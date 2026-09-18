'use strict';
// 统一时间处理：所有业务时间一律走 dayjs（全局规则）。
// 业务时区锁定 Asia/Shanghai，落库/展示统一用北京时间字符串（YYYY-MM-DD HH:mm:ss，无 Z），
// 根治裸 new Date().toISOString() 带来的 +8h 时差问题。
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const tz = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(tz);
dayjs.tz.setDefault('Asia/Shanghai');

// 当前北京时间字符串（YYYY-MM-DD HH:mm:ss），无 Z
function now() {
  return dayjs.tz().format('YYYY-MM-DD HH:mm:ss');
}

module.exports = { now, dayjs };
