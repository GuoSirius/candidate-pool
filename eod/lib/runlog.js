'use strict';
/*
 * eod/lib/runlog.js —— 运行日志统一归位
 * ---------------------------------------------------------------------------
 * 背景：日志文件原先靠外部调度命令 `> xxx.log` 重定向产生，路径随调度配置漂移
 *（2026-11-06 盘前日志落到了 eod/ 根，与 eod/logs/ 里的既有序列脱节）。
 * 治本：脚本启动时自行开启 tee，把 console.log/error/warn 镜像追加到
 *   eod/logs/<prefix>-<YYYY-MM-DD>.log（一天一个文件，带会话头）。
 * stdout 语义完全不变（--json 机器摘要不受影响）；写日志失败静默，不干扰主流程。
 *
 * 用法（在 OPT 解析后、主流程开始前）：
 *   const { startRunLog } = require('./lib/runlog');
 *   if (!OPT.paths) startRunLog('preopen');
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const util = require('util');
const { dayjs } = require('../../time');

function logsDir() {
  const dir = path.join(__dirname, '..', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let started = false;

/** 开启 console → 文件镜像。幂等（重复调用返回已有文件）。 */
function startRunLog(prefix) {
  const file = path.join(logsDir(), `${prefix}-${dayjs.tz().format('YYYY-MM-DD')}.log`);
  if (started) return file;
  started = true;

  const write = (line) => { try { fs.appendFileSync(file, line); } catch (e) { /* 日志失败不影响主流程 */ } };
  const wrap = (origFn) => (...args) => {
    origFn(...args);
    write(args.map((a) => (typeof a === 'string' ? a : util.format(a))).join(' ') + '\n');
  };
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = wrap(orig.log);
  console.error = wrap(orig.error);
  console.warn = wrap(orig.warn);
  write(`\n===== run start ${dayjs.tz().format('YYYY-MM-DD HH:mm:ss')} args: ${process.argv.slice(2).join(' ') || '(none)'} =====\n`);
  return file;
}

module.exports = { startRunLog, logsDir };
