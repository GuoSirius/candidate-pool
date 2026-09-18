'use strict';
// 实时入库：读取「最近一次」快照，写入 Cloudflare D1（默认）或本地 SQLite（--local）。
// 由 run_today.cmd/sh 在 gen_candidates 之后链式调用。
// 凭据缺失或入库失败时：打印告警并退出 0（不阻断报告生成本身）。
const fs = require('fs');
const path = require('path');
const { persistSnap } = require('./persist');
const d1 = require('./d1client');
const localSqlite = require('./sqlite_client');

const DATA = path.join(__dirname, '..', 'data');
const isLocal = process.argv.includes('--local');

function latestSnap() {
  if (!fs.existsSync(DATA)) return null;
  const files = fs.readdirSync(DATA).filter(f => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) return null;
  return path.join(DATA, files[files.length - 1]);
}

(async () => {
  let client;
  if (isLocal) {
    client = localSqlite.createClient();
    console.log(`[db] 本地 SQLite 模式 -> ${client.file}`);
  } else if (d1.cfg()) {
    client = d1;
  } else {
    console.log('[db] 未配置 CF_API_TOKEN 且未指定 --local，跳过入库（本地验证用 node db/write_live.js --local；同步 Cloudflare 请设置 CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN）');
    process.exit(0);
  }
  const f = latestSnap();
  if (!f) { console.log('[db] 无 snapshot 可入库'); process.exit(0); }
  const snap = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log(`[db] 入库快照 ${path.basename(f)}（锚定日 ${snap.anchor}）`);
  try {
    const r = await persistSnap(snap, client);
    console.log(`[db] 完成 run_id=${r.runId} picks=${r.picks} prices=${r.prices} base=${r.base}`);
    if (client.close) client.close();
  } catch (e) {
    console.error('[db] 入库失败（不影响报告）: ' + (e && e.message || e));
    process.exit(0);
  }
})();
