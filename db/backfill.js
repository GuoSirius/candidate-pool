'use strict';
// 历史回填：遍历 data/snapshot-*.json（覆盖全部历史运行），规范化后写入
//   Cloudflare D1（默认，不写本地）/ 本地 SQLite（--local）/ 两边都写（--both）。
// 也支持 --dry 仅解析统计、不接触网络。
//
// 全量幂等重放：run_batch UNIQUE(anchor_date)、pick_record UNIQUE(run_id,code)、
// price_daily UNIQUE(code,date)，重复运行不会重复插入 —— 因此「哪边落后就跑一次」即可追平。
const fs = require('fs');
const path = require('path');
const { normalizeSnap } = require('./normalize');
const { persistSnap } = require('./persist');
const { resolveTargets } = require('./clients');

const DATA = path.join(__dirname, '..', 'data');
const isDry = process.argv.includes('--dry');

function listSnaps() {
  if (!fs.existsSync(DATA)) return [];
  return fs.readdirSync(DATA).filter(f => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
}

(async () => {
  const files = listSnaps();
  if (!files.length) { console.log('[backfill] 无 snapshot 文件'); return; }

  const { targets, notes } = isDry ? { targets: [], notes: [] } : resolveTargets();
  for (const n of notes) console.log('[backfill] ' + n);
  if (!isDry && !targets.length) {
    console.log('[backfill] 未指定写入目标：--local 写本地 / --both 两边都写 / 配好 CF_* 凭据后默认写远程');
  }
  for (const t of targets) console.log(`[backfill] 写入目标 ${t.name}${t.file ? ' -> ' + t.file : ''}`);

  console.log(`[backfill] 发现 ${files.length} 份快照${isDry ? '（dry-run，不写库）' : ''}`);

  const totals = new Map();
  for (const t of targets) totals.set(t.name, { picks: 0, prices: 0, base: 0, fail: 0 });

  let totalPicks = 0, totalPrices = 0, totalBase = 0, parseFail = 0;
  for (const f of files) {
    const file = path.join(DATA, f);
    let snap;
    try { snap = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { console.log(`  ✗ ${f}: 解析失败 ${e.message}`); parseFail++; continue; }
    const { run, picks, prices, base } = normalizeSnap(snap);
    console.log(`  · ${run.anchor_date}  全池 ${run.universe_count}  重点 ${run.high_count} / 次级 ${run.secondary_count} / 条件 ${run.conditional_count} / 排除 ${run.excluded_count}  R01 ${run.r01_count} R07 ${run.r07_count} R05 ${run.r05_count}`);
    totalPicks += picks.length; totalPrices += prices.length; totalBase += base.length;

    for (const t of targets) {
      try {
        await persistSnap(snap, t.client);
        const acc = totals.get(t.name);
        acc.picks += picks.length; acc.prices += prices.length; acc.base += base.length;
      } catch (e) {
        console.log(`  ✗ ${f} → ${t.name}: 入库失败 ${e.message}`);
        totals.get(t.name).fail++;
      }
    }
  }
  for (const t of targets) if (t.client.close) t.client.close();

  console.log(`[backfill] 解析合计：picks=${totalPicks} prices=${totalPrices} base=${totalBase}${parseFail ? ` 解析失败 ${parseFail}` : ''}`);
  for (const [name, a] of totals) {
    const runs = files.length - parseFail - a.fail;
    console.log(`[backfill] ${name} 完成：runs=${runs} picks=${a.picks} prices=${a.prices} base=${a.base}${a.fail ? ` 失败 ${a.fail}` : ''}`);
  }
  if (!isDry && targets.length > 1) {
    console.log('[backfill] 提示：两端都写完后可跑 `node db/verify_sync.js` 核对指纹是否一致');
  }
})().catch(e => { console.error('[backfill] 中止:', e.message); process.exit(1); });
