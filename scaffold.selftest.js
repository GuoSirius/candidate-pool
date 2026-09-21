'use strict';
/*
 * scaffold.selftest.js —— 首次运行脚手架的回归自测
 * ---------------------------------------------------------------------------
 * 为什么必须自测：脚手架是**唯一会往用户目录写文件**的自动流程。它一旦越界
 * （覆盖已有配置、写出占位凭据），后果是「用户的数据没了」或「程序行为静默改变」，
 * 而且只在首次运行时发生 —— 手工测一次根本触发不到第二次。
 *
 * 覆盖：创建 / 不覆盖 / 幂等 / 不造凭据 / 包内安装判定 / 静默输出。
 * 用法：node scaffold.selftest.js
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('./paths');
const scaffold = require('./scaffold');

let failed = 0;
const tmpDirs = [];

function check(name, ok, detail) {
  if (ok) console.log(`  OK   ${name}`);
  else { failed++; console.log(`  FAIL ${name}${detail === undefined ? '' : `  → ${detail}`}`); }
}

function mkTmp(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `cp-scaffold-${tag}-`));
  tmpDirs.push(d);
  return d;
}

function cleanup() {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
}

const read = (p) => fs.readFileSync(p, 'utf8');

console.log('[1] 空目录（重定位）：应补齐目录与观察池');
{
  const H = mkTmp('empty');
  paths.setHome(H);
  const r = scaffold.ensureWorkspace();

  for (const [k, p] of Object.entries({
    data: paths.dataDir(), reports: paths.reportsDir(),
    'eod/data': paths.eodDataDir(), 'eod/reports': paths.eodReportsDir(), db: path.dirname(paths.localDb()),
  })) {
    check(`创建目录 ${k}`, fs.existsSync(p), p);
  }
  check('candidates.json 已从示例模板生成', fs.existsSync(paths.candidatesFile()), paths.candidatesFile());
  const j = JSON.parse(read(paths.candidatesFile()));
  check('生成的观察池结构正确（stocks 非空）', Array.isArray(j.stocks) && j.stocks.length > 0, `stocks=${j.stocks && j.stocks.length}`);
  check('生成的观察池带示例说明', /示例/.test(String(j.note || '')), j.note);
  check('createdFiles 记录 1 项', r.createdFiles.length === 1, String(r.createdFiles.length));
  check('relocated=true（HOME 不是包根）', r.relocated === true, String(r.relocated));
  check('source=setHome()', r.source === 'setHome()', r.source);
  check('installed=false（临时目录不在 node_modules 下）', r.installed === false, String(r.installed));
}

console.log('\n[2] 绝不写入含凭据的配置文件');
{
  const H = mkTmp('creds');
  paths.setHome(H);
  scaffold.ensureWorkspace();
  check('未创建 notify_config.json', !fs.existsSync(paths.notifyConfigFile()), paths.notifyConfigFile());
  check('未创建 db/.env', !fs.existsSync(paths.dbEnvFile()), paths.dbEnvFile());
  const r = scaffold.ensureWorkspace();
  check('两份凭据以「提示」形式给出', r.hints.length === 2, JSON.stringify(r.hints.map((h) => path.basename(h.to))));
  check('提示里带可复制的命令', scaffold.renderHints(r).some((l) => /^\s+cp "/.test(l)), 'no cp line');
}

console.log('\n[3] 绝不覆盖已存在的文件（向后兼容的核心）');
{
  const H = mkTmp('keep');
  paths.setHome(H);
  fs.mkdirSync(H, { recursive: true });
  const mine = JSON.stringify({ name: '我的观察池', stocks: [{ code: 'sh600519', name: '贵州茅台', sector: '食品饮料' }] }, null, 2);
  fs.writeFileSync(paths.candidatesFile(), mine);
  fs.writeFileSync(paths.notifyConfigFile(), '{"wechat":{"key":"MY_REAL_KEY"}}');

  const r = scaffold.ensureWorkspace();
  check('已有 candidates.json 内容未被改写', read(paths.candidatesFile()) === mine, 'content changed');
  check('已有 candidates.json 未被重新生成', r.createdFiles.length === 0, String(r.createdFiles.length));
  check('已有 notify_config.json 原样保留', /MY_REAL_KEY/.test(read(paths.notifyConfigFile())), 'changed');
  check('已有的那份不再出现在提示里', !r.hints.some((h) => h.to === paths.notifyConfigFile()), 'still hinted');
}

console.log('\n[4] 幂等：重复调用零副作用');
{
  const H = mkTmp('idem');
  paths.setHome(H);
  const a = scaffold.ensureWorkspace();
  const before = read(paths.candidatesFile());
  const b = scaffold.ensureWorkspace();
  const c = scaffold.ensureWorkspace();
  check('第二次调用不创建任何目录', b.createdDirs.length === 0, String(b.createdDirs.length));
  check('第二次调用不创建任何文件', b.createdFiles.length === 0, String(b.createdFiles.length));
  check('第三次调用同样为空', c.createdDirs.length + c.createdFiles.length === 0, 'not empty');
  check('文件内容稳定', read(paths.candidatesFile()) === before, 'content drift');
  check('首次确实创建了东西（对照）', a.createdDirs.length + a.createdFiles.length > 0, 'nothing created at all');
}

console.log('\n[5] 输出：无事发生时保持静默');
{
  const H = mkTmp('quiet');
  paths.setHome(H);
  scaffold.ensureWorkspace();
  const silent = scaffold.ensureWorkspace();
  check('无变化 → renderReport 为空数组', scaffold.renderReport(silent).length === 0, JSON.stringify(scaffold.renderReport(silent)));
  const lines = [];
  scaffold.autoInit({ log: (s) => lines.push(s) });
  check('无变化 → autoInit 不打任何日志', lines.length === 0, lines.join(' | '));

  const lines2 = [];
  scaffold.autoInit({ log: (s) => lines2.push(s), init: true });
  check('--init 即使无变化也有输出', lines2.length > 0, 'silent');
  check('--init 输出含「已就绪」', lines2.some((l) => /已就绪/.test(l)), lines2.join(' | '));
}

console.log('\n[6] node_modules 安装场景：应给出重定位警告');
{
  const H = path.join(mkTmp('nm'), 'node_modules', 'candidate-pool');
  fs.mkdirSync(H, { recursive: true });
  paths.setHome(H);
  const r = scaffold.ensureWorkspace();
  check('installed=true', r.installed === true, String(r.installed));
  const report = scaffold.renderReport(r).join('\n');
  check('报告里出现重定位警告', /node_modules/.test(report) && /--cwd/.test(report), report);
}

console.log('\n[7] 默认（包根）行为：本仓库已有全部文件 → 不创建、不改动');
{
  paths.setHome(null);
  check('HOME 回到包根', paths.home() === paths.PKG_ROOT, paths.home());
  const before = fs.existsSync(paths.candidatesFile()) ? read(paths.candidatesFile()) : null;
  const r = scaffold.ensureWorkspace();
  check('未创建任何文件（仓库里都齐了）', r.createdFiles.length === 0, JSON.stringify(r.createdFiles.map((f) => f.to)));
  if (before !== null) {
    check('仓库里的 candidates.json 未被改动', read(paths.candidatesFile()) === before, 'changed');
    check('仓库里的 candidates.json 不是示例模板', !/示例模板/.test(read(paths.candidatesFile())), 'overwritten by template');
  } else {
    check('仓库里的 candidates.json 跳过（不存在，不适用）', true);
  }
  check('PKG_ROOT 下没有 node_modules 判定', scaffold.looksInstalled(paths.PKG_ROOT) === false, 'misdetected');
}

cleanup();
console.log(failed ? `\n自我检查失败：${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
