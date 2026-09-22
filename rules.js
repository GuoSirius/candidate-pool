#!/usr/bin/env node
'use strict';
/*
 * rules.js — 候选池规则引擎（纯函数，零副作用，可单测）
 * ---------------------------------------------------------------------------
 * 把 gen_candidates.js 中「与 IO / 全局状态无关」的计算核心抽出来，作为唯一真相源：
 *   - R01 量能验证突破（calcR01）
 *   - R07 板块内补涨判定（isLaggard）
 *   - R05 尾盘异动核验（verifyR05）
 *   - 行业涨幅中位数（computeSectors）
 *   - 成交量单位 / 换手率推算（volLotSize / calcTurnover）
 *   - 交易日锚定（ymd / isWeekendD / lastClosedTradingDay / nextTradingDay）
 *
 * 所有函数均为纯函数：相同入参恒得相同出参，不读网络、不改全局。
 * gen_candidates.js 改为 require('./rules') 后调用，避免两处逻辑漂移。
 * 单测见 rules.test.js（node --test）。
 * ---------------------------------------------------------------------------
 */

const { dayjs } = require('./time');

// ---------- R01 门槛常量 ----------
const G = {
  VOL_RATIO_MIN: 1.5,   // C1 量 ≥ 近5日均量 150%
  CHG_MIN: 3.0,         // C3 涨幅下限
  CHG_MAX: 8.0,         // C3 涨幅上限
  TURN_MIN: 3.0,        // C4 换手 ≥ 3%
  CAP_MIN: 20,          // C5 市值下限（亿）
  CAP_MAX: 500,         // C5 市值上限（亿）
  HIGH52_ZONE: 0.9,     // C6 收盘 < 0.9×52周高 视为未进入高位区
};

// ---------- 时区安全的小工具 ----------
function ymd(d) {
  return dayjs.isDayjs(d) ? d.format('YYYY-MM-DD') : dayjs.tz(d).format('YYYY-MM-DD');
}
function isWeekendD(d) { const g = d.day(); return g === 0 || g === 6; }
/** dateStr（YYYY-MM-DD）之后的下一个交易日（仅剔除周末，不含节假日日历）。 */
function nextTradingDay(dateStr) {
  let d = dayjs.tz(dateStr + ' 00:00:00').add(1, 'day');
  while (isWeekendD(d)) d = d.add(1, 'day');
  return ymd(d);
}
/** 最近一个「已收盘」的交易日：周六 → 周五，周日 → 周五，交易日 15:00 前 → 前一交易日。 */
function lastClosedTradingDay(nowD) {
  const d = dayjs.isDayjs(nowD) ? nowD : dayjs.tz(nowD);
  const day = d.day();
  const hour = d.hour();
  let back = 0;
  if (day === 6) back = 1;        // 周六 -> 周五
  else if (day === 0) back = 2;   // 周日 -> 周五
  else if (hour < 15) back = 1;   // 交易日盘中 -> 前一交易日
  let x = d.subtract(back, 'day');
  while (isWeekendD(x)) x = x.subtract(1, 'day');
  return ymd(x);
}

// ---------- 成交量单位 / 换手率 ----------
// K 线成交量单位（2026-08 实测）：
//   主板/创业板 -> “手”(1手=100股)；科创板 sh688/sh689 -> 直接就是“股”。
//   例：金山办公 sh688111 于 2026-08-10 vol=9902896，按“手”折算成交额 2600 亿（荒谬），
//       按“股”折算 26.01 亿、换手 2.13%（合理）。
function volLotSize(code) {
  return /^sh68[89]/.test(String(code)) ? 1 : 100;
}

// 锚定日换手率 %：成交股数 / 流通股本 ×100
// 报价里的 idx38 只反映“此刻”，盘前恒为 0 且与历史锚定日口径不符，故一律按 K 线量能推算。
function calcTurnover(vol, circShares, code) {
  if (!vol || !circShares) return null;
  let t = (vol * volLotSize(code)) / circShares * 100;
  // 兜底：若单位判定失误会整整差 100 倍。A 股单日换手率极少超过 100%，此时自动纠偏。
  if (t > 100) t = t / 100;
  return t;
}

// ---------- R01 量能验证突破（纯函数）----------
// 入参：
//   today  — 锚定日 K 线 bar   { vol, high, close, turn }
//   hist   — 锚定日之前的日K线数组（hist[0] 为最近一个 prior 交易日），每根 { vol, high, close }
//   quote  — 报价市值段 { total_market_cap, circulating_market_cap, high_52week }（单位：元 / 元 / 元）
//   kError — 该标的 K 线获取失败信息（透传为 r01.error）
// 出参：与 gen_candidates 内联 R01 计算完全一致的 r01 对象。
function calcR01(today, hist, quote, kError) {
  const r01 = { ok: false, gates: {}, core: 0, capOk: false, highZoneOk: true, mktCapYi: null, circCapYi: null, error: kError || null };
  if (today && hist && hist.length) {
    const t = today, h = hist;
    // C1 量能倍数（不含当日）
    if (h.length >= 5) {
      const ma5 = h.slice(0, 5).reduce((a, r) => a + r.vol, 0) / 5;
      r01.volRatio = t.vol / ma5;
      r01.gates.C1 = t.vol >= G.VOL_RATIO_MIN * ma5;
    }
    // C2 突破前10日高（不含当日）
    if (h.length >= 10) {
      const h10 = Math.max(...h.slice(0, 10).map(r => r.high));
      r01.prior10High = h10;
      r01.gates.C2 = t.close > h10;
    }
    // C3 涨幅 3%-8%
    if (h.length >= 1) {
      const prev = h[0].close;
      r01.chg = (t.close / prev - 1) * 100;
      r01.gates.C3 = r01.chg >= G.CHG_MIN && r01.chg <= G.CHG_MAX;
    }
    // C4 换手
    r01.turn = t.turn;
    r01.gates.C4 = t.turn >= G.TURN_MIN;
    r01.close = t.close;
    // C5 市值
    if (quote && quote.total_market_cap) {
      r01.mktCapYi = +quote.total_market_cap / 1e8;
      r01.circCapYi = +quote.circulating_market_cap / 1e8;
      r01.capOk = r01.mktCapYi >= G.CAP_MIN && r01.mktCapYi <= G.CAP_MAX;
    }
    // C6 52周高位区
    if (quote && quote.high_52week && t.close) {
      r01.high52 = +quote.high_52week;
      r01.highZoneOk = t.close < G.HIGH52_ZONE * r01.high52;
    }
    r01.core = ['C1', 'C2', 'C3', 'C4'].filter(g => r01.gates[g]).length;
    // 注意：历史不足 5/10 日时 C1/C2 门栏为 undefined，必须 !! 收成布尔，
    // 否则 ok 会变成 undefined（生产因 K 线恒 260 根被掩盖，仍属潜在 bug）。
    r01.ok = !!(r01.gates.C1 && r01.gates.C2 && r01.gates.C3 && r01.gates.C4 && r01.capOk && r01.highZoneOk);
  }
  return r01;
}

// ---------- R07 板块内补涨判定（纯函数）----------
// laggard = 该标的所属行业处于「当日涨幅前 10% 行业」且自身涨幅 < 行业涨幅中位数的一半。
function isLaggard(stockR01Chg, sector) {
  return !!(sector && sector.inTop10 && stockR01Chg != null && stockR01Chg < 0.5 * sector.pct);
}

// ---------- R05 尾盘异动核验（纯函数）----------
// 入参 dayBars 已是「锚定日」的分时 bar 数组（gen_candidates 负责按 anchor 过滤）；
// fullDayGain 为当日全天涨幅（即 R01 的 chg）。
// 三项核心门槛：14:30–15:00 涨幅 ≥2%、尾盘量占全天 ≥20%、全天涨幅 <7%。
function verifyR05(dayBars, fullDayGain, anchor) {
  const r05 = { available: false, lateGain: null, lateVolShare: null, fullDayGain: fullDayGain, gates: {}, verdict: '', note: '' };
  if (!Array.isArray(dayBars) || dayBars.length === 0) {
    r05.verdict = 'gap';
    r05.note = `分时接口未回溯至锚定日 ${anchor || ''}（仅保留最近约 5 个交易日），R05 三项核心门槛中依赖分时数据的两项无法验证，故判定为数据缺口，不编造信号。`;
    return r05;
  }
  r05.available = true;
  const late = dayBars.filter(b => b.time >= '1430');
  const p1430 = dayBars.find(b => b.time >= '1430') || dayBars[0];
  const p1500 = dayBars[dayBars.length - 1];
  if (p1430 && p1500 && p1430.price) r05.lateGain = (p1500.price / p1430.price - 1) * 100;
  const lateVol = late.reduce((a, b) => a + (b.vol || 0), 0);
  const dayVol = dayBars.reduce((a, b) => a + (b.vol || 0), 0);
  r05.lateVolShare = dayVol ? lateVol / dayVol : 0;
  r05.gates.lateGain = r05.lateGain != null && r05.lateGain >= 2;
  r05.gates.lateVol = r05.lateVolShare >= 0.20;
  r05.gates.fullDay = r05.fullDayGain != null && r05.fullDayGain < 7;
  if (r05.gates.lateGain && r05.gates.lateVol && r05.gates.fullDay) r05.verdict = 'partial';
  else r05.verdict = 'no';
  return r05;
}

// ---------- R07 行业涨幅中位数（纯函数）----------
// 观察池内同行业个股当日涨幅中位数（无需外部板块接口）。返回按 pct 降序的数组，
// 并标注 topN = round(len*0.1) 与 inTop10 标记。
function computeSectors(stocks) {
  const bySector = {};
  for (const s of stocks) {
    const name = (s.sector || '未分类');
    if (!bySector[name]) bySector[name] = { chgs: [], codes: [] };
    bySector[name].chgs.push(s.r01 && s.r01.chg != null ? s.r01.chg : 0);
    bySector[name].codes.push(s.code);
  }
  const list = Object.entries(bySector).map(([name, v]) => {
    const sorted = v.chgs.slice().sort((a, b) => a - b);
    const mid = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
    return { code: name, name, pct: mid };
  });
  list.sort((a, b) => b.pct - a.pct);
  const topN = Math.max(1, Math.round(list.length * 0.1));
  list.forEach((s, i) => { s.rank = i + 1; s.inTop10 = i < topN; s.total = list.length; s.topN = topN; s.members = null; });
  return list;
}

module.exports = {
  G,
  ymd, isWeekendD, nextTradingDay, lastClosedTradingDay,
  volLotSize, calcTurnover,
  calcR01, isLaggard, verifyR05, computeSectors,
};
