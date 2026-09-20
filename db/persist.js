'use strict';
// 将规范化后的快照写入 Cloudflare D1（run_batch + pick_record + price_daily + stock_base）
// 幂等：同一锚定日重复跑不会重复插入（run_batch UNIQUE anchor_date；pick_record UNIQUE(run_id,code)）
const { normalizeSnap } = require('./normalize');

const RUN_Q = `INSERT OR IGNORE INTO run_batch
  (anchor_date,target_date,run_at,universe_count,r01_count,r07_count,r05_count,
   high_count,secondary_count,conditional_count,excluded_count,kline_fail_rate,source,note)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
const RUN_SEL = 'SELECT id FROM run_batch WHERE anchor_date=?';

// 入选 / 行情写入采用「recency guard」而非 INSERT OR REPLACE：
//   同一锚定日若被本地与 GitHub 两端重复写入，仅当新快照的 run_at（数据生成时刻）≥ 已有值才覆盖，
//   避免「陈旧离线兜底数据」把「新鲜实时数据」顶掉（双写冲突的核心护栏之一）。
// 新行（无冲突）正常 INSERT；冲突且更新条件不满足时静默保留较新数据。
const PICK_Q = `INSERT INTO pick_record
  (run_id,anchor_date,code,name,sector,tier,r01_ok,r07_laggard,r05_partial,core,r01_chg,price,
   turnover,vol_ratio,circ_market_cap,total_market_cap,sector_pct,sector_rank,reason,picked_at,run_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(run_id, code) DO UPDATE SET
    name=excluded.name, sector=excluded.sector, tier=excluded.tier, r01_ok=excluded.r01_ok,
    r07_laggard=excluded.r07_laggard, r05_partial=excluded.r05_partial, core=excluded.core,
    r01_chg=excluded.r01_chg, price=excluded.price, turnover=excluded.turnover,
    vol_ratio=excluded.vol_ratio,
    circ_market_cap=excluded.circ_market_cap, total_market_cap=excluded.total_market_cap,
    sector_pct=excluded.sector_pct, sector_rank=excluded.sector_rank, reason=excluded.reason,
    picked_at=excluded.picked_at, run_at=excluded.run_at
  WHERE excluded.run_at >= pick_record.run_at OR pick_record.run_at IS NULL`;
const PRICE_Q = `INSERT INTO price_daily
  (code,date,open,high,low,close,chg_pct,turnover,circ_market_cap,total_market_cap,run_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(code, date) DO UPDATE SET
    open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
    chg_pct=excluded.chg_pct, turnover=excluded.turnover,
    circ_market_cap=excluded.circ_market_cap, total_market_cap=excluded.total_market_cap,
    run_at=excluded.run_at
  WHERE excluded.run_at >= price_daily.run_at OR price_daily.run_at IS NULL`;
const BASE_Q = `INSERT OR IGNORE INTO stock_base (code,name,sector,updated_at) VALUES (?,?,?,?)`;

// 惰性迁移：为既有 D1 / 本地 SQLite 补上 run_at 列（新库由 schema.sql 直接建好）。
// 两端都会跑，先到者成功、后到者捕获「列已存在」忽略即可。
let _migrated = false;
async function ensureColumns(client) {
  if (_migrated) return;
  _migrated = true;
  for (const sql of [
    'ALTER TABLE pick_record ADD COLUMN run_at TEXT',
    'ALTER TABLE pick_record ADD COLUMN vol_ratio REAL',
    'ALTER TABLE price_daily ADD COLUMN run_at TEXT',
  ]) {
    try { await client.query(sql); } catch (_) { /* 列已存在则忽略 */ }
  }
}

async function persistSnap(snap, d1) {
  const { run, picks, prices, base } = normalizeSnap(snap);
  await ensureColumns(d1);

  await d1.query(RUN_Q, [
    run.anchor_date, run.target_date, run.run_at, run.universe_count, run.r01_count,
    run.r07_count, run.r05_count, run.high_count, run.secondary_count,
    run.conditional_count, run.excluded_count, run.kline_fail_rate, run.source, run.note,
  ]);
  const rows = await d1.query(RUN_SEL, [run.anchor_date]);
  const runId = rows[0] && rows[0].id;
  if (!runId) throw new Error('无法获取 run_id: ' + run.anchor_date);

  const stmts = [];
  for (const p of picks) {
    stmts.push({ sql: PICK_Q, params: [
      runId, p.anchor_date, p.code, p.name, p.sector, p.tier, p.r01_ok, p.r07_laggard,
      p.r05_partial, p.core, p.r01_chg, p.price, p.turnover, p.vol_ratio, p.circ_market_cap,
      p.total_market_cap, p.sector_pct, p.sector_rank, p.reason, p.picked_at, run.run_at,
    ] });
  }
  for (const pr of prices) {
    stmts.push({ sql: PRICE_Q, params: [
      pr.code, pr.date, pr.open, pr.high, pr.low, pr.close, pr.chg_pct,
      pr.turnover, pr.circ_market_cap, pr.total_market_cap, run.run_at,
    ] });
  }
  for (const b of base) {
    stmts.push({ sql: BASE_Q, params: [b.code, b.name, b.sector, b.updated_at] });
  }
  await d1.batch(stmts);

  return { runId, picks: picks.length, prices: prices.length, base: base.length };
}

module.exports = { persistSnap };
