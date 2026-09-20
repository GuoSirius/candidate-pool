import type { NoteType } from '../types.js';
import { invalid } from './errors.js';

/**
 * 写接口入参校验：集中一处，各路由只管调用。
 * 约定：校验函数「通过就返回规整后的值，不通过就抛 BizError(10003)」，
 * 这样路由里是一行 `const x = reqCode(body.code)`，不需要到处判空。
 */

export const CODE_RE = /^(sh|sz|bj)\d{6}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const CONTENT_MAX = 500;
export const GROUP_NAME_MAX = 30;
export const DESC_MAX = 200;
export const REL_NOTE_MAX = 200;

const NOTE_TYPES = ['comment', 'memo'] as const;

/** 股票代码：非空，形如 sh600519 / sz000001 / bj830799 */
export function reqCode(v: unknown): string {
  if (typeof v !== 'string' || !CODE_RE.test(v)) {
    throw invalid('code 必须为非空字符串且形如 sh600519 / sz000001 / bj830799');
  }
  return v;
}

/** 备注内容：非空，去首尾空白，长度 ≤ 500 */
export function reqContent(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw invalid('content 不能为空');
  if (s.length > CONTENT_MAX) throw invalid(`content 长度不能超过 ${CONTENT_MAX} 字`);
  return s;
}

/** 备注类型：缺省 comment；仅允许 comment / memo */
export function optNoteType(v: unknown): NoteType {
  if (v === undefined || v === null || v === '') return 'comment';
  if (typeof v !== 'string' || !(NOTE_TYPES as readonly string[]).includes(v)) {
    throw invalid(`type 只能为 ${NOTE_TYPES.join(' / ')}`);
  }
  return v as NoteType;
}

/** 锚定日：可空；非空须为 YYYY-MM-DD（不做交易日校验，允许先记后补） */
export function optAnchorDate(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !DATE_RE.test(v)) {
    throw invalid('anchor_date 须为空或形如 YYYY-MM-DD');
  }
  return v;
}

/** 分组名：非空，去首尾空白，长度 ≤ 30 */
export function reqGroupName(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw invalid('分组名不能为空');
  if (s.length > GROUP_NAME_MAX) throw invalid(`分组名长度不能超过 ${GROUP_NAME_MAX} 字`);
  return s;
}

/** 分组颜色：可空；非空须为 #RRGGBB */
export function optColor(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !COLOR_RE.test(v)) {
    throw invalid('color 须为空或形如 #4F8DFD');
  }
  return v;
}

/** 可选短文本（分组说明 / 入组备注）：可空，去首尾空白，长度 ≤ max */
export function optText(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw invalid(`${field} 须为字符串`);
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) throw invalid(`${field} 长度不能超过 ${max} 字`);
  return s;
}

/** 路径参数 id：须为正整数 */
export function reqId(raw: string | undefined, field = 'id'): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw invalid(`${field} 须为正整数`);
  return n;
}
