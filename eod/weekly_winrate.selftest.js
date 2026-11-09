'use strict';
/*
 * eod/weekly_winrate.selftest.js —— 周六胜率简报回归自测
 * 运行：node eod/weekly_winrate.selftest.js（退出码非 0 = 失败；纯本地临时目录）
 * 重点钉死：① 样本不足时绝不输出任何胜率/结论；② 窗口按交易日不按文件数；③ 表格列数一致。
 */
const fs = require('fs');
const path = require('path');
const W = require('./weekly_winrate');
const cfg = require('./weekly_winrate.config');

let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? '  OK  ' : '  FAIL'}  ${name}${cond || detail === undefined ? '' : `  → ${String(detail).slice(0, 200)}`}`);
  if (!cond) failed++;
}

const root = path.join(__dirname, '..', '.tmp', `weekly_winrate-selftest-${process.pid}`);
const dirs = {
  tail: path.join(root, 'eod'),
  preopen: path.join(root, 'preopen'),
  hotmoney: path.join(root, 'hotmoney'),
  nextday: path.join(root, 'data'),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

const V = { basis: 10, t1: { date: '2026-11-09', buyRet: 3.2, hit: true }, t3: { date: '2026-11-11', buyRet: 4.1, maxRet: 6, hit3: true } };
const dates = [];
for (let i = 0; i < 22; i++) {
  const d = `2026-10-${String(i + 1).padStart(2, '0')}`;
  dates.push(d);
  const rec = {
    code: 'sh600001', name: '甲', sector: 'A', board: '主板', total: 85, groupRank: 1, verdicts: V,
  };
  fs.writeFileSync(path.join(dirs.tail, `eod-${d}.json`), JSON.stringify({ records: { sh600001: rec } }), 'utf8');
  fs.writeFileSync(path.join(dirs.tail, `eod-${d}-obs.json`), JSON.stringify({ records: { sh600001: rec } }), 'utf8');
  fs.writeFileSync(path.join(dirs.hotmoney, `hotmoney-${d}.json`), JSON.stringify({ records: [
    { code: '600002', name: '乙', verdicts: V, hot: [{ name: '章盟主', tier: '一线' }] },
    { code: '600003', name: '丙', verdicts: V, hot: [{ name: '某席位', tier: '避坑' }] },
  ] }), 'utf8');
  fs.writeFileSync(path.join(dirs.nextday, `snapshot-${d}.json`), JSON.stringify({ stocks: [
    { code: 'sh600004', name: '丁', r01: { ok: true }, verdicts: V },
    { code: 'sh600005', name: '无判定', r01: { ok: true } },
  ] }), 'utf8');
}
const perf = {
  generatedAt: '2026-11-09 16:37:46', windowDays: 40,
  pipelines: { tail: { archives: 40, tradingDays: 31, n: 1202, t1: { rate: 23.5 }, t3: { rate3: 25, avg: -0.79 } } },
};

console.log('\n[1] 归档枚举：按交易日切片，不按文件数（评审 #1 同款坑）');
const a5 = W.listArchives(dirs, 5);
check('days=5 → 覆盖 5 个不同交易日', new Set(a5.map((e) => e.date)).size === 5);
check('days=5 → 20 份文件（每天 4 份：尾盘 formal+obs / 游资 / 快照）', a5.length === 20, a5.length);
const a22 = W.listArchives(dirs, 22);
check('days=22 → 覆盖 22 个交易日', new Set(a22.map((e) => e.date)).size === 22);
check('days=22 → 88 份文件', a22.length === 88, a22.length);

console.log('\n[2] 逐票抽取：只收带 verdicts 的');
const c22 = W.collectRecords(dirs, 22);
check('无解析失败', c22.broken.length === 0);
check('nextday 缺 verdicts 的票被排除', !c22.records.some((r) => r.name === '无判定'));
check('hot 的 tier/name 已提取', c22.records.some((r) => r.hotTiers.includes('一线') && r.hotNames.includes('章盟主')));

console.log('\n[3] 总分分档');
check('≥80', W.scoreBand(85, cfg.scoreBands) === '≥80');
check('60–80', W.scoreBand(60, cfg.scoreBands) === '60–80');
check('<60', W.scoreBand(59.9, cfg.scoreBands) === '<60');
check('缺失 → 未知', W.scoreBand(null, cfg.scoreBands) === '未知');

console.log('\n[4] 硬门禁：样本不足只报样本量，绝不输出结论');
const c3 = W.collectRecords(dirs, 3);
const r3 = W.analyze(perf, c3, cfg);
check('3 天 → insufficient=true', r3.insufficient === true);
check('样本量统计正确', r3.sampleDays === 3 && r3.totalTickets > 0);
check('不含 dims / hotmoney', !r3.dims && !r3.hotmoney);
const md3 = W.renderMarkdown({ result: r3, perf, today: '2026-11-09', windowDays: 3 }, cfg);
check('写明不输出胜率与回归结论', md3.includes('不输出胜率与回归结论'));
check('不含任何 % 命中率', !md3.includes('%'), md3.slice(0, 200));
check('不含「T+1 命中率」表头', !md3.includes('T+1 命中率'));
check('不含分层/游资章节', !md3.includes('按分项') && !md3.includes('按游资'));
check('仍给出各管道样本量', md3.includes('逐票样本') && md3.includes('已回填交易日'));
check('明确禁止据此调参', md3.includes('请勿用本期数据做参数调整'));

console.log('\n[5] 样本达标 → 三维度');
const r22 = W.analyze(perf, c22, cfg);
check('22 天 → insufficient=false', r22.insufficient === false);
check('产出分项维度', !!r22.dims && Object.keys(r22.dims).length === 3);
check('产出游资维度', !!r22.hotmoney && r22.hotmoney.tiers.length >= 2);
check('管道引用 perf 聚合', r22.pipelines.tail.t1.rate === 23.5);
const md22 = W.renderMarkdown({ result: r22, perf, today: '2026-11-09', windowDays: 22 }, cfg);
check('三章节齐全', md22.includes('## 1. 按管道') && md22.includes('## 2. 按分项') && md22.includes('## 3. 按游资'));
check('标注不推送/不调权重', md22.includes('不推送') && md22.includes('不自动调权重'));

console.log('\n[6] Markdown 表格列数一致（防列错位回归）');
const blocks = [];
let cur = [];
for (const l of md22.split('\n')) {
  if (l.startsWith('|')) cur.push(l);
  else { if (cur.length) blocks.push(cur); cur = []; }
}
if (cur.length) blocks.push(cur);
check('每块表格内部列数一致', blocks.every((b) => new Set(b.map((l) => l.split('|').length)).size === 1),
  JSON.stringify(blocks.map((b) => b[0].split('|').length)));
check('分项 / 游资表均为 6 列（8 段）', blocks.some((b) => b[0].includes('分层') && b[0].split('|').length === 8)
  && blocks.some((b) => b[0].includes('维度') && b[0].split('|').length === 8));

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${failed ? `❌ ${failed} 项失败` : '✅ 全部通过'}（临时目录已清理：${root}）`);
process.exitCode = failed ? 1 : 0;
