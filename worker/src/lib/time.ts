/**
 * 北京时间字符串（YYYY-MM-DD HH:mm:ss，无时区后缀）。
 *
 * 全局规范：时间生成 / 解析一律走 dayjs，业务时区锁定 Asia/Shanghai。
 * 根目录 `time.js`（Node 脚本）与 `web/src/utils/date.ts`（前端）都是 dayjs 口径，
 * 此处保持一致，避免同一件事在三个运行时各写一份实现、日后静默漂移。
 *
 * 为什么不直接用 `new Date().toISOString()`：Worker 运行在 UTC，直接取会差 8 小时，
 * 与库内既有时间口径（脚本侧写入的北京时间）不一致，复盘时会串日。
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/** 业务时区。北京无夏令时，偏移恒为 +08:00。 */
export const CN_TZ = 'Asia/Shanghai';

export function nowBeijing(): string {
  return dayjs().tz(CN_TZ).format('YYYY-MM-DD HH:mm:ss');
}
