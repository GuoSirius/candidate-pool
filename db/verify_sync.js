'use strict';
// 一致性哨兵：比对「由快照派生的 4 张表」在远程 D1 与本地 db/local.db 上的指纹。
//
// 为什么可以直接比：
//   这 4 张表完全由 data/snapshot-*.json 派生，写入是「纯函数式规范化 + 幂等」
//   （UNIQUE(anchor_date) / UNIQUE(run_id,code) / UNIQUE(code,date) + run_at recency guard）。
//   因此两端只要回放过同一批快照，指纹必然逐字段相等；不相等就说明有一端没跟上。
//
// 不参与比对的表：watch_group / pick_group_rel / stock_note
//   —— 这三张由网页写接口产生，只存在于线上，本地库没有也不该有。
//
// 指纹一律用「整型化聚合」（金额 ×100、涨幅 ×1000 后 ROUND 求和），
// 避免两端浮点求和顺序不同导致末位差异误报。
//
// 退出码：0 = 全部一致；1 = 存在不一致或无法比对（可直接用于定时任务哨兵）。
const d1 = require('./d1client');
const localSqlite = require('./sqlite_client');

const CHECKS = [
  {
    table: 'run_batch',
    sql: `SELECT COUNT(*) AS 运行批次,
                 IFNULL(SUM(universe_count), 0) AS 全池合计,
                 IFNULL(SUM(r01_count + r07_count + r05_count), 0) AS 规则命中合计,
                 MAX(anchor_date) AS 最新锚定日
          FROM run_batch`,
  },
  {
    table: 'pick_record',
    sql: `SELECT COUNT(*) AS 入选记录,
                 COUNT(DISTINCT code) AS 入选个股,
                 COUNT(DISTINCT run_id) AS 覆盖批次,
                 IFNULL(SUM(CAST(ROUND(r01_chg * 1000) AS INTEGER)), 0) AS R01涨幅毫数和,
                 IFNULL(SUM(CAST(ROUND(price * 100) AS INTEGER)), 0) AS 入选价分和
          FROM pick_record`,
  },
  {
    table: 'price_daily',
    sql: `SELECT COUNT(*) AS 日线行数,
                 COUNT(DISTINCT code) AS 覆盖个股,
                 COUNT(DISTINCT date) AS 交易日数,
                 MIN(date) AS 首日,
                 MAX(date) AS 末日,
                 IFNULL(SUM(CAST(ROUND(close * 100) AS INTEGER)), 0) AS 收盘分和
          FROM price_daily`,
  },
  {
    table: 'stock_base',
    sql: `SELECT COUNT(*) AS 档案行数, COUNT(DISTINCT code) AS 档案个股 FROM stock_base`,
  },
];

const fmt = (v) => (v === null || v === undefined ? 'null' : String(v));

(async () => {
  if (!d1.cfg()) {
    console.error('[verify] 缺少 CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN，无法读取远程 D1');
    process.exit(1);
  }
  const local = localSqlite.createClient();
  console.log('[verify] 远程 D1 ←→ 本地 ' + local.file);
  console.log('');

  let bad = 0;
  const todo = [];
  for (const chk of CHECKS) {
    let remoteRow = null, localRow = null, err = '';
    try { remoteRow = (await d1.query(chk.sql))[0] || null; } catch (e) { err = '远程读取失败: ' + e.message; }
    try { localRow = (await local.query(chk.sql))[0] || null; } catch (e) { err = (err ? err + '；' : '') + '本地读取失败: ' + e.message; }

    if (err) {
      bad++;
      console.log(`  ${chk.table.padEnd(13)} FAIL  ${err}`);
      continue;
    }

    const keys = Object.keys(remoteRow);
    const diffs = [];
    const pairs = [];
    for (const k of keys) {
      const a = remoteRow[k] ?? null;
      const b = localRow ? (localRow[k] ?? null) : null;
      pairs.push(`${k}=${fmt(a)}|${fmt(b)}`);
      if (fmt(a) !== fmt(b)) diffs.push(`${k}(远程 ${fmt(a)} / 本地 ${fmt(b)})`);
    }
    if (diffs.length) {
      bad++;
      console.log(`  ${chk.table.padEnd(13)} FAIL  ${diffs.join('  ')}`);
      todo.push(chk.table);
    } else {
      console.log(`  ${chk.table.padEnd(13)} PASS  ${pairs.join('  ')}`);
    }
  }

  local.close();
  console.log('');
  if (bad) {
    console.log(`[verify] ${CHECKS.length} 张表中 ${bad} 张不一致：${todo.join(' / ')}`);
    console.log('[verify] 修复：node db/backfill.js --both   （全量幂等重放，落后的那一端会被补齐）');
    process.exit(1);
  }
  console.log(`[verify] 全部一致：${CHECKS.length}/${CHECKS.length} 张派生表逐字段相同`);
  process.exit(0);
})().catch((e) => {
  console.error('[verify] 中止:', e.message);
  process.exit(1);
});
