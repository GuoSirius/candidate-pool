'use strict';
/*
 * eod/lib/regime.selftest.js —— 环境闸分档与涨跌幅制度的回归自测
 * 运行：node eod/lib/regime.selftest.js   （退出码非 0 = 失败；纯函数，不联网）
 */

const { calcRegime, limitPctOf } = require('./regime');

let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? '  OK  ' : '  FAIL'}  ${name}${cond || detail === undefined ? '' : `  → ${detail}`}`);
  if (!cond) failed++;
}

console.log('\n[1] 涨跌幅制度（先板块后 ST：创业/科创 ST 是 20%，不是 5%）');
check('主板普通 10', limitPctOf('sh600000', 'X') === 10);
check('主板 ST 5', limitPctOf('sz000001', 'ST某某') === 5);
check('创业板普通 20', limitPctOf('sz300750', '宁德时代') === 20);
check('创业板 ST 20', limitPctOf('sz300001', 'ST某某') === 20);
check('科创 ST 20', limitPctOf('sh688001', 'ST某某') === 20);
check('北交 30', limitPctOf('bj920001', 'X') === 30);

/** 造 n 只报价 */
function mk(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = fn(i);
    out.push({
      code: i < 4000 ? `sh6${String(10000 + i).slice(-5)}` : `sz3${String(10000 + i).slice(-5)}`,
      name: 'X',
      chgPct: p,
      amountWan: 1000,
    });
  }
  return out;
}

console.log('\n[2] 分档阈值');
const strong = mk(1000, () => 5.2).concat(mk(0, () => 0));   // 全涨且全部 ≥涨停（主板 10 判不出 → 用 9.9）
check('涨停近似判定（9.9% ≈ 主板涨停）', calcRegime(mk(2000, () => 9.9)).limitUp === 2000);
const ice = calcRegime(mk(2000, (i) => (i % 100 < 12 ? 9.9 : i % 100 < 15 ? 0.1 : -9.9)));
check('冰点（上涨占比 ~12%、跌停潮）', ice && ice.label === '冰点', ice && `${ice.label} upPct=${ice.upPct} limitDown=${ice.limitDown}`);
const weak = calcRegime(mk(2000, (i) => (i % 100 < 30 ? 1.0 : -1.5)));
check('弱市（上涨占比 ~30%）', weak && weak.label === '弱市', weak && `${weak.label} upPct=${weak.upPct}`);
const normal = calcRegime(mk(2000, (i) => (i % 100 < 45 ? 1.0 : -1.0)));
check('正常（上涨占比 ~45%）', normal && normal.label === '正常', normal && `${normal.label} upPct=${normal.upPct}`);
check('弱市带提示语', weak && typeof weak.tip === 'string' && weak.tip.length > 0);
check('正常无提示语', normal && normal.tip === null);

console.log('\n[3] 边界');
check('报价 <1000 只 → null（样本不足不判档）', calcRegime(mk(999, () => 1)) === null);
check('空数组 → null', calcRegime([]) === null);
check('chgPct 缺失被过滤', calcRegime(mk(2000, () => 1).map((q, i) => (i % 2 ? { ...q, chgPct: null } : q))) !== null);

console.log(`\n${failed ? `自测失败 ${failed} 项` : '全部通过'}`);
process.exit(failed ? 1 : 0);
