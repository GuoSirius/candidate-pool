'use strict';
/*
 * eod/lib/report_fmt.js —— 两份 HTML 报告（report.js / preopen_report.js）共享的格式化纯函数
 * ---------------------------------------------------------------------------
 * 抽取原则：只收「多处在用且逐字相同」的实现，避免两份报告漂移（2026-11-05 从
 * report.js 与 preopen_report.js 合并而来）。gen_candidates.js 自有一套加硬变体
 * （esc 额外转义单引号、b() 内部再 esc），语义不同，未并入——统一它需全量审计
 * 三处调用点的转义时机，属独立任务。
 *
 * 注意 b() 的约定：参数为「未转义文本」；调用方若已 esc 过再传入会双重转义。
 * ---------------------------------------------------------------------------
 */

/** 双语片段：默认中文，点右上角 EN 切换
 *  参数约定：zh/en 为「未转义文本」（可含 HTML 片段，切换时经 innerHTML 回填）。
 *  属性值必须 esc：否则内容里的裸双引号会提前闭合 data-zh/data-en（2026-11-09 评审 2.3）。
 *  浏览器解析属性时会自动解码实体，dataset 拿到的仍是原始字符串，行为不变。 */
function b(zh, en) {
  const z = String(zh ?? ''), e = String(en ?? zh ?? '');
  return `<span data-zh="${esc(z)}" data-en="${esc(e)}">${z}</span>`;
}
function num(n, d = 2) { return (n == null || isNaN(n)) ? '—' : Number(n).toFixed(d); }
function pct(n) { return (n == null || isNaN(n)) ? '—' : (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%'; }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** 连板文案：{streak,days,count} → 首板/昨日首板/N连板/N天M板/组合；兼容旧数字（纯连板数） */
function boardsTxt(bd) {
  if (bd == null) return '';
  if (typeof bd === 'number') bd = { streak: bd, days: bd, count: bd };
  const st = bd.streak | 0, N = bd.days | 0, M = bd.count | 0;
  if (st >= 2) return M > st ? `${st}连板·${N}天${M}板` : `${st}连板`;
  if (st === 1) return M > 1 ? `首板·${N}天${M}板` : '首板';
  if (M >= 1) return N === 2 ? '昨日首板' : `${N}天${M}板`;
  return '';
}

/** 金额（元）→ 「1.2亿」「3000万」，涨红跌绿 */
function fmtAmt(v) {
  if (v == null || isNaN(v)) return '';
  const a = Math.abs(v);
  return (v < 0 ? '-' : '') + (a >= 1e8 ? num(a / 1e8, 1) + '亿' : num(a / 1e4, 0) + '万');
}

/** 上榜单元格（2026-11-09 从 preopen_report.js 迁入共享）：tag + 游资标注（金额+分层，如「章盟主(1.2亿)@一线」） */
function billboardCell(bb) {
  if (!bb) return '';
  const hotTxt = (bb.hot || [])
    .map((h) => `${esc(h.name)}${h.amt != null ? '(' + fmtAmt(h.amt) + ')' : ''}${h.tier ? '@' + esc(h.tier) : ''}`)
    .join(' / ');
  return `<span class="tag pass">${b('上榜', 'List')}</span>${hotTxt ? `<span class="src">${hotTxt}</span>` : ''}`;
}

/** HTML 安全压缩（用户要求减小入库体积，2026-11-09）：
 *  只做 <style> 内空白折叠、逐行去首部缩进、去空行。
 *  不合并标签间空白（inline 元素间距会变）、不删行内 JS 换行（// 注释会串行）。
 *  2026-11-09 评审 #8：不再删 {}:;, 周围空白 —— 那会连 CSS 字符串内部一起改写
 *  （content: "a: b, c" → content:"a:b,c"），「零语义风险」契约不成立。 */
function minifyHTML(html) {
  return String(html)
    .replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => `<style>${css.replace(/\s+/g, ' ')}</style>`)
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s+/, ''))
    .filter((l) => l.length)
    .join('\n');
}

module.exports = { b, num, pct, esc, boardsTxt, fmtAmt, billboardCell, minifyHTML };
