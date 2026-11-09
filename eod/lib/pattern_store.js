'use strict';
/*
 * eod/lib/pattern_store.js —— 形态选股归档（JSON，一天一份 + K 线日档缓存）
 * ---------------------------------------------------------------------------
 * 两类文件（都落在 eod/data/pattern/）：
 *   pattern-<交易日>.json        命中明细 + 贴线样本 + 漏斗统计（提交 git，供复盘）
 *   pattern-kline-<交易日>.json   粗筛入围票的前复权日线 + 报价快照（体积大，gitignore）
 *
 * K 线缓存的用途：`--replay` 零网络重算，调形态阈值 / 改报告不用重抓 3000+ 次行情。
 * 只存最近 cacheBars 根、字段压成数组，老鸭头/VCP 需要的 60 日均线仍算得出来。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const paths = require('../../paths');
const { now } = require('../../time');
const { atomicWriteJSON, readJSONSafe } = require('./atomic');

const warn = (m) => process.stderr.write(`${m}\n`);

function dirOf(cfg) { return path.join(paths.eodDir(), cfg.store.dataDir); }
function dataFile(cfg, tradeDate) {
  return path.join(dirOf(cfg), `${cfg.store.prefix}-${tradeDate}.json`);
}
function klineFile(cfg, tradeDate) {
  return path.join(dirOf(cfg), `${cfg.store.klinePrefix}-${tradeDate}.json`);
}

function loadRun(cfg, tradeDate) {
  return readJSONSafe(dataFile(cfg, tradeDate), null, warn);
}

/** 落库（幂等：整文件覆盖，records 按 code 唯一，runs[] 追加留痕） */
function saveRun({ cfg, tradeDate, scope, candidates, nearMiss, rejByReason, meta, anchor }) {
  const f = dataFile(cfg, tradeDate);
  const prev = loadRun(cfg, tradeDate) || {};
  const prevRecords = prev.records || {};
  // 同日重跑以本次命中为准（不残留上次试跑的票），但保留已回填的 verdicts / 上榜标注
  const records = {};
  for (const c of candidates) {
    const r = { ...c };
    const old = prevRecords[c.code];
    if (old) {
      if (old.verdicts && !r.verdicts) r.verdicts = old.verdicts;
      if (old.billboard && !r.billboard) r.billboard = old.billboard;
    }
    records[c.code] = r;
  }
  const runs = prev.runs || [];
  runs.push({ at: now(), count: candidates.length, codes: candidates.map((c) => c.code) });
  if (runs.length > cfg.store.keepRunHistory) runs.splice(0, runs.length - cfg.store.keepRunHistory);

  const doc = {
    tradeDate,
    scope: scope || cfg.scope.default,
    mode: 'pattern',
    version: cfg.version,
    generatedAt: now(),
    anchor: anchor || prev.anchor || null,
    meta: Object.assign({}, meta, { recordCount: Object.keys(records).length, runCount: runs.length }),
    runs,
    nearMiss: Array.isArray(nearMiss) ? nearMiss : (prev.nearMiss || []),
    records,
  };
  if (rejByReason && Object.keys(rejByReason).length) doc.meta.rejByReason = rejByReason;
  atomicWriteJSON(f, doc);
  return { file: f, recordCount: doc.meta.recordCount, runCount: runs.length };
}

/** K 线日档缓存写入：rowsDesc 降序 → 升序、只留最近 cacheBars 根、字段压成数组 */
function saveKlineCache(cfg, tradeDate, entries, meta) {
  const bars = {};
  const quotes = {};
  const keep = cfg.report.sparkBars + 40; // 100 根：覆盖 60 日均线 + 45 日 VCP 基底
  for (const e of entries) {
    const rows = (e.kline.rows || []).slice().reverse().slice(-keep);
    bars[e.code] = rows.map((r) => [r.date, r.open, r.close, r.high, r.low, r.vol]);
    if (e.quote) quotes[e.code] = e.quote;
  }
  const doc = {
    generatedAt: now(), anchor: tradeDate, count: Object.keys(bars).length,
    cacheBars: keep, meta: meta || {}, quotes, bars,
  };
  const f = klineFile(cfg, tradeDate);
  atomicWriteJSON(f, doc);
  return { file: f, count: doc.count };
}

/** 读缓存：返回 { quotes, bars(已转对象数组) }；缺档返回 null */
function loadKlineCache(cfg, tradeDate) {
  const doc = readJSONSafe(klineFile(cfg, tradeDate), null, warn);
  if (!doc || !doc.bars) return null;
  const bars = {};
  for (const [code, arr] of Object.entries(doc.bars)) {
    bars[code] = (arr || []).map((r) => ({ date: r[0], open: r[1], close: r[2], high: r[3], low: r[4], vol: r[5] }));
  }
  return {
    quotes: doc.quotes || {}, bars, generatedAt: doc.generatedAt, anchor: doc.anchor,
    count: doc.count, meta: doc.meta || {},
  };
}

module.exports = { dirOf, dataFile, klineFile, loadRun, saveRun, saveKlineCache, loadKlineCache };
