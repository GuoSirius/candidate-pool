'use strict';
/*
 * eod/pattern_screener.js —— 形态选股入口（编排层）
 * ---------------------------------------------------------------------------
 * 流程：
 *   1. 锚定实时行情实际交易日（marketDate）：开盘前停在上一交易日→锚定上一交易日（完整 K、走缓存）；
 *      开盘后行情日切到当日→锚定当日（含实时 K、不读/不写缓存）。天然覆盖法定节假日/调休/临时休市。
 *   2. 全市场快照 → 宽松粗筛（只排除明确不可能的，形态票常缩量整理，按活跃度排序会误杀）
 *   3. 仅对入围票抓前复权日 K（两阶段漏斗，避免 ~5000 次请求触发 WAF），日档缓存
 *   4. 双引擎跑四类形态 → 参考价位 → 行业分组 → 上榜/游资（低频，失败留空）
 *   5. 落库(JSON) → HTML 报告（可过滤）→ 通知（默认关）
 *
 * 用法：
 *   node eod/pattern_screener.js                    # 默认全市场，锚定实时行情实际交易日（开盘前=上一交易日，开盘后=当日实时）
 *   node eod/pattern_screener.js --scope watchlist  # 观察池（快速调试）
 *   node eod/pattern_screener.js --date 2026-11-09  # 指定锚定日
 *   node eod/pattern_screener.js --limit 300        # 粗筛后只取前 N 只（调试）
 *   node eod/pattern_screener.js --replay           # 从 K 线缓存零网络重算（无 --date 时取最新缓存日，调阈值用）
 *   node eod/pattern_screener.js --refresh          # 忽略缓存强制重抓 K 线
 *   node eod/pattern_screener.js --no-notify --json --paths --init
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const cfg = require('./pattern.config');
const { dayjs } = require('../time');
const { lastClosedTradingDay } = require('../rules');
const market = require('./lib/market');
const PR = require('./lib/preopen_rules');
const store = require('./lib/pattern_store');
const { stampToDate } = require('./lib/trading');
const E = require('./lib/pattern_engine');
const F = require('./lib/pattern_features');
const { loadIndustryMap, sectorOf, listedOf, UNKNOWN } = require('./lib/sector');
const { mapLimit } = require('./lib/http');
const { minifyHTML } = require('./lib/report_fmt');
const { buildHTML } = require('./lib/pattern_report');
const paths = require('../paths');
const scaffold = require('../scaffold');
const { notify } = require('../notify');

const argv = process.argv.slice(2);
function argOf(f) { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; }
const OPT = {
  scope: argOf('--scope') || cfg.scope.default,
  date: argOf('--date'),
  now: argOf('--now'),
  limit: Math.max(0, parseInt(argOf('--limit'), 10) || 0),
  replay: argv.includes('--replay'),
  refresh: argv.includes('--refresh'),
  noNotify: argv.includes('--no-notify'),
  json: argv.includes('--json'),
  paths: argv.includes('--paths'),
  init: argv.includes('--init'),
};
const RUNNER = process.env.GITHUB_ACTIONS ? 'github' : 'local';
function log(m) { if (!OPT.json) console.log(m); }
if (!OPT.paths) require('./lib/runlog').startRunLog('pattern');

function fail(msg, err) {
  log(`[失败] ${msg}` + (err ? `\n${(err && err.stack) || err}` : ''));
  if (cfg.notify.alertOnFailure && !OPT.noNotify) {
    notify({ title: `形态选股失败 · ${dayjs.tz().format('MM-DD HH:mm')}`, content: `${msg}\n\n${(err && err.message) || err || ''}` })
      .then((res) => { for (const [ch, [ok]] of res) log(`[notify] ${ch}: ${ok ? 'OK' : '失败'}`); })
      .catch(() => {});
  }
  process.exitCode = 1;
}

function boardOf(code) {
  return /sh68[89]/.test(code) ? '科创板' : /^sz30/.test(code) ? '创业板' : /^bj/.test(code) ? '北交所' : '主板';
}

/** 报价精简（写进 K 线缓存，供 --replay 复用） */
function liteQuote(q, sector) {
  return {
    name: q.name, price: q.price, prevClose: q.prevClose, open: q.open,
    high: q.high, low: q.low, chgPct: q.chgPct, volRatio: q.volRatio,
    turnover: q.turnover, totalCapYi: q.totalCapYi, floatCapYi: q.floatCapYi,
    stamp: q.stamp, sector,
  };
}

function readCandidates() {
  const f = paths.candidatesFile();
  if (!fs.existsSync(f)) throw new Error('candidates.json 不存在，无法加载观察池');
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  const list = (c.stocks || []).map((s) => String(s.code));
  if (!list.length) throw new Error('candidates.json 的 stocks 为空');
  return list;
}

/** 粗筛：只排除明确不可能的标的，不按活跃度取 TopN */
function coarseFilter(quotes, map, tradeDate) {
  const f = cfg.funnel, ex = cfg.exclude, rej = {};
  const kept = [];
  const drop = (why) => { rej[why] = (rej[why] || 0) + 1; };
  for (const q of quotes) {
    if (ex.st && /ST|退/i.test(q.name)) { drop('ST/退市风险'); continue; }
    if (ex.suspended) {
      const hhmmss = String(q.stamp || '').slice(8, 14);
      if (!(q.vol > 0) || hhmmss === '090000') { drop('停牌/无成交'); continue; }
    }
    if (ex.newListing) {
      if (/^[NC]/.test(q.name)) { drop('新股/次新'); continue; }
      const listed = listedOf(map, q.code);
      if (listed && tradeDate) {
        const days = Math.abs(dayjs.tz(tradeDate + ' 00:00:00').diff(dayjs.tz(listed.slice(0, 10) + ' 00:00:00'), 'day'));
        if (days < ex.newListingDays) { drop('上市过短'); continue; }
      }
    }
    if (!(q.price >= f.minPrice && q.price <= f.maxPrice)) { drop('价格区间'); continue; }
    if (!(q.totalCapYi >= f.minTotalCapYi && q.totalCapYi <= f.maxTotalCapYi)) { drop('市值区间'); continue; }
    if (!(q.turnover >= f.minTurnoverPct)) { drop('换手过低'); continue; }
    if (!(q.volRatio >= f.minVolRatio)) { drop('量比过低'); continue; }
    if (!(q.amountWan >= f.minAmountWan)) { drop('成交额过低'); continue; }
    kept.push(q);
  }
  kept.sort((a, b) => (b.amountWan || 0) - (a.amountWan || 0)); // 仅用于 --limit 调试截断
  return { kept: OPT.limit > 0 ? kept.slice(0, OPT.limit) : kept, rej, total: kept.length };
}

/** 抓 K 线（或复用日档缓存）；失败率超红线直接中止，绝不产出假的「0 命中」 */
async function getKlines(codes, quotesByCode, anchor, funnel = {}) {
  const allowCacheRead = funnel.allowCacheRead;
  const allowCacheWrite = funnel.allowCacheWrite;
  if (allowCacheRead || OPT.replay) {
    const cache = store.loadKlineCache(cfg, anchor);
    if (cache) {
      log(`[K线] 复用缓存 ${path.basename(store.klineFile(cfg, anchor))}（${cache.count} 只，${cache.generatedAt}）`);
      const entries = Object.entries(cache.bars).map(([code, asc]) => ({
        code, kline: { rows: asc.slice().reverse() }, quote: cache.quotes[code] || null,
      }));
      return { entries, fromCache: true, quotesByCode: cache.quotes, funnel: cache.meta || {} };
    }
    if (OPT.replay) throw new Error(`--replay 需要 ${anchor} 的 K 线缓存，但未找到（先正常跑一次）`);
  }

  log(`[K线] 抓取 ${codes.length} 只（并发 ${cfg.kline.concurrency}，锚定 ${anchor}）…`);
  let done = 0;
  const res = await mapLimit(codes, cfg.kline.concurrency, async (code) => {
    try {
      const kl = await market.fetchKline(code, anchor);
      return { code, kline: kl, quote: quotesByCode[code] || null };
    } catch (e) {
      return { code, error: String((e && e.message) || e) };
    } finally {
      if ((++done) % cfg.kline.progressEvery === 0) log(`      K线进度 ${done}/${codes.length}`);
    }
  });
  const ok = [], failCodes = [];
  for (const r of res) {
    if (r && !r.error && r.kline) ok.push(r);
    else failCodes.push(r && r.code);
  }
  const failRate = codes.length ? failCodes.length / codes.length : 1;
  log(`[K线] 成功 ${ok.length} / 失败 ${failCodes.length}（失败率 ${(failRate * 100).toFixed(1)}%）`);
  if (failRate > cfg.kline.maxFailRate) {
    throw new Error(`K线失败率 ${(failRate * 100).toFixed(1)}% 超过红线 ${(cfg.kline.maxFailRate * 100).toFixed(0)}%，疑似数据源拦截，中止（不生成报告/不覆盖归档）`);
  }
  if (allowCacheWrite) {
    const saved = store.saveKlineCache(cfg, anchor, ok, { scope: OPT.scope, source: 'live', ...funnel });
    log(`[K线] 已缓存 ${saved.count} 只 → ${path.basename(saved.file)}`);
  } else {
    log(`[K线] 盘中实时模式，不写缓存（避免半截当日 K 线）`);
  }
  return { entries: ok, fromCache: false, quotesByCode };
}

/** 逐票跑引擎 → 候选 / 贴线 / 缺口 */
function buildCandidates(entries, defs, quotesByCode, map) {
  const candidates = [], nearMiss = [], gaps = [];
  for (const e of entries) {
    const code = e.code;
    const rowsDesc = (e.kline && e.kline.rows) || [];
    const asc = F.toAsc(rowsDesc);
    const q = quotesByCode[code] || e.quote || {};
    const name = q.name || code;
    if (asc.length < cfg.kline.minBars) { gaps.push({ code, name, reason: `K线不足 ${asc.length}/${cfg.kline.minBars}` }); continue; }
    const ser = F.series(asc);
    let all, sum;
    try {
      all = E.matchAll(asc, ser, defs, cfg, code);
    } catch (e) {
      // 单票引擎异常不应拖垮整条流水线（否则零产物、零归档）。
      // 记缺口放行，保证其余标的照常产出。
      gaps.push({ code, name, reason: `引擎异常：${(e && e.message) || e}` });
      continue;
    }
    const matches = all.filter((m) => m.stage !== '已破位');
    if (!matches.length) continue;
    sum = E.summarize(matches, cfg);
    const rec = {
      code, name,
      sector: q.sector || sectorOf(map, code) || UNKNOWN,
      board: boardOf(code),
      price: q.price != null ? q.price : asc[asc.length - 1].close,
      chgPct: q.chgPct != null ? q.chgPct : ser.chg[ser.chg.length - 1],
      volRatio: q.volRatio, turnover: q.turnover,
      capYi: { total: q.totalCapYi, float: q.floatCapYi },
      score: sum.primary.score, total: sum.total,
      resonance: sum.resonance, stage: sum.stage,
      patternIds: sum.patternIds, patternNames: sum.patternNames,
      patterns: matches.map((m) => ({
        id: m.id, name: m.name, nameEn: m.nameEn, engine: m.engine,
        score: m.score, stage: m.stage, window: m.window,
        features: m.features, featureScores: m.featureScores, gates: m.gates,
      })),
      window: sum.primary.window,
      priceLevels: sum.price,
      boards: PR.boardsInfo(rowsDesc, code),
      spark: F.sparkBars(asc, cfg.report.sparkBars),
      billboard: null,
    };
    if (rec.score >= cfg.score.minMatch) candidates.push(rec);
    else if (rec.score >= cfg.score.minMatch - cfg.score.nearMissBand) nearMiss.push(rec);
  }
  candidates.sort((a, b) => b.total - a.total || b.score - a.score);
  nearMiss.sort((a, b) => b.total - a.total);
  return { candidates, nearMiss: nearMiss.slice(0, 20), gaps };
}

/** 补全上榜/游资（仅命中票，低频；东财失败留空不阻断） */
async function attachBillboard(candidates, anchor) {
  if (!candidates.length) return;
  let bb = null;
  try { bb = await market.fetchBillboard(anchor); }
  catch (e) { log(`[上榜] 龙虎榜抓取失败，相关列留空：${e.message}`); }
  if (!bb) return;
  const list = candidates.filter((c) => bb[c.code.slice(2)]);
  log(`[上榜] 命中 ${list.length} 只，抓席位明细…`);
  await mapLimit(list, 4, async (c) => {
    try {
      const seats = await market.fetchBillboardSeats(c.code.slice(2), anchor);
      c.billboard = { net: bb[c.code.slice(2)].net, hot: PR.matchHotMoney(seats) };
    } catch (e) { /* 席位抓取失败留空 */ }
  });
}

function groupBySector(candidates) {
  const by = new Map();
  for (const c of candidates) {
    if (!by.has(c.sector)) by.set(c.sector, []);
    by.get(c.sector).push(c);
  }
  const groups = [];
  for (const [sector, list] of by) {
    list.sort((a, b) => b.total - a.total);
    list.forEach((c, i) => { c.groupRank = i + 1; c.bestInGroup = i === 0; });
    groups.push({ sector, size: list.length, best: list[0] });
  }
  groups.sort((a, b) => b.best.total - a.best.total);
  return groups;
}

async function emitResult(p) {
  const { tradeDate, scope, result, anchor, fromCache, rejByReason } = p;
  // --replay 没有全市场快照，漏斗计数沿用上次归档，避免逐次重算退化成 0
  const pm = ((store.loadRun(cfg, tradeDate) || {}).meta) || {};
  const snapCount = p.snapshotCount || pm.snapshotCount || 0;
  const coarseCount = p.coarseCount || pm.coarseCount || 0;
  const saved = store.saveRun({
    cfg, tradeDate, scope, candidates: result.candidates,
    nearMiss: result.nearMiss, rejByReason, anchor,
    meta: {
      snapshotCount: snapCount, coarseCount, klineCount: p.klineCount,
      candidateCount: result.candidates.length, groupCount: result.groups.length,
      gapCount: result.gaps.length, fromCache, definitions: path.basename(p.defs.source), limitApplied: OPT.limit || 0,
      version: cfg.version, elapsedMs: Date.now() - (p._t0 || Date.now()),
    },
  });
  log(`[落库] ${path.basename(saved.file)}（${saved.recordCount} 条 / 第 ${saved.runCount} 次运行）`);

  const reportDir = path.join(paths.eodDir(), cfg.store.reportDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, `${cfg.store.prefix}-${tradeDate}.html`);
  fs.writeFileSync(reportFile, minifyHTML(buildHTML({
    cfg, tradeDate, scope, result, defs: p.defs, runner: RUNNER,
    anchor, fromCache, marketDate: p.marketDate,
  })), 'utf8');
  log(`[报告] ${reportFile}`);

  if (cfg.notify.enabled && !OPT.noNotify) {
    const lines = result.candidates.slice(0, 20).map((c, i) =>
      `${i + 1}. ${c.name}（${c.code.slice(2)}）${c.sector} · ${c.patternNames.join('+')} · ${numScore(c.score)}分 · ${c.stage}`);
    const res = await notify({
      title: `形态选股 ${tradeDate}（${result.candidates.length} 只）`,
      content: [`交易日 ${tradeDate} · 形态选股（${scope === 'universe' ? '全市场' : '观察池'}）`,
        `候选 ${result.candidates.length} 只 / ${result.groups.length} 行业`, '', ...lines].join('\n'),
      htmlPath: reportFile,
    });
    for (const [ch, [ok]] of res) log(`[notify] ${ch}: ${ok ? 'OK' : '失败'}`);
  }
  return {
    tradeDate, scope, candidates: result.candidates.length, groups: result.groups.length,
    top: result.top.slice(0, 10).map((c) => ({ code: c.code, name: c.name, patterns: c.patternNames, score: c.score, stage: c.stage })),
    reportFile, savedFile: saved.file,
  };
}

function numScore(v) { return Number(v || 0).toFixed(1); }

/** 从报价戳众数推出行情日（与 trading.js 同一口径；观察池无全市场众数时退化为最多出现的日期）。 */
function marketDateFromQuotes(quotes) {
  const byDate = new Map();
  for (const q of quotes) {
    const d = stampToDate(q.stamp);
    if (d) byDate.set(d, (byDate.get(d) || 0) + 1);
  }
  let best = null, n = 0;
  for (const [d, c] of byDate) if (c > n) { n = c; best = d; }
  return best;
}

/** 抓全市场 / 观察池快照，返回 { quotes, marketDate }；marketDate 由报价时间戳众数推出。 */
async function fetchSnapshot(cfg, log) {
  if (OPT.scope === 'watchlist') {
    const cs = readCandidates();
    log(`[1/4] 抓观察池快照（${cs.length} 只）…`);
    const quotes = (await market.fetchBatch(cs, cfg)).filter(Boolean);
    return { quotes, marketDate: marketDateFromQuotes(quotes) };
  }
  log('[1/4] 抓全市场快照…');
  const snap = await market.fullMarketSnapshot(cfg, log);
  if (snap.meta.valid < cfg.market.minValidQuotes) {
    throw new Error(`有效报价 ${snap.meta.valid} 低于红线 ${cfg.market.minValidQuotes}`);
  }
  log(`      快照 ${snap.meta.valid} 只（行情日 ${snap.meta.marketDate}）`);
  return { quotes: snap.quotes, marketDate: snap.meta.marketDate || null };
}

async function run() {
  const t0 = Date.now();
  if (OPT.paths) {
    const d = paths.describe();
    log(`工作目录: ${d.home} (来源 ${d.source})`);
    for (const [k, v] of Object.entries(d.workspace)) log(`  ${k.padEnd(14)} ${v}`);
    log(`  ${'patternData'.padEnd(14)} ${store.dirOf(cfg)}`);
    log(`  ${'patternReport'.padEnd(14)} ${path.join(paths.eodDir(), cfg.store.reportDir)}`);
    return { paths: d };
  }
  if (OPT.init) { scaffold.autoInit({ log, init: true }); return { init: true }; }
  scaffold.autoInit({ log });
  if (!['watchlist', 'universe'].includes(OPT.scope)) {
    throw new Error(`--scope 仅支持 watchlist | universe，收到："${OPT.scope}"`);
  }

  const now = OPT.now ? dayjs.tz(OPT.now.replace(' ', 'T') + '+08:00') : dayjs.tz();
  if (OPT.now && !now.isValid()) throw new Error(`--now 格式非法："${OPT.now}"`);
  const calendarToday = now.format('YYYY-MM-DD');

  // ---- 锚定（第一步）----
  // 口径统一为「实时行情实际交易日」：开盘前行情日停在上一交易日 → 锚定上一交易日（完整 K、走缓存）；
  // 开盘后行情日切到当日 → 锚定当日（含实时 K，不读/不写缓存）。天然覆盖法定节假日 / 调休 / 临时休市。
  //   --date 显式优先（调试/回放目标日）；--replay 无 --date → 最新 K 线缓存日；否则取实时快照的行情日。
  let anchor = null;
  let marketDate = null;
  let intraday = false; // 锚定日 == 今日历日 → 盘中实时
  if (OPT.date) {
    anchor = OPT.date;
    marketDate = anchor;
    intraday = (anchor === calendarToday);
  } else if (OPT.replay) {
    anchor = store.latestKlineCacheDate(cfg) || lastClosedTradingDay(now);
    marketDate = anchor;
  }
  log(`[锚定] ${anchor || '(待快照)'}（范围 ${OPT.scope}）`);

  const defs = E.loadDefs(cfg);
  log(`[形态] ${defs.patterns.map((p) => p.name).join(' / ')} ← ${path.basename(defs.source)}`);
  const map = loadIndustryMap();
  if (map.count < 3000) log(`[警告] 行业映射仅 ${map.count} 只，分组可能失真`);

  let quotesByCode = {}, codes = [], snapshotCount = 0, coarseCount = 0, rejByReason = {};
  let quotes = null; // 本次现抓的快照报价（非 --replay 且需粗筛时有值）

  // live 无 --date：先抓快照拿到行情日，再锚定（必须在 K 线缓存判定之前）
  if (!OPT.replay && !OPT.date) {
    const snap = await fetchSnapshot(cfg, log); // { quotes, marketDate }
    quotes = snap.quotes;
    marketDate = snap.marketDate;
    anchor = marketDate || lastClosedTradingDay(now);
    intraday = (anchor === calendarToday);
    log(`[锚定] ${anchor}（行情日 ${marketDate || '—'}，${intraday ? '盘中实时' : '已收盘/休市'}）`);
  }

  // K 线缓存开关：盘中实时（锚定当日）不读/不写，避免缓存半截当日 K；
  // 上一交易日 / 显式历史日 / --replay 正常走缓存。
  const cacheRead = (cfg.kline.cache && !OPT.refresh && !intraday) || OPT.replay;
  const cache = cacheRead ? store.loadKlineCache(cfg, anchor) : null;
  if (cache && !OPT.refresh) {
    log(`[缓存] 命中 ${anchor} 日档（${cache.count} 只），跳过全市场快照`);
    const pm = ((store.loadRun(cfg, anchor) || {}).meta) || {};
    const cm = cache.meta || {};
    snapshotCount = cm.snapshotCount || pm.snapshotCount || 0;
    coarseCount = cm.coarseCount || pm.coarseCount || cache.count;
    quotesByCode = cache.quotes || {};
  } else {
    if (!quotes) quotes = (await fetchSnapshot(cfg, log)).quotes;
    snapshotCount = quotes.length;
    const cf = coarseFilter(quotes, map, anchor);
    codes = cf.kept.map((q) => q.code);
    coarseCount = cf.total;
    rejByReason = cf.rej;
    for (const q of cf.kept) quotesByCode[q.code] = liteQuote(q, sectorOf(map, q.code) || UNKNOWN);
    log(`[2/4] 粗筛 ${cf.total} 只（原 ${quotes.length}，剔除 ${quotes.length - cf.total}）${OPT.limit ? ` · --limit 调试截断为 ${codes.length} 只` : ''}`);
    if (!codes.length) throw new Error('粗筛后无标的，检查 funnel 门槛');
  }

  const kl = await getKlines(codes, quotesByCode, anchor, {
    snapshotCount, coarseCount,
    allowCacheRead: cacheRead, allowCacheWrite: !intraday && !OPT.replay,
  });
  if (kl.fromCache) quotesByCode = kl.quotesByCode || quotesByCode;

  log('[3/4] 跑形态引擎…');
  const built = buildCandidates(kl.entries, defs, quotesByCode, map);
  const groups = groupBySector(built.candidates);
  const top = built.candidates.slice(0, cfg.score.maxRows > 0 ? cfg.score.maxRows : built.candidates.length);
  const result = {
    candidates: built.candidates, groups, top,
    nearMiss: built.nearMiss, gaps: built.gaps,
    stats: {
      snapshotCount, coarseCount: coarseCount || Object.keys(quotesByCode).length,
      klineCount: kl.entries.length, candidateCount: built.candidates.length,
      groupCount: groups.length, gapCount: built.gaps.length,
    },
  };
  log(`      命中 ${built.candidates.length} 只 / ${groups.length} 行业（贴线 ${built.nearMiss.length}）`);

  if (kl.fromCache) {
    const prev = store.loadRun(cfg, anchor);
    if (prev && prev.records) {
      for (const c of built.candidates) {
        const old = prev.records[c.code];
        if (old && old.billboard) c.billboard = old.billboard;
        if (old && old.verdicts) c.verdicts = old.verdicts;
      }
      log('[上榜] --replay 沿用已有归档的上榜/游资标注与回填');
    }
  } else {
    await attachBillboard(built.candidates, anchor);
  }

  log('[4/4] 落库 + 报告…');
  return emitResult({
    tradeDate: anchor, scope: OPT.scope, result, defs, anchor,
    fromCache: kl.fromCache, rejByReason, marketDate,
    snapshotCount, coarseCount: result.stats.coarseCount, klineCount: kl.entries.length,
    _t0: t0,
  });
}

run()
  .then((s) => { if (s && OPT.json) console.log(JSON.stringify(s, null, 2)); })
  .catch((e) => fail('形态选股流程异常', e));
