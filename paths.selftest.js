'use strict';
/*
 * paths.selftest.js —— 工作目录解析的回归自测
 * ---------------------------------------------------------------------------
 * 为什么必须有：`paths.js` 的默认分支直接决定**全部数据文件读写的落点**。
 * 一旦默认值被改错（例如有人「顺手」把默认从包根改成 process.cwd()），
 * 本机定时任务与 CI 就会把快照/报告写到别处，表现为「跑了但 report 里找不到」——
 * 这种故障不会报错，只会静默换目录。故用可重跑断言把默认行为钉死。
 *
 * 运行：node paths.selftest.js    （退出码非 0 = 失败）
 * 纯函数 + 临时目录，不联网、不写真实工作区。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./paths');

let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? '  OK  ' : '    '}${name}${cond || detail === undefined ? '' : `  → ${detail}`}`);
  if (!cond) failed++;
}

const PKG = P.PKG_ROOT;
const TMP_A = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-home-a-'));
const TMP_B = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-home-b-'));

/** 每个用例前清掉解析缓存，保证互不污染 */
function reset() { P.setHome(null); }
function withEnv(val, fn) {
  const bak = process.env.CANDIDATE_POOL_HOME;
  if (val === undefined) delete process.env.CANDIDATE_POOL_HOME; else process.env.CANDIDATE_POOL_HOME = val;
  reset();
  try { return fn(); } finally {
    if (bak === undefined) delete process.env.CANDIDATE_POOL_HOME; else process.env.CANDIDATE_POOL_HOME = bak;
    reset();
  }
}
function withArgv(extra, fn) {
  const bak = process.argv;
  process.argv = ['node', 'x.js', ...extra];
  reset();
  try { return fn(); } finally { process.argv = bak; reset(); }
}

console.log('\n[1] 默认行为必须与历史 __dirname 完全一致（改了就是静默换目录）');
withEnv(undefined, () => withArgv([], () => {
  check('home() === 包根', P.home() === PKG, P.home());
  check('来源标记 pkg-root', P.homeSource() === 'pkg-root', P.homeSource());
  check('未处于重定位状态', P.isRelocated() === false);
  // 逐项对齐「老写法」的结果
  const legacy = {
    candidatesFile: path.join(PKG, 'candidates.json'),
    notifyConfigFile: path.join(PKG, 'notify_config.json'),
    dataDir: path.join(PKG, 'data'),
    reportsDir: path.join(PKG, 'reports'),
    eodDataDir: path.join(PKG, 'eod', 'data'),
    eodReportsDir: path.join(PKG, 'eod', 'reports'),
    industryMapFile: path.join(PKG, 'eod', 'data', 'industry-map.json'),
    localDb: path.join(PKG, 'db', 'local.db'),
    dbEnvFile: path.join(PKG, 'db', '.env'),
  };
  for (const [k, v] of Object.entries(legacy)) check(`默认 ${k} 与老写法一致`, P[k]() === v, `${P[k]()} vs ${v}`);
  // 尾盘子目录的两个用法（store.js 用 eodDir + cfg.store.dataDir）
  check('eodDir() + dataDir 名 = eod/data', path.join(P.eodDir(), 'data') === path.join(PKG, 'eod', 'data'));
}));

console.log('\n[2] CANDIDATE_POOL_HOME 必须整棵重定向');
withEnv(TMP_A, () => withArgv([], () => {
  check('home() === 环境变量值', P.home() === path.resolve(TMP_A), P.home());
  check('来源标记 env', P.homeSource() === 'env:CANDIDATE_POOL_HOME', P.homeSource());
  check('isRelocated() === true', P.isRelocated() === true);
  check('dataDir 落在 HOME 下', P.dataDir() === path.join(TMP_A, 'data'), P.dataDir());
  check('eodDataDir 落在 HOME 下', P.eodDataDir() === path.join(TMP_A, 'eod', 'data'), P.eodDataDir());
  check('eodReportsDir 落在 HOME 下', P.eodReportsDir() === path.join(TMP_A, 'eod', 'reports'), P.eodReportsDir());
  check('reportsDir 落在 HOME 下', P.reportsDir() === path.join(TMP_A, 'reports'), P.reportsDir());
  check('localDb 落在 HOME 下', P.localDb() === path.join(TMP_A, 'db', 'local.db'), P.localDb());
  check('dbEnvFile 落在 HOME 下', P.dbEnvFile() === path.join(TMP_A, 'db', '.env'), P.dbEnvFile());
  check('candidatesFile 落在 HOME 下', P.candidatesFile() === path.join(TMP_A, 'candidates.json'), P.candidatesFile());
  check('industryMapFile 落在 HOME 下', P.industryMapFile() === path.join(TMP_A, 'eod', 'data', 'industry-map.json'), P.industryMapFile());
  // 关键不变式：代码资产**不**跟着走
  check('schema.sql 仍在包内', P.codeAsset('db', 'schema.sql') === path.join(PKG, 'db', 'schema.sql'), P.codeAsset('db', 'schema.sql'));
  check('schema.sql 不落在 HOME 下', !P.codeAsset('db', 'schema.sql').startsWith(TMP_A));
}));

console.log('\n[3] --cwd <dir> 必须生效');
withEnv(undefined, () => withArgv(['--cwd', TMP_B], () => {
  check('home() === --cwd 值', P.home() === path.resolve(TMP_B), P.home());
  check('来源标记 argv', P.homeSource() === 'argv:--cwd', P.homeSource());
  check('eodDataDir 落在 --cwd 下', P.eodDataDir() === path.join(TMP_B, 'eod', 'data'), P.eodDataDir());
}));

console.log('\n[4] 优先级：env > --cwd > 包根');
{
  const bakEnv = process.env.CANDIDATE_POOL_HOME;
  const bakArgv = process.argv;
  process.env.CANDIDATE_POOL_HOME = TMP_A;
  process.argv = ['node', 'x.js', '--cwd', TMP_B];
  reset();
  check('同时给 env 与 --cwd → env 胜', P.home() === path.resolve(TMP_A) && P.homeSource() === 'env:CANDIDATE_POOL_HOME', P.homeSource());
  if (bakEnv === undefined) delete process.env.CANDIDATE_POOL_HOME; else process.env.CANDIDATE_POOL_HOME = bakEnv;
  process.argv = bakArgv; reset();
}

console.log('\n[5] cwdFromArgv 解析健壮性（不误吃下一个参数）');
check('无 --cwd → null', P.cwdFromArgv(['--offline']) === null);
check('--cwd 在末尾无值 → null', P.cwdFromArgv(['--cwd']) === null);
check('--cwd 后跟另一个 flag → null', P.cwdFromArgv(['--cwd', '--offline']) === null);
check('--cwd X → X', P.cwdFromArgv(['--cwd', 'X']) === 'X');
check('--cwd X 混在其他参数里 → X', P.cwdFromArgv(['--intraday', '--cwd', 'X', '--json']) === 'X');
check('--now 的值不会被误当 --cwd', P.cwdFromArgv(['--now', '2026-09-21 11:30']) === null);

console.log('\n[6] setHome 显式覆盖与重置');
P.setHome(TMP_A);
check('setHome 生效', P.home() === path.resolve(TMP_A) && P.homeSource() === 'setHome()', P.homeSource());
P.setHome(null);
check('setHome(null) 回到包根', P.home() === PKG && P.homeSource() === 'pkg-root', `${P.home()} / ${P.homeSource()}`);

console.log('\n[7] describe() 自述完整');
withEnv(TMP_A, () => {
  const d = P.describe();
  check('describe 含 home/source/relocated', d.home === path.resolve(TMP_A) && d.relocated === true && !!d.source);
  check('describe 列出 9 个工作区路径', Object.keys(d.workspace).length === 9, String(Object.keys(d.workspace).length));
  check('describe 列出代码资产', d.codeAssets.schemaSql === path.join(PKG, 'db', 'schema.sql'));
});

console.log('\n[8] 自测自身不泄漏临时目录');
{
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-home-probe-'));
  const ok = fs.existsSync(probe);
  fs.rmSync(probe, { recursive: true, force: true });
  check('临时目录可创建且可清理', ok && !fs.existsSync(probe));
}

// 收尾：把自己造的两个临时目录删掉（否则每跑一次泄漏两个）
for (const d of [TMP_A, TMP_B]) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 已被占用则忽略 */ }
}

console.log(failed ? `\n自我检查失败：${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
