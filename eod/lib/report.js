'use strict';
/*
 * eod/lib/report.js —— 自包含双语 HTML 报告（FR-08）
 * ---------------------------------------------------------------------------
 * 视觉与交互完全复用 gen_candidates.js 的既有样式（暖色系 + data-zh/data-en
 * 双语切换），保证两份报告放在一起不违和。零依赖，输出单文件 HTML。
 *
 * 结构：
 *   topbar（标题 + 语言切换）→ meta-bar（交易日 / 口径 / 漏斗数字）
 *   → 核心结论 → TOP N 明细（含六项分项得分）
 *   → 分行业分组卡片 → 淘汰漏斗统计 → 数据缺口（折叠）
 *   → 数据口径声明 + 免责声明
 * ---------------------------------------------------------------------------
 */

const { BOARD_LABEL } = require('./screen');

/** 双语片段：默认渲染中文，点击右上角按钮切换 */
function b(zh, en) { return `<span data-zh="${zh}" data-en="${en}">${zh}</span>`; }
function num(n, d = 2) { return (n == null || isNaN(n)) ? '—' : Number(n).toFixed(d); }
function pct(n) { return (n == null || isNaN(n)) ? '—' : (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%'; }
function yi(n) { return (n == null || isNaN(n)) ? '—' : Number(n).toFixed(1) + ' 亿'; }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

const SCORE_COLS = [
  ['tailMomentum', '尾盘动能', 'Tail momentum'],
  ['volume', '量能', 'Volume'],
  ['position', '位置', 'Position'],
  ['avgLine', '均价线', 'VWAP'],
  ['sector', '板块', 'Sector'],
  ['turnoverFit', '换手', 'Turnover'],
];

/** 单条候选的行（用于 TOP 表 / 分组卡片） */
function rowHtml(c, i, cfg, withBreakdown) {
  const tail = c.tail || {};
  const warn = cfg.score.tailUpRatioWarn;
  const tagBits = [];
  if (c.bestInGroup) tagBits.push(`<span class="tag pass">${b('组内最优', 'best in group')}</span>`);
  if (tail.upRatio != null && tail.upRatio < warn) {
    tagBits.push(`<span class="tag gap">${b('拉升不连贯', 'choppy tail')}</span>`);
  }
  const cells = withBreakdown
    ? SCORE_COLS.map(([k]) => `<td>${num(c.score ? c.score[k] : null, 1)}</td>`).join('')
    : '';
  return `<tr>
    <td>${i + 1}</td>
    <td><b>${esc(c.name)}</b><span class="src">${c.code.replace(/^[a-z]+/, '')}</span></td>
    <td>${b(esc(c.sector), esc(c.sector))}</td>
    <td class="up">${pct(c.chgPct)}</td>
    <td>${num(tail.segPct, 2)}%</td>
    <td>${num(c.volRatio)}</td>
    <td>${num(c.turnover, 1)}%</td>
    <td>${yi(c.floatCapYi)}</td>
    ${cells}
    <td><span class="score">${num(c.total, 1)}</span></td>
    <td class="wrap">${tagBits.join('') || '—'}</td>
  </tr>`;
}

const CSS = `  :root {
    --bg: #fffbeb; --card: #fff; --text: #1c1917; --muted: #92400e;
    --border: #fde68a; --accent: #b45309; --red: #dc2626; --green: #16a34a;
    --blue: #2563eb; --amber: #d97706; --gold: #ca8a04; --slate: #64748b;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; padding: 24px 16px; }
  .container { max-width: 1040px; margin: 0 auto; }
  .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 4px; }
  h1 { font-size: 1.55rem; font-weight: 700; margin-bottom: 6px; }
  h2 { font-size: 1.15rem; font-weight: 600; margin: 30px 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--border); }
  .sub { color: var(--muted); font-size: 0.9rem; margin-bottom: 14px; }
  #langBtn { flex: none; cursor: pointer; border: 1px solid var(--accent); background: #fff; color: var(--accent); font-weight: 600; font-size: 0.85rem; padding: 7px 16px; border-radius: 999px; font-family: inherit; transition: all .15s; white-space: nowrap; }
  #langBtn:hover { background: var(--accent); color: #fff; }
  .meta-bar { display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 0.88rem; margin-bottom: 18px; }
  .meta-bar .label { color: var(--muted); }
  .meta-bar .value { font-weight: 600; }
  .callout { background: #fff7ed; border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 10px; padding: 16px 20px; margin-bottom: 18px; }
  .callout h3 { color: var(--accent); margin-bottom: 8px; }
  .callout ul { margin: 6px 0 0 18px; font-size: 0.9rem; }
  .callout li { margin-bottom: 5px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
  .group-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .group-head h3 { font-size: 1.02rem; }
  .group-head .g-meta { color: var(--muted); font-size: 0.82rem; }
  .up { color: var(--red); }
  .down { color: var(--green); }
  .flat { color: var(--slate); }
  .score { display: inline-block; font-size: 0.95rem; font-weight: 700; padding: 2px 12px; border-radius: 6px; background: #fffbeb; color: var(--gold); }
  .tag { display: inline-block; font-size: 0.78rem; padding: 2px 8px; border-radius: 4px; margin: 2px 4px 2px 0; background: #eff6ff; color: var(--blue); }
  .tag.fail { background: #f1f5f9; color: var(--slate); }
  .tag.pass { background: #fef2f2; color: var(--red); }
  .tag.gap { background: #fffbeb; color: var(--amber); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { padding: 8px 9px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; background: #fefce8; }
  td.wrap { white-space: normal; min-width: 150px; }
  td .src { display: block; color: var(--slate); font-size: 0.72rem; }
  details { margin-top: 10px; }
  summary { cursor: pointer; color: var(--accent); font-size: 0.88rem; font-weight: 600; }
  .src { font-size: 0.78rem; color: var(--slate); margin-top: 8px; }
  .disclaimer { margin-top: 26px; padding: 14px 18px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 0.85rem; color: #991b1b; }
  .footer { margin-top: 22px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.8rem; text-align: center; }`;

/**
 * @param {object} m { cfg, tradeDate, mode, cutHHMM, segFrom, result, meta, runner }
 * @returns {string} 完整 HTML
 */
function buildHTML(m) {
  const { cfg, tradeDate, mode, cutHHMM, segFrom, result, meta, runner } = m;
  const { candidates, groups, top, stats } = result;
  const modeLabel = mode === 'observe'
    ? b(`观察模式（口径 ${cutHHMM}，未固定）`, `observe mode (cut ${cutHHMM}, not final)`)
    : b(`固定口径 ${cutHHMM}`, `fixed cut ${cutHHMM}`);

  // ---- 核心结论 ----
  const bestGroup = groups[0];
  const conclusion = [
    `<b>${b(`候选 ${candidates.length} 只 / ${groups.length} 个行业`, `${candidates.length} names across ${groups.length} industries`)}。</b>`
      + (bestGroup ? b(
        `最强行业「${esc(bestGroup.sector)}」（中位涨幅 ${num(bestGroup.best.sectorMedianChg, 2)}%），组内最优 ${esc(bestGroup.best.name)}。`,
        `Strongest industry "${esc(bestGroup.sector)}" (median ${num(bestGroup.best.sectorMedianChg, 2)}%); its top pick is ${esc(bestGroup.best.name)}.`) : ''),
    top.length ? b(
      `全市场前五：${top.slice(0, 5).map((c) => `${esc(c.name)}（${num(c.total, 1)}）`).join('、')}。`,
      `Top five: ${top.slice(0, 5).map((c) => `${esc(c.name)} (${num(c.total, 1)})`).join(', ')}.`) : b('本时段无候选。', 'No candidates in this window.'),
    b(
      `漏斗：快照 ${stats.snapshotCount} → 初筛通过 ${stats.prePassCount} → 尾盘段校验后 ${stats.candidateCount}。`,
      `Funnel: snapshot ${stats.snapshotCount} → pre-filter pass ${stats.prePassCount} → after tail checks ${stats.candidateCount}.`),
  ];

  // ---- TOP N 表 ----
  const topRows = top.map((c, i) => rowHtml(c, i, cfg, true)).join('');
  const topHead = `<tr><th>#</th><th>${b('标的', 'Name')}</th><th>${b('行业', 'Industry')}</th>
    <th>${b('涨幅', 'Chg')}</th><th>${b('尾盘段', 'Tail seg')}</th><th>${b('量比', 'Vol ratio')}</th>
    <th>${b('换手', 'Turnover')}</th><th>${b('流通值', 'Float cap')}</th>
    ${SCORE_COLS.map(([, zh, en]) => `<th>${b(zh, en)}</th>`).join('')}
    <th>${b('总分', 'Total')}</th><th>${b('标记', 'Flags')}</th></tr>`;

  // ---- 分组卡片 ----
  const groupCards = groups.map((g) => {
    const rows = g.shown.map((c, i) => rowHtml(c, i, cfg, false)).join('');
    return `<div class="card">
      <div class="group-head">
        <h3>${esc(g.sector)}</h3>
        <span class="g-meta">${b(`组内 ${g.size} 只（展示 ${g.shown.length}）`, `${g.size} picked, showing ${g.shown.length}`)}
          · ${b('行业中位涨幅', 'industry median')} ${pct(g.best.sectorMedianChg)}</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>${b('标的', 'Name')}</th><th>${b('行业', 'Industry')}</th>
          <th>${b('涨幅', 'Chg')}</th><th>${b('尾盘段', 'Tail seg')}</th><th>${b('量比', 'Vol ratio')}</th>
          <th>${b('换手', 'Turnover')}</th><th>${b('流通值', 'Float cap')}</th>
          <th>${b('总分', 'Total')}</th><th>${b('标记', 'Flags')}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  }).join('');

  // ---- 淘汰漏斗 ----
  const funnelRows = Object.entries(stats.preByReason)
    .sort((a, c) => c[1] - a[1])
    .map(([r, n]) => `<tr><td>${b(esc(r), esc(r))}</td><td>${n}</td></tr>`).join('');
  const tailRows = Object.entries(stats.tailByReason)
    .sort((a, c) => c[1] - a[1])
    .map(([r, n]) => `<tr><td>${b(esc(r), esc(r))}</td><td>${n}</td></tr>`).join('');

  // ---- 数据缺口 ----
  const gapRows = result.dropped.filter((d) => d.reason.includes('数据')).slice(0, 40)
    .map((d) => `<tr><td>${esc(d.code)}</td><td>${esc(d.name)}</td><td>${esc(d.reason)}</td></tr>`).join('');

  const provenance = b(
    `全市场快照来自腾讯 qt.gtimg.cn 批量报价（${meta.slots} 个槽位 / ${meta.batches} 批 / 失败 ${meta.failedBatches} 批，耗时 ${(meta.elapsedMs / 1000).toFixed(1)}s）；分时 1 分钟线来自腾讯 web.ifzq.gtimg.cn 分时接口（尾盘段 ${segFrom} → ${cutHHMM}）；行业归属来自本地缓存 eod/data/industry-map.json（东财行业分类）。交易日由行情时间戳众数推导（${meta.marketDate}），不依赖外部交易日历。运行环境：${runner}。`,
    `Market snapshot: Tencent qt.gtimg.cn batch quotes (${meta.slots} slots / ${meta.batches} batches / ${meta.failedBatches} failed, ${(meta.elapsedMs / 1000).toFixed(1)}s); 1-minute bars: Tencent web.ifzq.gtimg.cn (tail segment ${segFrom} → ${cutHHMM}); industry mapping: local cache eod/data/industry-map.json (EM sector classes). Trade date derived from the quote-timestamp mode (${meta.marketDate}); no external calendar. Runner: ${runner}.`);

  const title = `${cfg.report.title} — ${tradeDate} ${cutHHMM.slice(0, 2)}:${cutHHMM.slice(2)}`;
  const titleEn = `${cfg.report.titleEn} — ${tradeDate} ${cutHHMM.slice(0, 2)}:${cutHHMM.slice(2)}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
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
      <div class="sub">${b(`尾盘段 ${segFrom.slice(0, 2)}:${segFrom.slice(2)} → ${cutHHMM.slice(0, 2)}:${cutHHMM.slice(2)} · 满分 100 · ${modeLabel}`,
        `Tail segment ${segFrom.slice(0, 2)}:${segFrom.slice(2)} → ${cutHHMM.slice(0, 2)}:${cutHHMM.slice(2)} · max 100 · ${modeLabel}`)}</div>
    </div>
    <button id="langBtn" type="button">EN</button>
  </div>

  <div class="meta-bar">
    <div><span class="label">${b('交易日：', 'Trade date:')}</span><span class="value">${tradeDate}</span></div>
    <div><span class="label">${b('口径：', 'Cut:')}</span><span class="value">${cutHHMM.slice(0, 2)}:${cutHHMM.slice(2)}</span></div>
    <div><span class="label">${b('快照：', 'Snapshot:')}</span><span class="value">${stats.snapshotCount}</span></div>
    <div><span class="label">${b('初筛通过：', 'Pre-filter pass:')}</span><span class="value">${stats.prePassCount}</span></div>
    <div><span class="label">${b('候选：', 'Candidates:')}</span><span class="value up">${stats.candidateCount}</span></div>
    <div><span class="label">${b('行业组：', 'Groups:')}</span><span class="value">${stats.groupCount}</span></div>
  </div>

  <div class="callout">
    <h3>${b('核心结论（先行）', 'Key Conclusions (Up Front)')}</h3>
    <ul>${conclusion.map((c) => `<li>${c}</li>`).join('')}</ul>
  </div>

  <h2>${b(`TOP ${top.length} 候选（含六项分项得分）`, `Top ${top.length} Candidates (with score breakdown)`)}</h2>
  ${top.length ? `<div class="table-wrap"><table><thead>${topHead}</thead><tbody>${topRows}</tbody></table></div>`
    : `<div class="card">${b('本时段无满足全部门槛的候选。', 'No candidate passed all gates in this window.')}</div>`}

  <h2>${b('分行业明细', 'By Industry')}</h2>
  ${groupCards || `<div class="card">${b('无分组数据。', 'No group data.')}</div>`}

  <h2>${b('淘汰漏斗', 'Rejection Funnel')}</h2>
  <div class="card">
    <h3>${b('初筛阶段（快照字段即可判定）', 'Pre-filter (snapshot fields only)')}</h3>
    <div class="table-wrap"><table><thead><tr><th>${b('原因', 'Reason')}</th><th>${b('数量', 'Count')}</th></tr></thead>
      <tbody>${funnelRows || `<tr><td colspan="2">${b('无', 'none')}</td></tr>`}</tbody></table></div>
    <h3 style="margin-top:14px">${b('尾盘段校验阶段（需分时数据）', 'Tail-segment checks (needs minute data)')}</h3>
    <div class="table-wrap"><table><thead><tr><th>${b('原因', 'Reason')}</th><th>${b('数量', 'Count')}</th></tr></thead>
      <tbody>${tailRows || `<tr><td colspan="2">${b('无', 'none')}</td></tr>`}</tbody></table></div>
    ${cfg.report.showDataGap && gapRows ? `<details><summary>${b('数据缺口明细（最多 40 条）', 'Data-gap details (up to 40)')}</summary>
      <div class="table-wrap"><table><thead><tr><th>Code</th><th>${b('名称', 'Name')}</th><th>${b('原因', 'Reason')}</th></tr></thead>
      <tbody>${gapRows}</tbody></table></div></details>` : ''}
  </div>

  <h2>${b('数据口径与偏差声明', 'Data Provenance and Deviations')}</h2>
  <div class="card"><p class="body-text">${provenance}</p></div>

  <div class="disclaimer">${b('本报告为程序化观察输出，仅供个人研究参考，不构成任何投资建议。尾盘候选按 14:50 快照口径筛选，实际 14:50—15:00 之间价格仍会波动，需自行确认可成交性与流动性。',
    'This report is programmatic observation output for personal research only and is not investment advice. Tail candidates are screened on the 14:50 snapshot; prices still move between 14:50 and 15:00 — verify tradability and liquidity yourself.')}</div>
  <div class="footer">candidate-pool · eod tail screener v${cfg.version} · ${mode === 'observe' ? b('观察模式', 'observe mode') : b('固定口径', 'fixed cut')} ${cutHHMM}</div>
</div>
<script>
(function () {
  var lang = 'zh';
  var btn = document.getElementById('langBtn');
  var nodes = document.querySelectorAll('[data-zh]');
  nodes.forEach(function (el) {
    if (!el.getAttribute('data-zh')) { el.setAttribute('data-zh', el.innerHTML); }
  });
  function apply(target) {
    nodes.forEach(function (el) {
      var val = el.getAttribute('data-' + target);
      if (val !== null && val !== '') { el.innerHTML = val; }
    });
    document.documentElement.lang = (target === 'zh') ? 'zh-CN' : 'en';
    document.title = (target === 'zh') ? '${title}' : '${titleEn}';
    btn.textContent = (target === 'zh') ? 'EN' : '中文';
  }
  btn.addEventListener('click', function () { lang = (lang === 'zh') ? 'en' : 'zh'; apply(lang); });
  apply(lang);
})();
</script>
</body>
</html>`;
}

module.exports = { buildHTML };
