'use strict';
// 入库目标选择：把「写远程 D1 / 写本地 SQLite / 两边都写」收敛到一处，
// 供 backfill.js 与 write_live.js 共用（此前两边各写了一份互斥判断）。
//
// 为什么要有 --both：
//   两个库原本由「互斥分支」写入 —— 不加 --local 只写远程，加了只写本地，
//   一次运行只能写一边。而本机日常任务（run_today.*）与 GitHub 定时任务
//   （daily-screen.yml）走的都是远程，于是 db/local.db 永远停在旧数据上。
//   data/snapshot-*.json 是唯一真相来源，且 backfill 是「全量幂等重放」，
//   所以「谁落后就跑 --both 追平」就够了，不需要增量同步或差异比对。
const localSqlite = require('./sqlite_client');
const d1 = require('./d1client');

const has = (argv, flag) => argv.includes(flag);

/**
 * 解析命令行参数得出写入目标。
 *
 * | 参数      | 远程 D1        | 本地 db/local.db |
 * |-----------|----------------|------------------|
 * | （无）本机 | 写             | 写（2026-10-22 起，与 ops/01 文档表格及尾盘 targetArgv 口径对齐） |
 * | （无）CI  | 写             | 不写             |
 * | --local   | 不写           | 写               |
 * | --both    | 写             | 写               |
 *
 * 无显式参数时按「本机双写 / CI 只远程」取默认（判据 GITHUB_ACTIONS，
 * 与 eod/lib/store_d1.js::targetArgv 同一口径）——此前本机裸跑只写远程，
 * 导致本地库有尾盘数据却没有候选池快照，复盘缺半边。
 *
 * @param {string[]} argv 命令行参数，默认 process.argv
 * @returns {{targets: Array<{name: 'remote'|'local', client: object, file?: string}>, notes: string[]}}
 *   notes 是需要调用方打印的提示（例如缺少远程凭据）。
 */
function resolveTargets(argv = process.argv) {
  const explicit = has(argv, '--local') || has(argv, '--both');
  const wantLocal = explicit ? has(argv, '--local') || has(argv, '--both') : !process.env.GITHUB_ACTIONS;
  const wantRemote = has(argv, '--both') || !has(argv, '--local');
  const targets = [];
  const notes = [];

  if (wantRemote) {
    if (d1.cfg()) targets.push({ name: 'remote', client: d1 });
    else notes.push('未配置 CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN，跳过远程 D1（设 --local 只写本地，或配好凭据后重跑）');
  }

  if (wantLocal) {
    const client = localSqlite.createClient();
    targets.push({ name: 'local', client, file: client.file });
  }

  return { targets, notes };
}

module.exports = { resolveTargets };
