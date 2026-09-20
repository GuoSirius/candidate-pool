'use strict';
/*
 * eod/lib/sector.js —— 行业归属（代码 -> 行业）缓存读取
 * ---------------------------------------------------------------------------
 * 为什么需要缓存：
 *   全市场「代码 → 行业」的映射有两个来源，都很慢或不稳：
 *     - 东财 clist 的 f100 字段：一次能拿全市场，但**东财对突发高频请求会封 IP**
 *       （实测十余次请求后即 socket hang up），不能放进 14:50 的关键路径；
 *     - 新浪行业分类：只给「行业 → 领涨股」，成员清单要按行业分页拉，请求数上百。
 *   而行业归属**几乎不变**（一年也就调几次成分），所以做成低频刷新的本地缓存：
 *   平时读文件（零网络、零延迟），偶尔用 build_industry_map.js 刷一次。
 *
 * 缓存结构（eod/data/industry-map.json）：
 *   { generatedAt, source, count, stocks: { "sh600519": { name, sector, listed } } }
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const MAP_PATH = path.join(__dirname, '..', 'data', 'industry-map.json');
const UNKNOWN = '未分类';

/** 读取行业映射；文件缺失 / 损坏一律返回空表（不抛错，让主流程降级为「未分类」） */
function loadIndustryMap(file = MAP_PATH) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const stocks = j && j.stocks && typeof j.stocks === 'object' ? j.stocks : {};
    return { generatedAt: j.generatedAt || null, source: j.source || null, count: Object.keys(stocks).length, stocks };
  } catch (e) {
    return { generatedAt: null, source: null, count: 0, stocks: {}, error: String((e && e.message) || e) };
  }
}

/** 取某只票的行业；查不到返回 null（由调用方决定记为「未分类」还是 data_gap） */
function sectorOf(map, code) {
  const s = map && map.stocks ? map.stocks[code] : null;
  return (s && s.sector) || null;
}

/** 取某只票的上市日期（YYYYMMDD，可能为 null） */
function listedOf(map, code) {
  const s = map && map.stocks ? map.stocks[code] : null;
  return (s && s.listed) || null;
}

/**
 * 按行业统计当日涨幅中位数（板块强度，FR-05）。
 * 只用快照里**已通过基础有效性**的票参与统计，避免退市/停牌票把中位数带偏。
 * @returns {Map<string, {sector, median, count, rank, total}>}
 */
function computeSectorStats(stocks, map) {
  const buckets = new Map();
  for (const q of stocks) {
    const sec = sectorOf(map, q.code);
    if (!sec) continue;
    if (q.chgPct == null) continue;
    if (!buckets.has(sec)) buckets.set(sec, []);
    buckets.get(sec).push(q.chgPct);
  }
  const rows = [];
  for (const [sector, arr] of buckets) {
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    rows.push({ sector, median: mid, count: sorted.length });
  }
  rows.sort((a, b) => b.median - a.median);
  rows.forEach((r, i) => { r.rank = i + 1; r.total = rows.length; });
  return new Map(rows.map((r) => [r.sector, r]));
}

module.exports = { loadIndustryMap, sectorOf, listedOf, computeSectorStats, MAP_PATH, UNKNOWN };
