import type { Context } from 'hono';

/**
 * 统一 API 响应信封
 * 约定：无论成功失败，body 结构始终为 { code, message, data }；
 * 真实业务数据永远放在 data 中（成功时为业务对象，失败时为 null 或附加上下文）。
 * code 复用 HTTP 语义状态码（成功 200，失败 4xx/5xx），便于 HTTP 层感知，body 仍统一。
 */
export interface ApiEnvelope<T = unknown> {
  code: number;
  message: string;
  data: T | null;
}

/** 成功响应：HTTP 200，业务数据在 data */
export function ok<T>(c: Context, data: T, message = 'success'): Response {
  return c.json<ApiEnvelope<T>>({ code: 200, message, data });
}

/**
 * 失败响应：保留 HTTP 语义状态码，body 仍为统一结构。
 * data 默认 null；如需透出校验细节等可传入。
 */
export function fail(
  c: Context,
  status: number,
  message: string,
  data: unknown = null,
): Response {
  return c.json<ApiEnvelope>(
    { code: status, message, data },
    status as 400 | 404 | 500 | 502,
  );
}
