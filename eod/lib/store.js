'use strict';
/*
 * eod/lib/store.js —— 幂等落库（FR-10 / FR-11 / Q3）
 * ---------------------------------------------------------------------------
 * 约定（与 tail.config.js store 段一致）：
 *   1. 一个交易日一份正式文件 `eod-<交易日>.json`，**整文件覆盖**：
 *      文件内 records 以 code 为键，天然不会出现重复记录；
 *      同日多次运行的历史（几次、各跑出几只候选）记在 runs[] 里留痕，
 *      最多保留 keepRunHistory 条。
 *   2. 观察模式（14:30~14:50）另存 `eod-<交易日>-obs.json`，
 *      不污染正式口径；同一天多次观察互相覆盖（同口径幂等），
 *      「跑了几次 / 各自什么时点」看 runs[]（文件名带时点的 `-obs<HHMM>` 仅在 --stamp 时用）。
 *   3. 收盘后回填（P5）写进每条 record 的 `fill` 字段（当日收盘价 / 次日表现），
 *      重新跑筛选会覆盖 records 但**保留旧 fill**——只要 code 还在候选里。
 *   4. 全部零依赖：Node 内置 fs/path + 项目 time.js。
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { now: nowBJ } = require('../../time');
const paths = require('../../paths');

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
    totalCapYi: c.totalCapYi,
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
      // 实际取数窗口（盘中模式的滚动窗口靠它才可回溯；正式口径固定 1430→1450）
      segFrom: c.tail.segFromUsed ?? c.tail.segFrom ?? null,
      cut: c.tail.cut ?? null,
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

/**
 * 文件名后缀（不含扩展名）。
 *   正式  (cut)      → ''
 *   观察  (observe)  → '-obs'                       ← **一天一个文件**，多次观察靠 runs[] 留痕
 *                      '-obs<HHMM>'（stamp=true）
 *   盘中  (intraday) → '-intraday'                  ← **一天一个文件**，多次运行靠 runs[] 留痕
 *                      '-intraday<HHMM>-w<分钟>'（stamp=true）
 *
 * 观察 / 盘中都默认**一天一个文件、不按时点命名**，理由相同：
 *   两者的「尾盘段」都是**相对窗口**（观察 = 14:30→当前时点，盘中 = 滚动 segMinutes 分钟），
 *   不同时刻的结果**本来就不可横向比较**，逐个留档没有复盘价值；而盘中一天可能跑十几次，
 *   按时点命名会让目录失控（十几个 JSON + 十几个 HTML）。
 *   真正需要留痕的是「跑了几次、每次什么口径、多少候选」—— 那正是 runs[] 的职责；
 *   时点也没丢，存档里有 doc.cutAt，D1 侧有 tail_run.cut_at。
 *   还有一条：D1 对 (trade_date, mode) 是 UPSERT，一个交易日只有一行观察，
 *   文件名若不跟着「一天一个」，就会出现「磁盘 N 份 vs 库里 1 行」这种两源粒度不一致
 *   （曾按 `-obs<HHMM>` 命名，副作用是文件名取决于启动分钟，文档 / --replay 无法写死）。
 * 需要完整保留某一次时显式加 --stamp；stamp 模式下连窗口长度一起写进文件名，
 * 因为「对比 20 分钟 vs 30 分钟窗口」正是 stamp 的主要用途（同名会互相覆盖）。
 */
function daySuffix(mode, cutHHMM, { stamp = false, segMinutes = null } = {}) {
  if (mode === 'observe') return stamp ? `-obs${cutHHMM}` : '-obs';
  if (mode === 'intraday') {
    if (!stamp) return '-intraday';
    return `-intraday${cutHHMM}${segMinutes ? `-w${segMinutes}` : ''}`;
  }
  return '';
}

/**
 * 存档文件名（数据 JSON）。
 *   正式  (cut)      → eod-<日>.json            ← 唯一被 D1 同步 / 复盘引用的口径
 *   观察  (observe)  → eod-<日>-obs.json        （--stamp 时带时点）
 *   盘中  (intraday) → eod-<日>-intraday.json   （--stamp 时带时点与窗口）
 * 观察 / 盘中必须另存：它们的尾盘段不是 14:30→14:50 的固定口径
 * （观察是 14:30→当前时点，盘中是滚动窗口），若写进正式文件会把当天的正式结果
 * 覆盖成假的 14:50 口径。
 */
function dayFile(cfg, tradeDate, mode, cutHHMM, opts) {
  return path.join(paths.eodDir(), cfg.store.dataDir, `eod-${tradeDate}${daySuffix(mode, cutHHMM, opts)}.json`);
}

/** 读取某交易日的正式存档（无则 null） */
function loadDay(cfg, tradeDate) {
  const f = dayFile(cfg, tradeDate, 'cut');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

/**
 * 保存一次运行结果（幂等）。
 * @param {object} p
 *   - segFrom    尾盘段起点 'HHMM'（盘中模式会随之滚动，存进 runs[] 才能回溯口径）
 *   - segMinutes 盘中窗口长度（分钟）；正式/观察为 null
 *   - stamp      盘中模式下是否在文件名里带上时点（默认 false = 一天一个文件）
 * @returns {{file:string, recordCount:number, runCount:number, replacedFill:number}}
 */
function saveRun({ cfg, tradeDate, mode, cutHHMM, result, runner, segFrom = null, segMinutes = null, stamp = false }) {
  const dir = path.join(paths.eodDir(), cfg.store.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = dayFile(cfg, tradeDate, mode, cutHHMM, { stamp, segMinutes });

  const old = fs.existsSync(file) ? (() => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
  })() : null;

  const run = {
    at: nowBJ(),
    mode,
    cutAt: cutHHMM,
    // 尾盘段起点与窗口长度：正式/观察恒为 1430；盘中是滚动窗口，必须记下来，
    // 否则事后看 runs[] 只知道「11:20 跑过一次」，不知道那次用的是哪一段。
    segFrom,
    segMinutes,
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
  return { file, doc, recordCount: Object.keys(records).length, runCount: runs.length, replacedFill };
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

module.exports = { saveRun, loadDay, applyFill, toRecord, dayFile, daySuffix };
