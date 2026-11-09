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
 *   - 交易日锚定（ymd / isWeekendD / isTradingDay / previousTradingDay / nextTradingDay / lastClosedTradingDay，含法定节假日；周六/周日与调休补班日永远休市）
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
  // C3 涨幅下限。2026-10-22 回溯调参（docs/backtest/01-复盘.md）：
  // 入选日涨 3–5% 的 44 条里该段次日均 -1.08%（胜率 25%），5–8% 段 +0.24%
  // （胜率 46%）——涨 3–5% 就破前 10 日高的多是弱突破/假突破。下限 3 → 4。
  CHG_MIN: 4.0,
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

// ---------- 交易日历（法定节假日）----------
// 设计说明：trading.js 用「行情时间戳众数」判定今天是否交易日（零维护、覆盖周末/节假日/临时休市）。
// 但纯日期函数（lastClosedTradingDay / nextTradingDay / previousTradingDay）没有行情上下文，
// 必须有一张日历才能正确剔除法定节假日。
// 重要：A 股周六/周日永远休市；调休补班日即使落在周末也休市，对开市判定无任何影响，
// 因此本表只登记「法定节假日」，不登记调休补班。
// 这里只维护「已知年份」，未知年份回退为「仅剔周末」（与旧行为一致），避免无数据时崩。
// 数据来源：国务院办公厅 2025-11-04 公布的 2026 年放假安排。
const TRADING_CALENDAR = {
  '2026': {
    // 法定节假日（休市）
    holidays: [
      '2026-01-01', '2026-01-02', '2026-01-03', // 元旦
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23', // 春节
      '2026-04-04', '2026-04-05', '2026-04-06', // 清明
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', // 劳动节
      '2026-06-19', '2026-06-20', '2026-06-21', // 端午
      '2026-09-25', '2026-09-26', '2026-09-27', // 中秋
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', // 国庆
    ],
  },
  '2027': {
    // 法定节假日（休市）—— 国务院办公厅 2026-11-05 公布
    holidays: [
      '2027-01-01', '2027-01-02', '2027-01-03', // 元旦（周五~周日）
      '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12', '2027-02-13', // 春节（除夕周五~正月初八周六）
      '2027-04-03', '2027-04-04', '2027-04-05', // 清明（周六~周一）
      '2027-05-01', '2027-05-02', '2027-05-03', '2027-05-04', '2027-05-05', // 劳动节（周六~周三）
      '2027-06-09', // 端午（周三单日）
      '2027-09-15', // 中秋（周三单日）
      '2027-10-01', '2027-10-02', '2027-10-03', '2027-10-04', '2027-10-05', '2027-10-06', '2027-10-07', // 国庆（周五~周四）
    ],
  },
  // 2028 及以后：国务院办公厅通常于前一年 11 月前后公布，届时补录本表。
  // 未收录年份运行时仅告警、不终止，回退为「仅剔周末」的旧 lastClosedTradingDay 实现。
};
// 缺年份时只告警一次，避免刷屏（每年首触达时提醒维护者更新日历）。
const _calWarned = new Set();
function calendarFor(year) {
  const c = TRADING_CALENDAR[String(year)];
  if (!c) {
    if (!_calWarned.has(year)) {
      _calWarned.add(year);
      process.stderr.write(
        `[交易日历] 未收录 ${year} 年法定节假日安排，回退为「仅剔周末」` +
        `（可能把法定节假日误判为交易日）。\n` +
        `          请更新 rules.js 的 TRADING_CALENDAR（国务院办公厅通常每年 11 月前后公布次年安排）。\n` +
        `          注：形态选股/盘前/尾盘等实时报告的锚定走「行情时间戳众数」(marketDate)，不依赖此表；\n` +
        `          此表仅用于次日池目标日/离线/--date 等无行情上下文的纯日期推算。\n`
      );
    }
    return null;
  }
  return { holidays: new Set(c.holidays) };
}
/** 某日是否为交易日：剔除法定节假日；周六/周日永远休市（调休补班即使落在周末也休市，不另开市）。 */
function isTradingDay(d) {
  const x = dayjs.isDayjs(d) ? d : dayjs.tz(d + ' 00:00:00');
  const ymdStr = x.format('YYYY-MM-DD');
  const cal = calendarFor(x.year());
  if (cal && cal.holidays.has(ymdStr)) return false; // 法定节假日休市
  return x.day() !== 0 && x.day() !== 6;              // 周六/周日永远休市
}
/** dateStr（YYYY-MM-DD）之前最近的交易日（含节假日/调休修正）。 */
function previousTradingDay(d) {
  let x = dayjs.isDayjs(d) ? d : dayjs.tz(d + ' 00:00:00');
  x = x.subtract(1, 'day');
  while (!isTradingDay(x)) x = x.subtract(1, 'day');
  return ymd(x);
}
/** dateStr（YYYY-MM-DD）之后最近的交易日（含节假日/调休修正）。 */
function nextTradingDay(dateStr) {
  let d = dayjs.isDayjs(dateStr) ? dateStr : dayjs.tz(dateStr + ' 00:00:00');
  d = d.add(1, 'day');
  while (!isTradingDay(d)) d = d.add(1, 'day');
  return ymd(d);
}
/** 最近一个「已收盘」的交易日：今天交易日且 15:00 后 → 今天；其余（盘中/今天非交易日）→ 之前最近交易日（节假日正确）。 */
function lastClosedTradingDay(nowD) {
  const d = dayjs.isDayjs(nowD) ? nowD : dayjs.tz(nowD);
  if (isTradingDay(d) && d.hour() >= 15) return ymd(d);
  return previousTradingDay(d);
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
  ymd, isWeekendD, isTradingDay, previousTradingDay, nextTradingDay, lastClosedTradingDay,
  volLotSize, calcTurnover,
  calcR01, isLaggard, verifyR05, computeSectors,
};
