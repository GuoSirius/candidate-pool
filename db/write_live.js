'use strict';
// 实时入库：读取「最近一次」快照，写入
//   Cloudflare D1（默认，不写本地）/ 本地 SQLite（--local）/ 两边都写（--both）。
// 由 run_today.cmd/sh 在 gen_candidates 之后链式调用 —— 本机任务用 --both，
// 这样一次运行就让本地库与线上库同时前进，不会出现「一边新一边旧」。
// 凭据缺失或入库失败时：打印告警并退出 0（不阻断报告生成本身）。
const fs = require('fs');
const path = require('path');
const { persistSnap } = require('./persist');
const { resolveTargets } = require('./clients');
const paths = require('../paths');

// 快照目录跟随工作目录（见 paths.js）：默认 <仓库根>/data
const DATA = paths.dataDir();

function latestSnap() {
  if (!fs.existsSync(DATA)) return null;
  const files = fs.readdirSync(DATA).filter(f => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) return null;
  return path.join(DATA, files[files.length - 1]);
}

(async () => {
  const { targets, notes } = resolveTargets();
  for (const n of notes) console.log('[db] ' + n);
  if (!targets.length) {
    console.log('[db] 未指定写入目标：--local 写本地 / --both 两边都写 / 配好 CF_* 凭据后默认写远程');
    process.exit(0);
  }
  for (const t of targets) console.log(`[db] 写入目标 ${t.name}${t.file ? ' -> ' + t.file : ''}`);

  const f = latestSnap();
  if (!f) { console.log('[db] 无 snapshot 可入库'); process.exit(0); }
  const snap = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log(`[db] 入库快照 ${path.basename(f)}（锚定日 ${snap.anchor}）`);

  let failed = 0;
  for (const t of targets) {
    try {
      const r = await persistSnap(snap, t.client);
      console.log(`[db] ${t.name} 完成 run_id=${r.runId} picks=${r.picks} prices=${r.prices} base=${r.base}`);
    } catch (e) {
      failed++;
      console.error(`[db] ${t.name} 入库失败（不影响报告）: ` + ((e && e.message) || e));
    }
  }
  for (const t of targets) if (t.client.close) t.client.close();

  if (failed) {
    console.error('[db] 单边补写：远程 `node db/write_live.js` ／ 本地 `node db/write_live.js --local`');
    console.error('[db] 若快照有缺漏（不止今天这一份），直接全量重放：`node db/backfill.js --both`');
  }
  process.exit(0);
})();
