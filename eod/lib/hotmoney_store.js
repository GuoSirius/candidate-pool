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

function dataDir() { return path.join(paths.eodDir(), cfg.store.dataDir); }
function dayFile(date) { return path.join(dataDir(), `${cfg.store.prefix}-${date}.json`); }

function loadDay(date) {
  const f = dayFile(date);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

function saveDay(date, doc) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const f = dayFile(date);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc), 'utf8');
  fs.renameSync(tmp, f);
  return f;
}

function snapshotFile() { return path.join(dataDir(), 'hotmoney-seats-snapshot.json'); }

function loadSeatSnapshot() {
  const f = snapshotFile();
  if (!fs.existsSync(f)) return { seatsByPerson: {}, updatedAt: null };
  try {
    const o = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { seatsByPerson: (o && o.seatsByPerson) || {}, updatedAt: (o && o.updatedAt) || null };
  } catch (e) { return { seatsByPerson: {}, updatedAt: null }; }
}

function saveSeatSnapshot(snap) {
  fs.mkdirSync(dataDir(), { recursive: true });
  snap.updatedAt = new Date().toISOString();
  const tmp = `${snapshotFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snap), 'utf8');
  fs.renameSync(tmp, snapshotFile());
}

function watchFile() { return path.join(dataDir(), 'hotmoney-watchlist.json'); }

function loadWatchlist() {
  const f = watchFile();
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch (e) { return {}; }
}

function saveWatchlist(w) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${watchFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(w), 'utf8');
  fs.renameSync(tmp, watchFile());
}

module.exports = { dayFile, loadDay, saveDay, loadSeatSnapshot, saveSeatSnapshot, loadWatchlist, saveWatchlist };
