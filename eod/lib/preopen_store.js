'use strict';
/*
 * eod/lib/preopen_store.js —— 盘前选股落库（JSON 归档，溯源用）
 * ---------------------------------------------------------------------------
 * 一天一份文件：preopen/data/preopen-YYYYMMDD.json
 *   - records: code -> 候选明细（含 P1/P2/P3 分项、基线、标签、总分）
 *   - nearMiss: 贴线样本（总分落在 [minTotal-10, minTotal) 的 Top10，带完整分项）——
 *     竞价特征无法事后从 K 线重建，被拒样本不留就无法回溯调「入选线」（2026-10-22 补）
 *   - meta.rejByReason: 各淘汰原因计数（漏斗/通过率分析）
 *   - runs[]: 当日多次运行留痕（幂等：同文件整文件覆盖，records 按 code 唯一）
 *   - close：收盘回填后追加当日收盘/涨跌幅/是否涨停/命中标记（preopen_backfill.js）
 *
 * 与 tail store 解耦：盘前数据既要「开盘快照」又要「收盘回填」，结构不同，独立维护。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const paths = require('../../paths');

function dataFile(cfg, tradeDate) {
  return path.join(paths.eodDir(), cfg.store.dataDir, `${cfg.store.prefix}-${tradeDate}.json`);
}

/** 读已有归档（无则返回 null） */
function loadRun(cfg, tradeDate) {
  const f = dataFile(cfg, tradeDate);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

/**
 * 落库（幂等：同文件整文件覆盖，runs[] 追加本次运行）。
 * @param {object} p { cfg, tradeDate, scope, candidates, nearMiss?, rejByReason?, meta, marketDate }
 *   - nearMiss：贴线样本（总分 [minTotal-10, minTotal) 的 Top10，带完整分项），
 *     供日后调「入选线」用；竞价特征无法事后重建，必须运行时留。语义 = 最近一次运行覆盖。
 *   - rejByReason：各淘汰原因计数（漏斗分析用）。
 * @returns {{file, recordCount, runCount}}
 */
function saveRun({ cfg, tradeDate, scope, candidates, nearMiss, rejByReason, meta, marketDate }) {
  const dir = path.join(paths.eodDir(), cfg.store.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const f = dataFile(cfg, tradeDate);

  const prev = loadRun(cfg, tradeDate) || {};
  const records = prev.records || {};
  for (const c of candidates) records[c.code] = c;

  const runs = prev.runs || [];
  runs.push({
    at: new Date().toISOString(),
    count: candidates.length,
    codes: candidates.map((c) => c.code),
  });
  if (runs.length > cfg.store.keepRunHistory) runs.splice(0, runs.length - cfg.store.keepRunHistory);

  const doc = {
    tradeDate,
    scope: scope || cfg.scope.default,
    mode: 'preopen',
    generatedAt: new Date().toISOString(),
    marketDate,
    meta: Object.assign({}, meta, { recordCount: Object.keys(records).length, runCount: runs.length }),
    runs,
    // 贴线样本（最近一次运行覆盖）；rejByReason 挂在 meta 里
    nearMiss: Array.isArray(nearMiss) ? nearMiss : (prev.nearMiss || []),
    // 保留历史回填结果（若有）
    close: prev.close || null,
    records,
  };
  if (rejByReason && Object.keys(rejByReason).length) doc.meta.rejByReason = rejByReason;
  fs.writeFileSync(f, JSON.stringify(doc, null, 2), 'utf8');
  return { file: f, recordCount: doc.meta.recordCount, runCount: runs.length };
}

/**
 * 收盘回填：把当日收盘数据合并进归档（不重建候选，只追加 close 段）。
 * @param {object} closeMap  code -> { close, dayChgPct, limitUp, hit }
 */
function mergeBackfill(cfg, tradeDate, closeMap, summary) {
  const doc = loadRun(cfg, tradeDate);
  if (!doc) throw new Error(`未找到盘前归档 ${tradeDate}，无法回填`);
  doc.close = {
    backfilledAt: new Date().toISOString(),
    marketDate: tradeDate,
    hitDayChgMin: summary.hitDayChgMin,
    total: 0, hit: 0,
    perCode: {},
  };
  let hit = 0, total = 0;
  for (const [code, v] of Object.entries(closeMap)) {
    const rec = doc.records[code];
    if (!rec) continue;
    rec.close = v;
    total++;
    if (v.hit) hit++;
    doc.close.perCode[code] = v;
  }
  doc.close.total = total;
  doc.close.hit = hit;
  doc.close.hitRate = total ? +(hit / total * 100).toFixed(1) : 0;
  fs.writeFileSync(dataFile(cfg, tradeDate), JSON.stringify(doc, null, 2), 'utf8');
  return doc.close;
}

module.exports = { dataFile, loadRun, saveRun, mergeBackfill };
