'use strict';
// 本地 SQLite 查询助手：把传入的 SQL 跑在 db/local.db 上并以表格打印。
// 用法：
//   node db/query_local.js                         # 打印内置概览（批次 / 分类分布）
//   node db/query_local.js "SELECT * FROM run_batch ORDER BY anchor_date"
//   node db/query_local.js "SELECT code,name,tier,reason FROM pick_record WHERE code='sz002594'"
// 仅允许读语句（SELECT/WITH），避免误改本地库。
const localSqlite = require('./sqlite_client');

const sql = process.argv.slice(2).join(' ').trim();
const client = localSqlite.createClient();

function table(rows) {
  if (!rows.length) { console.log('(空结果)'); return; }
  const cols = Object.keys(rows[0]);
  const w = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const sep = cols.map((c, i) => '-'.repeat(w[i])).join('-+-');
  console.log(cols.map((c, i) => String(c).padEnd(w[i])).join(' | '));
  console.log(sep);
  for (const r of rows) console.log(cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join(' | '));
}

(async () => {
  let rows;
  if (!sql) {
    console.log('=== 运行批次（run_batch）===');
    table(await client.query('SELECT anchor_date, universe_count, high_count, secondary_count, conditional_count, excluded_count FROM run_batch ORDER BY anchor_date'));
    console.log('\n=== 入选分类分布（pick_record）===');
    table(await client.query("SELECT tier, COUNT(*) c FROM pick_record GROUP BY tier ORDER BY c DESC"));
    const b = await client.query('SELECT COUNT(*) c FROM stock_base');
    console.log('\nstock_base 档案数:', (b[0] && b[0].c) || 0);
    // 多次入选（复盘重点）
    console.log('\n=== 多次入选的票（同票跨 run）===');
    table(await client.query("SELECT code, name, COUNT(DISTINCT run_id) runs, GROUP_CONCAT(DISTINCT anchor_date) dates FROM pick_record GROUP BY code HAVING runs > 1 ORDER BY runs DESC LIMIT 20"));
  } else {
    if (!/^\s*(SELECT|WITH|PRAGMA|EXPLAIN|VALUES)\b/i.test(sql)) {
      console.error('只允许只读查询（SELECT / WITH / PRAGMA）。'); process.exit(1);
    }
    rows = await client.query(sql);
    table(rows);
  }
  if (client.close) client.close();
})().catch(e => { console.error('查询失败:', e.message); process.exit(1); });
