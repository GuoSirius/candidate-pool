// 日期工具。全局规范：时间生成 / 解析 / 比较一律用 dayjs，业务时区锁定 Asia/Shanghai
//（不用原生 Date，避免机器时区与月末加减的边界问题，例：3-31 减 1 个月）。
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const CN_TZ = 'Asia/Shanghai';

/** 今天（北京时区）的 YYYY-MM-DD。 */
export function todayCN(): string {
  return dayjs().tz(CN_TZ).format('YYYY-MM-DD');
}

/** N 个月前的 YYYY-MM-DD（北京时区）。months <= 0 返回空串，表示「不限起始」。 */
export function monthsAgoCN(months: number): string {
  if (months <= 0) return '';
  return dayjs().tz(CN_TZ).subtract(months, 'month').format('YYYY-MM-DD');
}
