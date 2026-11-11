'use strict';
/*
 * eod/pool_reflow.selftest.js —— 观察池回流「非破坏性」回归自测
 * 运行：node eod/pool_reflow.selftest.js（退出码非 0 = 失败；纯本地临时目录，不碰真实数据）
 * 重点钉死：只追加、存量票零改动、删除恒 0、写前校验能拦住各类破坏、幂等。
 */
const fs = require('fs');
const path = require('path');
const R = require('./pool_reflow');

let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? '  OK  ' : '  FAIL'}  ${name}${cond || detail === undefined ? '' : `  → ${String(detail).slice(0, 200)}`}`);
  if (!cond) failed++;
}
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- 临时归档（.tmp/ 专用目录，用完即删） ----------
const root = path.join(__dirname, '..', '.tmp', `pool_reflow-selftest-${process.pid}`);
const dirs = {
  tail: path.join(root, 'eod'),
  preopen: path.join(root, 'preopen'),
  hotmoney: path.join(root, 'hotmoney'),
  nextday: path.join(root, 'data'),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
const put = (dir, name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj), 'utf8');
const V = { basis: 10, t1: { date: '2026-11-09', buyRet: 3.2, hit: true }, t3: { date: '2026-11-11', buyRet: 4, maxRet: 5, hit3: true } };

put(dirs.tail, 'eod-2026-11-06.json', { records: {
  sh600001: { code: 'sh600001', name: '甲', sector: 'A', total: 90, verdicts: V },
  sh600002: { code: 'sh600002', name: '乙', sector: 'B', total: 80 },
} });
put(dirs.tail, 'eod-2026-11-06-obs.json', { records: {
  sh600001: { code: 'sh600001', name: '甲', sector: 'A', total: 99, verdicts: V },
} });
put(dirs.nextday, 'snapshot-2026-11-06.json', { stocks: [
  { code: 'sh600003', name: '丙', sector: 'C', r01: { ok: true } },
  { code: 'sh600004', name: '丁', sector: 'D', r01: { ok: false } },
] });
put(dirs.hotmoney, 'hotmoney-2026-11-06.json', { records: [
  { code: '600005', name: '戊', hot: [{ name: '章盟主', tier: '一线' }] },
  { code: '600006', name: '己', hot: [{ name: '某', tier: '避坑' }] },
  { code: 'BAD', name: '脏数据', hot: [{ name: '章盟主', tier: '一线' }] },
] });
put(dirs.preopen, 'preopen-2026-11-06.json', { records: {
  sh600007: { code: 'sh600007', name: '庚', sector: 'G', label: '超预期' },
  sh600008: { code: 'sh600008', name: '辛', sector: 'H', label: '低于预期' },
} });
put(dirs.nextday, 'snapshot-2026-11-05.json', { stocks: [] });

console.log('\n[1] 代码归一化：脏代码绝不入池');
check('6位沪市 → sh', R.toFullCode('600519') === 'sh600519');
check('6位深市 → sz', R.toFullCode('000001') === 'sz000001');
check('6位北交 → bj', R.toFullCode('920001') === 'bj920001');
check('已带前缀原样', R.toFullCode('sh600519') === 'sh600519');
check('非法代码丢弃', R.toFullCode('BAD') === '' && R.toFullCode(null) === '');

console.log('\n[2] 交易日窗口：按日期并集，不按文件数');
const days = R.collectTradingDays(dirs, 5);
check('窗口含 2 个交易日', days.length === 2 && days[0] === '2026-11-06' && days[1] === '2026-11-05', JSON.stringify(days));
check('-obs 不额外占一天', R.collectTradingDays(dirs, 1).length === 1);

console.log('\n[3] 四来源收集 + 状态');
const { signals, status } = R.collectSignals(dirs, days, require('./pool_reflow.config'));
check('命中 4 只（尾盘/R01/一线游资/超预期）', signals.size === 4, [...signals.keys()].join(','));
check('正式档只算一次（-obs 未被重复读取）', signals.get('sh600001').sources.size === 1);
check('600005 补前缀为 sh600005', signals.has('sh600005'));
check('避坑席位不算信号', !signals.has('sh600006'));
check('脏代码 BAD 未入池', ![...signals.keys()].some((c) => c === 'BAD'));
check('R01 未触发票不算', !signals.has('sh600004'));
check('低于预期不算', !signals.has('sh600008'));
check('四来源状态均为 ok', ['tailTopHit', 'r01', 'hotmoneyT1', 'preopenBeat'].every((k) => status[k].state === 'ok'), JSON.stringify(status));
check('缺档来源标 unavailable 而非 error', R.collectSignals({ ...dirs, tail: path.join(root, 'none') }, ['2026-11-04']).status.tailTopHit.state === 'unavailable');

console.log('\n[4] diff：删除恒 0、存量零改动');
const before = {
  name: '观察池', note: '手工维护', generatedAt: '2026-01-01 00:00:00', minCapYi: 10, count: 2,
  stocks: [
    { code: 'sh600001', name: '甲', sector: 'A' },
    { code: 'sh600009', name: '壬', sector: 'I' },
  ],
};
const diff = R.buildDiff(signals, before);
check('拟新增 3 只', diff.toAdd.length === 3, diff.toAdd.map((s) => s.code).join(','));
check('命中存量 1 只', diff.toTagExisting.length === 1);
check('保持不动 1 只', diff.untouched === 1);
check('删除恒为 0', diff.wouldRemove === 0);
check('总数 2 → 5', diff.totalBefore === 2 && diff.totalAfter === 5);

console.log('\n[5] applyDiff + 非破坏性硬校验');
const after = R.applyDiff(before, diff, require('./pool_reflow.config'), '2026-11-09');
check('写后通过校验', R.assertNonDestructive(before, after) === true);
check('存量票对象逐字不变', JSON.stringify(after.stocks.slice(0, 2)) === JSON.stringify(before.stocks));
check('顶层字段除 stocks/count 外不变', ['name', 'note', 'generatedAt', 'minCapYi'].every((k) => after[k] === before[k]));
check('count 同步', after.count === 5);
check('新增票均带 meta.sources', after.stocks.slice(2).every((s) => s.meta && s.meta.sources.length && s.meta.addedAt === '2026-11-09'));
check('meta 含来源与最近触发', JSON.stringify(after.stocks[2].meta.sources) !== '[]' && !!after.stocks[2].meta.lastTrigger);
check('原 before 未被篡改', before.stocks.length === 2 && before.count === 2);

console.log('\n[6] 校验能拦住各类破坏（任一不通过即放弃写回）');
check('删一只存量票 → 抛错', throws(() => R.assertNonDestructive(before, { ...after, stocks: after.stocks.slice(1), count: 4 })));
const mod = clone(after); mod.stocks[0].name = '被改名';
check('改一只存量票 → 抛错', throws(() => R.assertNonDestructive(before, mod)));
check('擅自加顶层键 → 抛错', throws(() => R.assertNonDestructive(before, { ...after, extra: 1 })));
check('改 note → 抛错', throws(() => R.assertNonDestructive(before, { ...after, note: 'x' })));
const dup = clone(after); dup.stocks.push(clone(after.stocks[0])); dup.count++;
check('重复代码 → 抛错', throws(() => R.assertNonDestructive(before, dup)));
const noMeta = clone(after); delete noMeta.stocks[2].meta;
check('新增票缺 meta → 抛错', throws(() => R.assertNonDestructive(before, noMeta)));
check('count 与 stocks 不一致 → 抛错', throws(() => R.assertNonDestructive(before, { ...after, count: 99 })));

console.log('\n[7] 幂等：同一批信号再跑不再新增');
const diff2 = R.buildDiff(signals, after);
check('二次 diff 拟新增 0', diff2.toAdd.length === 0);
check('二次 diff 总数不变', diff2.totalAfter === 5);
check('二次 diff 仍不删除', diff2.wouldRemove === 0);

console.log('\n[8] 报告：单文件 HTML / 明确写出 dry-run / 删除 0');
const html = R.renderHTML({
  mode: 'DRY-RUN', today: '2026-11-09', dates: days, status, diff, before, after: null,
  config: require('./pool_reflow.config'),
});
check('是完整单文件 HTML（内联样式）', html.startsWith('<!DOCTYPE html>') && html.includes('<style>') && html.trimEnd().endsWith('</html>'));
check('标注 DRY-RUN', html.includes('DRY-RUN'));
check('写明未写回', html.includes('未写'));
check('写明删除 0 只', html.includes('删除 0 只'));
check('写明不设上限', html.includes('不设上限'));
check('含拟新增表', html.includes('拟新增（3 只）'));
check('恢复命令里的 > 被转义（表格单元格统一 HTML 转义）', html.includes('&gt;') && !html.includes('candidates.json > candidates'));
check('无外链资源', !html.includes('<script src=') && !html.includes('<link '));
const ths = [...html.matchAll(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/g)].map((m) => (m[1].match(/<th>/g) || []).length);
const trs = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]).filter((r) => r.includes('<td'))
  .map((r) => {
    const cs = r.match(/colspan="(\d+)"/);
    return cs ? Number(cs[1]) : (r.match(/<td[ >]/g) || []).length;
  });
check('表格结构存在且无列错位', ths.length >= 4 && trs.every((n) => ths.includes(n)), JSON.stringify({ ths, trs }));
check('首列固定（手机端横向滚动不丢代码）', html.includes('th:first-child,td:first-child{position:sticky;left:0}'));
check('拟新增 / 命中存量两张票表都冻结「代码 + 名称」',
  (html.match(/class="[^"]*freeze2/g) || []).length === 2
  && html.includes('.tw.freeze2 th:nth-child(2),.tw.freeze2 td:nth-child(2){position:sticky;left:var(--s1)}'));
check('第二列偏移量与首列宽度共用 --s1（不写死两处数字）',
  html.includes('--s1:88px') && html.includes('width:var(--s1)'));
const B = require('./lib/brief_report');
check('freeze 参数：显式传 2 才双列冻结',
  B.table(['代码', '名称'], [['sh600001', '甲']], { freeze: 2 }).includes('freeze2')
  && !B.table(['代码', '名称'], [['sh600001', '甲']]).includes('freeze2'));
const row = () => ['x'];
check('滚动阈值：19 行自然流 / 20 行滚动',
  !B.table(['a'], Array.from({ length: 19 }, row)).includes('class="tw scroll"')
  && B.table(['a'], Array.from({ length: 20 }, row)).includes('class="tw scroll"'));
// 夹具里 toAdd 只有 3 只，用 25 行模拟真实「拟新增」长表
const longTable = B.table(['代码', '名称'], Array.from({ length: 25 }, () => ['sh600001', '甲']));
check('长表带滚动容器 + 表头 sticky',
  longTable.includes('class="tw scroll"')
  && html.includes('.tw.scroll thead th{position:sticky;top:0;z-index:4}')
  && !html.includes('class="tw scroll"'));

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${failed ? `❌ ${failed} 项失败` : '✅ 全部通过'}（临时目录已清理：${root}）`);
process.exitCode = failed ? 1 : 0;
