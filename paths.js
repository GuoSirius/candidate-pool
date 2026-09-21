'use strict';
/*
 * paths.js —— 工作目录（HOME）解析：把「代码」与「运行产物 / 配置」分开
 * ---------------------------------------------------------------------------
 * 为什么要有这一层：
 *   本项目历史上所有路径都锚在 `__dirname`（= 仓库结构）。这在「拉代码运行」下完全
 *   正确，但一旦装进 `node_modules/`（或 `npx` 的临时缓存目录），产物就会被写进**包目录
 *   本身**——重装即丢、npx 场景下更是跑完就消失；配置也无处可放。故引入一个可覆盖的 HOME。
 *
 * 解析优先级（一次解析后缓存）：
 *   1) setHome(dir)             —— 程序内显式指定（自测用）
 *   2) CANDIDATE_POOL_HOME      —— 环境变量（推荐，所有脚本都认）
 *   3) 命令行 --cwd <dir>        —— 入口脚本可直接传
 *   4) 包根（= 本文件所在目录）  —— **默认，与历史行为逐字节一致**
 *
 * HOME 之下保持与仓库**同样的相对布局**，于是「拉代码」与「装包」两种用法指向同一套
 * 相对路径，行为不会分叉：
 *   <HOME>/candidates.json            观察池（可编辑）
 *   <HOME>/data/snapshot-*.json       候选池快照
 *   <HOME>/reports/*.html             候选池报告
 *   <HOME>/notify_config.json         推送凭据
 *   <HOME>/eod/data/*.json            尾盘归档 + industry-map.json 缓存
 *   <HOME>/eod/reports/*.html         尾盘报告
 *   <HOME>/db/local.db                本地 SQLite
 *   <HOME>/db/.env                    D1 凭据
 *   <HOME>/.env                       （预留：通用环境变量，当前未使用）
 *
 * **不随 HOME 移动的（代码资产，永远跟包走，见 codeAsset()）**：
 *   db/schema.sql、db/migrations/、以及全部 .js —— 它们是程序的一部分，不是用户数据。
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

/** 包 / 仓库根（= 本文件所在目录）。代码资产的锚点，**永不**随 HOME 移动。 */
const PKG_ROOT = __dirname;

/** 从 argv 里取 `--cwd <dir>`（不改动各脚本已有的参数解析；两个入口都零改动就能认） */
function cwdFromArgv(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--cwd');
  if (i < 0) return null;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : null;
}

let _home = null;
let _source = null;

/** 当前工作目录（绝对路径）。解析一次后缓存；setHome(null) 可重置。 */
function home() {
  if (_home) return _home;
  const fromEnv = process.env.CANDIDATE_POOL_HOME;
  const fromArg = cwdFromArgv();
  _home = path.resolve(fromEnv || fromArg || PKG_ROOT);
  _source = fromEnv ? 'env:CANDIDATE_POOL_HOME' : (fromArg ? 'argv:--cwd' : 'pkg-root');
  return _home;
}

/** 显式指定 HOME；传 null / '' 清除覆盖并回到默认解析。返回生效值。 */
function setHome(dir) {
  _home = dir ? path.resolve(dir) : null;
  _source = dir ? 'setHome()' : null;
  return home();
}

/** HOME 的来源（诊断用）：pkg-root | env:CANDIDATE_POOL_HOME | argv:--cwd | setHome() */
function homeSource() { home(); return _source; }

/** 是否处于「重定位」状态（HOME 不是包根） */
function isRelocated() { return home() !== PKG_ROOT; }

const at = (...s) => path.join(home(), ...s);

// ---------- 工作区（随 HOME 移动）----------
const Home = {
  candidatesFile: () => at('candidates.json'),
  notifyConfigFile: () => at('notify_config.json'),
  dataDir: () => at('data'),
  reportsDir: () => at('reports'),
  eodDir: () => at('eod'),
  eodDataDir: () => at('eod', 'data'),
  eodReportsDir: () => at('eod', 'reports'),
  industryMapFile: () => at('eod', 'data', 'industry-map.json'),
  localDb: () => at('db', 'local.db'),
  dbEnvFile: () => at('db', '.env'),
};

// ---------- 代码资产（永远跟包走）----------
/** 包内的程序文件路径（schema.sql / migrations / 任意 .js） */
function codeAsset(...s) { return path.join(PKG_ROOT, ...s); }

/** 建目录（递归），返回该目录路径，便于链式使用 */
function ensureDir(dir) {
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 全部关键路径一览（`--paths` 与自测用） */
function describe() {
  return {
    home: home(),
    source: homeSource(),
    relocated: isRelocated(),
    pkgRoot: PKG_ROOT,
    workspace: {
      candidates: Home.candidatesFile(),
      notifyConfig: Home.notifyConfigFile(),
      data: Home.dataDir(),
      reports: Home.reportsDir(),
      eodData: Home.eodDataDir(),
      eodReports: Home.eodReportsDir(),
      industryMap: Home.industryMapFile(),
      localDb: Home.localDb(),
      dbEnv: Home.dbEnvFile(),
    },
    codeAssets: {
      schemaSql: codeAsset('db', 'schema.sql'),
      migrations: codeAsset('db', 'migrations'),
    },
  };
}

module.exports = {
  PKG_ROOT, home, setHome, homeSource, isRelocated, cwdFromArgv,
  ...Home, codeAsset, ensureDir, describe,
};
