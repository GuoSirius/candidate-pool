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
const { dayjs } = require('../time');
const cfg = require('./preopen.config');
const market = require('./lib/market');
const store = require('./lib/preopen_store');
const argv = process.argv.slice(2);
const OPT = { date: (() => { const i = argv.indexOf('--date'); return i >= 0 ? argv[i + 1] : null; })(), force: argv.includes('--force') };
function log(m) { console.log(m); }

function boardLimitPct(code) {
  if (/^sh68[89]/.test(code)) return 20;
  if (/^sz30/.test(code)) return 20;
  if (/^bj/.test(code)) return 30;
  return 10;
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

  const closeMap = {};
  for (const code of codes) {
    const q = qmap.get(code);
    if (!q || q.price == null) { closeMap[code] = { close: null, dayChgPct: null, limitUp: false, hit: false, note: '无收盘数据' }; continue; }
    const dayChgPct = q.chgPct;
    const limitPrice = q.prevClose > 0 ? Math.round(q.prevClose * (1 + boardLimitPct(code) / 100) * 100) / 100 : null;
    const limitUp = limitPrice != null && q.price >= limitPrice - 0.005;
    const hit = dayChgPct != null && dayChgPct >= cfg.backfill.hitDayChgMin;
    closeMap[code] = { close: q.price, dayChgPct, limitUp, hit };
  }

  const summary = { hitDayChgMin: cfg.backfill.hitDayChgMin };
  const close = store.mergeBackfill(cfg, tradeDate, closeMap, summary);
  log(`[回填] 命中 ${close.hit}/${close.total}（开盘买入当日涨≥${cfg.backfill.hitDayChgMin}%）= ${close.hitRate}%`);
  return close;
}

run().catch((e) => { log(`[失败] ${e && e.stack || e}`); process.exitCode = 1; });
