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

/** 双语片段：默认中文，点右上角 EN 切换 */
function b(zh, en) { return `<span data-zh="${zh}" data-en="${en}">${zh}</span>`; }
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

module.exports = { b, num, pct, esc, boardsTxt };
