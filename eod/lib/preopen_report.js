'use strict';
/*
 * eod/lib/preopen_report.js —— 盘前选股 HTML 报告（自包含，内联 CSS）
 * ---------------------------------------------------------------------------
 * 视觉与交互对齐 eod/lib/report.js（尾盘富报告）：主题切换(深浅色+localStorage)、
 * 中英双语、按总分/按行业双视图、标签&行业双重过滤、分项列开关、两级分组表头。
 * 涨红跌绿（A 股口径）：.up=红, .down=绿。零依赖，单文件 HTML。
 *
 * 结构：
 *   topbar(标题+主题+语言) → meta-bar → 核心结论
 *   → 候选明细(工具栏+双视图+过滤) → 分组概览 → 数据缺口(折叠)
 *   → 数据口径与偏差 → 免责声明
 *
 * 列：# / 名称+代码 / 行业 / 板块 / 今开% / 昨涨% / 竞价量能比 / 趋势
 *     / P1 竞价 / P2 弱转强 / P3 趋势 / 总分 / 标签
 */

/** 双语片段：默认中文，点右上角 EN 切换 */
function b(zh, en) { return `<span data-zh="${zh}" data-en="${en}">${zh}</span>`; }
function num(n, d = 2) { return (n == null || isNaN(n)) ? '—' : Number(n).toFixed(d); }
function pct(n) { return (n == null || isNaN(n)) ? '—' : (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%'; }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function trendStr(t) {
  if (!t) return '—';
  const parts = [t.maBull ? '多头✓' : '多头✗'];
  if (t.newHigh20) parts.push('20新✓');
  if (t.newHigh60) parts.push('60新✓');
  parts.push(`斜率${num(t.slope20, 1)}%/d`);
  return parts.join(' ');
}
function labelCls(l) {
  const s = String(l || '');
  if (s.indexOf('超预期') >= 0 || s === '竞价涨停') return 'pass';
  if (s.indexOf('弱转强') >= 0) return '';
  if (s.indexOf('竞价强') >= 0 || s.indexOf('趋势') >= 0) return 'gap';
  return '';
}

/*
 * 信号分项分组（两级表头）：P1 竞价强势(35) + P2 弱转强/超预期(35) + P3 趋势(30)。
 * 组内列顺序 = 渲染顺序，权重写进组标题，一眼看出谁占大头。
 */
const SCORE_GROUP = { key: 'sig', zh: '信号分项', en: 'Signals', cols: [['p1', 'P1 竞价·35'], ['p2', 'P2 弱转强·35'], ['p3', 'P3 趋势·30']] };
const SCORE_COLS = SCORE_GROUP.cols;

/** 候选行。withBreakdown 控制是否渲染 P1/P2/P3 三个分项单元格。 */
function rowHtml(c, i, withBreakdown) {
  const cells = withBreakdown
    ? SCORE_COLS.map(([k]) => `<td class="num sc">${num(c.scoreItems ? c.scoreItems[k] : null, 1)}</td>`).join('')
    : '';
  const riskTag = c.risk ? `<span class="tag gap">${b('风险', 'risk')}</span>` : '';
  return `<tr data-sector="${esc(c.sector)}" data-label="${esc(c.label)}"${c.bestInGroup ? ' data-best="1"' : ''} data-grank="${c.groupRank || ''}">
    <td>${i + 1}</td>
    <td><b>${esc(c.name)}</b><span class="src">${c.code.replace(/^[a-z]+/, '')}</span></td>
    <td>${b(esc(c.sector), esc(c.sector))}</td>
    <td>${esc(c.board)}</td>
    <td class="num ${c.auctionChgPct >= 0 ? 'up' : 'down'}">${pct(c.auctionChgPct)}</td>
    <td class="num ${c.yesterdayChgPct >= 0 ? 'up' : 'down'}">${pct(c.yesterdayChgPct)}</td>
    <td class="num">${c.auctionVolRatio == null ? '—' : num(c.auctionVolRatio, 2)}</td>
    <td class="trend">${esc(trendStr(c.trend))}</td>
    ${cells}
    <td><span class="score">${num(c.total, 1)}</span></td>
    <td class="wrap"><span class="tag ${labelCls(c.label)}">${esc(c.label)}</span>${riskTag}</td>
  </tr>`;
}

const CSS = `  :root, :root[data-theme="light"] {
    --bg: #fffbeb; --card: #fff; --text: #1c1917; --muted: #92400e;
    --border: #fde68a; --accent: #b45309; --red: #dc2626; --green: #16a34a;
    --blue: #2563eb; --amber: #d97706; --gold: #ca8a04; --slate: #64748b;
    --btn-bg: #fff; --btn-fg: #b45309; --callout-bg: #fff7ed; --th-bg: #fefce8;
    --grp-self-bg: #fed7aa; --grp-self-fg: #7c2d12; --grp-sub-self-bg: #fff7ed;
    --tag-bg: #eff6ff; --tag-pass-bg: #fef2f2; --tag-gap-bg: #fff7ed; --score-bg: #fffbeb;
    --sc-self-bg: rgba(217, 119, 6, 0.06); --note-fg: #57534e;
    --disc-bg: #fef2f2; --disc-border: #fecaca; --disc-fg: #991b1b; --card-empty-bg: #fafaf9;
  }
  :root[data-theme="dark"] {
    --bg: #0f1419; --card: #1a2129; --text: #e6edf3; --muted: #c9a684;
    --border: #2a323c; --accent: #f59e0b; --red: #ff5b5b; --green: #26a69a;
    --blue: #60a5fa; --amber: #fbbf24; --gold: #ffb74d; --slate: #94a3b8;
    --btn-bg: #222b35; --btn-fg: #f59e0b; --callout-bg: #1f1c17; --th-bg: #222b35;
    --grp-self-bg: #3a2a1a; --grp-self-fg: #fcd34d; --grp-sub-self-bg: #1f1c17;
    --tag-bg: #1b2533; --tag-pass-bg: #2a1e1e; --tag-gap-bg: #1f1c17; --score-bg: #211d14;
    --sc-self-bg: rgba(245, 158, 11, 0.10); --note-fg: #b9b3a8;
    --disc-bg: #2a1e1e; --disc-border: #5b2a2a; --disc-fg: #fca5a5; --card-empty-bg: #14171c;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; padding: 24px 16px; }
  .container { max-width: 1320px; margin: 0 auto; }
  .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 4px; }
  h1 { font-size: 1.55rem; font-weight: 700; margin-bottom: 6px; }
  h2 { font-size: 1.15rem; font-weight: 600; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--border); }
  .sub { color: var(--muted); font-size: 0.9rem; margin-bottom: 14px; }
  .topbtn { flex: none; cursor: pointer; border: 1px solid var(--accent); background: var(--btn-bg); color: var(--btn-fg); font-weight: 600; font-size: 0.85rem; padding: 7px 14px; border-radius: 999px; font-family: inherit; transition: all .15s; white-space: nowrap; }
  .topbtn:hover { background: var(--accent); color: var(--btn-bg); }
  .topbar .btns { display: flex; gap: 8px; }
  .meta-bar { display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 0.88rem; margin-bottom: 18px; }
  .meta-bar .label { color: var(--muted); }
  .meta-bar .value { font-weight: 600; }
  .callout { background: var(--callout-bg); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 10px; padding: 16px 20px; margin-bottom: 18px; }
  .callout h3 { color: var(--accent); margin-bottom: 8px; }
  .callout ul { margin: 6px 0 0 18px; font-size: 0.9rem; }
  .callout li { margin-bottom: 5px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
  .up { color: var(--red); } .down { color: var(--green); } .flat { color: var(--slate); }
  .score { display: inline-block; font-size: 0.95rem; font-weight: 700; padding: 2px 12px; border-radius: 6px; background: var(--score-bg); color: var(--gold); }
  .tag { display: inline-block; font-size: 0.78rem; padding: 2px 8px; border-radius: 4px; margin: 2px 4px 2px 0; background: var(--tag-bg); color: var(--blue); }
  .tag.pass { background: var(--tag-pass-bg); color: var(--red); }
  .tag.gap { background: var(--tag-gap-bg); color: var(--amber); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { padding: 8px 9px; text-align: center; vertical-align: middle; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; background: var(--th-bg); }
  th.grp { text-align: center; font-size: 0.8rem; border-bottom: 1px solid var(--border); background: var(--grp-self-bg); color: var(--grp-self-fg); font-weight: 700; }
  th.grp-sub { background: var(--grp-sub-self-bg); color: var(--accent); }
  td.num { text-align: center; font-variant-numeric: tabular-nums; }
  td.sc { background: var(--sc-self-bg); }
  .score-note { margin: 0 0 12px; font-size: 0.86rem; line-height: 1.75; color: var(--note-fg); background: var(--callout-bg); border: 1px dashed var(--border); border-radius: 8px; padding: 10px 14px; }
  td.wrap { white-space: normal; min-width: 130px; }
  td .src { display: block; color: var(--slate); font-size: 0.72rem; }
  td.trend { color: var(--muted); font-size: 0.8rem; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin: 0 0 12px; }
  .toolrow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; width: 100%; }
  .toolrow .cap { font-size: 0.8rem; color: var(--muted); font-weight: 600; flex: none; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; flex: none; }
  .segbtn { border: 0; background: var(--btn-bg); color: var(--btn-fg); font: inherit; font-size: 0.85rem; font-weight: 600; padding: 6px 16px; cursor: pointer; white-space: nowrap; }
  .segbtn + .segbtn { border-left: 1px solid var(--border); }
  .segbtn.active { background: var(--accent); color: #fff; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { border: 1px solid var(--border); background: var(--btn-bg); color: var(--text); font: inherit; font-size: 0.8rem; padding: 3px 11px; border-radius: 999px; cursor: pointer; }
  .chip i { font-style: normal; color: var(--muted); margin-left: 3px; }
  .chip.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .chip.active i { color: inherit; opacity: 0.85; }
  .bd-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--muted); cursor: pointer; white-space: nowrap; flex: none; }
  tr.sector-row td { background: var(--th-bg); color: var(--accent); font-weight: 700; font-size: 0.88rem; }
  table.hide-bd th.grp, table.hide-bd th.grp-sub, table.hide-bd td.sc { display: none; }
  details { margin-top: 10px; }
  summary { cursor: pointer; color: var(--accent); font-size: 0.88rem; font-weight: 600; }
  .src { font-size: 0.78rem; color: var(--slate); margin-top: 8px; }
  .disclaimer { margin-top: 26px; padding: 14px 18px; background: var(--disc-bg); border: 1px solid var(--disc-border); border-radius: 8px; font-size: 0.85rem; color: var(--disc-fg); }
  .footer { margin-top: 22px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.8rem; text-align: center; }`;

/**
 * @param {object} m { cfg, tradeDate, scope, anchor, result, marketDate, runner }
 * @returns {string} 完整 HTML
 */
function buildHTML(m) {
  const { cfg, tradeDate, scope, anchor, result, marketDate, runner } = m;
  const { candidates, groups, top, stats } = result;
  const scopeLabel = scope === 'universe' ? b('全市场', 'Full market') : b('观察池', 'Watchlist');

  // ---- 核心结论 ----
  const bestGroup = groups[0];
  const conclusion = [
    `<b>${b(`候选 ${candidates.length} 只 / ${groups.length} 个行业（${scope === 'universe' ? '全市场' : '观察池'}）`,
      `${candidates.length} names across ${groups.length} industries (${scope === 'universe' ? 'full market' : 'watchlist'})`)}。</b>`
      + (bestGroup ? b(
        `最强行业「${esc(bestGroup.sector)}」，组内最优 ${esc(bestGroup.best.name)}（${num(bestGroup.best.total, 1)}）。`,
        `Strongest industry "${esc(bestGroup.sector)}"; its top pick is ${esc(bestGroup.best.name)} (${num(bestGroup.best.total, 1)}).`) : ''),
    top.length ? b(
      `全市场前五：${top.slice(0, 5).map((c) => `${esc(c.name)}（${num(c.total, 1)}）`).join('、')}。`,
      `Top five: ${top.slice(0, 5).map((c) => `${esc(c.name)} (${num(c.total, 1)})`).join(', ')}.`) : b('本时段无候选。', 'No candidates.'),
    b(
      `漏斗：快照 ${stats.snapshotCount} → 有基线 ${stats.baselineCount} → 入选 ${stats.candidateCount}（缺口 ${stats.gapCount}）。`,
      `Funnel: snapshot ${stats.snapshotCount} → with baseline ${stats.baselineCount} → picked ${stats.candidateCount} (gaps ${stats.gapCount}).`),
  ];

  // ---- 两级表头：合并「信号分项」到 P1/P2/P3 ----
  const topHead = `<tr><th rowspan="2">#</th><th rowspan="2">${b('标的', 'Name')}</th><th rowspan="2">${b('行业', 'Industry')}</th>
    <th rowspan="2">${b('板块', 'Board')}</th><th rowspan="2">${b('今开', 'Open')}</th><th rowspan="2">${b('昨涨', 'Prev chg')}</th>
    <th rowspan="2">${b('竞价量能比', 'Auction vol')}</th><th rowspan="2">${b('趋势', 'Trend')}</th>
    <th colspan="${SCORE_COLS.length}" class="grp">${b(SCORE_GROUP.zh, SCORE_GROUP.en)}</th>
    <th rowspan="2">${b('总分', 'Total')}</th><th rowspan="2">${b('标签', 'Label')}</th></tr>
    <tr>${SCORE_COLS.map(([, zh]) => `<th class="grp-sub">${b(zh, zh)}</th>`).join('')}</tr>`;

  const scoreNote = `<p class="score-note" id="scoreNote">${b(
    `信号分项：<b class="sn-self">P1 竞价强势</b>（今开高开 + 竞价量能比）· <b>P2 弱转强/超预期</b>（昨日强 + 今日开幅符合或超预期）· <b>P3 趋势</b>（均线多头 + N 日新高 + 斜率）。总分 = P1×0.35 + P2×0.35 + P3×0.30。`,
    `Signals: <b class="sn-self">P1 auction strength</b> (gap-up + auction volume ratio) · <b>P2 turn-strong / beat</b> (yesterday strong + today gap in/above range) · <b>P3 trend</b> (MA bull + N-day high + slope). Total = P1×0.35 + P2×0.35 + P3×0.30.`)}</p>`;

  // ---- 候选明细 + 工具栏（标签过滤 + 行业过滤 + 双视图 + 分项开关）----
  const listed = candidates.slice(0, cfg.report.maxRows);
  const truncated = candidates.length - listed.length;
  // 标签 chips（按出现顺序去重）
  const labelCounts = {};
  for (const c of listed) labelCounts[c.label] = (labelCounts[c.label] || 0) + 1;
  const labelOrder = [];
  for (const c of listed) if (!labelOrder.includes(c.label)) labelOrder.push(c.label);
  // 行业 chips
  const sectorCounts = {};
  for (const c of listed) { const k = c.sector || '未分类'; sectorCounts[k] = (sectorCounts[k] || 0) + 1; }
  const sectorOrder = groups.map((g) => g.sector).filter((s) => sectorCounts[s]);
  for (const k of Object.keys(sectorCounts)) if (!sectorOrder.includes(k)) sectorOrder.push(k);

  const bestCount = listed.reduce((n, c) => n + (c.bestInGroup ? 1 : 0), 0);
  const top3Count = listed.reduce((n, c) => n + ((c.groupRank || 99) <= 3 ? 1 : 0), 0);

  const labelChips = [`<button type="button" class="chip active" data-lfilter="">${b(`全部 ${listed.length}`, `All ${listed.length}`)}</button>`]
    .concat([
      `<button type="button" class="chip" data-lfilter="@best">${b('组内第一', 'Group #1')}<i>${bestCount}</i></button>`,
      `<button type="button" class="chip" data-lfilter="@top3">${b('组内前三', 'Group top 3')}<i>${top3Count}</i></button>`,
    ])
    .concat(labelOrder.map((l) => `<button type="button" class="chip" data-lfilter="${esc(l)}">${b(esc(l), esc(l))}<i>${labelCounts[l]}</i></button>`))
    .join('');
  const sectorChips = [`<button type="button" class="chip active" data-sfilter="">${b('全部行业', 'All sectors')}</button>`]
    .concat(sectorOrder.map((s) => `<button type="button" class="chip" data-sfilter="${esc(s)}">${b(esc(s), esc(s))}<i>${sectorCounts[s]}</i></button>`))
    .join('');

  const toolbar = `<div class="toolbar">
    <div class="seg" role="tablist">
      <button type="button" id="viewScore" class="segbtn active">${b('按总分', 'By score')}</button>
      <button type="button" id="viewSector" class="segbtn">${b('按行业', 'By industry')}</button>
    </div>
    <div class="toolrow"><span class="cap">${b('标签', 'Label')}</span><span class="chips" id="lchips">${labelChips}</span></div>
    <div class="toolrow"><span class="cap">${b('行业', 'Industry')}</span><span class="chips" id="schips">${sectorChips}</span></div>
    <div class="toolrow"><label class="bd-toggle"><input type="checkbox" id="bdToggle" checked> ${b('分项得分', 'Breakdown')}</label></div>
  </div>`;

  // 分组分隔行：默认隐藏，「按行业」视图前端插入各组行首
  const baseCols = 8 + SCORE_COLS.length + 2; // 基础8 + 分项3 + 总分/标签2 = 13
  const sepRows = groups.map((g) =>
    `<tr class="sector-row" data-sep="${esc(g.sector)}" hidden><td colspan="${baseCols}">${
      b(esc(g.sector), esc(g.sector))} · ${b(`组内 ${g.size} 只，最优 ${esc(g.best.name)}（${num(g.best.total, 1)}）`,
        `${g.size} picked; top ${esc(g.best.name)} (${num(g.best.total, 1)})`)}</td></tr>`).join('');
  const candRows = listed.map((c, i) => rowHtml(c, i, true)).join('');

  // ---- 数据缺口 ----
  const gapRows = (result.gaps || []).slice(0, 40)
    .map((g) => `<tr><td>${esc(g.code.replace(/^[a-z]+/, ''))}</td><td>${esc(g.name)}</td><td>${esc(g.reason)}</td></tr>`).join('');

  const provenance = b(
    `竞价快照来自腾讯 qt.gtimg.cn 批量报价（今开 open 于 09:25 撮合后固定，近似竞价价；竞价量能比 = 竞价量 / 昨日全天量）。昨涨 + 趋势基线来自腾讯 ifzq fqkline 前复权日 K 线，锚定前一交易日 ${esc(anchor || marketDate || tradeDate)}${scope === 'universe' ? '（全市场基线缓存 preopen-baseline-*.json）' : '（观察池实时计算）'}。行业归属来自本地缓存 eod/data/industry-map.json。交易日由行情时间戳众数推导（${esc(marketDate || tradeDate)}），不依赖外部交易日历。运行环境：${esc(runner)}。`,
    `Auction snapshot: Tencent qt.gtimg.cn batch quotes (open fixed at 09:25 auction close; auction vol ratio = auction vol / yesterday full-day vol). Yesterday-change + trend baseline: Tencent ifzq fqkline (pre-adjusted daily K), anchored to the prior trading day ${esc(anchor || marketDate || tradeDate)}${scope === 'universe' ? ' (full-market baseline cache preopen-baseline-*.json)' : ' (watchlist computed live)'}. Industry: local cache eod/data/industry-map.json. Trade date derived from quote-timestamp mode (${esc(marketDate || tradeDate)}); no external calendar. Runner: ${esc(runner)}.`);

  const title = `${cfg.report.title} — ${tradeDate}`;
  const titleEn = `${cfg.report.titleEn} — ${tradeDate}`;

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<div class="container">
  <div class="topbar">
    <div>
      <h1>${b(cfg.report.title, cfg.report.titleEn)} · ${tradeDate}</h1>
      <div class="sub">${b('盘前窗口 09:20–09:35 · 今开(open) 09:25 撮合后固定 · 满分 100', 'Pre-open window 09:20–09:35 · open fixed at 09:25 auction close · max 100')}</div>
    </div>
    <div class="btns">
      <button id="themeBtn" type="button" class="topbtn" title="切换深浅色">☀</button>
      <button id="langBtn" type="button" class="topbtn">EN</button>
    </div>
  </div>

  <div class="meta-bar">
    <div><span class="label">${b('交易日：', 'Trade date:')}</span><span class="value">${tradeDate}</span></div>
    <div><span class="label">${b('范围：', 'Scope:')}</span><span class="value">${scopeLabel}</span></div>
    <div><span class="label">${b('行情日：', 'Market date:')}</span><span class="value">${esc(marketDate || tradeDate)}</span></div>
    <div><span class="label">${b('基线锚定日：', 'Baseline anchor:')}</span><span class="value">${esc(anchor || '—')}</span></div>
    <div><span class="label">${b('快照：', 'Snapshot:')}</span><span class="value">${stats.snapshotCount}</span></div>
    <div><span class="label">${b('基线：', 'Baseline:')}</span><span class="value">${stats.baselineCount}</span></div>
    <div><span class="label">${b('候选：', 'Candidates:')}</span><span class="value up">${stats.candidateCount}</span></div>
    <div><span class="label">${b('行业组：', 'Groups:')}</span><span class="value">${stats.groupCount}</span></div>
    <div><span class="label">${b('缺口：', 'Gaps:')}</span><span class="value">${stats.gapCount}</span></div>
  </div>

  <div class="callout">
    <h3>${b('核心结论（先行）', 'Key Conclusions (Up Front)')}</h3>
    <ul>${conclusion.map((c) => `<li>${c}</li>`).join('')}</ul>
  </div>

  <h2>${b(`候选明细（${listed.length} 只）`, `Candidates (${listed.length})`)}</h2>
  ${listed.length ? `${scoreNote}${toolbar}
  <div class="table-wrap"><table id="candTable"><thead>${topHead}</thead>
    <tbody id="candBody">${candRows}${sepRows}</tbody></table></div>
  ${truncated > 0 ? `<p class="src">${b(`另有 ${truncated} 只超出展示上限（report.maxRows）未列出。`, `${truncated} more candidates not listed (report.maxRows cap).`)}</p>` : ''}`
    : `<div class="card">${b('本时段无满足全部门槛的候选。', 'No candidate passed all gates.')}</div>`}

  <h2>${b('数据缺口', 'Data Gaps')}</h2>
  <div class="card">
    ${cfg.report.showDataGap && gapRows ? `<details><summary>${b(`被剔除/缺数据明细（最多 40 条，共 ${result.gaps.length}）`, `Excluded / missing-data details (up to 40 of ${result.gaps.length})`)}</summary>
      <div class="table-wrap"><table><thead><tr><th>${b('代码', 'Code')}</th><th>${b('名称', 'Name')}</th><th>${b('原因', 'Reason')}</th></tr></thead>
      <tbody>${gapRows}</tbody></table></div></details>` : b('无数据缺口记录。', 'No data-gap records.')}
  </div>

  <h2>${b('数据口径与偏差声明', 'Data Provenance and Deviations')}</h2>
  <div class="card"><p class="body-text">${provenance}</p></div>

  <div class="disclaimer">${b('本报告为程序化观察输出，仅供个人研究参考，不构成任何投资建议。盘前候选基于集合竞价快照筛选，09:25 后价格仍可能变动，涨停/一字板存在买不到的风险，需自行确认可成交性与流动性。开盘快照存档于 eod/data/preopen-' + tradeDate + '.json，收盘后由 preopen_backfill.js 回填当日涨跌幅/是否涨停并统计命中率。',
    'This report is programmatic observation output for personal research only and is not investment advice. Pre-open candidates are screened on the auction snapshot; prices may still move after 09:25, and limit-up / one-word boards may be unbuyable — verify tradability and liquidity yourself. The snapshot is archived to eod/data/preopen-' + tradeDate + '.json; after close preopen_backfill.js back-fills the day change / limit-up and computes the hit rate.')}</div>
  <div class="footer">candidate-pool · preopen screener v${cfg.version} · ${scopeLabel} · ${tradeDate}</div>
</div>
<script>
(function () {
  var themeBtn = document.getElementById('themeBtn');
  var root = document.documentElement;
  var savedTheme = null;
  try { savedTheme = localStorage.getItem('report-theme'); } catch (e) {}
  if (savedTheme === 'light' || savedTheme === 'dark') root.setAttribute('data-theme', savedTheme);
  function syncThemeLabel() { themeBtn.textContent = (root.getAttribute('data-theme') === 'dark') ? '☀' : '🌙'; }
  syncThemeLabel();
  themeBtn.addEventListener('click', function () {
    var t = (root.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('report-theme', t); } catch (e) {}
    syncThemeLabel();
  });
  var lang = 'zh';
  var btn = document.getElementById('langBtn');
  var nodes = document.querySelectorAll('[data-zh]');
  nodes.forEach(function (el) { if (!el.getAttribute('data-zh')) el.setAttribute('data-zh', el.innerHTML); });
  function apply(target) {
    nodes.forEach(function (el) {
      var val = el.getAttribute('data-' + target);
      if (val !== null && val !== '') el.innerHTML = val;
    });
    document.documentElement.lang = (target === 'zh') ? 'zh-CN' : 'en';
    document.title = (target === 'zh') ? '${title}' : '${titleEn}';
    btn.textContent = (target === 'zh') ? 'EN' : '中文';
  }
  btn.addEventListener('click', function () { lang = (lang === 'zh') ? 'en' : 'zh'; apply(lang); });
  apply(lang);

  // 候选明细：视图切换 + 标签过滤 + 行业过滤（AND）+ 分项开关。
  // 行服务端渲染好；「按行业」把行重排进分组分隔行之下，不重建 DOM。
  var tbody = document.getElementById('candBody');
  if (tbody) {
    var candRows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-sector]'));
    var sepOrder = [];
    Array.prototype.forEach.call(tbody.querySelectorAll('tr[data-sep]'), function (tr) { sepOrder.push(tr); });
    var candView = 'score', lFilter = '', sFilter = '';
    var viewScoreBtn = document.getElementById('viewScore');
    var viewSectorBtn = document.getElementById('viewSector');
    function want(tr) {
      var okL = true, okS = true;
      if (lFilter === '@best') okL = tr.hasAttribute('data-best');
      else if (lFilter === '@top3') { var g = parseInt(tr.getAttribute('data-grank'), 10); okL = g >= 1 && g <= 3; }
      else if (lFilter) okL = tr.getAttribute('data-label') === lFilter;
      if (sFilter) okS = tr.getAttribute('data-sector') === sFilter;
      return okL && okS;
    }
    function renderCand() {
      var frag = document.createDocumentFragment();
      var ranked = (lFilter === '@best' || lFilter === '@top3');
      var shown = [];
      if (candView === 'score') {
        candRows.forEach(function (tr) { if (want(tr)) { frag.appendChild(tr); shown.push(tr); } });
      } else {
        sepOrder.forEach(function (sep) {
          var sec = sep.getAttribute('data-sep');
          if (sFilter && sec !== sFilter) return;
          var groupRows = [];
          candRows.forEach(function (tr) { if (tr.getAttribute('data-sector') === sec && want(tr)) groupRows.push(tr); });
          if (!groupRows.length) return;
          sep.hidden = false; frag.appendChild(sep);
          groupRows.forEach(function (tr) { frag.appendChild(tr); shown.push(tr); });
        });
      }
      shown.forEach(function (tr) {
        var cell = tr.cells[0];
        if (ranked) {
          if (!tr.dataset.idx) tr.dataset.idx = cell.textContent;
          cell.textContent = tr.getAttribute('data-grank') || tr.dataset.idx;
        } else if (tr.dataset.idx) {
          cell.textContent = tr.dataset.idx;
        }
      });
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      tbody.appendChild(frag);
    }
    function setView(v) {
      candView = v;
      viewScoreBtn.classList.toggle('active', v === 'score');
      viewSectorBtn.classList.toggle('active', v === 'sector');
      renderCand();
    }
    viewScoreBtn.addEventListener('click', function () { setView('score'); });
    viewSectorBtn.addEventListener('click', function () { setView('sector'); });
    function bindChips(id, setter) {
      var wrap = document.getElementById(id);
      wrap.addEventListener('click', function (e) {
        var chip = e.target.closest('.chip');
        if (!chip) return;
        setter(chip.getAttribute('data-lfilter') != null ? chip.getAttribute('data-lfilter') : chip.getAttribute('data-sfilter') || '');
        Array.prototype.forEach.call(wrap.querySelectorAll('.chip'), function (c) {
          var v = c.getAttribute('data-lfilter') != null ? c.getAttribute('data-lfilter') : (c.getAttribute('data-sfilter') || '');
          var cur = (id === 'lchips') ? lFilter : sFilter;
          c.classList.toggle('active', v === cur);
        });
        // 组内前三要求同组相邻：选中时自动切「按行业」
        if (lFilter === '@top3' && candView !== 'sector') { setView('sector'); return; }
        renderCand();
      });
    }
    bindChips('lchips', function (v) { lFilter = v; });
    bindChips('schips', function (v) { sFilter = v; });
    var bdToggle = document.getElementById('bdToggle');
    var scoreNote = document.getElementById('scoreNote');
    function applyBd() {
      var on = bdToggle.checked;
      document.getElementById('candTable').classList.toggle('hide-bd', !on);
      if (scoreNote) scoreNote.style.display = on ? '' : 'none';
    }
    bdToggle.addEventListener('change', applyBd);
    applyBd();
    renderCand();
  }
})();
</script>
</body>
</html>`;
}

module.exports = { buildHTML };
