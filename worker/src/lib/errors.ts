import { BizCode } from './response.js';

/**
 * 业务异常：由数据层抛出、路由层统一翻译成统一信封。
 *
 * 为什么要有它：写接口的失败原因（参数错、重名、对象不存在）发生在 lib 层，
 * 若每层都 `return { ok:false, code, message }` 会让调用方到处判空；
 * 抛异常 + 路由层 catch 一次翻译，代码更直白。
 */
export class BizError extends Error {
  code: number;

  constructor(message: string, code: number = BizCode.ERR_GENERIC) {
    super(message);
    this.name = 'BizError';
    this.code = code;
  }
}

/** 参数错误（10003） */
export function invalid(message: string): BizError {
  return new BizError(message, BizCode.ERR_INVALID_PARAM);
}

/** 资源不存在（10002） */
export function notFound(message: string): BizError {
  return new BizError(message, BizCode.ERR_NOT_FOUND);
}

/** 通用业务错误（10001），如分组重名 */
export function conflict(message: string): BizError {
  return new BizError(message, BizCode.ERR_GENERIC);
}
