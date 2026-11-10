'use strict';
/*
 * eod/lib/preopen_cache.js —— 盘前基线缓存读写（2026-11-10 评审 #4/#5 后续）
 * ---------------------------------------------------------------------------
 * 文件命名口径（用户 2026-11-11 拍板）：文件名 = 该基线「服务」的交易日（serveDate）：
 *   - 交易日 15:00 收盘前跑（含 03:00 预计算，属「昨日收盘后→今日开盘前」窗口）→ 命名当日
 *   - 交易日 15:00 收盘后跑（为下一交易日盘前服务）→ 命名下一交易日（如 11-11 收盘后 → 11-12）
 *   - 非交易日跑 → 命名下一个交易日
 * 内容内嵌 dataDate = 基线数据日（rows[0] 所在交易日，即消费日眼中的「昨日」），
 * 读侧靠 dataDate + 昨收(prevClose) 抽样校验定位/验证档案，文件名仅是语义标签（日历口径，
 * 节假日错名不影响正确性——校验会兜底弃用）。
 *   - 写：{ dataDate, baselines: {code: baseline} }，文件 preopen-baseline-<serveDate>.json
 *   - 读：精确 anchor 日档优先 → 扫描最新 dataDate < anchor 的档；校验通过才使用。
 *     旧格式（裸 code→baseline map，无 dataDate）无法证明口径，一律视为无效。
 */
const fs = require('fs');
const path = require('path');
const { readJSONSafe, atomicWriteJSON } = require('./atomic');
const { isTradingDay, nextTradingDay } = require('../../rules');

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

/** 基线「服务」的交易日（文件命名用）：
 *  交易日 15:00 收盘前（含 03:00）→ 当日；收盘后 / 非交易日 → 下一交易日（日历口径，节假日正确）。 */
function serveDateOf(now) {
  const today = now.format('YYYY-MM-DD');
  if (isTradingDay(now) && now.hour() * 60 + now.minute() < 15 * 60) return today;
  return nextTradingDay(today);
}

/** 写缓存：文件名 = serveDate（服务交易日）；dataDate 内嵌供读侧校验；任一缺失不写 */
function save(dir, serveDate, dataDate, map, log = () => {}) {
  if (!serveDate || !dataDate || !map || !map.size) return null;
  const out = {};
  for (const [code, b] of map) out[code] = b;
  const file = path.join(dir, `preopen-baseline-${serveDate}.json`);
  atomicWriteJSON(file, { dataDate, baselines: out });
  log(`[基线] 已缓存 ${map.size} 只（数据日 ${dataDate}，服务 ${serveDate}）→ ${path.basename(file)}`);
  return file;
}

module.exports = { load, save, parseDoc, validate, serveDateOf };
