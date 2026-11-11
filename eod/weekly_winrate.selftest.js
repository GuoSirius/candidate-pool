'use strict';
/*
 * eod/weekly_winrate.selftest.js —— 周六胜率简报回归自测
 * 运行：node eod/weekly_winrate.selftest.js（退出码非 0 = 失败；纯本地临时目录）
 * 重点钉死：① 样本不足时绝不输出任何胜率/结论；② 窗口按交易日不按文件数；③ HTML 表格列数一致、动态值转义；
 * ④ 报告为单文件 HTML（2026-11-11 由 Markdown 改版，可进 Cloudflare Pages 归档 + iframe）。
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
const html3 = W.renderHTML({ result: r3, perf, today: '2026-11-09', windowDays: 3 }, cfg);
check('是完整单文件 HTML（内联样式）', html3.startsWith('<!DOCTYPE html>') && html3.includes('<style>') && html3.trimEnd().endsWith('</html>'));
check('写明不输出胜率与回归结论', html3.includes('不输出胜率与回归结论'));
check('不含任何 % 命中率', !html3.includes('%'), html3.slice(0, 200));
check('不含「T+1 命中率」表头', !html3.includes('T+1 命中率'));
check('不含分层/游资章节', !html3.includes('按分项') && !html3.includes('按游资'));
check('仍给出各管道样本量', html3.includes('逐票样本') && html3.includes('已回填交易日'));
check('明确禁止据此调参', html3.includes('请勿用本期数据做参数调整'));
check('动态值做了 HTML 转义（防注入）', !html3.includes('<script>') && !html3.includes('src='));

console.log('\n[5] 样本达标 → 三维度');
const r22 = W.analyze(perf, c22, cfg);
check('22 天 → insufficient=false', r22.insufficient === false);
check('产出分项维度', !!r22.dims && Object.keys(r22.dims).length === 3);
check('产出游资维度', !!r22.hotmoney && r22.hotmoney.tiers.length >= 2);
check('管道引用 perf 聚合', r22.pipelines.tail.t1.rate === 23.5);
const html22 = W.renderHTML({ result: r22, perf, today: '2026-11-09', windowDays: 22 }, cfg);
check('三章节齐全', html22.includes('1. 按管道') && html22.includes('2. 按分项') && html22.includes('3. 按游资'));
check('标注不推送/不调权重', html22.includes('不推送') && html22.includes('不自动调权重'));

console.log('\n[6] HTML 表格列数一致 + 转义（防列错位 / XSS 回归）');
/** 从 HTML 中取出每张表：表头 <th> 数，及每行 <td> 数（colspan 的空表按 colspan 计） */
function tablesOf(html) {
  return [...html.matchAll(/<table>[\s\S]*?<\/table>/g)].map((m) => {
    const t = m[0];
    const head = (t.match(/<thead>[\s\S]*?<\/thead>/) || [''])[0];
    const th = (head.match(/<th>/g) || []).length;
    const widths = [...t.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
      .map((r) => r[1]).filter((r) => r.includes('<td'))
      .map((r) => {
        const cs = r.match(/colspan="(\d+)"/);
        return cs ? Number(cs[1]) : (r.match(/<td[ >]/g) || []).length;
      });
    return { head, th, widths };
  });
}
const tables = tablesOf(html22);
check('至少渲染出 3 张表', tables.length >= 3, tables.length);
check('含手机端首列固定 + 长表表头固定 CSS',
  html3.includes('th:first-child,td:first-child{position:sticky;left:0}')
  && html3.includes('.tw.scroll thead th{position:sticky;top:0;z-index:4}'));
check('固定列背景为实色（防横向滚动透字）',
  html3.includes('--stripe:#141a21') && html3.includes('td{background:var(--bg)}'));
check('短表不制造双层滚动', !html22.includes('class="tw scroll"'));
check('每张表所有行列数与表头一致', tables.every((t) => t.th > 0 && t.widths.every((w) => w === t.th)),
  JSON.stringify(tables.map((t) => [t.th, ...new Set(t.widths)])));
check('分项 / 游资表均为 6 列', tables.some((t) => t.head.includes('分层') && t.th === 6)
  && tables.some((t) => t.head.includes('维度') && t.th === 6));
const evil = W.renderHTML({
  result: r22, today: '2026-11-09', windowDays: 22,
  perf: { ...perf, generatedAt: '<script>alert(1)</script>' },
}, cfg);
check('动态值被 HTML 转义（<script> 不裸奔）', !evil.includes('<script>') && evil.includes('&lt;script&gt;'));

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${failed ? `❌ ${failed} 项失败` : '✅ 全部通过'}（临时目录已清理：${root}）`);
process.exitCode = failed ? 1 : 0;
