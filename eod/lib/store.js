'use strict';
/*
 * eod/lib/store.js —— 幂等落库（FR-10 / FR-11 / Q3）
 * ---------------------------------------------------------------------------
 * 约定（与 tail.config.js store 段一致）：
 *   1. 一个交易日一份正式文件 `eod-<交易日>.json`，**整文件覆盖**：
 *      文件内 records 以 code 为键，天然不会出现重复记录；
 *      同日多次运行的历史（几次、各跑出几只候选）记在 runs[] 里留痕，
 *      最多保留 keepRunHistory 条。
 *   2. 观察模式（14:30~14:50）另存 `eod-<交易日>-obs<HHMM>.json`，
 *      不污染正式口径；同一时点的观察文件互相覆盖（同口径幂等）。
 *   3. 收盘后回填（P5）写进每条 record 的 `fill` 字段（当日收盘价 / 次日表现），
 *      重新跑筛选会覆盖 records 但**保留旧 fill**——只要 code 还在候选里。
 *   4. 全部零依赖：Node 内置 fs/path + 项目 time.js。
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { now: nowBJ } = require('../../time');

/** 候选对象 -> 存档记录（压缩字段：分时明细不落盘，只留尾盘段汇总） */
function toRecord(c) {
  return {
    code: c.code,
    name: c.name,
    sector: c.sector,
    board: c.board,
    boardLabel: c.boardLabel,
    price: c.price,
    prevClose: c.prevClose,
    high: c.high,
    chgPct: c.chgPct,
    turnover: c.turnover,
    volRatio: c.volRatio,
    volRatioEst: c.volRatioEst ?? null,
    floatCapYi: c.floatCapYi,
    avgPrice: c.avgPrice,
    groupRank: c.groupRank,
    bestInGroup: c.bestInGroup,
    groupSize: c.groupSize,
    tail: c.tail ? {
      segPct: c.tail.segPct,
      upRatio: c.tail.upRatio,
      maxDrawdownPct: c.tail.maxDrawdownPct,
      priceVsAvgPct: c.tail.priceVsAvgPct,
      avgAtCut: c.tail.avgAtCut,
      p0: c.tail.p0,
      p1: c.tail.p1,
      bars: c.tail.bars,
    } : null,
    score: c.score,
    total: c.total,
    sectorMedianChg: c.sectorMedianChg,
    sectorRank: c.sectorRank,
    sectorTotal: c.sectorTotal,
    // P5 回填位：{ close, next1, next2, next3, filledAt }（收盘后由回填脚本写入）
    fill: {},
  };
}

function dayFile(cfg, tradeDate, mode, cutHHMM) {
  const base = mode === 'observe' ? `eod-${tradeDate}-obs${cutHHMM}` : `eod-${tradeDate}`;
  return path.join(__dirname, '..', cfg.store.dataDir, `${base}.json`);
}

/** 读取某交易日的正式存档（无则 null） */
function loadDay(cfg, tradeDate) {
  const f = dayFile(cfg, tradeDate, 'cut');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

/**
 * 保存一次运行结果（幂等）。
 * @returns {{file:string, recordCount:number, runCount:number, replacedFill:number}}
 */
function saveRun({ cfg, tradeDate, mode, cutHHMM, result, runner }) {
  const dir = path.join(__dirname, '..', cfg.store.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = dayFile(cfg, tradeDate, mode, cutHHMM);

  const old = fs.existsSync(file) ? (() => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
  })() : null;

  const run = {
    at: nowBJ(),
    mode,
    cutAt: cutHHMM,
    candidateCount: result.candidates.length,
    groupCount: result.groups.length,
    prePassCount: result.stats.prePassCount,
    snapshotCount: result.stats.snapshotCount,
    runner: runner || 'local',
  };

  // 合并旧 fill：同 code 重选时保留收盘后回填的表现数据
  const records = {};
  let replacedFill = 0;
  const oldRecs = (old && old.records) || {};
  for (const c of result.candidates) {
    const rec = toRecord(c);
    const prev = oldRecs[c.code];
    if (prev && prev.fill && Object.keys(prev.fill).length) {
      rec.fill = prev.fill;
      replacedFill++;
    }
    records[c.code] = rec;
  }

  const runs = [...((old && old.runs) || []), run].slice(-cfg.store.keepRunHistory);

  const doc = {
    version: cfg.version,
    tradeDate,
    mode,
    cutAt: cutHHMM,
    updatedAt: nowBJ(),
    runs,
    stats: result.stats,
    records,
  };
  fs.writeFileSync(file, JSON.stringify(doc, null, 1), 'utf8');
  return { file, recordCount: Object.keys(records).length, runCount: runs.length, replacedFill };
}

/**
 * 回填（P5）：给指定交易日的正式文件写 fill 字段。
 * @param {object} patch code -> fill 对象（整体替换该 code 的 fill）
 * @returns {{updated:number, missing:string[]}} missing = 文件里没有的 code
 */
function applyFill(cfg, tradeDate, patch) {
  const file = dayFile(cfg, tradeDate, 'cut');
  if (!fs.existsSync(file)) return { updated: 0, missing: Object.keys(patch) };
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = [];
  let updated = 0;
  for (const [code, fill] of Object.entries(patch)) {
    if (doc.records[code]) {
      doc.records[code].fill = { ...fill, filledAt: nowBJ() };
      updated++;
    } else {
      missing.push(code);
    }
  }
  if (updated) {
    doc.updatedAt = nowBJ();
    fs.writeFileSync(file, JSON.stringify(doc, null, 1), 'utf8');
  }
  return { updated, missing };
}

module.exports = { saveRun, loadDay, applyFill, toRecord };
