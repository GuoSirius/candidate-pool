import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * 统一 API 响应信封
 * 约定：无论成功失败，body 结构始终为 { code, message, data }。
 *
 * code 是「业务码」而非 HTTP 状态码：
 *   - 200 表示成功；
 *   - 非 200 为业务错误码（如 10001 通用错误、10002 资源不存在、10003 参数错误、10004 服务内部错误）。
 * 真实业务数据永远放在 data（成功时为业务对象，失败时为 null 或附加上下文）。
 *
 * HTTP 状态码默认恒为 200（成功与业务错误均返回 200），由前端统一读 code 判定；
 * 仅在真正的传输/网关层异常（如未捕获异常）时才显式返回非 200（如 500），便于监控。
 * 若确有需要，fail/ok 的 status 参数可覆盖 HTTP 状态。
 */
export interface ApiEnvelope<T = unknown> {
  code: number;
  message: string;
  data: T | null;
}

/** 业务码常量，集中管理便于前后端对齐 */
export const BizCode = {
  OK: 200,
  ERR_GENERIC: 10001,
  ERR_NOT_FOUND: 10002,
  ERR_INVALID_PARAM: 10003,
  ERR_INTERNAL: 10004,
  /** 无写权限：未配置 WRITE_TOKEN 或令牌校验失败（见 lib/auth.ts） */
  ERR_FORBIDDEN: 10005,
} as const;

/** 成功响应：业务码默认 200，HTTP 默认 200。 */
export function ok<T>(
  c: Context,
  data: T,
  message = 'success',
  code: number = BizCode.OK,
  status: ContentfulStatusCode = 200,
): Response {
  return c.json<ApiEnvelope<T>>({ code, message, data }, status);
}

/**
 * 失败响应：业务码默认 10001（通用业务错误），HTTP 默认 200（由 code 区分错误）。
 * 如需让 HTTP 层也感知（如真实 5xx），传 status。
 */
export function fail(
  c: Context,
  message: string,
  code: number = BizCode.ERR_GENERIC,
  data: unknown = null,
  status: ContentfulStatusCode = 200,
): Response {
  return c.json<ApiEnvelope>({ code, message, data }, status);
}
