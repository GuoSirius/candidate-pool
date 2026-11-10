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
const { minifyHTML } = require('./lib/report_fmt');
const { calcRegime } = require('./lib/regime');
const scaffold = require('../scaffold');

const argv = process.argv.slice(2);
function argOf(f) { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; }
const OPT = {
  universe: argv.includes('--universe') || argOf('--scope') === 'universe',
  baseline: argv.includes('--baseline'),
  force: argv.includes('--force'),
  now: argOf('--now'),
  noNotify: argv.includes('--no-notify'),
  json: argv.includes('--json'),
  paths: argv.includes('--paths'),
  init: argv.includes('--init'),
  stamp: argv.includes('--stamp'),
};
const RUNNER = process.env.GITHUB_ACTIONS ? 'github' : 'local';
function log(m) { if (!OPT.json) console.log(m); }

// 日志统一归位：脚本自镜像到 eod/logs/<prefix>-<日期>.log（不依赖外部重定向；--paths 纯打印不记）
// 基线预计算是独立任务（03:00 跑，供次日盘前读缓存），用独立前缀，
// 否则会与当日 09:25 盘前选股主流程的日志混写进同一个文件、互相污染。
if (!OPT.paths) require('./lib/runlog').startRunLog(OPT.baseline ? 'preopen-baseline' : 'preopen');

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
  // 周末粗筛：不等行情数据即可拒掉，避免周末用陈旧报价打分（法定节假日仍靠行情日期第二遍守卫）
  const dow = now.day();
  if (dow === 0 || dow === 6) {
    return { ok: false, reason: `周末非交易日（周${['日', '一', '二', '三', '四', '五', '六'][dow]}），跳过（--force 可强制）` };
  }
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
/** 昨日换手% = 昨日成交量(股) / 流通股本；流通股本 = 流通市值(元) / 现价(元)（报价同一时刻取数，价格约掉）。注意科创板 K 线量单位是「股」 */
function yesterdayTurnoverPct(q, b) {
  if (!q.floatCap || q.floatCap <= 0 || !q.price || !b.yesterdayVol) return null;
  const lot = /^sh68[89]/.test(q.code) ? 1 : 100; // 手→股（科创板 K 线量本身就是股）
  const shares = q.floatCap / q.price; // 股
  return +((b.yesterdayVol * lot) / shares * 100).toFixed(2);
}

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
  if (OPT.now && !now.isValid()) throw new Error(`--now 格式非法："${OPT.now}"（应为 "YYYY-MM-DD HH:mm"）`);
  let anchor = lastClosedTradingDay(now);   // 初始值（供 --baseline 观察池等无快照分支兜底；主流程会被 marketDate 覆盖）

  // 仅预计算基线缓存（供全市场次日盘前用，建议收盘后定时跑）
  if (OPT.baseline) {
    const scope = argOf('--scope') || (OPT.universe ? 'universe' : cfg.scope.default);
    if (!['watchlist', 'universe'].includes(scope)) {
      throw new Error(`--scope 仅支持 watchlist | universe，收到："${scope}"`);
    }
    let codes;
    if (scope === 'universe') {
      // 全市场：先抓快照枚举「活跃」代码（~5000），只对活跃票抓 K 线；
      // 直接 expandCodes 会盲扫 3 万槽位（含大量 inactive），K 线逐个抓取会超时。
      log('[基线] 全市场模式：先抓快照枚举活跃代码…');
      const snap = await market.fullMarketSnapshot(cfg, log);
      codes = snap.quotes.map((q) => q.code);
      log(`[基线] 活跃代码 ${codes.length} 只（交易日 ${snap.meta.marketDate}）`);
      anchor = snap.meta.marketDate; // 基线锚定日直接取行情日（数据驱动，不依赖日历）
    } else {
      codes = readCandidates().map((c) => c.code);
    }
    log(`[基线预计算] scope=${scope} 共 ${codes.length} 只，锚定日 ${anchor}`);
    const m = new Map();
    let done = 0;
    const res = await mapLimit(codes, cfg.market.concurrency, async (code) => {
      try {
        const kl = await market.fetchKline(code, anchor);
        const b = PR.calcBaseline(kl, code, cfg);
        if ((++done) % 500 === 0) log(`[基线] 进度 ${done}/${codes.length}`);
        return [code, b];
      } catch (e) { return [code, { error: String((e && e.message) || e) }]; }
    });
    let ok = 0, err = 0;
    for (const [c, b] of res) { if (b && !b.error) { m.set(c, b); ok++; } else err++; }
    const out = {}; for (const [c, b] of m) out[c] = b;
    const cf = path.join(paths.eodDir(), cfg.baseline.dataDir, cfg.baseline.fileName(anchor));
    fs.mkdirSync(path.dirname(cf), { recursive: true });
    fs.writeFileSync(cf, JSON.stringify(out), 'utf8');
    log(`[基线] 已缓存 ${ok} 只（失败 ${err}）→ ${path.basename(cf)}`);
    return { baseline: { file: cf, ok, err } };
  }

  // 时段守卫（本地时钟，第一遍）
  let ss = sessionState({ now, force: OPT.force });
  log(`[时段] ${ss.reason}`);
  if (!ss.ok) { log('[结束] 跳过'); return { skipped: ss.reason }; }

  // 范围与代码（--scope 白名单校验：拼错值静默降级全市场盲扫太危险，评审 #20）
  const scope = argOf('--scope') || (OPT.universe ? 'universe' : cfg.scope.default);
  if (!['watchlist', 'universe'].includes(scope)) {
    throw new Error(`--scope 仅支持 watchlist | universe，收到："${scope}"`);
  }
  let codes, quotes;
  if (scope === 'watchlist') {
    const watch = readCandidates();
    codes = watch.map((w) => w.code);
    log(`[1/4] 抓观察池竞价快照（${codes.length} 只）…`);
    quotes = (await market.fetchBatch(codes, cfg)).filter((q) => q);
    // 第二遍时段守卫：观察池路径没有全市场 meta，用报价时间戳众数推行情日期（同口径）
    const byDate = new Map();
    for (const q of quotes) {
      const d = String(q.stamp || '').slice(0, 8);
      if (d) byDate.set(d, (byDate.get(d) || 0) + 1);
    }
    let mkStamp = '', best = 0;
    for (const [d, n] of byDate) if (n > best) { best = n; mkStamp = d; }
    const wlMarketDate = mkStamp ? `${mkStamp.slice(0, 4)}-${mkStamp.slice(4, 6)}-${mkStamp.slice(6, 8)}` : '';
    ss = sessionState({ now, marketDate: wlMarketDate || undefined, force: OPT.force });
    if (!ss.ok) { log('[结束] 跳过'); return { skipped: ss.reason }; }
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
  anchor = tradeDate; // 主流程锚定日 = 行情日（开盘前=上一交易日；数据驱动，不依赖日历）

  // 基线
  log('[2/4] 计算基线（昨涨 + 趋势）…');
  const baseline = await getBaseline(codes, anchor, scope);

  // 行业映射（分组用）
  const map = loadIndustryMap();
  if (map.count < 3000) log(`[警告] 行业映射仅 ${map.count} 只，分组可能失真`);

  // 规则 + 打分
  log('[3/4] 应用 P1/P2/P3 打分…');
  const candidates = [];
  const nearMissAll = [];
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
    const p4 = PR.calcP4(q, b, cfg, p1);
    const sc = PR.scorePreopen(p1, p2, p3, cfg);
    const sector = sectorOf(map, q.code) || UNKNOWN;
    // 双轨：score=打分入选 / p4=仅 P04 通道入选 / both=双轨皆中（报告按轨道过滤）
    const track = sc.total >= cfg.score.minTotal ? (p4.ok ? 'both' : 'score') : 'p4';
    const rec = {
      code: q.code, name: q.name, sector,
      board: /sh68[89]/.test(q.code) ? '科创板' : /^sz30/.test(q.code) ? '创业板' : /^bj/.test(q.code) ? '北交所' : '主板',
      open: q.open, prevClose: q.prevClose, price: q.price,
      auctionChgPct: p1.auctionChgPct, auctionVolRatio: p1.auctionVolRatio,
      yesterdayChgPct: b.yesterdayChgPct,
      yesterdayVolRatio: b.yesterdayVolRatio != null ? +b.yesterdayVolRatio.toFixed(2) : null,
      yesterdayTurnoverPct: yesterdayTurnoverPct(q, b),
      boards: b.boards || null,
      capYi: { total: q.totalCapYi, float: q.floatCapYi },
      trend: { maBull: p3.maBull, newHigh20: p3.newHigh20, newHigh60: p3.newHigh60, slope20: p3.slope20 },
      p1, p2, p3, p4,
      track,
      label: track === 'p4' ? cfg.rules.p4.label : PR.labelOf(p1, p2, p3),
      risk: p2.risk,
      total: +sc.total.toFixed(1),
      scoreItems: { p1: +p1.score.toFixed(2), p2: +p2.score.toFixed(2), p3: +p3.score.toFixed(2) },
      stamp: q.stamp,
    };
    if (sc.total < cfg.score.minTotal && !p4.ok) {
      // 贴线样本（2026-10-22 补）：总分落在 [minTotal-10, minTotal) 的进归档 nearMiss 段。
      // 竞价量比等特征无法事后从 K 线重建，被拒样本不留就无法回溯调「入选线」本身。
      // 2026-11-05 补：P04 通道只差一项门槛的也归档（p4Miss 标记差哪项），供调 P04 门槛。
      if (sc.total >= cfg.score.minTotal - 10) {
        nearMissAll.push(Object.assign(rec, { belowMin: +(cfg.score.minTotal - sc.total).toFixed(1) }));
      } else if (p4.miss === 1) {
        nearMissAll.push(Object.assign(rec, { belowMin: +(cfg.score.minTotal - sc.total).toFixed(1), p4Miss: p4.failed[0] }));
      }
      continue;
    }
    candidates.push(rec);
  }
  candidates.sort((a, b) => b.total - a.total);
  nearMissAll.sort((a, b) => b.total - a.total);
  const nearMiss = nearMissAll.slice(0, 10);

  // 昨日主力净流入（东财 fflow）+ 昨日龙虎榜（候选级低频调用；封 IP / 失败留空，不阻断）
  if (candidates.length) {
    log(`[3.5/4] 候选昨日净流入/龙虎榜（${candidates.length} 只，东财）…`);
    await mapLimit(candidates, 4, async (c) => {
      const f = await market.fetchFlowDay(c.code);
      if (f && f[anchor] != null) c.yesterdayMainInflow = f[anchor];
    });
    const bb = await market.fetchBillboard(anchor);
    // 席位明细并行抓（评审 #8：串行 40 只上榜最坏 ~10 分钟 → 4 并发 ~1.5 分钟）
    const bbCands = candidates.filter((c) => bb[c.code.slice(2)]);
    await mapLimit(bbCands, 4, async (c) => {
      try {
        const seats = await market.fetchBillboardSeats(c.code.slice(2), anchor);
        c.billboard = { net: bb[c.code.slice(2)].net, hot: PR.matchHotMoney(seats) };
      } catch (e) { /* 容错：席位抓取失败留空 */ }
    });
  }

  // 各淘汰原因计数（gaps 明细不落盘，只留统计——6000+ 只/天的明细太肥且没用）
  const rejByReason = {};
  for (const g of gaps) rejByReason[g.reason] = (rejByReason[g.reason] || 0) + 1;

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
    groups.push({ sector, size: list.length, shown: list.slice(0, cfg.group.maxPerGroup > 0 ? cfg.group.maxPerGroup : list.length), best: list[0] });
  }
  groups.sort((a, b) => b.best.total - a.best.total);

  const result = {
    candidates, groups, top: candidates.slice(0, cfg.group.topN > 0 ? cfg.group.topN : candidates.length),
    stats: { snapshotCount: quotes.length, baselineCount: baseline.size, candidateCount: candidates.length, groupCount: groups.length, gapCount: gaps.length, rejByReason },
    gaps,
    nearMiss,
  };

  log(`[4/4] 落库 + 报告 + 通知…`);
  // 市场环境标签（批次 B1）：仅全市场口径可判（观察池 378 只样本会误档）；失败降级为不显示
  const regime = scope === 'universe' ? calcRegime(quotes) : null;
  if (regime) log(`[环境] ${regime.label}（涨停 ${regime.limitUp} / 跌停 ${regime.limitDown} / 上涨占比 ${regime.upPct}%）${regime.tip ? ' · ' + regime.tip : ''}`);
  return emitResult({ tradeDate, scope, anchor, result, baselineCount: baseline.size, quotesCount: quotes.length, marketDate: tradeDate, regime, _t0: Date.now() });
}

async function emitResult(p) {
  const { tradeDate, scope, result, marketDate, regime } = p;
  const saved = store.saveRun({
    cfg, tradeDate, scope, candidates: result.candidates,
    nearMiss: result.nearMiss, rejByReason: result.stats.rejByReason,
    meta: { snapshotCount: result.stats.snapshotCount, baselineCount: p.baselineCount, validQuotes: p.quotesCount, marketDate, regime, elapsedMs: Date.now() - (p._t0 || Date.now()) },
    marketDate, anchor: p.anchor,
  });
  log(`[落库] ${path.basename(saved.file)}（${saved.recordCount} 条 / 第 ${saved.runCount} 次运行）`);

  const reportDir = path.join(paths.eodDir(), cfg.store.reportDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const suffix = OPT.stamp ? `-${dayjs.tz().format('HHmm')}` : '';
  const reportFile = path.join(reportDir, `${cfg.store.prefix}-${tradeDate}${suffix}.html`);
  fs.writeFileSync(reportFile, minifyHTML(buildHTML({ cfg, tradeDate, scope, result, marketDate, anchor: p.anchor, runner: RUNNER, regime })), 'utf8');
  log(`[报告] ${reportFile}`);

  if (cfg.notify.enabled && !OPT.noNotify) {
    const top = result.top.slice(0, cfg.notify.topInMessage > 0 ? cfg.notify.topInMessage : result.top.length);
    const lines = top.map((c, i) =>
      `${i + 1}. ${c.name}（${c.code.replace(/^[a-z]+/, '')}）${c.sector} · 竞价${c.auctionChgPct?.toFixed(2)}% · 昨${c.yesterdayChgPct?.toFixed(2)}% · ${c.label} · 总分${c.total}`);
    const content = [
      `交易日 ${tradeDate} · 盘前选股（${scope === 'universe' ? '全市场' : '观察池'}）`,
      `候选 ${result.stats.candidateCount} 只 / ${result.stats.groupCount} 行业（快照 ${result.stats.snapshotCount} → 基线 ${result.stats.baselineCount}）`,
      '', ...lines, '',
      `完整报告见本地：eod/reports/${cfg.store.reportDir.split('/').pop()}/${cfg.store.prefix}-${tradeDate}${suffix}.html`,
    ].join('\n');
    const res = await notify({ title: `盘前选股 ${tradeDate}（${result.stats.candidateCount} 只）`, content, htmlPath: reportFile });
    for (const [ch, [ok, info]] of res) log(`[notify] ${ch}: ${ok ? 'OK' : '失败 ' + JSON.stringify(info)}`);
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
