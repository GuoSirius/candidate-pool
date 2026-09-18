'use strict';
// 历史回填：遍历 data/snapshot-*.json（覆盖全部历史运行），规范化后写入
// Cloudflare D1（默认）或本地 SQLite（--local）。也支持 --dry 仅解析统计、不接触网络。
const fs = require('fs');
const path = require('path');
const { normalizeSnap } = require('./normalize');
const { persistSnap } = require('./persist');
const d1 = require('./d1client');
const localSqlite = require('./sqlite_client');

const DATA = path.join(__dirname, '..', 'data');
const isDry = process.argv.includes('--dry');
const isLocal = process.argv.includes('--local');

function listSnaps() {
  if (!fs.existsSync(DATA)) return [];
  return fs.readdirSync(DATA).filter(f => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
}

(async () => {
  const files = listSnaps();
  if (!files.length) { console.log('[backfill] 无 snapshot 文件'); return; }

  let client = null;
  if (isLocal) { client = localSqlite.createClient(); console.log(`[backfill] 本地 SQLite 模式 -> ${client.file}`); }
  else if (d1.cfg()) { client = d1; }
  else if (!isDry) {
    console.log('[backfill] 未配置 CF_API_TOKEN 且未指定 --local，跳过写库（--dry 仅统计 / --local 写本地 / 设置 CF_* 同步到 Cloudflare）');
  }

  console.log(`[backfill] 发现 ${files.length} 份快照${isDry ? '（dry-run，不写库）' : ''}`);

  let totalPicks = 0, totalPrices = 0, totalBase = 0, fail = 0;
  for (const f of files) {
    const file = path.join(DATA, f);
    let snap;
    try { snap = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { console.log(`  ✗ ${f}: 解析失败 ${e.message}`); fail++; continue; }
    const { run, picks, prices, base } = normalizeSnap(snap);
    console.log(`  · ${run.anchor_date}  全池 ${run.universe_count}  重点 ${run.high_count} / 次级 ${run.secondary_count} / 条件 ${run.conditional_count} / 排除 ${run.excluded_count}  R01 ${run.r01_count} R07 ${run.r07_count} R05 ${run.r05_count}`);
    totalPicks += picks.length; totalPrices += prices.length; totalBase += base.length;

    if (!isDry && client) {
      try { await persistSnap(snap, client); }
      catch (e) { console.log(`  ✗ ${f}: 入库失败 ${e.message}`); fail++; }
    }
  }
  if (client && client.close) client.close();
  console.log(`[backfill] 完成：runs=${files.length - fail} picks=${totalPicks} prices=${totalPrices} base=${totalBase}${fail ? ` 失败 ${fail}` : ''}`);
})().catch(e => { console.error('[backfill] 中止:', e.message); process.exit(1); });
