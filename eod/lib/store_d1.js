'use strict';
/*
 * eod/lib/store_d1.js —— 尾盘选股落库到 Cloudflare D1（FR-10 的「发布」一侧）
 * ---------------------------------------------------------------------------
 * 设计：本地 JSON（eod/lib/store.js）仍是**权威归档**；本模块把同一份 doc 同步到 D1，
 * 供网页端 /api/tail/* 读取。复用 db/d1client（与 backfill 同一套 HTTP API）。
 *
 * - 无 CF_* 凭据时静默跳过（本地开发 / 测试不污染远端）。
 * - 自带 ensureTables：**自愈兜底**。DDL 不再复制到这里，统一从 db/ddl.js
 *   （= db/schema.sql，唯一真相源）取；先探一次 sqlite_master，缺表才整份重放。
 *   因此即便没人跑过 `npm run db:migrate`，第一次带凭据的 EOD 运行也能把表建好。
 *   （2026-09-21 事故：此处原先硬编码了第二份 DDL，与 schema.sql 各写一份无人对齐，
 *     加上本地/远程都没有可靠的应用路径 → 线上根本没有 tail_run / tail_pick。）
 * - tail_pick 的 fill_json 用「空值保护」：传入空 {} 时不覆盖已回填的 fill，避免
 *   同日「EOD 重跑」把 P5 收盘回填的结果清掉（实际时序上 EOD 早于 P5，本保护是双保险）。
 */
const d1 = require('../../db/d1client');
const ddl = require('../../db/ddl');

let _tablesReady = false;
/**
 * 建表兜底（自愈）。DDL 不再硬编码在这里 —— 统一从 db/ddl.js 取，
 * 也就是 db/schema.sql（唯一真相源）。先花 1 次请求探 sqlite_master：
 * 已就绪就直接返回，缺表才整份重放（schema.sql 全 IF NOT EXISTS，可重复执行）。
 */
async function ensureTables(client) {
  if (_tablesReady) return;
  try {
    const rows = await client.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tail_run','tail_pick')",
    );
    if (Array.isArray(rows) && rows.length >= 2) { _tablesReady = true; return; }
  } catch (_) {
    // 探测失败（权限 / 网络抖动）时不要直接放弃，交给下面的整份重放兜底
  }
  await client.batch(ddl.loadStatements().map((sql) => ({ sql })));
  _tablesReady = true;
}

const RUN_Q = `INSERT INTO tail_run
  (trade_date, mode, cut_at, updated_at, run_at, candidate_count, group_count, pre_pass_count,
   snapshot_count, runner, runs_json, stats_json)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(trade_date, mode) DO UPDATE SET
    cut_at=excluded.cut_at, updated_at=excluded.updated_at, run_at=excluded.run_at,
    candidate_count=excluded.candidate_count, group_count=excluded.group_count,
    pre_pass_count=excluded.pre_pass_count, snapshot_count=excluded.snapshot_count,
    runner=excluded.runner, runs_json=excluded.runs_json, stats_json=excluded.stats_json`;

const PICK_Q = `INSERT INTO tail_pick
  (trade_date, mode, code, name, sector, board, board_label, price, prev_close, high, chg_pct,
   turnover, vol_ratio, vol_ratio_est, float_cap_yi, avg_price, group_rank, best_in_group,
   group_size, total, sector_median_chg, sector_rank, sector_total, tail_seg_pct, tail_up_ratio,
   tail_max_drawdown_pct, tail_price_vs_avg_pct, tail_avg_at_cut, tail_p0, tail_p1, tail_bars,
   score_json, fill_json)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(trade_date, mode, code) DO UPDATE SET
    name=excluded.name, sector=excluded.sector, board=excluded.board, board_label=excluded.board_label,
    price=excluded.price, prev_close=excluded.prev_close, high=excluded.high, chg_pct=excluded.chg_pct,
    turnover=excluded.turnover, vol_ratio=excluded.vol_ratio, vol_ratio_est=excluded.vol_ratio_est,
    float_cap_yi=excluded.float_cap_yi, avg_price=excluded.avg_price, group_rank=excluded.group_rank,
    best_in_group=excluded.best_in_group, group_size=excluded.group_size, total=excluded.total,
    sector_median_chg=excluded.sector_median_chg, sector_rank=excluded.sector_rank,
    sector_total=excluded.sector_total, tail_seg_pct=excluded.tail_seg_pct,
    tail_up_ratio=excluded.tail_up_ratio, tail_max_drawdown_pct=excluded.tail_max_drawdown_pct,
    tail_price_vs_avg_pct=excluded.tail_price_vs_avg_pct, tail_avg_at_cut=excluded.tail_avg_at_cut,
    tail_p0=excluded.tail_p0, tail_p1=excluded.tail_p1, tail_bars=excluded.tail_bars,
    score_json=excluded.score_json,
    fill_json = CASE WHEN excluded.fill_json IS NULL OR excluded.fill_json = '{}'
                     THEN tail_pick.fill_json ELSE excluded.fill_json END`;

function j(v) { return v == null ? null : JSON.stringify(v); }
function n(v) { return v == null ? null : v; }
function b1(v) { return v ? 1 : 0; }

/**
 * 把一次 EOD 运行结果同步到 Cloudflare D1。
 * @param {object} doc 与 store.saveRun 返回 doc 同构：{ tradeDate, mode, cutAt, updatedAt, runs, stats, records }
 * @returns {{skipped?:boolean, reason?:string, run?:number, picks?:number, error?:string}}
 */
async function syncTailRun(doc) {
  if (!d1.cfg()) {
    return { skipped: true, reason: '未配置 CF_* 凭据，跳过 D1 同步（本地 JSON 仍保留归档）' };
  }
  try {
    await ensureTables(d1);

    const lastRun = Array.isArray(doc.runs) && doc.runs.length ? doc.runs[doc.runs.length - 1] : null;
    const runAt = (lastRun && lastRun.at) || doc.updatedAt || null;
    const runStmt = {
      sql: RUN_Q,
      params: [
        doc.tradeDate, doc.mode, doc.cutAt ?? null, doc.updatedAt ?? null, runAt,
        Number(doc.stats?.candidateCount ?? 0), Number(doc.stats?.groupCount ?? 0),
        Number(doc.stats?.prePassCount ?? 0), Number(doc.stats?.snapshotCount ?? 0),
        runAt ? (lastRun && lastRun.runner) || 'local' : 'local',
        j(doc.runs), j(doc.stats),
      ],
    };

    const records = doc.records || {};
    const pickStmts = Object.values(records).map((r) => ({
      sql: PICK_Q,
      params: [
        doc.tradeDate, doc.mode, r.code, n(r.name), n(r.sector), n(r.board), n(r.boardLabel),
        n(r.price), n(r.prevClose), n(r.high), n(r.chgPct), n(r.turnover), n(r.volRatio),
        n(r.volRatioEst), n(r.floatCapYi), n(r.avgPrice), n(r.groupRank), b1(r.bestInGroup),
        n(r.groupSize), n(r.total), n(r.sectorMedianChg), n(r.sectorRank), n(r.sectorTotal),
        n(r.tail?.segPct), n(r.tail?.upRatio), n(r.tail?.maxDrawdownPct), n(r.tail?.priceVsAvgPct),
        n(r.tail?.avgAtCut), n(r.tail?.p0), n(r.tail?.p1), j(r.tail?.bars), j(r.score), j(r.fill),
      ],
    }));

    await d1.batch([runStmt, ...pickStmts]);
    return { run: 1, picks: pickStmts.length };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

/**
 * 收盘回填（P5）：把已算好的 N1~N10 表现写进某交易日的 tail_pick.fill_json。
 * 与 store.applyFill 不同，这里直接命中 D1（若凭据在），并保留本地 JSON 由 P5 脚本负责。
 * @param {string} tradeDate
 * @param {string} mode
 * @param {Record<string, object>} patch code -> { close, n1..n10, filledAt }
 */
async function applyTailFill(tradeDate, mode, patch) {
  if (!d1.cfg()) return { skipped: true, reason: '未配置 CF_* 凭据，跳过 D1 回填' };
  try {
    await ensureTables(d1);
    const stmts = Object.entries(patch).map(([code, fill]) => ({
      sql: `UPDATE tail_pick SET fill_json = ? WHERE trade_date = ? AND mode = ? AND code = ?`,
      params: [j(fill), tradeDate, mode, code],
    }));
    if (!stmts.length) return { updated: 0 };
    await d1.batch(stmts);
    return { updated: stmts.length };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

module.exports = { syncTailRun, applyTailFill, ensureTables };
