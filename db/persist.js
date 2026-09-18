'use strict';
// 将规范化后的快照写入 Cloudflare D1（run_batch + pick_record + price_daily + stock_base）
// 幂等：同一锚定日重复跑不会重复插入（run_batch UNIQUE anchor_date；pick_record UNIQUE(run_id,code)）
const { normalizeSnap } = require('./normalize');

const RUN_Q = `INSERT OR IGNORE INTO run_batch
  (anchor_date,target_date,run_at,universe_count,r01_count,r07_count,r05_count,
   high_count,secondary_count,conditional_count,excluded_count,kline_fail_rate,source,note)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
const RUN_SEL = 'SELECT id FROM run_batch WHERE anchor_date=?';

const PICK_Q = `INSERT OR REPLACE INTO pick_record
  (run_id,anchor_date,code,name,sector,tier,r01_ok,r07_laggard,r05_partial,core,r01_chg,price,
   turnover,circ_market_cap,total_market_cap,sector_pct,sector_rank,reason,picked_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
const PRICE_Q = `INSERT OR REPLACE INTO price_daily
  (code,date,open,high,low,close,chg_pct,turnover,circ_market_cap,total_market_cap)
  VALUES (?,?,?,?,?,?,?,?,?,?)`;
const BASE_Q = `INSERT OR IGNORE INTO stock_base (code,name,sector,updated_at) VALUES (?,?,?,?)`;

async function persistSnap(snap, d1) {
  const { run, picks, prices, base } = normalizeSnap(snap);

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
      p.r05_partial, p.core, p.r01_chg, p.price, p.turnover, p.circ_market_cap,
      p.total_market_cap, p.sector_pct, p.sector_rank, p.reason, p.picked_at,
    ] });
  }
  for (const pr of prices) {
    stmts.push({ sql: PRICE_Q, params: [
      pr.code, pr.date, pr.open, pr.high, pr.low, pr.close, pr.chg_pct,
      pr.turnover, pr.circ_market_cap, pr.total_market_cap,
    ] });
  }
  for (const b of base) {
    stmts.push({ sql: BASE_Q, params: [b.code, b.name, b.sector, b.updated_at] });
  }
  await d1.batch(stmts);

  return { runId, picks: picks.length, prices: prices.length, base: base.length };
}

module.exports = { persistSnap };
