'use strict';
/*
 * eod/lib/pattern_report.js —— 形态选股 HTML 报告（单文件、零外链、双语、深浅色）
 * ---------------------------------------------------------------------------
 * 骨架复用 preopen_report.js 的 CSS 与交互范式（主题/语言/视图/chips/分项开关），
 * 共享纯函数走 report_fmt.js；形态选股特有的部分独立在此，不改动盘前报告。
 *
 * 新增（用户 2026-11-09 拍板）：
 *   - 形态过滤 chips 只用形态名（强势平台 / N字二波 / 老鸭头 / VCP突破 / 多形态共振），不带股票名
 *   - 基础表头之后紧跟「推荐买入区间 / 止损 / 止盈」三列
 *   - 上榜与游资合并为一列（同盘前 billboardCell），「上榜 / 游资 / 按游资名」只是过滤 chips
 *   - mini K 线：内联 SVG，标出启动日位置，涨红跌绿
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const paths = require('../../paths');
const { b, num, pct, esc, boardsTxt, billboardCell, hotTierAttr, hotTierCounts, hotTierChipValue } = require('./report_fmt');
const { CSS } = require('./preopen_report');
// mini K 线是全报告共享能力（kline_spark.js），本文件只保留形态特有的「启动日虚线」参数
const { KLINE_CSS, sparkCell } = require('./kline_spark');

const EXTRA_CSS = `
  .buy-range { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--accent); }
  .tag.wait { background: var(--tag-gap-bg); color: var(--amber); }
  .tag.res { background: var(--tag-pass-bg); color: var(--red); }
  table.hide-bd th.sc, table.hide-bd td.sc, table.hide-bd th.grp { display: none; }
  td.sc { background: var(--sc-self-bg); font-size: .78rem; }
  th.sc { background: var(--grp-sub-self-bg); color: var(--accent); }
  .pat-cell { white-space: normal; min-width: 116px; }
  .pat-cell .tag { margin: 1px 3px 1px 0; }
`;

/** 分项特征展开列（固定 6 项，形态之间口径一致，便于横向比较） */
const DETAIL_COLS = [
  ['launchVolX', '启动放量', 'x'],
  ['cumChg', '累计涨幅', '%'],
  ['boxAmp', '箱体振幅', '%'],
  ['minVsMA20', '最低距MA20', '%'],
  ['volMaintain', '量能维持', 'x'],
  ['maxDrawdown', '最大回撤', '%'],
];

function capTxt(cap) {
  if (!cap || cap.total == null) return '—';
  return `${num(cap.total, 1)}/${cap.float != null ? num(cap.float, 1) : '—'}亿`;
}

function patternTags(c) {
  const main = c.patterns[0];
  const tags = c.patterns.map((p) => `<span class="tag ${p.id === main.id ? 'pass' : ''}">${esc(p.name)}<i> ${num(p.score, 0)}</i></span>`).join('');
  return tags + (c.resonance >= 2 ? `<span class="tag res">${b('共振', 'Resonance')}×${c.resonance}</span>` : '');
}

// 上榜与游资是同一列：直接复用 report_fmt.billboardCell（与盘前/尾盘报告同口径，
// 一格内 = 上榜 tag + 游资席位明细/金额/分层）。「上榜 / 游资 / 按游资名」只是过滤 chips，不是列。

function rowHtml(c, i, cfg, withDetail) {
  const p = c.priceLevels || {};
  const w = c.window || {};
  const f = (c.patterns[0] && c.patterns[0].features) || {};
  const hmNames = [...new Set(((c.billboard && c.billboard.hot) || []).map((h) => h.name).filter(Boolean))]
    .map(encodeURIComponent).join('|');
  const hmTiers = hotTierAttr(c.billboard);
  const detail = withDetail
    ? DETAIL_COLS.map(([k]) => {
      const v = f[k];
      return `<td class="num sc">${Number.isFinite(v) ? num(v, k === 'volMaintain' || k === 'launchVolX' ? 2 : 1) : '—'}</td>`;
    }).join('')
    : '';
  const wait = p.status === '等回踩';
  return `<tr data-sector="${esc(c.sector)}" data-patterns="${esc(c.patternIds.join('|'))}" data-stage="${esc(c.stage)}"`
    + ` data-score="${num(c.score, 1)}" data-resonance="${c.resonance}"`
    + `${c.bestInGroup ? ' data-best="1"' : ''} data-grank="${c.groupRank || ''}"`
    + `${c.billboard ? ' data-billboard="1"' : ''}${hmNames ? ` data-hot="1" data-hm="${hmNames}"` : ''}${hmTiers ? ` data-hm-tier="${hmTiers}"` : ''}>
    <td>${i + 1}</td>
    <td><b>${esc(c.name)}</b><span class="src">${esc(c.code.replace(/^[a-z]+/, ''))}</span></td>
    ${sparkCell(c.spark, { width: cfg.report.sparkWidth, height: cfg.report.sparkHeight, launchDate: w.launchDate })}
    <td>${esc(c.sector)}</td>
    <td>${esc(c.board)}</td>
    <td class="num">${num(c.price)}</td>
    <td class="num ${c.chgPct >= 0 ? 'up' : 'down'}">${pct(c.chgPct)}</td>
    <td class="num">${num(c.volRatio)}</td>
    <td class="num">${c.turnover == null ? '—' : num(c.turnover, 2) + '%'}</td>
    <td class="num">${capTxt(c.capYi)}</td>
    <td class="num"><span class="buy-range">${p.buyLow == null ? '—' : `${num(p.buyLow)}–${num(p.buyHigh)}`}</span></td>
    <td class="num down" title="Below pattern support">${p.stopLoss == null ? '—' : num(p.stopLoss)}</td>
    <td class="num up" title="R:R ${p.rewardRatio || 2}:1">${p.takeProfit == null ? '—' : num(p.takeProfit)}</td>
    <td class="pat-cell">${patternTags(c)}</td>
    <td>${boardsTxt(c.boards)}</td>
    <td class="wrap">${billboardCell(c.billboard)}</td>
    <td><span class="score">${num(c.score, 1)}</span></td>
    <td class="src">${esc(String(w.launchDate || '—').slice(5))} · ${num(w.windowDays, 0)}${b('日', 'd')}</td>
    <td class="num ${f.cumChg >= 0 ? 'up' : 'down'}">${pct(f.cumChg)}</td>
    <td class="num ${f.aboveMA20Now >= 0 ? 'up' : 'down'}">${pct(f.aboveMA20Now)}</td>
    <td><span class="tag ${c.stage === '二次启动' ? 'pass' : ''}">${esc(c.stage)}</span></td>
    ${detail}
    <td><span class="score">${num(c.total, 1)}</span></td>
    <td class="wrap"><span class="tag ${wait ? 'wait' : ''}">${esc(p.status || '—')}</span>${p.chasePct != null ? `<span class="src">${b('距支撑', 'to support')} ${num(p.chasePct, 1)}%</span>` : ''}</td>
  </tr>`;
}

/** 近 N 日分形态胜率（由 weekly_winrate 写 perf-weekly.json，缺数据只显示「待积累」） */
function loadPerf() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(paths.eodDir(), 'data', 'perf-weekly.json'), 'utf8'));
    return (d.pipelines && d.pipelines.pattern) || null;
  } catch (e) { return null; }
}

const headCols = () => [
  ['#'], [b('标的', 'Name')], [b('mini K线', 'mini K')], [b('行业', 'Industry')], [b('板块', 'Board')],
  [b('现价', 'Price')], [b('涨跌%', 'Chg%')], [b('量比', 'VolR')], [b('换手%', 'Turn%')], [b('市值/流通', 'Cap/FLOAT')],
  [b('推荐买入区间', 'Buy range')], [b('止损', 'Stop')], [b('止盈', 'Target')],
  [b('形态', 'Patterns')], [b('连板', 'Streak')], [b('上榜', 'List')],
  [b('匹配分', 'Match')], [b('窗口', 'Window')],
  [b('累计涨幅', 'Cum chg')], [b('距MA20', 'vs MA20')], [b('阶段', 'Stage')],
];

function buildHTML(m) {
  const { cfg, tradeDate, scope, result, defs, runner, anchor, fromCache, marketDate } = m;
  const { candidates, groups, top, stats, nearMiss } = result;
  const listed = candidates.slice(0, cfg.report.maxRows > 0 ? cfg.report.maxRows : candidates.length);
  const truncated = candidates.length - listed.length;
  const perf = loadPerf();

  const scopeLabel = scope === 'universe' ? b('全市场', 'Full market') : b('观察池', 'Watchlist');
  const defList = defs.patterns.map((p) => p.name).join(' / ');
  // 各形态命中数（含共振重复计数）
  const patCounts = {};
  for (const p of defs.patterns) patCounts[p.id] = 0;
  for (const c of listed) for (const id of c.patternIds) if (id in patCounts) patCounts[id]++;
  const resonanceCount = listed.filter((c) => c.resonance >= 2).length;

  const conclusion = [
    `<b>${b(`命中 ${candidates.length} 只 / ${groups.length} 个行业（${scope === 'universe' ? '全市场' : '观察池'}）`,
      `${candidates.length} names across ${groups.length} industries`)}。</b>`
      + (groups[0] ? b(` 最强行业「${esc(groups[0].sector)}」，组内最优 ${esc(groups[0].best.name)}（${num(groups[0].best.total, 1)}）。`,
        ` Strongest sector "${esc(groups[0].sector)}", top ${esc(groups[0].best.name)} (${num(groups[0].best.total, 1)}).`) : ''),
    top.length ? b(`综合分前五：${top.slice(0, 5).map((c) => `${esc(c.name)}（${num(c.total, 1)}·${esc(c.patternNames[0])}）`).join('、')}。`,
      `Top five: ${top.slice(0, 5).map((c) => `${esc(c.name)} (${num(c.total, 1)})`).join(', ')}.`) : b('本时段无命中。', 'No hits.'),
    b(`漏斗：快照 ${stats.snapshotCount} → 粗筛 ${stats.coarseCount} → 日K ${stats.klineCount} → 命中 ${stats.candidateCount}（数据缺口 ${stats.gapCount}）。`,
      `Funnel: snapshot ${stats.snapshotCount} → coarse ${stats.coarseCount} → K-lines ${stats.klineCount} → hits ${stats.candidateCount} (gaps ${stats.gapCount}).`),
  ];

  // ---- 表头：基础 9 列后紧跟价位 3 列；分项特征 6 列由开关控制 ----
  const baseHead = headCols().map(([h]) => `<th rowspan="2">${h}</th>`).join('');
  const detailHead = DETAIL_COLS.map(([, zh, unit]) => `<th class="sc">${b(zh + (unit === '%' ? '%' : 'x'), zh)}</th>`).join('');
  const topHead = `<tr>${baseHead}<th colspan="${DETAIL_COLS.length}" class="grp">${b('分项特征（开关）', 'Feature Breakdown')}</th>`
    + `<th rowspan="2">${b('综合分', 'Total')}</th><th rowspan="2">${b('标签', 'Label')}</th></tr>`
    + `<tr>${DETAIL_COLS.map(() => `<th class="grp-sub sc">·</th>`).join('')}</tr>`;
  const plainHead = `<tr>${headCols().map(([h]) => `<th>${h}</th>`).join('')}${detailHead}<th>${b('综合分', 'Total')}</th><th>${b('标签', 'Label')}</th></tr>`;
  const baseCols = headCols().length + DETAIL_COLS.length + 2;

  // ---- 过滤 chips ----
  const chipBtn = (f, v, zh, en, n, active) => `<button type="button" class="chip${active ? ' active' : ''}" data-f="${f}" data-v="${esc(v)}">${b(zh, en)}${n == null ? '' : `<i>${n}</i>`}</button>`;
  const patternChips = [chipBtn('pattern', '', `全部 ${listed.length}`, `All ${listed.length}`, null, true)]
    .concat(defs.patterns.map((p) => chipBtn('pattern', '@p:' + p.id, p.name, p.nameEn || p.name, patCounts[p.id], false)))
    .concat([chipBtn('pattern', '@resonance', '多形态共振', 'Resonance', resonanceCount, false)]).join('');
  const stageOrder = ['启动当日', '整理蓄势', '二次启动'];
  const stageCount = {}; for (const c of listed) stageCount[c.stage] = (stageCount[c.stage] || 0) + 1;
  const stageChips = [chipBtn('stage', '', '全部阶段', 'All stages', null, true)]
    .concat(stageOrder.filter((s) => stageCount[s]).map((s) => chipBtn('stage', s, s, s, stageCount[s], false))).join('');
  const scoreChips = [chipBtn('score', '0', '不限', 'Any', null, true)]
    .concat([90, 80, 70].map((v) => chipBtn('score', String(v), `≥${v}`, `≥${v}`, listed.filter((c) => c.score >= v).length, false))).join('');
  const bbCount = listed.filter((c) => c.billboard).length;
  const hotCount = listed.filter((c) => (c.billboard && c.billboard.hot || []).length).length;
  const bestCount = listed.filter((c) => c.bestInGroup).length;
  const top3Count = listed.filter((c) => (c.groupRank || 99) <= 3).length;
  const hmCounts = {};
  for (const c of listed) for (const n of new Set(((c.billboard && c.billboard.hot) || []).map((h) => h.name).filter(Boolean))) hmCounts[n] = (hmCounts[n] || 0) + 1;
  const tierStat = hotTierCounts(listed, (c) => c.billboard);
  const qualityChips = [chipBtn('quality', '', '全部', 'All', null, true),
    chipBtn('quality', '@billboard', '上榜', 'On list', bbCount, false),
    chipBtn('quality', '@hotmoney', '游资', 'Hot money', hotCount, false)]
    .concat(tierStat.order.map((t) => chipBtn('quality', hotTierChipValue(t), esc(t), esc(t), tierStat.counts[t], false)))
    .concat(Object.keys(hmCounts).sort((a, z) => hmCounts[z] - hmCounts[a]).map((n) => chipBtn('quality', '@hm:' + encodeURIComponent(n), n, n, hmCounts[n], false)))
    .concat([chipBtn('quality', '@best', '组内第一', 'Group #1', bestCount, false),
      chipBtn('quality', '@top3', '组内前三', 'Group top 3', top3Count, false)]).join('');
  const sectorCounts = {};
  for (const c of listed) sectorCounts[c.sector || '未分类'] = (sectorCounts[c.sector || '未分类'] || 0) + 1;
  const sectorOrder = groups.map((g) => g.sector).filter((s) => sectorCounts[s]);
  for (const k of Object.keys(sectorCounts)) if (!sectorOrder.includes(k)) sectorOrder.push(k);
  const sectorChips = [chipBtn('sector', '', '全部行业', 'All sectors', null, true)]
    .concat(sectorOrder.map((s) => chipBtn('sector', s, s, s, sectorCounts[s], false))).join('');

  const toolbar = `<div class="toolbar">
    <div class="seg" role="tablist">
      <button type="button" id="viewScore" class="segbtn active">${b('按综合分', 'By score')}</button>
      <button type="button" id="viewPattern" class="segbtn">${b('按形态', 'By pattern')}</button>
      <button type="button" id="viewSector" class="segbtn">${b('按行业', 'By industry')}</button>
    </div>
    <div class="toolrow"><span class="cap">${b('形态', 'Pattern')}</span><span class="chips" id="pc">${patternChips}</span></div>
    <div class="toolrow"><span class="cap">${b('阶段', 'Stage')}</span><span class="chips" id="sc2">${stageChips}</span></div>
    <div class="toolrow"><span class="cap">${b('匹配分', 'Match')}</span><span class="chips" id="mc">${scoreChips}</span></div>
    <div class="toolrow"><span class="cap">${b('质量', 'Quality')}</span><span class="chips" id="qc">${qualityChips}</span></div>
    <div class="toolrow"><span class="cap">${b('行业', 'Industry')}</span><span class="chips" id="sc">${sectorChips}</span></div>
    <div class="toolrow"><label class="bd-toggle"><input type="checkbox" id="bdToggle"> ${b('分项特征', 'Breakdown')}</label>
      <span class="cap">${b('过滤为 AND 组合；形态视图按主形态分组', 'Filters are AND-combined; pattern view groups by primary pattern')}</span></div>
  </div>`;

  const sepRows = groups.map((g) => `<tr class="sector-row" data-sep="s:${esc(g.sector)}" hidden><td colspan="${baseCols}">${esc(g.sector)} · ${b(`组内 ${g.size} 只，最优 ${esc(g.best.name)}（${num(g.best.total, 1)}）`, `${g.size} picked; top ${esc(g.best.name)} (${num(g.best.total, 1)})`)}</td></tr>`)
    .concat(defs.patterns.map((p) => `<tr class="sector-row" data-sep="p:${esc(p.id)}" hidden><td colspan="${baseCols}">${esc(p.name)} · ${patCounts[p.id]} ${b('只', 'hits')}</td></tr>`)).join('');
  const candRows = listed.map((c, i) => rowHtml(c, i, cfg, true)).join('');
  const nearRows = (nearMiss || []).map((c, i) => rowHtml(c, i, cfg, true)).join('');
  const gapRows = (result.gaps || []).slice(0, 40)
    .map((g) => `<tr><td>${esc(g.code.replace(/^[a-z]+/, ''))}</td><td>${esc(g.name)}</td><td>${esc(g.reason)}</td></tr>`).join('');

  // 分形态胜率（B4 回填 perf-weekly.json 后才显示）
  const perfRows = defs.patterns.map((p) => {
    const v = perf && perf.byPattern && perf.byPattern[p.id];
    return `<tr><td>${esc(p.name)}</td><td class="num">${patCounts[p.id]}</td><td class="num">${v && v.t1 ? v.t1.rate + '%' : b('待积累', 'pending')}</td><td class="num">${v && v.t3 ? v.t3.rate3 + '%' : b('待积累', 'pending')}</td></tr>`;
  }).join('');

  const provenance = b(
    `行情：腾讯 qt.gtimg.cn 批量报价（全市场按代码段枚举）→ 宽松粗筛 → 逐票 ifzq fqkline 前复权日 K（260 根，锚定 ${esc(anchor || tradeDate)}，盘中运行自动用前一交易日）。锚定后只用 ≤ 锚定日的数据，无未来函数。形态判定：模板引擎以「启动日锚点对齐 + 尺度无关特征向量」与模板票特征做加权距离匹配（标尺由 npm run pattern:calibrate 固化），规则引擎按老鸭头 / VCP 参数化门槛逐项判定；形态定义唯一裁决方 ${esc(defs.source)}。行业来自 eod/data/industry-map.json；连板由 K 线推算。上榜/游资来自东方财富龙虎榜与席位明细，约 17:00 后出齐，接口失败相关列留空。参考价位：支撑位取「窗口最低收盘」与「MA20×0.98」较高者且不高于现价×0.98，买入区间 = [支撑位, 现价×(1+${cfg.price.chasePct}%)]，止损 = 支撑位×(1-${cfg.price.stopBufferPct}%)，止盈 = 现价 +(现价−止损)×${cfg.price.rewardRatio}（按现价入场，盈亏比 ${cfg.price.rewardRatio}:1；买入区间是回踩支撑的参考挂单位，两者口径不同）；现价距支撑 >${cfg.price.maxChasePct}% 标「等回踩」。${fromCache ? '本次 K 线来自当日缓存（--replay 口径）。' : ''}运行环境：${esc(runner)}。`,
    `Data: Tencent batch quotes + pre-adjusted daily K-lines anchored to ${esc(anchor || tradeDate)}. Template engine matches scale-free feature vectors against calibrated template features; rule engine applies parameterized Duck-Head / VCP gates. Definitions: ${esc(defs.source)}. Billboard/seats from Eastmoney (may be unavailable). Price levels are quantitative reference levels, not advice. Runner: ${esc(runner)}.`);

  const title = `${cfg.report.title} — ${tradeDate}`;
  const titleEn = `${cfg.report.titleEn} — ${tradeDate}`;

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title><style>${CSS}${EXTRA_CSS}${KLINE_CSS}</style></head>
<body><div class="container">
  <div class="topbar"><div>
    <h1>${b(cfg.report.title, cfg.report.titleEn)} · ${tradeDate}</h1>
    <div class="sub">${b(`四类形态 · ${defList} · 双引擎 · 满分 100`, `Four patterns · dual engine · max 100`)}</div>
  </div><div class="btns">
    <button id="themeBtn" type="button" class="topbtn" title="切换深浅色">☀</button>
    <button id="langBtn" type="button" class="topbtn">EN</button>
  </div></div>

  <div class="meta-bar">
    <div><span class="label">${b('交易日：', 'Trade date:')}</span><span class="value">${tradeDate}</span></div>
    <div><span class="label">${b('锚定日：', 'Anchor:')}</span><span class="value">${esc(anchor || tradeDate)}</span></div>
    <div><span class="label">${b('行情日：', 'Market date:')}</span><span class="value">${esc(marketDate || anchor || tradeDate)}</span></div>
    <div><span class="label">${b('范围：', 'Scope:')}</span><span class="value">${scopeLabel}</span></div>
    <div><span class="label">${b('快照：', 'Snapshot:')}</span><span class="value">${stats.snapshotCount}</span></div>
    <div><span class="label">${b('粗筛：', 'Coarse:')}</span><span class="value">${stats.coarseCount}</span></div>
    <div><span class="label">${b('日K：', 'K-lines:')}</span><span class="value">${stats.klineCount}</span></div>
    <div><span class="label">${b('命中：', 'Hits:')}</span><span class="value up">${stats.candidateCount}</span></div>
    <div><span class="label">${b('缺口：', 'Gaps:')}</span><span class="value">${stats.gapCount}</span></div>
    ${fromCache ? `<div><span class="tag gap">${b('缓存重算', 'Replay')}</span></div>` : ''}
  </div>

  <div class="callout"><h3>${b('核心结论（先行）', 'Key Conclusions')}</h3><ul>${conclusion.map((c) => `<li>${c}</li>`).join('')}</ul></div>

  <h2>${b(`候选明细（${listed.length} 只）`, `Candidates (${listed.length})`)}</h2>
  ${listed.length ? `<p class="score-note">${b(
    `形态过滤只用形态名；「多形态共振」= 同一只票命中 ≥2 类。买入区间/止损/止盈为形态支撑位推导的<b>量化参考位</b>（盈亏比 ${cfg.price.rewardRatio}:1），不是投资建议；「等回踩」表示现价已离支撑过远。`,
    `Patterns are filtered by name only. Buy range / stop / target are quantitative reference levels derived from pattern support (R:R ${cfg.price.rewardRatio}:1), not investment advice.`)}</p>
  ${toolbar}
  <div class="table-wrap"><table id="candTable"><thead>${topHead}</thead><tbody id="candBody">${candRows}${sepRows}</tbody></table></div>
  ${truncated > 0 ? `<p class="src">${b(`另有 ${truncated} 只超出展示上限未列出。`, `${truncated} more not listed.`)}</p>` : ''}`
    : `<div class="card">${b('本时段无满足门槛的候选。', 'No candidate passed all gates.')}</div>`}

  <h2>${b('形态胜率（近 10 个交易日）', 'Pattern Win Rate (last 10 sessions)')}</h2>
  <div class="card"><div class="table-wrap"><table><thead><tr>
    <th>${b('形态', 'Pattern')}</th><th>${b('今日命中', 'Hits today')}</th><th>${b('T+1 命中率', 'T+1 rate')}</th><th>${b('T+3 命中率', 'T+3 rate')}</th>
  </tr></thead><tbody>${perfRows}</tbody></table></div>
  <p class="src">${b('口径：开盘价买入、T+1/T+3 收盘卖出（阈值 2%），由 weekly_winrate 按形态维度聚合；样本不足 20 个交易日只报「待积累」，不给结论。', 'Basis: open buy, T+1/T+3 close sell (2% threshold), aggregated by pattern; <20 sessions → pending only.')}</p></div>

  ${nearMiss && nearMiss.length ? `<h2>${b(`贴线未入选（${nearMiss.length} 只）`, `Near Miss (${nearMiss.length})`)}</h2>
  <div class="card"><details><summary>${b(`匹配分落在入选线（${cfg.score.minMatch}）下方 ${cfg.score.nearMissBand} 分内，默认折叠，供回调阈值`, `Scores within ${cfg.score.nearMissBand} pts below the ${cfg.score.minMatch} admission line`)}</summary>
    <div class="table-wrap"><table><thead>${plainHead}</thead><tbody>${nearRows}</tbody></table></div></details></div>` : ''}

  <h2>${b('数据缺口', 'Data Gaps')}</h2>
  <div class="card">${cfg.report.showDataGap && gapRows
    ? `<details><summary>${b(`K线不足明细（最多 40 条，共 ${result.gaps.length}）`, `K-line gaps (up to 40 of ${result.gaps.length})`)}</summary>
       <div class="table-wrap"><table><thead><tr><th>${b('代码', 'Code')}</th><th>${b('名称', 'Name')}</th><th>${b('原因', 'Reason')}</th></tr></thead><tbody>${gapRows}</tbody></table></div></details>`
    : b('无数据缺口记录。', 'No data-gap records.')}</div>

  <h2>${b('数据口径与偏差声明', 'Data Provenance and Deviations')}</h2>
  <div class="card"><p class="body-text">${provenance}</p></div>

  <div class="disclaimer">${b(
    `本报告为程序化观察输出，仅供个人研究参考，<b>不构成任何投资建议或买卖邀约</b>。模板形态起点由人工指定（如 2026-10-22 / 2026-09-16），属事后视角，存在前视偏差；相似度是模糊匹配，阈值需用「模板票满分 + 全市场命中数落在合理区间」双向校准。涨停/一字板存在买不到风险，参考价位不保证可成交，需自行确认流动性与风险。归档：eod/data/pattern/pattern-${tradeDate}.json。`,
    `Programmatic observation output for personal research only, <b>not investment advice</b>. Template start dates are hindsight-defined (look-ahead bias); similarity is fuzzy and must be calibrated. Reference price levels do not guarantee execution. Archive: eod/data/pattern/pattern-${tradeDate}.json.`)}</div>
  <div class="footer">candidate-pool · pattern screener v${cfg.version} · ${scopeLabel} · ${tradeDate}</div>
</div>
<script>
(function () {
  var themeBtn = document.getElementById('themeBtn'), root = document.documentElement, saved = null;
  try { saved = localStorage.getItem('report-theme'); } catch (e) {}
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  function syncTheme() { themeBtn.textContent = root.getAttribute('data-theme') === 'dark' ? '☀' : '🌙'; }
  syncTheme();
  themeBtn.addEventListener('click', function () {
    var t = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('report-theme', t); } catch (e) {}
    syncTheme();
  });
  var lang = 'zh', btn = document.getElementById('langBtn'), nodes = document.querySelectorAll('[data-zh]');
  nodes.forEach(function (el) { if (!el.getAttribute('data-zh')) el.setAttribute('data-zh', el.innerHTML); });
  function apply(target) {
    nodes.forEach(function (el) { var v = el.getAttribute('data-' + target); if (v !== null && v !== '') el.innerHTML = v; });
    document.documentElement.lang = target === 'zh' ? 'zh-CN' : 'en';
    document.title = target === 'zh' ? '${title}' : '${titleEn}';
    btn.textContent = target === 'zh' ? 'EN' : '中文';
  }
  btn.addEventListener('click', function () { lang = lang === 'zh' ? 'en' : 'zh'; apply(lang); });
  apply(lang);

  var tbody = document.getElementById('candBody');
  if (!tbody) return;
  var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-sector]'));
  var seps = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-sep]'));
  var view = 'score', filters = { pattern: '', stage: '', score: '0', quality: '', sector: '' };
  function want(tr) {
    var p = filters.pattern, q = filters.quality, ok = true;
    if (p === '@resonance') ok = +(tr.getAttribute('data-resonance') || 0) >= 2;
    else if (p.indexOf('@p:') === 0) ok = (tr.getAttribute('data-patterns') || '').split('|').indexOf(p.slice(3)) >= 0;
    if (filters.stage) ok = ok && tr.getAttribute('data-stage') === filters.stage;
    if (+filters.score > 0) ok = ok && +(tr.getAttribute('data-score') || 0) >= +filters.score;
    if (q === '@best') ok = ok && tr.hasAttribute('data-best');
    else if (q === '@top3') { var g = +(tr.getAttribute('data-grank') || 99); ok = ok && g >= 1 && g <= 3; }
    else if (q === '@billboard') ok = ok && tr.hasAttribute('data-billboard');
    else if (q === '@hotmoney') ok = ok && tr.getAttribute('data-hot') === '1';
    else if (q.indexOf('@hm:') === 0) ok = ok && (tr.getAttribute('data-hm') || '').split('|').indexOf(q.slice(4)) >= 0;
    else if (q.indexOf('@htier:') === 0) ok = ok && (tr.getAttribute('data-hm-tier') || '').split('|').indexOf(q.replace('@htier:', '')) >= 0;
    if (filters.sector) ok = ok && tr.getAttribute('data-sector') === filters.sector;
    return ok;
  }
  function render() {
    var frag = document.createDocumentFragment(), shown = [];
    if (view === 'score') {
      rows.forEach(function (tr) { if (want(tr)) { frag.appendChild(tr); shown.push(tr); } });
    } else {
      var prefix = view === 'sector' ? 's:' : 'p:';
      seps.forEach(function (sep) {
        var key = sep.getAttribute('data-sep');
        if (key.indexOf(prefix) !== 0) return;
        var val = key.slice(2), group = [];
        rows.forEach(function (tr) {
          var match = view === 'sector'
            ? tr.getAttribute('data-sector') === val
            : (tr.getAttribute('data-patterns') || '').split('|')[0] === val;
          if (match && want(tr)) group.push(tr);
        });
        if (!group.length) return;
        sep.hidden = false; frag.appendChild(sep);
        group.forEach(function (tr) { frag.appendChild(tr); shown.push(tr); });
      });
    }
    shown.forEach(function (tr) {
      var cell = tr.cells[0];
      if (filters.quality === '@best' || filters.quality === '@top3') {
        if (!tr.dataset.idx) tr.dataset.idx = cell.textContent;
        cell.textContent = tr.getAttribute('data-grank') || tr.dataset.idx;
      } else if (tr.dataset.idx) cell.textContent = tr.dataset.idx;
    });
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    tbody.appendChild(frag);
  }
  var btns = { score: document.getElementById('viewScore'), pattern: document.getElementById('viewPattern'), sector: document.getElementById('viewSector') };
  function setView(v) {
    view = v;
    Object.keys(btns).forEach(function (k) { btns[k].classList.toggle('active', k === v); });
    render();
  }
  Object.keys(btns).forEach(function (k) { btns[k].addEventListener('click', function () { setView(k); }); });
  ['pc', 'sc2', 'mc', 'qc', 'sc'].forEach(function (id) {
    var wrap = document.getElementById(id);
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      var f = chip.getAttribute('data-f'), v = chip.getAttribute('data-v') || '';
      if (!(f in filters)) return;
      filters[f] = v;
      Array.prototype.forEach.call(wrap.querySelectorAll('.chip'), function (c) {
        c.classList.toggle('active', (c.getAttribute('data-v') || '') === v);
      });
      if (f === 'quality' && v === '@top3' && view !== 'sector') { setView('sector'); return; }
      if (f === 'pattern' && v !== '' && view !== 'pattern') { setView('pattern'); return; }
      if (f === 'sector' && v !== '' && view !== 'sector') { setView('sector'); return; }
      render();
    });
  });
  var bd = document.getElementById('bdToggle');
  function applyBd() { document.getElementById('candTable').classList.toggle('hide-bd', !bd.checked); }
  bd.addEventListener('change', applyBd);
  applyBd();
  render();
})();
</script>
</body></html>`;
}

module.exports = { buildHTML, CSS: CSS + EXTRA_CSS + KLINE_CSS, DETAIL_COLS };
