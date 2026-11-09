'use strict';
/*
 * eod/lib/hotmoney_store.js —— 游资扫描归档（日档 + 席位快照 + 观察名单）
 * ---------------------------------------------------------------------------
 * 三类落盘（全部原子写：tmp → rename）：
 *   1. 日档  eod/data/hotmoney/hotmoney-<YYYY-MM-DD>.json —— 每交易日一份（榜单+匹配+未识别席位），
 *      永久缓存，报告的近 N 日汇总从这里聚合；缺档由 hotmoney_scan 自动回补。
 *   2. 席位快照 eod/data/hotmoney/hotmoney-seats-snapshot.json —— 每个游资出现过的席位全集，
 *      扫描锚定日时比对出「新席位」→ 变动感知（换马甲/改营业部在报告里可见）。
 *   3. 观察名单 eod/data/hotmoney/hotmoney-watchlist.json —— 未识别席位按天累计，
 *      高频新席位浮现 → 提示晋升进 registry（overrideFile）。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const paths = require('../../paths');
const cfg = require('../hotmoney.config');
const { atomicWriteJSON, readJSONSafe } = require('./atomic');

function dataDir() { return path.join(paths.eodDir(), cfg.store.dataDir); }
function dayFile(date) { return path.join(dataDir(), `${cfg.store.prefix}-${date}.json`); }

function loadDay(date) {
  return readJSONSafe(dayFile(date), null);
}

function saveDay(date, doc) {
  const f = dayFile(date);
  atomicWriteJSON(f, doc);
  return f;
}

function snapshotFile() { return path.join(dataDir(), 'hotmoney-seats-snapshot.json'); }

function loadSeatSnapshot() {
  const o = readJSONSafe(snapshotFile(), null);
  return { seatsByPerson: (o && o.seatsByPerson) || {}, updatedAt: (o && o.updatedAt) || null };
}

function saveSeatSnapshot(snap) {
  snap.updatedAt = new Date().toISOString();
  atomicWriteJSON(snapshotFile(), snap);
}

function watchFile() { return path.join(dataDir(), 'hotmoney-watchlist.json'); }

function loadWatchlist() {
  return readJSONSafe(watchFile(), {}) || {};
}

function saveWatchlist(w) {
  atomicWriteJSON(watchFile(), w);
}

module.exports = { dayFile, loadDay, saveDay, loadSeatSnapshot, saveSeatSnapshot, loadWatchlist, saveWatchlist };
