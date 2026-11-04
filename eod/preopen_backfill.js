'use strict';
/*
 * eod/preopen_backfill.js —— 收盘回填 + 命中率统计（溯源增强，Q3）
 * ---------------------------------------------------------------------------
 * 盘前快照只是"开盘信号"，价值要收盘验证。本脚本在 15:00–当日 23:59 运行：
 *   1. 读取当日 preopen-YYYYMMDD.json 的 records
 *   2. 抓取每只候选当日收盘（quote.price=收盘价，chgPct=当日涨幅）
 *   3. 回填：当日涨跌幅 / 是否涨停 / 命中（开盘买入当日收益 ≥ hitDayChgMin）
 *   4. 统计命中率，合并进归档（doc.close）
 *
 * 用法：
 *   node eod/preopen_backfill.js                  # 回填今日（受 15:00–23:59 窗口限制；跨夜补跑用 --date --force）
 *   node eod/preopen_backfill.js --date 2026-10-22
 *   node eod/preopen_backfill.js --force          # 忽略时段
 *   node eod/preopen_backfill.js --no-push        # 不推送归档
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const { dayjs } = require('../time');
const cfg = require('./preopen.config');
const market = require('./lib/market');
const store = require('./lib/preopen_store');
const PR = require('./lib/preopen_rules');
const { mapLimit } = require('./lib/http');
const paths = require('../paths');
const { lastClosedTradingDay } = require('../rules');
const { buildHTML } = require('./lib/preopen_report');
const argv = process.argv.slice(2);
const OPT = { date: (() => { const i = argv.indexOf('--date'); return i >= 0 ? argv[i + 1] : null; })(), force: argv.includes('--force') };
function log(m) { console.log(m); }

function boardLimitPct(code) {
  if (/^sh68[89]/.test(code)) return 20;
  if (/^sz30/.test(code)) return 20;
  if (/^bj/.test(code)) return 30;
  return 10;
}

/** 候选主力净流入（东财 fflow，失败留空）→ { code: 元 } */
async function fetchFlows(codes, date) {
  const out = {};
  await mapLimit(codes, 4, async (code) => {
    const f = await market.fetchFlowDay(code);
    if (f && f[date] != null) out[code] = f[date];
  });
  return out;
}

/** 候选日 K（含当日，算连板用；失败跳过）→ { code: kline } */
async function fetchKlines(codes, date) {
  const out = {};
  await mapLimit(codes, 6, async (code) => {
    try { const kl = await market.fetchKline(code, date); if (kl && kl.rows.length) out[code] = kl; } catch (e) { /* 留空 */ }
  });
  return out;
}

async function run() {
  const tradeDate = OPT.date || dayjs.tz().format('YYYY-MM-DD');
  const now = dayjs.tz();
  const hhmm = now.hour() * 100 + now.minute();
  const from = parseInt(cfg.backfill.from.replace(':', ''), 10);
  const to = parseInt(cfg.backfill.to.replace(':', ''), 10);
  if (!OPT.force && (hhmm < from || hhmm > to)) {
    log(`[结束] 未到收盘回填窗口（${cfg.backfill.from}–${cfg.backfill.to}），可用 --force 补跑`);
    return { skipped: true };
  }

  const doc = store.loadRun(cfg, tradeDate);
  if (!doc) { log(`[结束] 未找到盘前归档 ${tradeDate}`); return { skipped: true }; }
  const codes = Object.keys(doc.records);
  if (!codes.length) { log('[结束] 归档无候选'); return { skipped: true }; }
  log(`[回填] 读取 ${codes.length} 只候选，抓当日收盘…`);

  const quotes = (await market.fetchBatch(codes, cfg)).filter(Boolean);
  const qmap = new Map(quotes.map((q) => [q.code, q]));

  // 主力净流入（东财）+ 龙虎榜名单 + 连板 K 线：低频候选级调用，全部容错，失败留空
  log('[回填] 抓主力净流入 / 龙虎榜 / 连板K线…');
  const [flows, bbMap, klines] = await Promise.all([
    fetchFlows(codes, tradeDate),
    market.fetchBillboard(tradeDate),
    fetchKlines(codes, tradeDate),
  ]);
  log(`[回填] 净流入 ${Object.keys(flows).length}/${codes.length} · 龙虎榜全榜 ${Object.keys(bbMap).length} 只 · K线 ${Object.keys(klines).length}/${codes.length}`);

  const closeMap = {};
  for (const code of codes) {
    const q = qmap.get(code);
    if (!q || q.price == null) { closeMap[code] = { close: null, dayChgPct: null, limitUp: false, hit: false, note: '无收盘数据' }; continue; }
    const dayChgPct = q.chgPct;
    const limitPrice = q.prevClose > 0 ? Math.round(q.prevClose * (1 + boardLimitPct(code) / 100) * 100) / 100 : null;
    const limitUp = limitPrice != null && q.price >= limitPrice - 0.005;
    // 盘中开板：收盘涨停但当日最低价曾低于涨停价 → 封板被打开过，存在买入窗口（一字板则 low 也封死）
    const opened = limitUp && q.low != null && q.low < limitPrice - 0.005;
    const hit = dayChgPct != null && dayChgPct >= cfg.backfill.hitDayChgMin;
    closeMap[code] = {
      close: q.price, dayChgPct, limitUp, opened,
      turnover: q.turnover, volRatio: q.volRatio, hit,
      capYi: { total: q.totalCapYi, float: q.floatCapYi },
      mainInflow: flows[code] != null ? flows[code] : null,
    };
    const bb = bbMap[code.slice(2)];
    if (bb) closeMap[code].billboard = { net: bb.net, hot: PR.matchHotMoney(await market.fetchBillboardSeats(code.slice(2), tradeDate)) };
    if (klines[code]) closeMap[code].boards = PR.boardsInfo(klines[code].rows, code);
  }
  const bbHits = codes.filter((c) => closeMap[c] && closeMap[c].billboard);
  log(`[回填] 候选上榜 ${bbHits.length} 只${bbHits.length ? '：' + bbHits.map((c) => `${closeMap[c] && (qmap.get(c).name || c)}`).join('、') : ''}`);

  const summary = { hitDayChgMin: cfg.backfill.hitDayChgMin };
  const close = store.mergeBackfill(cfg, tradeDate, closeMap, summary);
  log(`[回填] 命中 ${close.hit}/${close.total}（开盘买入当日涨≥${cfg.backfill.hitDayChgMin}%）= ${close.hitRate}%`);

  // 重渲染 HTML（补充收盘区块：昨收%/今开%/今收%/买入收益% + 量比/换手%/涨停/买入机会/命中），覆盖盘前生成的旧报告
  try {
    const doc = store.loadRun(cfg, tradeDate);
    const recs = Object.values(doc.records).sort((a, b) => b.total - a.total);
    const bySector = new Map();
    for (const c of recs) { if (!bySector.has(c.sector)) bySector.set(c.sector, []); bySector.get(c.sector).push(c); }
    const groups = [];
    for (const [sector, list] of bySector) {
      list.sort((a, b) => b.total - a.total);
      list.forEach((c, i) => { c.groupRank = i + 1; c.bestInGroup = i === 0; c.groupSize = list.length; });
      groups.push({ sector, size: list.length, shown: list.slice(0, cfg.group.maxPerGroup), best: list[0] });
    }
    groups.sort((a, b) => b.best.total - a.best.total);
    const top = recs.slice(0, cfg.group.topN);
    const rej = doc.meta && doc.meta.rejByReason ? Object.values(doc.meta.rejByReason).reduce((a, b) => a + b, 0) : 0;
    const stats = {
      snapshotCount: (doc.meta && doc.meta.snapshotCount) || 0,
      baselineCount: (doc.meta && doc.meta.baselineCount) || 0,
      candidateCount: recs.length, groupCount: groups.length, gapCount: rej,
      rejByReason: (doc.meta && doc.meta.rejByReason) || {},
    };
    const result = { candidates: recs, groups, top, stats, gaps: [], nearMiss: doc.nearMiss || [] };
    const reportDir = path.join(paths.eodDir(), cfg.store.reportDir);
    fs.mkdirSync(reportDir, { recursive: true });
    const reportFile = path.join(reportDir, `${cfg.store.prefix}-${tradeDate}.html`);
    fs.writeFileSync(reportFile, buildHTML({ cfg, tradeDate, scope: doc.scope, anchor: doc.anchor || lastClosedTradingDay(dayjs.tz(tradeDate)), result, marketDate: doc.marketDate, runner: 'local', close: doc.close }), 'utf8');
    log(`[报告] 已重渲染（含收盘区块）${reportFile}`);
  } catch (e) { log(`[警告] HTML 重渲染失败（不影响归档）：${e && e.message || e}`); }

  return close;
}

run().catch((e) => { log(`[失败] ${e && e.stack || e}`); process.exitCode = 1; });
