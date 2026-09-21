#!/usr/bin/env node
'use strict';
/*
 * bin/candidate-pool.js —— npm 包入口：A股次日候选池初筛
 * ---------------------------------------------------------------------------
 * 只有「装成依赖 / npx 运行」时才会走到这里（仓库内直接跑的是 gen_candidates.js）。
 * 唯一职责：把**默认工作目录**从「包目录」改成「当前目录」。
 *
 * 为什么必须改：paths.js 的默认 HOME 是包根 —— 那是为了保持「仓库内运行」的行为
 * 逐字节不变。但装进 node_modules 后包根是 <...>/node_modules/candidate-pool，
 * 沿用该默认值会把快照与报告写进**包目录**：重装即丢，npx 场景下跑完就消失。
 * 用户显式给了 CANDIDATE_POOL_HOME 或 --cwd 时一律不覆盖。
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
require('../gen_candidates.js');
