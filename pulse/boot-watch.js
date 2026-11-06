// pulse:watch 引导脚本 —— 由 Windows 计划任务 pulse-watch 调起，
// spawn detached 启动 watch.js 并把输出追加到 pulse/data/watch-console.log。
// 之所以要经过这层引导：计划任务 Action 无法直接做输出重定向。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const log = path.join(root, 'pulse', 'data', 'watch-console.log');
fs.mkdirSync(path.dirname(log), { recursive: true });
const out = fs.openSync(log, 'a');
const err = fs.openSync(log, 'a');
const c = spawn(process.execPath, ['pulse/watch.js'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', out, err],
});
c.unref();
console.log('PID=' + c.pid);
