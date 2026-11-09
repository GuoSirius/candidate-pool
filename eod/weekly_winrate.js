'use strict';
/*
 * eod/weekly_winrate.js —— 周六胜率回归简报（批次 D2，周六 10:00 / ACTIVE）
 * ---------------------------------------------------------------------------
 * 干什么：读 `eod/data/perf-weekly.json`（按管道聚合）+ 四类归档逐票 verdicts，
 *         按「管道 / 分项 / 游资」三个维度出一份 Markdown 简报。
 *
 * ⚠️ 硬门禁（方案原文）：有 verdicts 的不同交易日数 < minTradingDays(20) 时，
 *    **只报样本量**，不输出任何命中率、均值、分层结论或调参建议 —— 小样本给结论等于编造。
 *
 * 边界（用户 2026-11-09 拍板）：
 *   - 不推送：完全不引入 notify.js，不发微信/邮件；
 *   - 不调权重：纯只读 + 只写一份报告，不修改任何归档 / 配置 / 观察池；
 *   - 报告落 eod/reports/weekly/，脚本不自动 git，由使用者按需提交。
 *
 * 口径说明（报告内也会标注）：
 *   - 「管道」维度直接引用 perf-weekly.json 的聚合（窗口 = perf.windowDays）；
 *   - 「分项」「游资」维度由逐票归档重算（窗口 = cfg.windowDays）；
 *     两者窗口不同，不可横向相减，报告里分别标注。
 *
 * 用法：
 *   node eod/weekly_winrate.js            # 出简报（样本不足时自动降级为「只报样本量」）
 *   node eod/weekly_winrate.js --days 90  # 覆盖逐票扫描窗口
 *   node eod/weekly_winrate.js --json     # 机器可读摘要
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./weekly_winrate.config');
const paths = require('../paths');
const V = require('./lib/verdict');
const { dayjs } = require('../time');

const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const OPT = {
  json: argv.includes('--json'),
  help: argv.includes('--help') || argv.includes('-h'),
  days: Math.max(1, parseInt(argOf('--days'), 10) || cfg.windowDays),
};
const say = (m) => { if (!OPT.json) console.log(m); };
const warn = (m) => process.stderr.write(`${m}\n`);

const USAGE = `周六胜率回归简报 weekly_winrate（${cfg.version}）
  node eod/weekly_winrate.js [--days N] [--json]
  硬门禁：verdicts 覆盖 < ${cfg.minTradingDays} 个交易日时只报样本量，不输出回归结论。
  纯只读，不推送、不调权重。`;

const RE = {
  tail: /^eod-(\d{4}-\d{2}-\d{2})(-obs)?\.json$/,
  preopen: /^preopen-(\d{4}-\d{2}-\d{2})\.json$/,
  nextday: /^snapshot-(\d{4}-\d{2}-\d{2})\.json$/,
  hotmoney: /^hotmoney-(\d{4}-\d{2}-\d{2})\.json$/,
};

function readDoc(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return null; }
}

/** 枚举四类归档，按「不同交易日」截最近 days 天（与 sliceByTradingDays 同口径） */
function listArchives(dirs, days) {
  const out = [];
  for (const [pipe, re] of Object.entries(RE)) {
    const dir = dirs[pipe];
    if (!dir || !fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(re);
      if (!m) continue;
      out.push({ pipe, dir, file: f, date: m[1], kind: m[2] ? 'tail-obs' : 'formal' });
    }
  }
  const keep = new Set([...new Set(out.map((e) => e.date))].sort().reverse().slice(0, Math.max(1, days | 0)));
  return out.filter((e) => keep.has(e.date)).sort((a, b) => (a.date === b.date ? a.file.localeCompare(b.file) : (a.date < b.date ? 1 : -1)));
}

/** 逐票抽取带 verdicts 的记录（纯只读） */
function collectRecords(dirs, days) {
  const archives = listArchives(dirs, days);
  const records = [];
  const broken = [];
  for (const e of archives) {
    const doc = readDoc(path.join(e.dir, e.file));
    if (!doc) { broken.push(e.file); continue; }
    const push = (r) => {
      if (!r || !r.verdicts) return;
      const hot = Array.isArray(r.hot) ? r.hot : [];
      const rules = [];
      if (r.r01 && r.r01.ok) rules.push('R01');
      if (r.r07 && r.r07.ok) rules.push('R07');
      if (r.r05 && r.r05.ok) rules.push('R05');
      const total = Number(r.total);
      records.push({
        date: e.date, pipe: e.pipe, kind: e.kind,
        code: r.code || '', name: r.name || '', sector: r.sector || '',
        verdicts: r.verdicts,
        total: Number.isFinite(total) ? total : null,
        groupRank: Number.isFinite(Number(r.groupRank)) ? Number(r.groupRank) : null,
        board: r.board || '', rules,
        hotTiers: [...new Set(hot.map((h) => (h && h.tier) || '').filter(Boolean))],
        hotNames: [...new Set(hot.map((h) => (h && h.name) || '').filter(Boolean))],
      });
    };
    if (e.pipe === 'tail' || e.pipe === 'preopen') {
      for (const [k, r] of Object.entries(doc.records || {})) push({ ...r, code: (r && r.code) || k });
    } else if (e.pipe === 'nextday') {
      for (const s of doc.stocks || []) if (s.r01 && s.r01.ok) push(s);   // 与 perf-weekly 口径一致
    } else {
      for (const r of doc.records || []) push(r);
    }
  }
  return { archives, records, broken };
}

/** 分桶 → V.aggregate；样本不足返回 null（不给结论） */
function bucketAgg(list, minN) {
  const a = V.aggregate(list);
  if (!a || !a.n || a.n < minN) return null;
  return a;
}

function scoreBand(total, bands) {
  if (total == null) return '未知';
  for (const b of bands) if (total >= b.min) return b.label;
  return '未知';
}

/** 三维度的结构化结果（纯函数，便于自测） */
function analyze(perf, collected, config = cfg) {
  const { archives, records, broken } = collected;
  const sampleDays = new Set(records.map((r) => r.date)).size;
  const insufficient = sampleDays < config.minTradingDays;

  const perPipe = {};
  for (const pipe of Object.keys(RE)) {
    const list = records.filter((r) => r.pipe === pipe);
    perPipe[pipe] = {
      archives: archives.filter((a) => a.pipe === pipe).length,
      tickets: list.length,
      days: new Set(list.map((r) => r.date)).size,
    };
  }

  if (insufficient) {
    return { sampleDays, insufficient, perPipe, broken, totalTickets: records.length, pipelines: (perf && perf.pipelines) || {} };
  }

  // 1) 管道：直接引用 perf-weekly.json 的聚合
  const pipelines = (perf && perf.pipelines) || {};

  // 2) 分项：只用尾盘正式档（排除 -obs 重复计票），按总分档 / 组内排名 / 板块分层
  const tail = records.filter((r) => r.pipe === 'tail' && r.kind === 'formal');
  const dims = {};
  const addRows = (name, pairs) => {
    dims[name] = pairs.map(([label, list]) => ({ label, n: list.length, agg: bucketAgg(list, config.minBucketN) }));
  };
  const by = (fn) => {
    const m = new Map();
    for (const r of tail) {
      const k = fn(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  };
  addRows('总分档', by((r) => scoreBand(r.total, config.scoreBands)));
  addRows('组内排名', by((r) => (r.groupRank == null ? '未知' : (r.groupRank === 1 ? '组内第1' : '非组内第1'))));
  addRows('板块', by((r) => r.board || '未知').slice(0, 8));

  // 3) 游资：按 tier 与席位名分层（同一票可计入多个桶，分层统计口径）
  const hm = records.filter((r) => r.pipe === 'hotmoney');
  const tierMap = new Map(), nameMap = new Map();
  for (const r of hm) {
    for (const t of r.hotTiers) { if (!tierMap.has(t)) tierMap.set(t, []); tierMap.get(t).push(r); }
    for (const n of r.hotNames) { if (!nameMap.has(n)) nameMap.set(n, []); nameMap.get(n).push(r); }
  }
  const hotmoney = {
    tiers: [...tierMap.entries()].sort((a, b) => b[1].length - a[1].length)
      .map(([label, list]) => ({ label, n: list.length, agg: bucketAgg(list, config.minBucketN) })),
    names: [...nameMap.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10)
      .map(([label, list]) => ({ label, n: list.length, agg: bucketAgg(list, config.minBucketN) })),
  };

  return { sampleDays, insufficient, perPipe, broken, totalTickets: records.length, pipelines, dims, hotmoney };
}

const esc = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const pct = (x) => (x == null ? '—' : `${x}%`);

function aggRow(dim, label, n, agg) {
  if (!agg) return `| ${esc(dim)} | ${esc(label)} | ${n} | 样本不足 | — | — |`;
  const t1 = agg.t1 ? `${pct(agg.t1.rate)}（n=${agg.t1.n}）` : '—';
  const t3 = agg.t3 ? `${pct(agg.t3.rate3)}（n=${agg.t3.n}）` : '—';
  const avg = agg.t3 ? pct(agg.t3.avg) : (agg.t1 ? pct(agg.t1.avg) : '—');
  return `| ${esc(dim)} | ${esc(label)} | ${n} | ${t1} | ${t3} | ${avg} |`;
}

function renderMarkdown(ctx, config = cfg) {
  const { result, perf, today, windowDays } = ctx;
  const L = [];
  L.push(`# 胜率回归简报 · ${today}`);
  L.push('');
  L.push(`- 数据：\`eod/data/perf-weekly.json\`（聚合，生成于 ${esc((perf && perf.generatedAt) || '缺失')}，窗口 ${esc((perf && perf.windowDays) || '—')} 天）+ 四类归档逐票 verdicts（窗口 ${windowDays} 天）`);
  L.push(`- 已回填交易日：**${result.sampleDays}** 天 / 门禁 ${config.minTradingDays} 天 · 逐票样本 **${result.totalTickets}** 条`);
  L.push(`- 分桶最小样本：${config.minBucketN} 条 · 不推送 · 不自动调权重 · 不修改任何归档`);
  if (result.broken.length) L.push(`- ⚠️ 解析失败归档 ${result.broken.length} 份：${esc(result.broken.slice(0, 5).join('、'))}`);
  L.push('');

  if (result.insufficient) {
    L.push('## 样本量（本期唯一输出）');
    L.push('');
    L.push('| 管道 | 归档数 | 逐票样本 | 已回填交易日 |');
    L.push('|---|---:|---:|---:|');
    for (const [pipe, s] of Object.entries(result.perPipe)) L.push(`| ${esc(pipe)} | ${s.archives} | ${s.tickets} | ${s.days} |`);
    L.push('');
    L.push(`> **样本不足（${result.sampleDays} / ${config.minTradingDays} 个交易日），本期不输出胜率与回归结论。**`);
    L.push('> 按方案 D2 前置条件，攒够交易日后再出命中率、分项分层与游资分层。请勿用本期数据做参数调整。');
    L.push('');
    L.push('_本期未生成任何命中率、均值、分层对比或调参建议。_');
    return L.join('\n') + '\n';
  }

  L.push('## 1. 按管道（引用 perf-weekly.json 聚合）');
  L.push('');
  L.push('| 管道 | 归档 | 交易日 | 样本 n | T+1 命中率 | T+3 命中率 | T+3 均值 |');
  L.push('|---|---:|---:|---:|---|---|---|');
  for (const [pipe, a] of Object.entries(result.pipelines)) {
    L.push(`| ${esc(pipe)} | ${esc(a.archives)} | ${esc(a.tradingDays)} | ${esc(a.n)} | ${a.t1 ? pct(a.t1.rate) : '—'} | ${a.t3 ? pct(a.t3.rate3) : '—'} | ${a.t3 ? pct(a.t3.avg) : '—'} |`);
  }
  L.push('');

  L.push('## 2. 按分项（尾盘正式档逐票重算，排除 -obs 重复计票）');
  L.push('');
  L.push('| 分层 | 桶 | n | T+1 命中 | T+3 命中 | 均值 |');
  L.push('|---|---|---:|---|---|---|');
  for (const [dim, rows] of Object.entries(result.dims || {})) {
    for (const r of rows) L.push(aggRow(dim, r.label, r.n, r.agg));
  }
  L.push('');
  L.push('> 分层为描述性统计，非因果结论；桶间样本量不同，不做显著性判断。');
  L.push('');

  L.push('## 3. 按游资（逐票重算；同一票可计入多个 tier/席位桶）');
  L.push('');
  L.push('| 维度 | 桶 | n | T+1 命中 | T+3 命中 | 均值 |');
  L.push('|---|---|---:|---|---|---|');
  for (const r of (result.hotmoney && result.hotmoney.tiers) || []) L.push(aggRow('tier', r.label, r.n, r.agg));
  for (const r of (result.hotmoney && result.hotmoney.names) || []) L.push(aggRow('席位', r.label, r.n, r.agg));
  L.push('');
  L.push('> 「避坑」类席位为负向标签，其命中率不代表可跟随信号。');
  L.push('');
  L.push('_本期为静态快照，无历史基线可比，不做趋势判断与权重调整建议。_');
  return L.join('\n') + '\n';
}

function run() {
  if (OPT.help) { say(USAGE); return { help: true }; }
  if (!OPT.json) require('./lib/runlog').startRunLog('weekly_winrate');

  const dirs = {
    tail: path.join(paths.eodDir(), 'data', 'eod'),
    preopen: path.join(paths.eodDir(), 'data', 'preopen'),
    hotmoney: path.join(paths.eodDir(), 'data', 'hotmoney'),
    nextday: paths.dataDir(),
  };
  const perfFile = path.join(paths.eodDir(), 'data', 'perf-weekly.json');
  const perf = readDoc(perfFile);
  if (!perf || !perf.pipelines) throw new Error(`聚合产物读取失败或结构异常：${perfFile} —— 先跑 nextday_backfill，拒绝编造胜率`);

  const collected = collectRecords(dirs, OPT.days);
  const result = analyze(perf, collected, cfg);
  const today = dayjs.tz().format('YYYY-MM-DD');

  const rdir = path.join(paths.home(), cfg.report.dir);
  fs.mkdirSync(rdir, { recursive: true });
  const reportPath = path.join(rdir, `winrate-${today}.md`);
  fs.writeFileSync(reportPath, renderMarkdown({ result, perf, today, windowDays: OPT.days }, cfg), 'utf8');

  say(`[weekly_winrate] 已回填 ${result.sampleDays}/${cfg.minTradingDays} 个交易日 · 逐票 ${result.totalTickets} 条 · 归档 ${collected.archives.length} 份`);
  if (result.insufficient) say('[门禁] 样本不足 → 只报样本量，不输出胜率与回归结论');
  else say('[门禁] 样本达标 → 输出管道 / 分项 / 游资三维度');
  if (collected.broken.length) warn(`[告警] ${collected.broken.length} 份归档解析失败：${collected.broken.slice(0, 5).join('、')}`);
  say(`[报告] ${reportPath}`);
  say('[边界] 未推送通知、未调权重、未修改任何归档');

  const summary = {
    today, sampleDays: result.sampleDays, minTradingDays: cfg.minTradingDays,
    insufficient: result.insufficient, totalTickets: result.totalTickets,
    archives: collected.archives.length, broken: collected.broken,
    perPipe: result.perPipe, reportPath,
  };
  if (OPT.json) console.log(JSON.stringify(summary, null, 2));
  return summary;
}

module.exports = { listArchives, collectRecords, scoreBand, analyze, renderMarkdown, run, OPT };

if (require.main === module) {
  try { run(); }
  catch (e) { warn(`[失败] weekly_winrate：${(e && e.stack) || e}`); process.exitCode = 1; }
}
