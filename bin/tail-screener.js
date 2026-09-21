#!/usr/bin/env node
'use strict';
/*
 * bin/tail-screener.js —— npm 包入口：尾盘选股（EOD Tail Screener）
 * ---------------------------------------------------------------------------
 * 只有「装成依赖 / npx 运行」时才会走到这里（仓库内直接跑的是 eod/tail_screener.js）。
 * 职责与 bin/candidate-pool.js 完全一致：把默认工作目录从「包目录」改成「当前目录」，
 * 否则 eod/data 归档与 eod/reports 报告会被写进 node_modules 里的包目录。
 *
 * 尾盘脚本还跨目录依赖仓库根的 notify.js 与 db/ —— 打包时必须一并带上，
 * 这也是「全量打包」而不是「只打包 eod/」的原因。
 * ---------------------------------------------------------------------------
 */
const argv = process.argv.slice(2);
if (!process.env.CANDIDATE_POOL_HOME && !argv.includes('--cwd')) {
  process.env.CANDIDATE_POOL_HOME = process.cwd();
  process.stderr.write(
    `[home] 工作目录 = ${process.cwd()}（默认取当前目录；`
    + `可用 CANDIDATE_POOL_HOME 或 --cwd <dir> 覆盖，--paths 查看全部落点）\n`,
  );
}
require('../eod/tail_screener.js');
