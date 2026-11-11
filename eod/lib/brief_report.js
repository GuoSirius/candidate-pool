'use strict';
/*
 * 内部简报 HTML 骨架（胜率周报 / 观察池回流 diff 共用）
 * ---------------------------------------------------------------------------
 * 2026-11-11：这两份原为 Markdown，因「只在终端/编辑器里读、不推送不入库」而用纯文本。
 * 现在历史报告统一走 Cloudflare Pages 归档 + iframe 查看，故改为单文件 HTML：
 * 内联 CSS、零外链、深色主题与其它报告一致，手机可看，能被前端下拉框枚举。
 *
 * 为什么收成共享模块：两份报告各有 CSS / 转义 / 表格拼接，各写一份必然漂移。
 * 注意 esc() 是 **HTML 转义**（原脚本的 esc 是 Markdown 表格转义，转义 `|`，不能复用）。
 * CSS 刻意不含 % 字符：weekly_winrate 的硬门禁自测会断言「样本不足时报告不含 %」。
 */
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const CSS = `
:root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--muted:#8b949e;--accent:#58a6ff;--warn:#d29922}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:1040px;margin:0 auto;padding:28px 20px 56px}
header{border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:20px}
h1{font-size:22px;margin:0 0 6px}
h2{font-size:16px;margin:26px 0 12px;padding-left:10px;border-left:3px solid var(--accent)}
.sub,.muted,footer{color:var(--muted);font-size:13px}
.meta{list-style:none;padding:12px 16px;margin:0 0 18px;background:var(--panel);border:1px solid var(--line);border-radius:10px;font-size:13px}
.meta li{padding:2px 0;color:var(--muted)}
.meta b{color:var(--fg)}
.tw{overflow-x:auto;margin:10px 0 4px}
table{border-collapse:collapse;font-size:13px}
th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;white-space:nowrap}
th{background:var(--panel);color:var(--muted);font-weight:600}
tr:nth-child(even) td{background:rgba(255,255,255,.025)}
td.empty{color:var(--muted);text-align:center}
.note{background:var(--panel);border-left:3px solid var(--warn);padding:10px 14px;border-radius:8px;margin:14px 0;color:var(--muted);font-size:13px}
code{background:var(--panel);padding:1px 5px;border-radius:4px;font-size:12px}
footer{margin-top:28px;border-top:1px solid var(--line);padding-top:12px}
@media(max-width:700px){main{padding:16px 12px 40px}h1{font-size:19px}.meta li{word-break:break-all}}
`;

/** 表格：单元格一律 HTML 转义，调用方传原始值即可 */
function table(headers, rows) {
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const tr = rows.length
    ? rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="empty" colspan="${headers.length}">无</td></tr>`;
  return `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

/** 提示条：入参为已构建好的安全 HTML（动态值请先 esc） */
const note = (html) => `<div class="note">${html}</div>`;

/** 单文件 HTML 页面。meta / body / footer 为 HTML 片段，动态值由调用方 esc */
function page({ title, subtitle = '', meta = [], body = '', footer = '' }) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><main>
<header><h1>${esc(title)}</h1>${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}</header>
${meta.length ? `<ul class="meta">${meta.map((m) => `<li>${m}</li>`).join('')}</ul>` : ''}
${body}
${footer ? `<footer>${footer}</footer>` : ''}
</main></body></html>
`;
}

module.exports = { esc, CSS, table, note, page };
