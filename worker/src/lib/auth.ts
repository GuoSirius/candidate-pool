import type { Context } from 'hono';
import { fail, BizCode } from './response.js';
import type { Bindings } from '../types.js';

/**
 * 写接口鉴权（共享令牌）。
 *
 * 站点（Cloudflare Pages）是公开可访问的，写接口一旦放开就等于谁都能改数据，
 * 因此约定：Worker 侧必须配置机密变量 `WRITE_TOKEN`，请求带 `x-write-token` 头且一致才放行。
 *
 * 安全默认：
 *   - 未配置 `WRITE_TOKEN` → 直接拒绝（而非「无令牌即放行」），避免忘记配置时静默裸奔；
 *   - 比较使用定长逐字节异或，避免字符串早退比较带来的时序侧信道。
 *
 * 想换成更强的方案（Cloudflare Access / Zero Trust）不需要改本文件：
 * 在 Cloudflare 控制台对 `/api` 路径加 Access 策略即可，令牌校验可继续保留。
 */
export function guardWrite(c: Context<{ Bindings: Bindings }>): Response | null {
  const expected = c.env.WRITE_TOKEN;
  if (!expected) {
    return fail(
      c,
      '写接口未启用：Worker 未配置 WRITE_TOKEN。请执行 wrangler secret put WRITE_TOKEN 后重试。',
      BizCode.ERR_FORBIDDEN,
    );
  }
  const got = c.req.header('x-write-token') ?? '';
  if (!got || !safeEqual(got, expected)) {
    return fail(c, '写令牌校验失败：请求头 x-write-token 缺失或与 WRITE_TOKEN 不一致。', BizCode.ERR_FORBIDDEN);
  }
  return null;
}

/** 定长逐字节比较（长度不同也走完整循环，避免早退暴露长度/前缀信息）。 */
function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i += 1) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
