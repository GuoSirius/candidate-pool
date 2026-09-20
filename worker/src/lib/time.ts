/**
 * 北京时间字符串（YYYY-MM-DD HH:mm:ss，无时区后缀）。
 *
 * 为什么不直接用 `new Date().toISOString()`：Worker 运行在 UTC，直接取会差 8 小时，
 * 与库内既有时间口径（脚本侧用 dayjs(Asia/Shanghai) 写入）不一致，复盘时会串日。
 *
 * 为什么不用 dayjs：Worker 侧不想为一个格式化再引依赖；Intl 指定时区后按「部件」拼接即可，
 * 结果与 dayjs.tz 的 `format('YYYY-MM-DD HH:mm:ss')` 完全一致。
 */
const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function nowBeijing(): string {
  const p: Record<string, string> = {};
  for (const part of PARTS.formatToParts(new Date())) {
    p[part.type] = part.value;
  }
  // 个别引擎在 hour12:false 下会把午夜格式化成 "24"，统一收敛成 "00"
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}`;
}
