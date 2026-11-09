'use strict';
/*
 * eod/lib/verdict.selftest.js —— verdict.js 三口径判定的回归自测
 * ---------------------------------------------------------------------------
 * 运行：node eod/lib/verdict.selftest.js    （退出码非 0 = 失败）
 * 纯函数断言，不联网、不写文件。
 */

const { barsAfter, buildVerdicts, aggregate, sliceByTradingDays, dayKeyOf } = require('./verdict');

let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? '  OK  ' : '  FAIL'}  ${name}${cond || detail === undefined ? '' : `  → ${detail}`}`);
  if (!cond) failed++;
}

// 全量降序 K（模拟 fetchKline 输出：最新在前）；基准日 T=2026-11-06（周五）
const K_DESC = [
  { date: '2026-11-13', open: 11.0, close: 10.8, high: 11.2, low: 10.6, vol: 1 },  // T+5
  { date: '2026-11-12', open: 10.9, close: 11.0, high: 11.3, low: 10.8, vol: 1 },  // T+4
  { date: '2026-11-11', open: 10.5, close: 10.9, high: 11.0, low: 10.4, vol: 1 },  // T+3
  { date: '2026-11-10', open: 10.2, close: 10.6, high: 10.7, low: 10.1, vol: 1 },  // T+2
  { date: '2026-11-09', open: 10.0, close: 10.3, high: 10.4, low: 9.9, vol: 1 },   // T+1
  { date: '2026-11-06', open: 9.6, close: 9.8, high: 9.9, low: 9.5, vol: 1 },      // T（不含）
  { date: '2026-11-05', open: 9.4, close: 9.6, high: 9.7, low: 9.3, vol: 1 },
];

console.log('\n[1] barsAfter：只取 T 之后、升序、最多 n 根');
const bars = barsAfter(K_DESC, '2026-11-06', 3);
check('长度 = 3', bars.length === 3, bars.length);
check('首根 = T+1', bars[0].date === '2026-11-09', bars[0].date);
check('末根 = T+3', bars[2].date === '2026-11-11', bars[2].date);
check('升序', bars[0].date < bars[1].date && bars[1].date < bars[2].date);
check('n=1 只取 T+1', barsAfter(K_DESC, '2026-11-06', 1).length === 1);

console.log('\n[2] buildVerdicts：默认 basis = T+1 开盘（游资/次日口径）');
const v = buildVerdicts(bars);
check('basis = 10.0（T+1 开盘）', v && v.basis === 10.0, v && v.basis);
check('t1.buyRet = 3.0（10.3/10.0）', v.t1.buyRet === 3.0, v.t1.buyRet);
check('t1.hit = true（≥2%）', v.t1.hit === true, v.t1.hit);
check('t1.date = 2026-11-09', v.t1.date === '2026-11-09', v.t1.date);
check('t3.buyRet = 9.0（10.9/10.0）', v.t3.buyRet === 9.0, v.t3.buyRet);
check('t3.maxRet = 10.0（期间最高 11.0）', v.t3.maxRet === 10.0, v.t3.maxRet);
check('t3.hit3 = true', v.t3.hit3 === true, v.t3.hit3);

console.log('\n[3] buildVerdicts：显式 basis（尾盘价口径）+ 阈值');
const v2 = buildVerdicts(bars, { basis: 9.8 });
check('basis = 9.8', v2.basis === 9.8, v2.basis);
check('t1.buyRet = 5.1（10.3/9.8）', v2.t1.buyRet === 5.1, v2.t1.buyRet);
const v2b = buildVerdicts(bars, { basis: 9.8, t1HitMin: 0.06 });
check('阈值 6% 时 t1.hit = false', v2b.t1.hit === false, v2b.t1.hit);

console.log('\n[4] 边界：bars 不足 / 空 / 停牌缺 bar');
const vOne = buildVerdicts(bars.slice(0, 1));
check('只有 T+1 → 出 t1、无 t3', vOne && vOne.t1 && !vOne.t3, JSON.stringify(vOne));
const vTwo = buildVerdicts(bars.slice(0, 2));
check('只有 T+2 → 仍无 t3', vTwo && !vTwo.t3);
check('空 bars → null', buildVerdicts([]) === null);
check('无 T 后 bar → null', buildVerdicts(barsAfter(K_DESC, '2026-11-13')) === null);
const vBad = buildVerdicts([{ date: '2026-11-09', open: 0, close: 10.3, high: 10.4, low: 9.9, vol: 1 }]);
check('open=0 的脏 bar 被过滤 → null', vBad === null, JSON.stringify(vBad));

console.log('\n[5] aggregate：命中率与均值');
const agg = aggregate([
  { verdicts: v },                       // t1 hit, t3 hit
  { verdicts: buildVerdicts([{ date: '2026-11-09', open: 10.0, close: 10.05, high: 10.1, low: 9.9, vol: 1 }, { date: '2026-11-10', open: 10.2, close: 10.2, high: 10.7, low: 10.1, vol: 1 }, { date: '2026-11-11', open: 10.5, close: 10.4, high: 11.0, low: 10.4, vol: 1 }]) }, // t1=0.5 不中 / t3=4.0 中
  { verdicts: null },                    // 缺段跳过
  {},
]);
check('n = 2（有 verdicts 的才算）', agg.n === 2, agg.n);
check('t1.n = 2 / hit = 1 / rate = 50', agg.t1.n === 2 && agg.t1.hit === 1 && agg.t1.rate === 50, JSON.stringify(agg.t1));
check('t3.n = 2 / hit3 = 2 / rate3 = 100', agg.t3.n === 2 && agg.t3.hit3 === 2 && agg.t3.rate3 === 100, JSON.stringify(agg.t3));
check('t3.avgMax ≈ 10.0', agg.t3.avgMax === 10.0, agg.t3.avgMax);
check('全空 → null', aggregate([{ verdicts: null }]) === null);

console.log('\n[6] 回扫窗口按交易日切片（评审 #1：tail 一天 formal+obs 两份）');
const ARCH = [];
for (const d of ['2026-10-30', '2026-10-31', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09']) {
  ARCH.push({ date: d, kind: 'tail', file: `eod-${d}.json` });
  ARCH.push({ date: d, kind: 'tail-obs', file: `eod-${d}-obs.json` });
}
const win10 = sliceByTradingDays(ARCH, 10);
check('days=10 → 覆盖 7 个不同交易日（不缩水成 5 天）', new Set(win10.map((e) => e.date)).size === 7, new Set(win10.map((e) => e.date)).size);
check('days=10 → 14 份归档全纳入（不按文件数截断）', win10.length === 14, win10.length);
const win5 = sliceByTradingDays(ARCH, 5);
check('days=5 → 恰 5 个交易日', new Set(win5.map((e) => e.date)).size === 5, new Set(win5.map((e) => e.date)).size);
check('days=5 → 10 份文件', win5.length === 10, win5.length);
check('按日期降序', win5[0].date > win5[win5.length - 1].date);
check('同日 formal 排在 obs 前（排序确定性）', win5[0].kind === 'tail' && win5[1].kind === 'tail-obs');
check('同日两口径 byDay 键不互相覆盖', dayKeyOf({ date: '2026-11-09', kind: 'tail' }) !== dayKeyOf({ date: '2026-11-09', kind: 'tail-obs' }));

console.log('\n[7] 脏 high 不污染期间最高收益（评审 #13）');
const dirty = bars.map((r, i) => (i === 1 ? { ...r, high: NaN } : r));
const vDirty = buildVerdicts(dirty);
check('一根 NaN high → maxRet 仍取其余有效高点', vDirty.t3.maxRet === 10.0, vDirty.t3.maxRet);
const allDirty = bars.map((r) => ({ ...r, high: undefined }));
check('三根 high 全脏 → maxRet = null（不写伪 -100%）', buildVerdicts(allDirty).t3.maxRet === null);

console.log(`\n${failed ? `自测失败 ${failed} 项` : '全部通过'}`);
process.exit(failed ? 1 : 0);
