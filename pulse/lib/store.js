'use strict';
/*
 * pulse/lib/store.js —— 快照/报告落盘与清理、watch 状态
 * 目录结构（按日期分层）：
 *   pulse/data/YYYY-MM-DD/snap-HHmmss.json   每轮快照
 *   pulse/data/latest.json                    最近一轮（watch 对比基准入口）
 *   pulse/data/watch-state.json               watch 基准状态
 *   pulse/report/YYYY-MM-DD/pulse-HHmmss.html 每轮报告
 *   pulse/report/latest.html                  最近一轮报告
 * 清理：按日期目录滚动，保留最近 KEEP_* 个交易日目录。
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const { ensureDir } = require('../../paths');

const bjDate = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10); // YYYY-MM-DD（北京）
const bjTime = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(11, 19).replace(/:/g, ''); // HHmmss
const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayDir(base, ms) {
  const dir = path.join(base, bjDate(ms));
  ensureDir(dir);
  return dir;
}

/** 滚动清理：按日期目录，只留最近 keep 个目录 */
function pruneDays(base, keep) {
  let dirs;
  try { dirs = fs.readdirSync(base).filter((d) => DATE_DIR_RE.test(d)).sort(); } catch (e) { return; }
  for (const d of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    try { fs.rmSync(path.join(base, d), { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
}

function saveSnapshot(snapshot) {
  const file = path.join(dayDir(cfg.DATA_DIR, snapshot.runAt), `snap-${bjTime(snapshot.runAt)}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot));
  fs.writeFileSync(path.join(cfg.DATA_DIR, 'latest.json'), JSON.stringify(snapshot));
  pruneDays(cfg.DATA_DIR, cfg.KEEP_SNAPSHOTS);
  return file;
}

function loadLatest() {
  try { return JSON.parse(fs.readFileSync(path.join(cfg.DATA_DIR, 'latest.json'), 'utf8')); }
  catch (e) { return null; }
}

function saveReport(html, runAt) {
  const file = path.join(dayDir(cfg.REPORT_DIR, runAt), `pulse-${bjTime(runAt)}.html`);
  fs.writeFileSync(file, html);
  fs.writeFileSync(path.join(cfg.REPORT_DIR, 'latest.html'), html);
  pruneDays(cfg.REPORT_DIR, cfg.KEEP_REPORTS);
  return file;
}

// ---- watch 状态（跨轮增量对比的基准） ----
const STATE_FILE = path.join(cfg.DATA_DIR, 'watch-state.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (e) { return { seenNewsIds: [], boardPct: {}, hotBoards: [] }; }
}

function saveState(state) {
  ensureDir(cfg.DATA_DIR);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

module.exports = { saveSnapshot, loadLatest, saveReport, loadState, saveState };
