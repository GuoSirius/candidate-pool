'use strict';
/*
 * rules.test.js — 规则引擎纯函数回归测试（node --test，零依赖）
 * 运行：node --test rules.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { dayjs } = require('./time');
const R = require('./rules');

// 构造一组 12 根 prior K 线（高位 104、成交量 1000、收盘 100），today 收 105（涨 5%）
function buildAllPass() {
  const hist = [];
  for (let i = 0; i < 12; i++) hist.push({ vol: 1000, high: 104, close: 100 });
  const today = { vol: 2000, high: 106, close: 105, turn: 5 }; // volRatio=2 → C1；105>104 → C2；chg5% → C3；turn5 → C4
  const quote = { total_market_cap: 100e8, circulating_market_cap: 80e8, high_52week: 200 }; // 100亿、0.9*200=180>105
  return { today, hist, quote };
}

test('G: R01 门槛常量与文档一致', () => {
  assert.equal(R.G.VOL_RATIO_MIN, 1.5);
  assert.equal(R.G.CHG_MIN, 3.0);
  assert.equal(R.G.CHG_MAX, 8.0);
  assert.equal(R.G.TURN_MIN, 3.0);
  assert.equal(R.G.CAP_MIN, 20);
  assert.equal(R.G.CAP_MAX, 500);
  assert.equal(R.G.HIGH52_ZONE, 0.9);
});

test('calcR01: 四项门栏全过 → ok=true, core=4', () => {
  const { today, hist, quote } = buildAllPass();
  const r = R.calcR01(today, hist, quote);
  assert.equal(r.core, 4);
  assert.equal(r.ok, true);
  assert.equal(r.gates.C1, true);
  assert.equal(r.gates.C2, true);
  assert.equal(r.gates.C3, true);
  assert.equal(r.gates.C4, true);
  assert.equal(r.capOk, true);
  assert.equal(r.highZoneOk, true);
  assert.ok(Math.abs(r.chg - 5.0) < 1e-9);
  assert.ok(Math.abs(r.volRatio - 2.0) < 1e-9);
});

test('calcR01: 仅 C1+C3 过 → core=2', () => {
  const { today, hist, quote } = buildAllPass();
  today.turn = 1;                 // C4 失败
  hist.forEach(h => { h.high = 110; }); // today.close 105 <= 110 → C2 失败
  const r = R.calcR01(today, hist, quote);
  assert.equal(r.core, 2);
  assert.equal(r.gates.C1, true);
  assert.equal(r.gates.C2, false);
  assert.equal(r.gates.C3, true);
  assert.equal(r.gates.C4, false);
  assert.equal(r.ok, false);
});

test('calcR01: 中国石油式巨无霸市值反例 — core=4 仍被 C5 排除', () => {
  const { today, hist } = buildAllPass();
  const quote = { total_market_cap: 2e12, circulating_market_cap: 1.8e12, high_52week: 200 }; // ~2万亿
  const r = R.calcR01(today, hist, quote);
  assert.equal(r.core, 4);
  assert.equal(r.capOk, false);
  assert.equal(r.mktCapYi, 20000);
  assert.equal(r.ok, false);
});

test('calcR01: C5 市值边界（含等号）', () => {
  const today = { vol: 1, high: 1, close: 1, turn: 0 };
  const hist = [{ vol: 1, high: 1, close: 1 }]; // length>=1，确保 quote 分支被计算
  const cases = [
    [20, true], [500, true],          // 边界含等号
    [19.99, false], [500.01, false],  // 越界
    [20000, false],                    // 中国石油反例
  ];
  for (const [capYi, expectOk] of cases) {
    const quote = { total_market_cap: capYi * 1e8, circulating_market_cap: capYi * 1e8, high_52week: 999 };
    const r = R.calcR01(today, hist, quote);
    assert.equal(r.capOk, expectOk, `cap=${capYi}亿 期望 capOk=${expectOk}`);
    assert.ok(Math.abs(r.mktCapYi - capYi) < 1e-6);
  }
});

test('calcR01: C6 52周高位区排除', () => {
  const today = { vol: 1, high: 10, close: 10, turn: 0 };
  const hist = [{ vol: 1, high: 1, close: 1 }];
  const quote = { total_market_cap: 100e8, circulating_market_cap: 80e8, high_52week: 10 }; // 0.9*10=9 < 10 → 高位
  const r = R.calcR01(today, hist, quote);
  assert.equal(r.highZoneOk, false);
  assert.equal(r.ok, false);
});

test('calcR01: 缺数据（无 K 线）— core=0, 透传 error', () => {
  const r = R.calcR01(null, [], { total_market_cap: 100e8 }, 'boom');
  assert.equal(r.core, 0);
  assert.equal(r.ok, false);
  assert.equal(r.capOk, false);
  assert.equal(r.mktCapYi, null);
  assert.equal(r.error, 'boom');
});

test('volLotSize: 科创板按股(1)，其余按手(100)', () => {
  assert.equal(R.volLotSize('sh688111'), 1);
  assert.equal(R.volLotSize('sh689001'), 1);
  assert.equal(R.volLotSize('sh680000'), 100); // 68 后非 8/9
  assert.equal(R.volLotSize('sh600000'), 100);
  assert.equal(R.volLotSize('sz300750'), 100);
});

test('calcTurnover: 股/手单位差 100 倍 + >100 自动纠偏', () => {
  assert.ok(Math.abs(R.calcTurnover(100000, 1e8, 'sh600000') - 10.0) < 1e-9);   // 主板按手
  assert.ok(Math.abs(R.calcTurnover(100000, 1e8, 'sh688111') - 0.1) < 1e-9);    // 科创板按股，差 100 倍
  assert.ok(Math.abs(R.calcTurnover(2e6, 1e8, 'sh600000') - 2.0) < 1e-9);      // 单位误判 raw=200 → 纠偏 /100 = 2
  assert.equal(R.calcTurnover(0, 1e8, 'sh600000'), null);
  assert.equal(R.calcTurnover(100, 0, 'sh600000'), null);
});

test('isLaggard: 行业前 10% 且自身涨幅 < 行业中位数一半', () => {
  assert.equal(R.isLaggard(1, { inTop10: true, pct: 5 }), true);   // 1 < 2.5
  assert.equal(R.isLaggard(3, { inTop10: true, pct: 5 }), false);  // 3 >= 2.5
  assert.equal(R.isLaggard(null, { inTop10: true, pct: 5 }), false);
  assert.equal(R.isLaggard(1, { inTop10: false, pct: 5 }), false);
});

test('verifyR05: 分时缺口 → verdict=gap', () => {
  const r = R.verifyR05([], 5, '2026-09-21');
  assert.equal(r.available, false);
  assert.equal(r.verdict, 'gap');
  assert.match(r.note, /2026-09-21/);
});

test('verifyR05: 尾盘拉升达标 → verdict=partial', () => {
  const bars = [
    { time: '0930', price: 10, vol: 100 },
    { time: '1000', price: 10, vol: 100 },
    { time: '1430', price: 10, vol: 100 },
    { time: '1500', price: 10.25, vol: 100 },
  ];
  const r = R.verifyR05(bars, 5, '2026-09-21');
  assert.equal(r.available, true);
  assert.ok(Math.abs(r.lateGain - 2.5) < 1e-9);
  assert.ok(Math.abs(r.lateVolShare - 0.5) < 1e-9);
  assert.equal(r.gates.lateGain, true);
  assert.equal(r.gates.lateVol, true);
  assert.equal(r.gates.fullDay, true);
  assert.equal(r.verdict, 'partial');
});

test('verifyR05: 全天涨幅越界 → verdict=no', () => {
  const bars = [
    { time: '1430', price: 10, vol: 100 },
    { time: '1500', price: 10.25, vol: 100 },
  ];
  const r = R.verifyR05(bars, 8, '2026-09-21'); // 全天 8% >=7 → fullDay 门栏失败
  assert.equal(r.gates.fullDay, false);
  assert.equal(r.verdict, 'no');
});

test('computeSectors: 行业涨幅中位数 + 前 10% 标注', () => {
  const stocks = [
    { code: 'a', sector: '银行', r01: { chg: 2 } },
    { code: 'b', sector: '银行', r01: { chg: 4 } },
    { code: 'c', sector: '银行', r01: { chg: 6 } },
    { code: 'd', sector: '券商', r01: { chg: 1 } },
    { code: 'e', sector: '券商', r01: { chg: 3 } },
  ];
  const list = R.computeSectors(stocks);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, '银行');
  assert.ok(Math.abs(list[0].pct - 4) < 1e-9);   // [2,4,6] 中位数 4
  assert.equal(list[0].inTop10, true);
  assert.equal(list[1].name, '券商');
  assert.ok(Math.abs(list[1].pct - 1) < 1e-9);   // [1,3] 中位数 1
  assert.equal(list[1].inTop10, false);
  assert.equal(list[0].topN, 1);                  // round(2*0.1)=1
});

test('lastClosedTradingDay: 周末与盘中顺延', () => {
  assert.equal(R.lastClosedTradingDay(dayjs.tz('2026-09-19 10:00:00')), '2026-09-18'); // 周六 → 周五
  assert.equal(R.lastClosedTradingDay(dayjs.tz('2026-09-20 10:00:00')), '2026-09-18'); // 周日 → 周五
  assert.equal(R.lastClosedTradingDay(dayjs.tz('2026-09-21 14:00:00')), '2026-09-18'); // 周一盘中 → 前一交易日
  assert.equal(R.lastClosedTradingDay(dayjs.tz('2026-09-21 16:00:00')), '2026-09-21'); // 周一收盘 → 当日
  assert.equal(R.lastClosedTradingDay(dayjs.tz('2026-09-22 14:00:00')), '2026-09-21'); // 周二盘中 → 周一
  assert.equal(R.lastClosedTradingDay(dayjs.tz('2026-09-22 16:00:00')), '2026-09-22'); // 周二收盘 → 当日
});

test('nextTradingDay: 跳过周末', () => {
  assert.equal(R.nextTradingDay('2026-09-18'), '2026-09-21'); // 周五 → 下周一
  assert.equal(R.nextTradingDay('2026-09-19'), '2026-09-21'); // 周六 → 下周一
});

test('regression: rules 模块可被 gen_candidates 直接 require 且不抛错', () => {
  assert.ok(typeof R.calcR01 === 'function');
  assert.ok(typeof R.verifyR05 === 'function');
});
