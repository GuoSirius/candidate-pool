'use strict';
/*
 * eod/lib/preopen_cache.js —— 盘前基线缓存读写（2026-11-10 评审 #4/#5 后续）
 * ---------------------------------------------------------------------------
 * 背景（键名错位，日志实锤）：03:00 预计算锚「昨日」写 preopen-baseline-<昨日>.json，
 * 09:25 主流程锚「今日」读 <今日>.json → 隔夜缓存从未命中，每日全市场 K 线白抓 ~3 分钟。
 * 统一口径：文件名与内嵌 dataDate 均为「基线数据日」= rows[0] 所在交易日
 * （即次日盘前眼中的「昨日」）。
 *   - 写：{ dataDate, baselines: {code: baseline} }，文件 preopen-baseline-<dataDate>.json
 *   - 读：精确 anchor 日档优先 → 扫描最新 dataDate < anchor 的档；
 *     并用报价昨收(prevClose) 抽样比对基线 lastClose，校验通过才使用。
 *     旧格式（裸 code→baseline map，无 dataDate）无法证明口径，一律视为无效，
 *     首次运行会触发一次实时重算并落新格式档。
 */
const fs = require('fs');
const path = require('path');
const { readJSONSafe, atomicWriteJSON } = require('./atomic');

const RE_FILE = /^preopen-baseline-(\d{4}-\d{2}-\d{2})\.json$/;
const MAX_SAMPLE = 300;   // 校验抽样上限
const MIN_SAMPLE = 20;    // 最少可比样本（不足视为无法校验 → 弃用，宁重算不用错档）
const MATCH_RATE = 0.5;   // 昨收一致率阈值（当日除权票为少数派，容忍）

/** 解析缓存文档：仅接受新格式 { dataDate, baselines }；旧裸 map 返回 null */
function parseDoc(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.dataDate && raw.baselines && typeof raw.baselines === 'object' && !Array.isArray(raw.baselines)) {
    return { dataDate: String(raw.dataDate), baselines: raw.baselines };
  }
  return null;
}

/** 抽样校验：基线 lastClose（数据日收盘）应与报价昨收 prevClose 一致。
 * 数据驱动的陈旧防护：缓存落后交易日 / 键名错位串档都会导致大面积不一致 → 弃用重算。 */
function validate(m, quotes) {
  if (!Array.isArray(quotes) || !quotes.length) return true; // 无报价可校验时放行（正常路径不会发生）
  let hit = 0, total = 0;
  for (const q of quotes) {
    const b = q && q.code ? m.get(q.code) : null;
    if (!b || !Number.isFinite(b.lastClose) || !Number.isFinite(q.prevClose)) continue;
    if (total >= MAX_SAMPLE) break;
    total++;
    if (Math.abs(b.lastClose - q.prevClose) <= Math.max(0.01, q.prevClose * 1e-4)) hit++;
  }
  return total >= MIN_SAMPLE && hit / total >= MATCH_RATE;
}

/** 读缓存：返回 Map(code → baseline) 或 null（无有效档） */
function load(dir, anchor, quotes, log = () => {}) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .map((f) => f.match(RE_FILE))
    .filter(Boolean)
    .map((m) => ({ date: m[1], file: path.join(dir, m[0]) }))
    .sort((a, b) => b.date.localeCompare(a.date));            // 新 → 旧
  const exact = files.find((f) => f.date === anchor);         // 同日重跑（--force 等）精确命中
  const ordered = exact ? [exact, ...files.filter((f) => f !== exact)] : files;
  for (const f of ordered) {
    const doc = parseDoc(readJSONSafe(f.file, null, log));
    if (!doc || !(doc.dataDate < anchor)) continue;           // 需严格早于锚定日
    const m = new Map(Object.entries(doc.baselines));
    if (!validate(m, quotes)) {
      log(`[基线] ${path.basename(f.file)}（数据日 ${doc.dataDate}）与当前昨收不符，弃用`);
      continue;
    }
    log(`[基线] 命中缓存 ${path.basename(f.file)}（数据日 ${doc.dataDate}，${m.size} 只）`);
    return m;
  }
  return null;
}

/** 写缓存：文件名按数据日命名；dataDate 缺失（全失败）或空 Map 不写 */
function save(dir, dataDate, map, log = () => {}) {
  if (!dataDate || !map || !map.size) return null;
  const out = {};
  for (const [code, b] of map) out[code] = b;
  const file = path.join(dir, `preopen-baseline-${dataDate}.json`);
  atomicWriteJSON(file, { dataDate, baselines: out });
  log(`[基线] 已缓存 ${map.size} 只（数据日 ${dataDate}）→ ${path.basename(file)}`);
  return file;
}

module.exports = { load, save, parseDoc, validate };
