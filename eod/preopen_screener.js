'use strict';
/*
 * eod/preopen_screener.js —— 盘前选股入口（Pre-Open Screener 编排层）
 * ---------------------------------------------------------------------------
 * 流程：
 *   1. 时段守卫（sessionState）：非交易日 / 未到 9:20 / 已过 9:35 → 跳过
 *   2. 抓竞价快照：观察池(fetchBatch) 或 全市场(fullMarketSnapshot)
 *   3. 基线：前一日 K 线算 昨涨 + 趋势（观察池实时算；全市场用隔夜缓存）
 *   4. 应用 P1/P2/P3 → 排除项 → 综合打分 → 分组
 *   5. 落库(JSON) → HTML 报告 → 通知 → git 推送溯源
 *
 * 用法：
 *   node eod/preopen_screener.js                     # 观察池，正常（受时段限制）
 *   node eod/preopen_screener.js --universe          # 全市场盲扫（需 baseline 缓存）
 *   node eod/preopen_screener.js --scope universe     # 同上
 *   node eod/preopen_screener.js --baseline           # 仅预计算基线缓存（供全市场次日用）
 *   node eod/preopen_screener.js --force              # 忽略时段，按当前快照取数
 *   node eod/preopen_screener.js --now "2026-10-22 09:25"  # 指定时刻（测试/补跑）
 *   node eod/preopen_screener.js --no-notify          # 不推送通知
 *   node eod/preopen_screener.js --no-push            # 不 git 推送（仅落本地）
 *   node eod/preopen_screener.js --json               # stdout 机器摘要
 *   node eod/preopen_screener.js --paths              # 打印落点
 *
 * 时段守卫：9:20–9:35 之外静默跳过（避免定时任务误触 / 上午空跑）。
 * 开盘价(open)在 9:25 撮合后固定，9:25–9:35 抓到的 open 一致 → 调度有 5 分钟宽限。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const cfg = require('./preopen.config');
const { dayjs } = require('../time');
const { lastClosedTradingDay } = require('../rules');
const market = require('./lib/market');
const PR = require('./lib/preopen_rules');
const store = require('./lib/preopen_store');
const { buildHTML } = require('./lib/preopen_report');
const { loadIndustryMap, listedOf, sectorOf, UNKNOWN } = require('./lib/sector');
const { mapLimit } = require('./lib/http');
const { notify } = require('../notify');
const paths = require('../paths');
const scaffold = require('../scaffold');

const argv = process.argv.slice(2);
function argOf(f) { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; }
const OPT = {
  universe: argv.includes('--universe') || argOf('--scope') === 'universe',
  baseline: argv.includes('--baseline'),
  force: argv.includes('--force'),
  now: argOf('--now'),
  noNotify: argv.includes('--no-notify'),
  noPush: argv.includes('--no-push'),
  json: argv.includes('--json'),
  paths: argv.includes('--paths'),
  init: argv.includes('--init'),
  stamp: argv.includes('--stamp'),
};
const RUNNER = process.env.GITHUB_ACTIONS ? 'github' : 'local';
function log(m) { if (!OPT.json) console.log(m); }

function fail(msg, err) {
  log(`[失败] ${msg}` + (err ? `\n${err && err.stack || err}` : ''));
  if (cfg.notify.enabled && cfg.notify.alertOnFailure && !OPT.noNotify) {
    notify({ title: `盘前选股失败 · ${dayjs.tz().format('MM-DD HH:mm')}`, content: `${msg}\n\n${err && err.message || err || ''}` })
      .then((res) => { for (const [ch, [ok, info]] of res) log(`[notify] ${ch}: ${ok ? 'OK' : '失败'}`); })
      .catch(() => {});
  }
  process.exitCode = 1;
}

// ---------- 时段守卫 ----------
function sessionState({ now, marketDate, force }) {
  const from = parseInt(cfg.session.openFrom.replace(':', ''), 10);
  const to = parseInt(cfg.session.openTo.replace(':', ''), 10);
  const hhmm = now.hour() * 100 + now.minute();
  const today = now.format('YYYY-MM-DD');
  if (force) return { ok: true, reason: '--force 忽略时段', tradeDate: marketDate || today };
  if (hhmm < from) return { ok: false, reason: `未到盘前窗口（${cfg.session.openFrom} 起）` };
  if (hhmm > to) return { ok: false, reason: `已过盘前窗口（${cfg.session.openTo} 止，可用 --force 补跑）` };
  if (marketDate && marketDate !== today) {
    return { ok: false, reason: `行情日期 ${marketDate} ≠ 今日，非交易日，跳过` };
  }
  return { ok: true, reason: '盘前窗口内', tradeDate: marketDate || today };
}

// ---------- 观察池加载 ----------
function readCandidates() {
  const f = paths.candidatesFile();
  if (!fs.existsSync(f)) throw new Error('candidates.json 不存在，无法加载观察池');
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  const list = (c.stocks || []).map((s) => ({ code: String(s.code), name: String(s.name || s.code), sector: String(s.sector || '未分类') }));
  if (!list.length) throw new Error('candidates.json 的 stocks 为空');
  return list;
}

// ---------- 基线（前一日 K 线指标）----------
async function getBaseline(codes, anchor, scope) {
  if (scope === 'universe') {
    const cf = path.join(paths.eodDir(), cfg.baseline.dataDir, cfg.baseline.fileName(anchor));
    if (fs.existsSync(cf)) {
      log(`[基线] 加载缓存 ${path.basename(cf)}`);
      const m = new Map();
      for (const [code, b] of Object.entries(JSON.parse(fs.readFileSync(cf, 'utf8')))) m.set(code, b);
      return m;
    }
    if (!cfg.baseline.computeIfMissing) { log('[基线] 全市场无缓存且禁用实时计算 → 跳过趋势(P3)'); return new Map(); }
    log('[基线] 全市场缓存缺失，实时计算（较慢，约数分钟）…');
  }
  const m = new Map();
  const res = await mapLimit(codes, cfg.market.concurrency, async (code) => {
    try {
      const kl = await market.fetchKline(code, anchor);
      return [code, PR.calcBaseline(kl, code, cfg)];
    } catch (e) { return [code, { error: String((e && e.message) || e) }]; }
  });
  let okN = 0, errN = 0;
  for (const [code, b] of res) {
    if (b && !b.error) { m.set(code, b); okN++; } else errN++;
  }
  log(`[基线] K线 ${okN} 只成功 / ${errN} 只失败`);
  if (scope === 'universe' && m.size) {
    const out = {}; for (const [code, b] of m) out[code] = b;
    fs.mkdirSync(path.dirname(path.join(paths.eodDir(), cfg.baseline.dataDir, cfg.baseline.fileName(anchor))), { recursive: true });
    const cf = path.join(paths.eodDir(), cfg.baseline.dataDir, cfg.baseline.fileName(anchor));
    fs.writeFileSync(cf, JSON.stringify(out), 'utf8');
    log(`[基线] 已缓存 ${m.size} 只 → ${path.basename(cf)}`);
  }
  return m;
}

// ---------- 排除项 ----------
function excludeOne(q, map, tradeDate) {
  const ex = cfg.exclude;
  if (ex.st && /ST|退/i.test(q.name)) return 'ST/退市风险';
  if (ex.suspended) {
    const hhmmss = String(q.stamp || '').slice(8, 14);
    if (!(q.vol > 0) || hhmmss === '090000') return '停牌/无成交';
  }
  if (ex.newListing) {
    if (/^[NC]/.test(q.name)) return '新股/次新';
    const listed = listedOf(map, q.code);
    if (listed && tradeDate) {
      const days = Math.abs(dayjs.tz(tradeDate + ' 00:00:00').diff(dayjs.tz(listed.slice(0, 10) + ' 00:00:00'), 'day'));
      if (days < ex.newListingDays) return '上市过短';
    }
  }
  return null;
}

// ---------- git 推送（溯源）----------
function gitPush(files, message) {
  const root = paths.PKG_ROOT;
  const run = (args, allowFail) => {
    try { return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString(); }
    catch (e) { if (allowFail) return ''; throw e; }
  };
  run(['add', ...files]);
  run(['-c', 'core.hooksPath=.git/cph', 'commit', '-m', message]);
  const sha = run(['rev-parse', 'HEAD']).trim();
  run(['-c', 'credential.helper=', '-c', 'credential.helper=wincred', 'push', 'origin', `${sha}:refs/heads/main`]);
}

// ---------- 主流程 ----------
async function run() {
  if (OPT.paths) {
    const d = paths.describe();
    log(`工作目录: ${d.home} (来源 ${d.source})`);
    for (const [k, v] of Object.entries(d.workspace)) log(`  ${k.padEnd(14)} ${v}`);
    return { paths: d };
  }
  if (OPT.init) { scaffold.autoInit({ log, init: true }); return { init: true }; }
  scaffold.autoInit({ log });

  const now = OPT.now
    ? dayjs.tz(OPT.now.replace(' ', 'T') + '+08:00')
    : dayjs.tz();
  const anchor = lastClosedTradingDay(now);   // 前一日 K 线锚定日

  // 时段守卫（本地时钟，第一遍）
  let ss = sessionState({ now, force: OPT.force });
  log(`[时段] ${ss.reason}`);
  if (!ss.ok) { log('[结束] 跳过'); return { skipped: ss.reason }; }

  // 范围与代码
  const scope = OPT.universe ? 'universe' : cfg.scope.default;
  let codes, quotes;
  if (scope === 'watchlist') {
    const watch = readCandidates();
    codes = watch.map((w) => w.code);
    log(`[1/4] 抓观察池竞价快照（${codes.length} 只）…`);
    quotes = (await market.fetchBatch(codes, cfg)).filter((q) => q);
  } else {
    log('[1/4] 抓全市场竞价快照…');
    const snap = await market.fullMarketSnapshot(cfg, log);
    quotes = snap.quotes;
    if (snap.meta.valid < cfg.market.minValidQuotes) throw new Error(`有效报价 ${snap.meta.valid} 低于红线 ${cfg.market.minValidQuotes}`);
    codes = quotes.map((q) => q.code);
    log(`      快照 ${snap.meta.valid} 只（交易日 ${snap.meta.marketDate}）`);
    // 第二遍时段守卫（用行情日期确认交易日）
    ss = sessionState({ now, marketDate: snap.meta.marketDate, force: OPT.force });
    if (!ss.ok) { log('[结束] 跳过'); return { skipped: ss.reason }; }
  }
  const tradeDate = ss.tradeDate;

  // 基线
  log('[2/4] 计算基线（昨涨 + 趋势）…');
  const baseline = await getBaseline(codes, anchor, scope);

  // 行业映射（分组用）
  const map = loadIndustryMap();
  if (map.count < 3000) log(`[警告] 行业映射仅 ${map.count} 只，分组可能失真`);

  // 规则 + 打分
  log('[3/4] 应用 P1/P2/P3 打分…');
  const candidates = [];
  const gaps = [];
  for (const q of quotes) {
    const b = baseline.get(q.code);
    if (!b) { gaps.push({ code: q.code, name: q.name, reason: '无基线K线' }); continue; }
    const exR = excludeOne(q, map, tradeDate);
    if (exR) { gaps.push({ code: q.code, name: q.name, reason: exR }); continue; }

    const p1 = PR.calcP1(q, b, cfg);
    q.__auctionChgPct = p1.auctionChgPct;
    const p2 = PR.calcP2(q, b, cfg);
    const p3 = PR.calcP3(b, cfg);
    const sc = PR.scorePreopen(p1, p2, p3, cfg);
    if (sc.total < cfg.score.minTotal) continue;

    const sector = sectorOf(map, q.code) || UNKNOWN;
    candidates.push({
      code: q.code, name: q.name, sector,
      board: /sh68[89]/.test(q.code) ? '科创板' : /^sz30/.test(q.code) ? '创业板' : /^bj/.test(q.code) ? '北交所' : '主板',
      open: q.open, prevClose: q.prevClose, price: q.price,
      auctionChgPct: p1.auctionChgPct, auctionVolRatio: p1.auctionVolRatio,
      yesterdayChgPct: b.yesterdayChgPct,
      trend: { maBull: p3.maBull, newHigh20: p3.newHigh20, newHigh60: p3.newHigh60, slope20: p3.slope20 },
      p1, p2, p3,
      label: PR.labelOf(p1, p2, p3),
      risk: p2.risk,
      total: +sc.total.toFixed(1),
      scoreItems: { p1: +p1.score.toFixed(2), p2: +p2.score.toFixed(2), p3: +p3.score.toFixed(2) },
      stamp: q.stamp,
    });
  }
  candidates.sort((a, b) => b.total - a.total);

  // 分组
  const bySector = new Map();
  for (const c of candidates) {
    if (!bySector.has(c.sector)) bySector.set(c.sector, []);
    bySector.get(c.sector).push(c);
  }
  const groups = [];
  for (const [sector, list] of bySector) {
    list.sort((a, b) => b.total - a.total);
    list.forEach((c, i) => { c.groupRank = i + 1; c.bestInGroup = i === 0; c.groupSize = list.length; });
    groups.push({ sector, size: list.length, shown: list.slice(0, cfg.group.maxPerGroup), best: list[0] });
  }
  groups.sort((a, b) => b.best.total - a.best.total);

  const result = {
    candidates, groups, top: candidates.slice(0, cfg.group.topN),
    stats: { snapshotCount: quotes.length, baselineCount: baseline.size, candidateCount: candidates.length, groupCount: groups.length, gapCount: gaps.length },
    gaps,
  };

  log(`[4/4] 落库 + 报告 + 通知…`);
  return emitResult({ tradeDate, scope, anchor, result, baselineCount: baseline.size, quotesCount: quotes.length, marketDate: tradeDate, _t0: Date.now() });
}

async function emitResult(p) {
  const { tradeDate, scope, result, marketDate } = p;
  const saved = store.saveRun({
    cfg, tradeDate, scope, candidates: result.candidates,
    meta: { snapshotCount: result.stats.snapshotCount, baselineCount: p.baselineCount, validQuotes: p.quotesCount, marketDate, elapsedMs: Date.now() - (p._t0 || Date.now()) },
    marketDate,
  });
  log(`[落库] ${path.basename(saved.file)}（${saved.recordCount} 条 / 第 ${saved.runCount} 次运行）`);

  const reportDir = path.join(paths.eodDir(), cfg.store.reportDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const suffix = OPT.stamp ? `-${dayjs.tz().format('HHmm')}` : '';
  const reportFile = path.join(reportDir, `${cfg.store.prefix}-${tradeDate}${suffix}.html`);
  fs.writeFileSync(reportFile, buildHTML({ cfg, tradeDate, scope, result, marketDate, runner: RUNNER }), 'utf8');
  log(`[报告] ${reportFile}`);

  if (cfg.notify.enabled && !OPT.noNotify) {
    const top = result.top.slice(0, cfg.notify.topInMessage);
    const lines = top.map((c, i) =>
      `${i + 1}. ${c.name}（${c.code.replace(/^[a-z]+/, '')}）${c.sector} · 竞价${c.auctionChgPct?.toFixed(2)}% · 昨${c.yesterdayChgPct?.toFixed(2)}% · ${c.label} · 总分${c.total}`);
    const content = [
      `交易日 ${tradeDate} · 盘前选股（${scope === 'universe' ? '全市场' : '观察池'}）`,
      `候选 ${result.stats.candidateCount} 只 / ${result.stats.groupCount} 行业（快照 ${result.stats.snapshotCount} → 基线 ${result.stats.baselineCount}）`,
      '', ...lines, '',
      `完整报告见本地：eod/reports/${cfg.store.prefix}-${tradeDate}${suffix}.html`,
    ].join('\n');
    const res = await notify({ title: `盘前选股 ${tradeDate}（${result.stats.candidateCount} 只）`, content, htmlPath: reportFile });
    for (const [ch, [ok, info]] of res) log(`[notify] ${ch}: ${ok ? 'OK' : '失败 ' + JSON.stringify(info)}`);
  }

  // 推送远程溯源
  if (!OPT.noPush) {
    try {
      const pushFiles = [saved.file, reportFile];
      gitPush(pushFiles, `preopen: ${tradeDate} 候选 ${result.stats.candidateCount} 只（${scope}）`);
      log('[推送] 已 git 提交并推送远程（溯源）');
    } catch (e) {
      log(`[推送] 失败（数据已落本地，可稍后手动推送）：${e && e.message || e}`);
    }
  }

  const summary = {
    tradeDate, scope,
    snapshot: result.stats.snapshotCount, baseline: result.stats.baselineCount,
    candidates: result.stats.candidateCount, groups: result.stats.groupCount,
    top: result.top.slice(0, 10).map((c) => ({ code: c.code, name: c.name, total: c.total, label: c.label })),
    reportFile, savedFile: saved.file,
  };
  if (OPT.json) console.log(JSON.stringify(summary, null, 2));
  return summary;
}

run().catch((e) => fail('盘前选股流程异常', e));
