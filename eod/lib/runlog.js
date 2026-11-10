'use strict';
/*
 * eod/lib/runlog.js —— 运行日志统一归位
 * ---------------------------------------------------------------------------
 * 背景：日志文件原先靠外部调度命令 `> xxx.log` 重定向产生，路径随调度配置漂移
 *（2026-11-06 盘前日志落到了 eod/ 根，与 eod/logs/ 里的既有序列脱节）。
 * 治本：脚本启动时自行开启 tee，在 process.stdout/stderr.write 上单点拦截，
 *   把全部输出（console.* 与直写 stream）镜像追加到
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
const { dayjs } = require('../../time');

function logsDir() {
  // 日志属于「运行产物」→ 随 HOME 走（npm 包 / npx 场景不写进 node_modules，重装即丢）。
  // 仓库场景下与历史完全一致：<repo>/eod/logs。
  let dir;
  try {
    const paths = require('../../paths');
    dir = path.join(paths.eodDir(), 'logs');
  } catch (e) {
    dir = path.join(__dirname, '..', 'logs');   // paths 不可用时的兜底（代码资产相对）
  }
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
  // 统一在流层面镜像（2026-11-10 评审 #1）：console.log/error/warn 内部就是
  // process.stdout/stderr.write（属性查找发生在调用时），gen_candidates 的 log()、
  // store/pool_reflow 等的 stderr 告警也走它 —— 只包 console 会漏，只包 stderr 会与
  // console 包装重复镜像。改在 stdout/stderr 两个 write 上单点拦截：console 与
  // 直写 stream 各镜像一次、互不重复。防递归：write() 内部用 fs.appendFileSync。
  for (const stream of [process.stdout, process.stderr]) {
    const origWrite = stream.write.bind(stream);
    stream.write = function (chunk, ...rest) {
      write(typeof chunk === 'string' ? chunk : String(chunk));
      return origWrite(chunk, ...rest);
    };
  }
  write(`\n===== run start ${dayjs.tz().format('YYYY-MM-DD HH:mm:ss')} args: ${process.argv.slice(2).join(' ') || '(none)'} =====\n`);
  return file;
}

module.exports = { startRunLog, logsDir };
