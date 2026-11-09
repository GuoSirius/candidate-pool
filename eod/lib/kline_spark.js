'use strict';
/*
 * eod/lib/kline_spark.js —— 全报告共享的 mini K 线（内联 SVG，零外链、零网络）
 * ---------------------------------------------------------------------------
 * 背景（2026-11-09）：形态报告先做了 mini K 线，用户要求「所有报告都加上这一列」。
 * 六个 HTML 生成器各自有 CSS / b() / 表头结构，逐份复制 SVG 逻辑必然漂移，
 * 故统一收在此模块：CSS 一段、SVG 一个函数、数据索引一份。
 *
 * 数据源：eod/data/pattern/pattern-kline-<交易日>.json
 *   - 形态选股每天落的全市场前复权日 K 日档缓存（粗筛 ~4800 只 × 100 根），
 *     本来是给 --replay 零网络重算用的，这里复用为「所有报告」的公共 K 线源。
 *   - 落盘字段顺序是 [date, open, close, high, low, vol]（省字节的压缩格式），
 *     而 SVG 要的是 [date, open, high, low, close, vol]，必须经 normalizeBars() 重排。
 *   - 缓存被 .gitignore 忽略（~21MB/日，可重建）。缺档 / 单票缺 K 时优雅降级为「—」，
 *     不抛错、不编造数据 —— GitHub runner 上重渲染也不会因此失败。
 *
 * 颜色：涨红跌绿（A 股口径）。走 CSS 变量并带 fallback，兼容各自独立的主题变量表。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const paths = require('../../paths');

const DEFAULT = { width: 132, height: 34, bars: 60 };

/** 拼进各报告 <style> 末尾的一段；minifyHTML 只折叠空白，不含 // 注释，安全 */
const KLINE_CSS = `
  td.spark { text-align: center; vertical-align: middle; padding: 2px 4px; }
  td.spark svg { display: block; margin: 0 auto; }
  .k-wick { stroke: var(--slate, #64748b); stroke-width: 1; fill: none; opacity: .55; }
  .k-up { stroke: var(--red, #dc2626); stroke-width: 2.4; fill: none; stroke-linecap: round; }
  .k-down { stroke: var(--green, #16a34a); stroke-width: 2.4; fill: none; stroke-linecap: round; }
  .k-launch { stroke: var(--amber, #d97706); stroke-width: 1; stroke-dasharray: 2 2; fill: none; }
`;

/** 裸 6 位 → 带市场前缀；已是 sh/sz/bj 前缀的原样小写返回；无法判定的返回 null */
function toFullCode(code) {
  const s = String(code == null ? '' : code).trim().toLowerCase().replace(/\s/g, '');
  if (/^(sh|sz|bj)\d{6}$/.test(s)) return s;
  if (!/^\d{6}$/.test(s)) return null;
  const h = s[0];
  if (h === '6' || h === '9') return 'sh' + s;   // 沪市主板 / 科创 688 / B 股
  if (h === '0' || h === '3' || h === '2') return 'sz' + s;
  if (h === '4' || h === '8') return 'bj' + s;   // 北交所
  return null;
}

/** 缓存压缩格式 [date,o,c,h,l,v] → SVG 格式 [date,o,h,l,c,v]；坏行直接剔除 */
function normalizeBars(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const r of arr) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const [date, o, c, h, l, v] = r;
    if (![o, c, h, l].every(Number.isFinite)) continue;
    out.push([String(date), o, h, l, c, Number.isFinite(v) ? v : 0]);
  }
  return out;
}

/** 找 ≤ anchor 的最近一份 K 线日档；精确命中优先 */
function klineCacheFile(anchor) {
  const dir = path.join(paths.eodDir(), 'data', 'pattern');
  if (!fs.existsSync(dir)) return null;
  const a = String(anchor || '');
  const exact = path.join(dir, `pattern-kline-${a}.json`);
  if (a && fs.existsSync(exact)) return exact;
  const dates = fs.readdirSync(dir)
    .map((f) => (f.match(/^pattern-kline-(\d{4}-\d{2}-\d{2})\.json$/) || [])[1])
    .filter((d) => d && (!a || d <= a)).sort();
  return dates.length ? path.join(dir, `pattern-kline-${dates[dates.length - 1]}.json`) : null;
}

const EMPTY = Object.freeze({ size: 0, source: null, date: null, get: () => null });
const _memo = new Map(); // key → { mtimeMs, index } —— 21MB JSON 按「文件+根数+截止日」各解析一次

/**
 * 载入某锚定日的 K 线索引。返回 { size, source, date, get(code) }。
 * get() 接受带前缀或裸 6 位代码，返回最近 bars 根 [date,o,h,l,c,v]，缺票返回 null。
 * 任何读取/解析异常都降级为 EMPTY（报告不允许因装饰性图表而失败）。
 */
function loadSparkIndex(anchor, opts = {}) {
  const bars = opts.bars || DEFAULT.bars;
  // until：截断到指定交易日（含）。盘前报告锚定的是「上一交易日」，若把重渲染当天
  // 的收盘 K 线画进去就是前视偏差，故由调用方传入 anchor 显式裁剪。
  const until = opts.until || null;
  let file;
  try { file = klineCacheFile(anchor); } catch (e) { return EMPTY; }
  if (!file) return EMPTY;
  const key = `${file}|${bars}|${until || ''}`;
  try {
    const mtimeMs = fs.statSync(file).mtimeMs;
    const hit = _memo.get(key);
    if (hit && hit.mtimeMs === mtimeMs) return hit.index;
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const map = new Map();
    for (const [code, arr] of Object.entries(doc.bars || {})) {
      const full = toFullCode(code);
      if (!full) continue;
      let rows = normalizeBars(arr);
      if (until) rows = rows.filter((r) => r[0] <= until);
      rows = rows.slice(-Math.max(2, bars));
      if (rows.length >= 2) map.set(full, rows);
    }
    const index = Object.freeze({
      size: map.size,
      source: path.basename(file),
      date: doc.anchor || null,
      get: (code) => { const k = toFullCode(code); return k ? (map.get(k) || null) : null; },
    });
    if (_memo.size > 6) _memo.clear();
    _memo.set(key, { mtimeMs, index });
    return index;
  } catch (e) {
    process.stderr.write(`[miniK] 读取 ${path.basename(file)} 失败，本列降级为空：${(e && e.message) || e}\n`);
    return EMPTY;
  }
}

/** 从索引取某票的 spark 数组（薄封装，报告里语义更清楚） */
function sparkOf(code, index) {
  return index && typeof index.get === 'function' ? index.get(code) : null;
}

/**
 * 内联 SVG：影线 + 开收实体（涨红跌绿），可选启动日竖虚线。
 * spark: [date,o,h,l,c,v][]；opts: { width, height, launchDate, title }
 */
function sparkSVG(spark, opts = {}) {
  if (!Array.isArray(spark) || spark.length < 2) return '';
  const W = opts.width || DEFAULT.width, H = opts.height || DEFAULT.height;
  const pad = 2, n = spark.length;
  let hi = -Infinity, lo = Infinity;
  for (const r of spark) {
    if (![r[2], r[3]].every(Number.isFinite)) continue;
    hi = Math.max(hi, r[2]); lo = Math.min(lo, r[3]);
  }
  if (!(hi > lo) || !Number.isFinite(hi) || !Number.isFinite(lo)) return '';
  const x = (i) => pad + i * (W - 2 * pad) / (n - 1);
  const y = (v) => pad + (hi - v) / (hi - lo) * (H - 2 * pad);
  const wicks = [], ups = [], downs = [];
  for (let i = 0; i < n; i++) {
    const [, o, h, l, c] = spark[i];
    if (![o, h, l, c].every(Number.isFinite)) continue;
    const xx = +x(i).toFixed(1);
    wicks.push(`M${xx},${y(h).toFixed(1)}V${y(l).toFixed(1)}`);
    (c >= o ? ups : downs).push(`M${xx},${y(o).toFixed(1)}V${y(c).toFixed(1)}`);
  }
  let launch = '';
  if (opts.launchDate) {
    const i = spark.findIndex((r) => r[0] === opts.launchDate);
    if (i >= 0) launch = `<path class="k-launch" d="M${x(i).toFixed(1)},${pad}V${H - pad}"/>`;
  }
  const from = String(spark[0][0] || '').slice(5), to = String(spark[n - 1][0] || '').slice(5);
  const title = opts.title || `${from} ~ ${to} · ${n}根`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="mini K-line">`
    + `<title>${title.replace(/[<>&"]/g, '')}</title>`
    + `<path class="k-wick" d="${wicks.join('')}"/>`
    + `<path class="k-up" d="${ups.join('')}"/><path class="k-down" d="${downs.join('')}"/>`
    + launch + '</svg>';
}

/**
 * 包成表格单元格；无数据显示「—」，列数始终 +1。
 * opts.until：按行截断到某个交易日（游资近 N 日明细每行日期不同，不截断就有前视偏差）。
 */
function sparkCell(spark, opts = {}) {
  let rows = spark;
  if (opts.until && Array.isArray(rows)) rows = rows.filter((r) => r[0] <= opts.until);
  const svg = sparkSVG(rows, opts);
  return `<td class="spark">${svg || '<span class="src">—</span>'}</td>`;
}

module.exports = {
  KLINE_CSS, DEFAULT, toFullCode, normalizeBars, klineCacheFile,
  loadSparkIndex, sparkOf, sparkSVG, sparkCell,
};
