// pulse:watch 引导脚本 —— 由 Windows 计划任务 pulse-watch 调起，
// spawn detached 启动 watch.js 并把输出追加到 pulse/data/watch-console.log。
// 之所以要经过这层引导：计划任务 Action 无法直接做输出重定向。
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const log = path.join(root, 'pulse', 'data', 'watch-console.log');
fs.mkdirSync(path.dirname(log), { recursive: true });

// 单实例保护：已存在 watch.js 进程则不重复启动（fail-open：检查失败仍启动）
try {
  const out = execSync(
    'powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\").CommandLine"',
    { timeout: 15000, windowsHide: true }
  ).toString();
  if (/pulse[\\/]watch\.js/.test(out)) {
    fs.appendFileSync(log, `[boot] 已有 watch 实例在运行，跳过本次启动\n`);
    process.exit(0);
  }
} catch (e) {
  fs.appendFileSync(log, `[boot] 单实例检查失败（继续启动）：${e.message}\n`);
}

const out = fs.openSync(log, 'a');
const err = fs.openSync(log, 'a');
const c = spawn(process.execPath, ['pulse/watch.js'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', out, err],
});
c.unref();
console.log('PID=' + c.pid);
