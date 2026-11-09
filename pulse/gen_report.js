'use strict';
/*
 * pulse/gen_report.js —— 生成单文件 HTML 报告（零外部资源，风格对齐现有报告）
 */
const cfg = require('./config');
// mini K 线：与 eod/ 各报告共用同一套内联 SVG 与日档缓存；个股热度榜的 code 常为空，缺码自动降级
const { KLINE_CSS, sparkCell, sparkOf, loadSparkIndex } = require('../eod/lib/kline_spark');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtBJ = (ms) => { if (!ms) return ''; const d = new Date(ms + 8 * 3600e3); return d.toISOString().slice(5, 16).replace('T', ' '); };
const VERIFY_BADGE = { A: 'badge-a', B: 'badge-b', C: 'badge-c', '-': 'badge-d' };

function buildReport(snapshot, analysis) {
  const { hotBoards, hotStocks } = analysis;
  const sparkIdx = loadSparkIndex(String(snapshot.runAtText || '').slice(0, 10));
  const top3 = hotBoards.filter((b) => b.verify === 'A' || b.verify === 'B').slice(0, 3);
  const summary = top3.length
    ? `过去 ${analysis.lookbackHours} 小时共采集 ${analysis.windowCount} 条消息。多源交叉验证热点：` +
      top3.map((b) => `${b.name}（${b.verify} 级验证 · ${b.sourceCount} 源${b.flow != null ? ` · 主力净流入 ${b.flow} 亿` : ''}${b.pct != null ? ` · 涨 ${b.pct}%` : ''}）`).join('；') +
      '。'
    : `过去 ${analysis.lookbackHours} 小时共采集 ${analysis.windowCount} 条消息，暂无 ≥2 源交叉验证的热点板块。`;

  const srcChips = Object.entries(snapshot.sourcesStatus)
    .map(([k, v]) => `<span class="chip ${v.startsWith('OK') ? 'ok' : 'bad'}">${esc(k)} · ${esc(v)}</span>`).join('');

  const leadCell = (b) => {
    if (b.leaders && b.leaders.length) {
      return b.leaders.map((l) => `<span class="lead-item">${esc(l.name)}<span class="${(l.pct || 0) >= 0 ? 'up' : 'down'}">${l.pct != null ? l.pct + '%' : ''}</span></span>`).join('');
    }
    return esc(b.lead || '-');
  };
  // 排序键：data-v 为数值（null 落底），无 data-v 时按文本
  const vAttr = (val, nullVal = -999) => ` data-v="${val == null ? nullVal : val}"`;
  const verifyRank = { A: 3, B: 2, C: 1 };
  const boardRows = hotBoards.map((b, i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="strong">${esc(b.name)}</td>
      <td${vAttr(b.score, 0)}>${b.score}</td>
      <td${vAttr(verifyRank[b.verify] || 0)}><span class="badge ${VERIFY_BADGE[b.verify] || 'badge-d'}">${b.verify}${b.sourceCount ? ` · ${b.sourceCount}源` : ''}</span></td>
      <td${vAttr(b.pct)}>${b.pct != null ? b.pct + '%' : '-'}</td>
      <td${vAttr(b.flow)}>${b.flow != null ? b.flow + ' 亿' : '-'}</td>
      <td>${leadCell(b)}</td>
    </tr>`).join('');

  const evidence = hotBoards.filter((b) => b.items.length).slice(0, 8).map((b) => `
    <div class="card">
      <div class="card-head"><span class="strong">${esc(b.name)}</span>
        <span class="badge ${VERIFY_BADGE[b.verify]}">${b.verify} 级验证 · ${b.sourceCount} 源</span>
        ${b.pct != null ? `<span class="muted">涨 ${b.pct}%</span>` : ''}
        ${b.flow != null ? `<span class="muted">主力 ${b.flow} 亿</span>` : ''}</div>
      ${b.leaders && b.leaders.length ? `<div class="news"><span class="tag">领涨股</span>${b.leaders.map((l) => `${esc(l.name)}<span class="${(l.pct || 0) >= 0 ? 'up' : 'down'}">${l.pct != null ? l.pct + '%' : ''}</span>`).join(' · ')}</div>` : ''}
      ${b.items.map((n) => `<div class="news"><span class="time">${fmtBJ(n.timeMs)}</span><span class="tag">${esc(cfg.SOURCE_LABELS[n.source] || n.source)}</span>${esc(n.text).slice(0, 160)}</div>`).join('')}
    </div>`).join('');

  const stockRows = hotStocks.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="strong">${esc(s.name)}</td>
      <td>${esc(s.code || '-')}</td>
      ${sparkCell(sparkOf(s.code, sparkIdx), { width: 96, height: 26 })}
      <td>${esc(s.sector || '-')}</td>
      <td${vAttr(s.score, 0)}>${s.score}</td>
      <td>${s.isLead ? '<span class="badge badge-b">热点板块领涨</span>' : ''} ${s.sources.map(esc).join(' / ') || '-'}</td>
    </tr>`).join('');

  const annRows = snapshot.announces.map((a) => `
    <tr>
      <td>${fmtBJ(a.timeMs)}</td>
      <td>${esc(a.code || '-')}</td>
      <td class="strong">${esc(a.name)}</td>
      <td><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a></td>
    </tr>`).join('');

  const newsRows = snapshot.news.map((n) => `
    <tr>
      <td>${fmtBJ(n.timeMs)}</td>
      <td><span class="tag">${esc(n.source)}</span></td>
      <td>${esc(n.text).slice(0, 200)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>消息脉搏 · ${esc(snapshot.runAtText)}</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#262b36; --text:#d7dce6; --muted:#8a93a6; --accent:#4f8cff; --red:#e05252; --green:#2ea36b; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif; }
  .wrap { max-width:1080px; margin:0 auto; padding:24px 16px 60px; }
  h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:17px; margin:32px 0 12px; border-left:3px solid var(--accent); padding-left:10px; }
  .sub { color:var(--muted); margin-bottom:14px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
  .chip { font-size:12px; padding:2px 10px; border-radius:10px; border:1px solid var(--line); }
  .chip.ok { color:#7bd7a2; } .chip.bad { color:#ff9c9c; border-color:#5a3038; }
  .summary { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin:14px 0; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border-radius:10px; overflow:hidden; }
  th,td { padding:8px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
  th { color:var(--muted); font-weight:600; background:#1b1f29; }
  tr:last-child td { border-bottom:none; }
  .strong { font-weight:600; } .muted { color:var(--muted); }
  .badge { font-size:12px; padding:1px 8px; border-radius:9px; border:1px solid var(--line); }
  .badge-a { color:#ffd479; border-color:#6b5a2c; } .badge-b { color:#7bd7a2; border-color:#2e5a44; }
  .badge-c { color:#9db4d8; } .badge-d { color:var(--muted); }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:12px; }
  .card-head { display:flex; gap:12px; align-items:center; margin-bottom:8px; flex-wrap:wrap; }
  .news { padding:4px 0; border-top:1px dashed var(--line); font-size:13px; }
  .news .time { color:var(--muted); margin-right:8px; } .news .tag { display:inline-block; min-width:64px; color:var(--accent); margin-right:8px; font-size:12px; }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
  .up { color:var(--red); } .down { color:var(--green); }
  .lead-item { display:inline-block; margin-right:10px; white-space:nowrap; }
  ${KLINE_CSS}
  table.sortable th[data-s] { cursor:pointer; user-select:none; white-space:nowrap; }
  table.sortable th[data-s].asc::after { content:' ▲'; color:var(--accent); }
  table.sortable th[data-s].desc::after { content:' ▼'; color:var(--accent); }
</style></head><body><div class="wrap">
  <h1>消息脉搏 · 行业热点与异动交叉分析</h1>
  <div class="sub">执行时间：${esc(snapshot.runAtText)}（北京时间） · 回看窗口 ${analysis.lookbackHours} 小时 · 采集 ${analysis.windowCount} 条消息 · ${snapshot.boards.length} 个板块 · ${snapshot.announces.length} 条公告</div>
  <div class="chips">${srcChips}</div>
  <div class="summary">${esc(summary)}</div>

  <h2>一、热点板块榜（消息 + 资金流 + 涨幅综合评分）</h2>
  <table class="sortable"><thead><tr><th>#</th><th>板块</th><th>热度分 ⇅</th><th>验证级别 ⇅</th><th>涨跌幅 ⇅</th><th>主力净流入 ⇅</th><th>领涨股</th></tr></thead><tbody>${boardRows || '<tr><td colspan="7">暂无</td></tr>'}</tbody></table>

  <h2>二、热点证据链（多源消息交叉比对）</h2>
  ${evidence || '<div class="muted">暂无消息命中的板块</div>'}

  <h2>三、个股热度榜（新闻命中 + 热点板块领涨股）</h2>
  <table class="sortable"><thead><tr><th>#</th><th>股票</th><th>代码</th><th>mini K线</th><th>行业</th><th>热度分 ⇅</th><th>依据</th></tr></thead><tbody>${stockRows || '<tr><td colspan="7">暂无</td></tr>'}</tbody></table>

  <h2>四、事件类公告（巨潮资讯 · 关键词过滤）</h2>
  <table><thead><tr><th>时间</th><th>代码</th><th>公司</th><th>公告</th></tr></thead><tbody>${annRows || '<tr><td colspan="4">暂无</td></tr>'}</tbody></table>

  <h2>五、全部消息流（按时间倒序）</h2>
  <table><thead><tr><th>时间</th><th>来源</th><th>内容</th></tr></thead><tbody>${newsRows || '<tr><td colspan="3">暂无</td></tr>'}</tbody></table>
</div>
<script>
// 表头点击排序：优先取 td[data-v]（数值，null 落底），否则按文本；再次点击切换升降序
document.querySelectorAll('table.sortable').forEach(function (table) {
  var ths = table.querySelectorAll('thead th');
  ths.forEach(function (th, i) {
    if (!th.textContent.includes('⇅')) return; // 仅 ⇅ 标记的列可排序
    th.setAttribute('data-s', '1');
    th.addEventListener('click', function () {
      var tbody = table.querySelector('tbody');
      var rows = Array.prototype.slice.call(tbody.rows);
      var dir = th.classList.contains('desc') ? 'asc' : 'desc';
      ths.forEach(function (h) { h.classList.remove('asc', 'desc'); });
      th.classList.add(dir);
      rows.sort(function (a, b) {
        var x = a.cells[i], y = b.cells[i];
        var vx = x.hasAttribute('data-v') ? parseFloat(x.getAttribute('data-v')) : NaN;
        var vy = y.hasAttribute('data-v') ? parseFloat(y.getAttribute('data-v')) : NaN;
        var cmp;
        if (!isNaN(vx) && !isNaN(vy)) cmp = vx - vy;
        else cmp = x.textContent.trim().localeCompare(y.textContent.trim(), 'zh');
        return dir === 'desc' ? -cmp : cmp;
      });
      rows.forEach(function (r) { tbody.appendChild(r); });
    });
  });
});
</script>
</body></html>`;
}

module.exports = { buildReport };
