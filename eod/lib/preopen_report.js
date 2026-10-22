'use strict';
/*
 * eod/lib/preopen_report.js —— 盘前选股 HTML 报告（自包含，内联 CSS）
 * ---------------------------------------------------------------------------
 * 结构：表头(交易日/范围/统计/时段) + 分组候选表 + 数据缺口(折叠) + 溯源说明。
 * 列：排名 / 代码 / 名称 / 板块 / 竞价涨幅 / 昨日涨幅 / 趋势 / P1 / P2 / P3 / 总分 / 标签。
 */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function pct(v) { return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }
function trendStr(t) {
  if (!t) return '—';
  const parts = [];
  parts.push(t.maBull ? '多头✓' : '多头✗');
  if (t.newHigh20) parts.push('20新✓');
  if (t.newHigh60) parts.push('60新✓');
  parts.push(`斜率${(t.slope20 ?? 0).toFixed(1)}%/d`);
  return parts.join(' ');
}

function buildHTML({ cfg, tradeDate, scope, result, marketDate, runner }) {
  const s = result.stats;
  const top = result.top.slice(0, cfg.report.maxRows);
  const rows = result.candidates.slice(0, cfg.report.maxRows).map((c, i) => {
    const cls = c.risk ? 'row risk' : (c.label.startsWith('超预期') || c.label === '竞价涨停' ? 'row hot' : 'row');
    return `<tr class="${cls}">
      <td>${i + 1}</td>
      <td class="code">${esc(c.code.replace(/^[a-z]+/, ''))}</td>
      <td>${esc(c.name)}</td>
      <td>${esc(c.sector)}</td>
      <td class="num ${c.auctionChgPct >= 0 ? 'up' : 'down'}">${pct(c.auctionChgPct)}</td>
      <td class="num ${c.yesterdayChgPct >= 0 ? 'up' : 'down'}">${pct(c.yesterdayChgPct)}</td>
      <td class="trend">${esc(trendStr(c.trend))}</td>
      <td class="num">${c.scoreItems.p1.toFixed(2)}</td>
      <td class="num">${c.scoreItems.p2.toFixed(2)}</td>
      <td class="num">${c.scoreItems.p3.toFixed(2)}</td>
      <td class="num total">${c.total.toFixed(1)}</td>
      <td class="label">${esc(c.label)}</td>
    </tr>`;
  }).join('');

  const groupsHtml = result.groups.map((g) => {
    const items = g.shown.map((c) => `<span class="chip ${c.risk ? 'risk' : ''}">${esc(c.name)}·${c.total.toFixed(1)}</span>`).join('');
    return `<div class="grp"><b>${esc(g.sector)}</b> <span class="muted">(${g.size})</span> ${items}</div>`;
  }).join('');

  const gaps = (result.gaps || []).slice(0, 40).map((g) => `<li>${esc(g.code.replace(/^[a-z]+/, ''))} ${esc(g.name)} — ${esc(g.reason)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>盘前选股 ${tradeDate}</title>
<style>
  :root { --bg:#0f1419; --card:#1a2129; --fg:#e6edf3; --muted:#8b98a5; --up:#ff5b5b; --down:#26a69a; --hot:#ffb74d; --line:#2a323c; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; padding:20px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:var(--muted); font-size:12px; margin-bottom:16px; }
  .stats { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px 14px; }
  .stat b { font-size:18px; color:var(--hot); }
  .stat span { display:block; color:var(--muted); font-size:11px; }
  table { width:100%; border-collapse:collapse; background:var(--card); border-radius:8px; overflow:hidden; }
  th, td { padding:7px 9px; text-align:left; border-bottom:1px solid var(--line); white-space:nowrap; }
  th { background:#222b35; color:var(--muted); font-weight:600; font-size:12px; }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .up { color:var(--up); } .down { color:var(--down); }
  .total { color:var(--hot); font-weight:700; }
  .code { color:var(--muted); }
  .label { color:var(--hot); }
  .trend { color:var(--muted); font-size:12px; }
  tr.hot { background:rgba(255,183,77,.08); }
  tr.risk { background:rgba(255,91,91,.07); }
  .groups { margin:16px 0; }
  .grp { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px 12px; margin-bottom:8px; }
  .chip { display:inline-block; background:#222b35; border-radius:6px; padding:2px 8px; margin:2px; font-size:12px; }
  .chip.risk { background:rgba(255,91,91,.18); }
  .muted { color:var(--muted); font-size:12px; }
  details { margin-top:14px; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px 12px; }
  details ul { margin:6px 0; padding-left:20px; color:var(--muted); font-size:12px; }
  .note { margin-top:16px; color:var(--muted); font-size:12px; border-top:1px solid var(--line); padding-top:10px; }
</style></head>
<body>
  <h1>盘前选股 · ${esc(cfg.report.titleEn)}</h1>
  <div class="sub">交易日 ${esc(tradeDate)} · ${scope === 'universe' ? '全市场' : '观察池'} · 行情日 ${esc(marketDate || tradeDate)} · 生成 ${new Date().toLocaleString('zh-CN')} · ${esc(runner)}</div>
  <div class="stats">
    <div class="stat"><b>${s.candidateCount}</b><span>候选</span></div>
    <div class="stat"><b>${s.groupCount}</b><span>行业</span></div>
    <div class="stat"><b>${s.snapshotCount}</b><span>快照</span></div>
    <div class="stat"><b>${s.baselineCount}</b><span>基线K线</span></div>
    <div class="stat"><b>${s.gapCount}</b><span>缺口</span></div>
  </div>
  <div class="groups">${groupsHtml || '<div class="muted">无候选</div>'}</div>
  <table>
    <thead><tr>
      <th>#</th><th>代码</th><th>名称</th><th>板块</th><th>竞价涨幅</th><th>昨日涨幅</th><th>趋势</th><th>P1</th><th>P2</th><th>P3</th><th>总分</th><th>标签</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="12" class="muted">无候选</td></tr>'}</tbody>
  </table>
  ${cfg.report.showDataGap && gaps ? `<details><summary>数据缺口（${result.gaps.length}）</summary><ul>${gaps}</ul></details>` : ''}
  <div class="note">信号说明：P1 竞价强势（高开+竞价量能）· P2 弱转强/超预期（昨日强+今日开幅）· P3 趋势（均线多头+N日新高+斜率）。
  开盘快照存档于 eod/data/preopen-${esc(tradeDate)}.json，收盘后由 preopen_backfill.js 回填当日涨跌幅/是否涨停，统计命中率，便于溯源。</div>
</body></html>`;
}

module.exports = { buildHTML };
