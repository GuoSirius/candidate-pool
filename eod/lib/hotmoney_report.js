'use strict';
/*
 * eod/lib/hotmoney_report.js —— 游资席位扫描 HTML 报告（自包含，内联 CSS）
 * ---------------------------------------------------------------------------
 * 视觉与交互对齐 eod/lib/preopen_report.js：主题切换(深浅色+localStorage)、中英双语、
 * chip 多维过滤。复用 preopen_report 的 CSS（其导出 CSS 常量，零漂移）。
 * 涨红跌绿（A 股口径）：.up=红, .down=绿。零依赖，单文件 HTML。
 *
 * 结构：
 *   topbar → meta-bar → 核心结论（席位变更感知 + 当日要点）
 *   → 当日交易明细（按游资/按票双视图 + 层级/方向/游资过滤）
 *   → 游资·近N日汇总（按层级过滤）
 *   → 近N日交易明细（游资/日期/方向过滤）
 *   → 票·近N日汇总 → 未识别席位观察名单 → 数据口径 → 免责声明
 * ---------------------------------------------------------------------------
 */
const { b, num, esc } = require('./report_fmt');
const { CSS } = require('./preopen_report');

/** 金额（元）→ 「1.2亿」「3000万」，涨红跌绿 */
function fmtAmt(v) {
  if (v == null || isNaN(v)) return { txt: '—', cls: '' };
  const a = Math.abs(v);
  const txt = (v < 0 ? '-' : '') + (a >= 1e8 ? num(a / 1e8, 2) + '亿' : num(a / 1e4, 0) + '万');
  return { txt, cls: v > 0 ? 'up' : v < 0 ? 'down' : '' };
}
/** 层级 tag 颜色类 */
function tierCls(tier) {
  if (tier === '一线') return 'pass';
  if (tier === '二线') return '';
  if (tier === '避坑') return 'gap';
  return 'src';
}
function tierTag(tier) {
  return `<span class="tag ${tierCls(tier)}">${esc(tier || '—')}</span>`;
}

/** 当日/近N日交易记录行（当日表与近N日表共用；近N日多一列日期） */
function tradeRowHtml(t, opts) {
  const buy = fmtAmt(t.buy);
  const sell = fmtAmt(t.sell);
  const net = fmtAmt(t.net);
  const dir = (t.net == null ? 0 : t.net) >= 0 ? 'in' : 'out';
  const marks = [
    t.preopen ? `<span class="tag pass">${b('盘前候选', 'Preopen')}</span>` : '',
    t.newSeat ? `<span class="tag gap" title="该席位首次出现（与历史快照比对）">${b('新席位', 'New seat')}</span>` : '',
  ].filter(Boolean).join(' ');
  return `<tr data-name="${esc(t.name)}" data-tier="${esc(t.tier || '')}" data-dir="${dir}"${opts.withDate ? ` data-date="${esc(t.date)}"` : ''} data-stock="${esc(t.code)}" data-net="${t.net || 0}">
    ${opts.withDate ? `<td class="src">${esc(t.date.slice(5))}</td>` : ''}
    <td><b>${esc(t.name)}</b> ${tierTag(t.tier)}</td>
    <td><b>${esc(t.stock)}</b><span class="src">${esc(t.code)}</span></td>
    <td class="num ${buy.cls}">${buy.txt}</td>
    <td class="num ${sell.cls}">${sell.txt}</td>
    <td class="num ${net.cls}"><b>${net.txt}</b></td>
    <td class="wrap src">${esc((t.seat || '').replace(/证券股份有限公司/, '证券'))}</td>
    <td class="wrap">${marks}</td>
  </tr>`;
}

/** 表格骨架 + 通用 chip 过滤（每组 chips 用 data-fkey 区分；行用同名 data-* 属性） */
function filterChipRow(id, capZh, capEn, chips) {
  return `<div class="toolrow"><span class="cap">${b(capZh, capEn)}</span><span class="chips" id="${id}">${chips}</span></div>`;
}
function chipHtml(fkey, value, label, count, active) {
  return `<button type="button" class="chip${active ? ' active' : ''}" data-fkey="${fkey}" data-fval="${esc(value)}">${label}${count != null ? `<i>${count}</i>` : ''}</button>`;
}

/** 主报告 */
function buildHTML({ cfg, anchor, result, runner }) {
  const { anchorDay, trades, byTrader, byStock, seatChanges, watchTop, window: win } = result;
  const anchorTrades = trades.filter((t) => t.date === anchor);

  // ---- chips 数据 ----
  const tierOrder = ['一线', '二线', '避坑'];
  const tierCount = (rows) => {
    const m = {};
    for (const t of rows) m[t.tier] = (m[t.tier] || 0) + 1;
    return m;
  };
  const nameOrder = [...new Set(anchorTrades.map((t) => t.name))];
  const nameCountA = {};
  for (const t of anchorTrades) nameCountA[t.name] = (nameCountA[t.name] || 0) + 1;
  const dateOrder = win.days.map((d) => d.date);
  const dateCount = {};
  for (const t of trades) dateCount[t.date] = (dateCount[t.date] || 0) + 1;
  const nameCountW = {};
  for (const t of trades) nameCountW[t.name] = (nameCountW[t.name] || 0) + 1;

  const tierChips = (rows) => {
    const m = tierCount(rows);
    return chipHtml('tier', '', b('全部', 'All'), rows.length, true)
      + tierOrder.filter((t) => m[t]).map((t) => chipHtml('tier', t, b(esc(t), esc(t)), m[t])).join('');
  };
  const dirChips = () => chipHtml('dir', '', b('全部方向', 'All'), null, true)
    + chipHtml('dir', 'in', b('净买入', 'Net buy'))
    + chipHtml('dir', 'out', b('净卖出', 'Net sell'));
  const nameChips = (rows, counts) => chipHtml('name', '', b('全部游资', 'All'), rows.length, true)
    + nameOrder.map((n) => chipHtml('name', n, b(esc(n), esc(n)), counts[n])).join('');
  const dateChips = () => chipHtml('date', '', b('全部日期', 'All'), trades.length, true)
    + dateOrder.map((d) => chipHtml('date', d, esc(d.slice(5)), dateCount[d])).join('');

  // ---- 核心结论 ----
  const changeNames = [...new Set(seatChanges.map((c) => `${c.name}（${c.tier}）`))];
  const topTraders = byTrader.slice(0, 3);
  const conclusion = [
    seatChanges.length
      ? b(`⚠ 席位变更感知：${esc(changeNames.join('、'))} 出现历史未见席位（行内标「新席位」，注意换马甲/改营业部）。`,
        `⚠ Seat changes: ${esc(changeNames.join(', '))} showed seats never seen before (marked "New seat").`)
      : b('席位快照比对：当日无新席位，名单内游资席位无变动。', 'Seat snapshot: no new seats, no registry changes detected.'),
    topTraders.length
      ? b(`当日游资净额前三：${esc(topTraders.map((t) => `${t.name}（${t.tier}）净 ${t.net >= 0 ? '+' : ''}${(t.net / 1e4 / 10000).toFixed(1)}万`).join('、'))}。`,
        `Top 3 by net: ${esc(topTraders.map((t) => `${t.name} (${t.tier}) net ${fmtAmt(t.net).txt}`).join(', '))}.`)
      : b('当日榜单未匹配到任何知名游资席位。', 'No known hot-money seat matched on this board.'),
    watchTop.length
      ? b(`观察名单：${watchTop.length} 个未识别席位出现 ≥${cfg.watch.minDays} 天（见文末表），高频者建议晋升进 registry。`,
        `Watchlist: ${watchTop.length} unmatched seats appeared ≥${cfg.watch.minDays} days (see table below).`)
      : b('观察名单：暂无连续多日出现的高频未识别席位。', 'Watchlist: no recurring unmatched seats yet.'),
  ];

  // ---- 当日明细行（双视图共用同一批行；按游资/按票由 JS 重排） ----
  const dayRows = anchorTrades
    .map((t) => tradeRowHtml(t, { withDate: false }))
    .join('');
  const winRows = trades
    .map((t) => tradeRowHtml(t, { withDate: true }))
    .join('');

  const provenance = b(
    `数据来自东方财富 datacenter 龙虎榜接口（RPT_DAILYBILLBOARD_DETAILSNEW / RPT_BILLBOARD_DAILYDETAILSBUY）：全榜名单 1 次请求/日，席位明细逐票抓取（买卖金额为该席位当日龙虎榜口径，非全日成交）。游资归属靠席位名正则匹配（唯一真相源 eod/hotmoney.config.js registry，可经 eod/data/hotmoney-registry.json 动态增删），公开常见整理仅供参考，游资会换马甲。席位变更感知 = 锚定日席位与本地快照（hotmoney-seats-snapshot.json）比对；未识别席位观察名单 = hotmoney-watchlist.json 按天累计。近 N 日明细来自本地日档缓存（缺档自动回补抓取）。锚定日 ${esc(anchor)}；17:30 前运行自动回退上一交易日。运行环境：${esc(runner)}。`,
    `Data: Eastmoney datacenter billboard APIs (board list once per day; per-stock seat details). Seat-to-trader mapping via regex registry (eod/hotmoney.config.js; dynamic overrides in eod/data/hotmoney-registry.json). Change detection compares anchor-day seats against the local snapshot. N-day details aggregate cached daily archives. Anchor: ${esc(anchor)}; before 17:30 it rolls back to the previous trading day. Runner: ${esc(runner)}.`);

  const disclaimer = b(
    '本报告为程序化观察输出，仅供个人研究参考，不构成投资建议。龙虎榜席位归属为公开整理、可能滞后或错标；游资买入不代表股价必然上涨；避坑层标注仅为风险提示。请自行核实与决策。',
    'Programmatic observation output for personal research only, not investment advice. Seat-to-trader attribution is crowd-sourced and may be stale or wrong; hot-money buying does not guarantee gains. Verify on your own.');

  const title = `${cfg.report.title} — ${anchor}`;
  const titleEn = `${cfg.report.titleEn} — ${anchor}`;
  const dayCount = win.days.length;

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
      <h1>${b(cfg.report.title, cfg.report.titleEn)} · ${anchor}</h1>
      <div class="sub">${b(`榜单已出齐口径（${cfg.session.boardReadyFrom} 后）· 窗口 ${dayCount} 个交易日 · 金额单位：龙虎榜席位买卖额`, `Board-ready basis (after ${cfg.session.boardReadyFrom}) · window ${dayCount} trading days · amounts = seat billboard turnover`)}</div>
    </div>
    <div class="btns">
      <button id="themeBtn" type="button" class="topbtn" title="切换深浅色">☀</button>
      <button id="langBtn" type="button" class="topbtn">EN</button>
    </div>
  </div>

  <div class="meta-bar">
    <div><span class="label">${b('锚定日：', 'Anchor:')}</span><span class="value">${anchor}</span></div>
    <div><span class="label">${b('榜单：', 'Board:')}</span><span class="value">${anchorDay.stockCount}</span></div>
    <div><span class="label">${b('游资命中：', 'Hit stocks:')}</span><span class="value up">${anchorDay.records.length}</span></div>
    <div><span class="label">${b('当日记录：', 'Day trades:')}</span><span class="value">${anchorTrades.length}</span></div>
    <div><span class="label">${b('窗口：', 'Window:')}</span><span class="value">${dayCount}${b('天', 'd')}</span></div>
    <div><span class="label">${b('席位变更：', 'Seat changes:')}</span><span class="value ${seatChanges.length ? 'down' : ''}">${seatChanges.length}</span></div>
    <div><span class="label">${b('观察席位：', 'Watch seats:')}</span><span class="value">${watchTop.length}</span></div>
  </div>

  <div class="callout">
    <h3>${b('核心结论（先行）', 'Key Conclusions (Up Front)')}</h3>
    <ul>${conclusion.map((c) => `<li>${c}</li>`).join('')}</ul>
  </div>

  <h2>${b(`当日交易明细（${anchorTrades.length} 条）`, `Anchor-Day Trades (${anchorTrades.length})`)}</h2>
  <p class="src">${b('同一批「游资×票」记录的两种排法：按游资 = 同一个人的买卖聚在一起（组间按其当日净额降序）；按票 = 同一只票上的游资聚在一起（组间按该票游资净额合计降序）。两视图数据完全相同，只是分组维度不同。',
    'The same trader×stock records in two groupings: by trader (one person\'s trades together) or by stock (all traders on one stock together); data identical, grouping differs.')}</p>
  ${anchorTrades.length ? `<div class="toolbar">
    <div class="seg" role="tablist">
      <button type="button" id="viewTrader" class="segbtn active">${b('按游资', 'By trader')}</button>
      <button type="button" id="viewStock" class="segbtn">${b('按票', 'By stock')}</button>
    </div>
    ${filterChipRow('fTier', '层级', 'Tier', tierChips(anchorTrades))}
    ${filterChipRow('fDir', '方向', 'Side', dirChips())}
    ${filterChipRow('fName', '游资', 'Trader', nameChips(anchorTrades, nameCountA))}
  </div>
  <div class="table-wrap"><table id="dayTable"><thead><tr>
    <th>${b('游资', 'Trader')}</th><th>${b('标的', 'Stock')}</th>
    <th>${b('买入', 'Buy')}</th><th>${b('卖出', 'Sell')}</th><th>${b('净额', 'Net')}</th>
    <th>${b('席位', 'Seat')}</th><th>${b('标记', 'Marks')}</th>
  </tr></thead><tbody id="dayBody">${dayRows}</tbody></table></div>`
    : `<div class="card">${b('当日榜单未匹配到知名游资席位。', 'No known hot-money seat matched on the anchor-day board.')}</div>`}

  <h2>${b(`游资 · 近${dayCount}日汇总（${byTrader.length} 人）`, `Traders · ${dayCount}-Day Summary (${byTrader.length})`)}</h2>
  <p class="src">${b(`依据 = 窗口内（近 ${dayCount} 个交易日日档）的全部游资记录按人聚合：净额 = 买入合计 − 卖出合计；活跃天数 = 出现过的交易日数；涉票数 = 去重标的数。列表按净额降序。逐日买卖去「近${dayCount}日交易明细」表用游资 chip 圈定。`,
    'Aggregated per trader over the window: net = total buy − total sell; days = distinct trading days seen; stocks = distinct names. Sorted by net. Per-day detail: use the trader chip in the window-trades table.')}</p>
  ${byTrader.length ? `${filterChipRow('fTier2', '层级', 'Tier', tierChips(byTrader))}
  <div class="table-wrap"><table><thead><tr>
    <th>${b('游资', 'Trader')}</th><th>${b('层级', 'Tier')}</th>
    <th>${b('净额', 'Net')}</th><th>${b('买入', 'Buy')}</th><th>${b('卖出', 'Sell')}</th>
    <th>${b('活跃天数', 'Days')}</th><th>${b('涉票数', 'Stocks')}</th>
  </tr></thead><tbody id="traderBody">${byTrader.map((t) => {
    const net = fmtAmt(t.net); const buy = fmtAmt(t.buy); const sell = fmtAmt(t.sell);
    return `<tr data-tier="${esc(t.tier || '')}" data-name="${esc(t.name)}">
    <td><b>${esc(t.name)}</b></td><td>${tierTag(t.tier)}</td>
    <td class="num ${net.cls}"><b>${net.txt}</b></td>
    <td class="num ${buy.cls}">${buy.txt}</td>
    <td class="num ${sell.cls}">${sell.txt}</td>
    <td class="num">${t.dayCount}</td><td class="num">${t.stockCount}</td>
  </tr>`; }).join('')}</tbody></table></div>`
    : `<div class="card">${b('窗口内无游资记录。', 'No trader records in the window.')}</div>`}

  <h2>${b(`近${dayCount}日交易明细（${trades.length} 条）`, `Window Trades (${trades.length})`)}</h2>
  <p class="src">${b(`窗口内（近 ${dayCount} 个交易日）的每一条游资买卖记录，结构与当日表相同、多一列日期；用 chips 圈定某游资 / 某天 / 某方向。当日表的数据就是本表中日期 = 锚定日的子集。`,
    'Every trader trade in the window (same layout as the day table plus a date column); use chips to isolate a trader / date / side.')}</p>
  ${trades.length ? `<div class="toolbar">
    ${filterChipRow('fName3', '游资', 'Trader', nameChips(trades, nameCountW))}
    ${filterChipRow('fDate', '日期', 'Date', dateChips())}
    ${filterChipRow('fDir3', '方向', 'Side', dirChips())}
    ${filterChipRow('fTier3', '层级', 'Tier', tierChips(trades))}
  </div>
  <div class="table-wrap"><table><thead><tr>
    <th>${b('日期', 'Date')}</th><th>${b('游资', 'Trader')}</th><th>${b('标的', 'Stock')}</th>
    <th>${b('买入', 'Buy')}</th><th>${b('卖出', 'Sell')}</th><th>${b('净额', 'Net')}</th>
    <th>${b('席位', 'Seat')}</th><th>${b('标记', 'Marks')}</th>
  </tr></thead><tbody id="winBody">${winRows}</tbody></table></div>`
    : `<div class="card">${b('窗口内无游资记录。', 'No records in the window.')}</div>`}

  <h2>${b(`票 · 近${dayCount}日游资汇总（${byStock.length} 只）`, `Stocks · ${dayCount}-Day Summary (${byStock.length})`)}</h2>
  <p class="src">${b('把窗口内记录按「票」聚合：这只票近 N 天被哪些游资做过、各自买/卖多少（游资按其在该票上的净额排序）。用于回答「这只票是谁在玩、是不是同一个游资反复做」。',
    'Aggregated per stock over the window: which traders played it and how much each bought/sold (sorted by per-stock net). Answers "who is behind this name, and is anyone repeating it".')}</p>
  ${byStock.length ? `<div class="table-wrap"><table><thead><tr>
    <th>${b('标的', 'Stock')}</th>
    <th>${b('净额', 'Net')}</th><th>${b('买入', 'Buy')}</th><th>${b('卖出', 'Sell')}</th>
    <th>${b('活跃天数', 'Days')}</th><th>${b('游资数', 'Traders')}</th><th>${b('游资（按净额）', 'Traders by net')}</th>
  </tr></thead><tbody>${byStock.map((s) => {
    const net = fmtAmt(s.net); const buy = fmtAmt(s.buy); const sell = fmtAmt(s.sell);
    const tradersTxt = s.traders.map((t) => `${esc(t.name)}${t.net >= 0 ? '' : '(卖)'}`).join(' / ');
    return `<tr>
    <td><b>${esc(s.stock)}</b><span class="src">${esc(s.code)}</span></td>
    <td class="num ${net.cls}"><b>${net.txt}</b></td>
    <td class="num ${buy.cls}">${buy.txt}</td>
    <td class="num ${sell.cls}">${sell.txt}</td>
    <td class="num">${s.dayCount}</td><td class="num">${s.traders.length}</td>
    <td class="wrap src">${tradersTxt}</td>
  </tr>`; }).join('')}</tbody></table></div>`
    : `<div class="card">${b('窗口内无游资涉票。', 'No stocks touched in the window.')}</div>`}

  <h2>${b(`未识别席位观察名单（≥${cfg.watch.minDays} 天，Top ${watchTop.length}）`, `Unmatched Seat Watchlist (≥${cfg.watch.minDays} days, top ${watchTop.length})`)}</h2>
  ${watchTop.length ? `<div class="table-wrap"><table><thead><tr>
    <th>${b('席位', 'Seat')}</th><th>${b('出现天数', 'Days')}</th><th>${b('累计买入', 'Buy')}</th><th>${b('累计卖出', 'Sell')}</th>
  </tr></thead><tbody>${watchTop.map((w) => {
    const buy = fmtAmt(w.buy); const sell = fmtAmt(w.sell);
    return `<tr><td class="wrap src">${esc(w.seat)}</td><td class="num">${w.dayCount}</td>
    <td class="num ${buy.cls}">${buy.txt}</td><td class="num ${sell.cls}">${sell.txt}</td></tr>`;
  }).join('')}</tbody></table></div>
  <p class="src">${b(`高频新席位建议晋升：在 eod/data/hotmoney-registry.json 增加 { "name": "…", "seat": "正则", "tier": "一线/二线", "action": "add" }，下次运行即生效（不改代码）。`,
    `To promote a seat: add { name, seat(regex), tier, action:"add" } to eod/data/hotmoney-registry.json; takes effect next run.`)}</p>`
    : `<div class="card">${b(`暂无出现 ≥${cfg.watch.minDays} 天的未识别席位。`, `No unmatched seat recurring ≥${cfg.watch.minDays} days yet.`)}</div>`}

  <div class="callout">
    <h3>${b('数据口径与偏差', 'Provenance & Caveats')}</h3>
    <p>${provenance}</p>
  </div>
  <div class="callout"><p>${disclaimer}</p></div>
</div>

<script>
(function () {
  'use strict';
  // ---- 主题 ----
  var root = document.documentElement;
  var themeBtn = document.getElementById('themeBtn');
  function syncThemeLabel() { themeBtn.textContent = (root.getAttribute('data-theme') === 'dark') ? '☀' : '🌙'; }
  try { var saved = localStorage.getItem('report-theme'); if (saved) root.setAttribute('data-theme', saved); } catch (e) {}
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

  // ---- 通用：chip 组绑定（单选；fval 为该组当前值） ----
  function bindChips(id, onPick) {
    var wrap = document.getElementById(id);
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      Array.prototype.forEach.call(wrap.querySelectorAll('.chip'), function (c) { c.classList.toggle('active', c === chip); });
      onPick(chip.getAttribute('data-fval') || '');
    });
  }

  // ---- 当日明细：三组 chip（层级/方向/游资）AND 过滤 + 按游资/按票双视图重排 ----
  var dayBody = document.getElementById('dayBody');
  if (dayBody) {
    var dayRows = Array.prototype.slice.call(dayBody.querySelectorAll('tr'));
    var dayT = '', dayD = '', dayN = '', dayView = 'trader';
    function dayWant(tr) {
      if (dayT && tr.getAttribute('data-tier') !== dayT) return false;
      if (dayD && tr.getAttribute('data-dir') !== dayD) return false;
      if (dayN && tr.getAttribute('data-name') !== dayN) return false;
      return true;
    }
    // 组净值（供排序）：按 data-net 原始值（元）对 游资/票 两个维度分别合计
    var groupNet = { trader: {}, stock: {} };
    dayRows.forEach(function (tr) {
      var v = parseFloat(tr.getAttribute('data-net')) || 0;
      var kn = tr.getAttribute('data-name'), ks = tr.getAttribute('data-stock');
      groupNet.trader[kn] = (groupNet.trader[kn] || 0) + v;
      groupNet.stock[ks] = (groupNet.stock[ks] || 0) + v;
    });
    function renderDay() {
      var frag = document.createDocumentFragment();
      var key = dayView === 'trader' ? 'data-name' : 'data-stock';
      var visible = dayRows.filter(dayWant);
      visible.sort(function (a, b2) {
        var g = groupNet[dayView];
        var ka = a.getAttribute(key), kb = b2.getAttribute(key);
        if (g[kb] !== g[ka]) return g[kb] - g[ka];
        return (parseFloat(b2.getAttribute('data-net')) || 0) - (parseFloat(a.getAttribute('data-net')) || 0);
      });
      visible.forEach(function (tr) { frag.appendChild(tr); });
      while (dayBody.firstChild) dayBody.removeChild(dayBody.firstChild);
      dayBody.appendChild(frag);
    }
    bindChips('fTier', function (v) { dayT = v; renderDay(); });
    bindChips('fDir', function (v) { dayD = v; renderDay(); });
    bindChips('fName', function (v) { dayN = v; renderDay(); });
    var vT = document.getElementById('viewTrader'), vS = document.getElementById('viewStock');
    function setView(v) {
      dayView = v;
      vT.classList.toggle('active', v === 'trader');
      vS.classList.toggle('active', v === 'stock');
      renderDay();
    }
    vT.addEventListener('click', function () { setView('trader'); });
    vS.addEventListener('click', function () { setView('stock'); });
    renderDay();
  }

  // ---- 游资汇总表：层级过滤 ----
  var traderBody = document.getElementById('traderBody');
  if (traderBody) {
    var traderRows = Array.prototype.slice.call(traderBody.querySelectorAll('tr'));
    bindChips('fTier2', function (v) {
      traderRows.forEach(function (tr) { tr.hidden = !!(v && tr.getAttribute('data-tier') !== v); });
    });
  }

  // ---- 近N日明细：游资/日期/方向/层级 四组 AND 过滤 ----
  var winBody = document.getElementById('winBody');
  if (winBody) {
    var winRows = Array.prototype.slice.call(winBody.querySelectorAll('tr'));
    var wN = '', wD = '', wDir = '', wT = '';
    function winWant(tr) {
      if (wN && tr.getAttribute('data-name') !== wN) return false;
      if (wD && tr.getAttribute('data-date') !== wD) return false;
      if (wDir && tr.getAttribute('data-dir') !== wDir) return false;
      if (wT && tr.getAttribute('data-tier') !== wT) return false;
      return true;
    }
    function renderWin() { winRows.forEach(function (tr) { tr.hidden = !winWant(tr); }); }
    bindChips('fName3', function (v) { wN = v; renderWin(); });
    bindChips('fDate', function (v) { wD = v; renderWin(); });
    bindChips('fDir3', function (v) { wDir = v; renderWin(); });
    bindChips('fTier3', function (v) { wT = v; renderWin(); });
    renderWin();
  }
})();
</script>
</body>
</html>`;
}

module.exports = { buildHTML };
