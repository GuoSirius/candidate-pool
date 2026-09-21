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
 * - **口径必须翻译**：本地脚本内部把「14:50 固定口径」叫 `cut`（eod/lib/trading.js 的
 *   `mode`，也是文件名分桶依据 —— daySuffix('cut') === ''），而 D1 / 网页 API 只有
 *   formal / observe（db/schema.sql、worker/src/types.ts）。落库前统一走 d1Mode()，
 *   否则网页拿到 `cut` 会 400「mode 只能为 formal / observe」，记录页也会把它兜底显示成「观察」。
 *   （2026-09-21 事故：当天 14:50 的正式运行就是这样写进去的。）
 */
const d1 = require('../../db/d1client');
const ddl = require('../../db/ddl');

/**
 * 本地内部口径 → D1/API 口径。`cut` 是本地对「14:50 固定口径」的旧叫法，对外一律叫 `formal`。
 * 未知口径直接抛错（宁可在同步这一步报出来，也不要往 D1 写第三种口径）。
 */
const D1_MODE = { cut: 'formal', formal: 'formal', observe: 'observe' };
function d1Mode(mode) {
  const m = D1_MODE[mode];
  if (!m) throw new Error(`未知尾盘口径「${mode}」：D1 只接受 formal / observe`);
  return m;
}

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

// ---------------------------------------------------------------------------
// SQL：**列清单是唯一真相源**。占位符由列清单派生、参数按列清单顺序装填，
// 三者（列 / `?` / params）因此结构上不可能错位。
//
// 2026-09-21 事故复盘：tail_pick 的列清单有 33 列，但 VALUES 是手写的 32 个 `?`，
// 每条候选插入都报 `7500: 32 values for 33 columns`；而 db/d1client 的 batch 是
// 「分片 Promise.all」**不是事务**（tail_run 在第一批就已提交），于是每轮同步都是
// 「运行记录写进去了、候选一条没有」—— 网页主表 / 分行业明细 / 口径对照全空，
// 记录页只剩一行 mode 还是错的元数据。手写占位符必须和手写列清单同步维护，
// 这里改成派生，从根上消除这类错位。
// ---------------------------------------------------------------------------
const RUN_COLS = [
  'trade_date', 'mode', 'cut_at', 'updated_at', 'run_at', 'candidate_count',
  'group_count', 'pre_pass_count', 'snapshot_count', 'runner', 'runs_json', 'stats_json',
];
const PICK_COLS = [
  'trade_date', 'mode', 'code', 'name', 'sector', 'board', 'board_label', 'price',
  'prev_close', 'high', 'chg_pct', 'turnover', 'vol_ratio', 'vol_ratio_est', 'float_cap_yi',
  'avg_price', 'group_rank', 'best_in_group', 'group_size', 'total', 'sector_median_chg',
  'sector_rank', 'sector_total', 'tail_seg_pct', 'tail_up_ratio', 'tail_max_drawdown_pct',
  'tail_price_vs_avg_pct', 'tail_avg_at_cut', 'tail_p0', 'tail_p1', 'tail_bars',
  'score_json', 'fill_json',
];

function ph(cols) { return cols.map(() => '?').join(','); }

/**
 * 由列清单生成 UPSERT。冲突列不参与 SET，`except` 用于把需要特殊处理的列
 * （如 fill_json 的空值保护）排出手写 SET 列表，再由 `extra` 追加自定义表达式。
 */
function upsertSql(table, cols, pkCols, opts = {}) {
  const skip = new Set([...pkCols, ...(opts.except || [])]);
  const sets = cols.filter((c) => !skip.has(c)).map((c) => `${c}=excluded.${c}`);
  if (opts.extra) sets.push(opts.extra);
  return `INSERT INTO ${table} (${cols.join(',')})
  VALUES (${ph(cols)})
  ON CONFLICT(${pkCols.join(', ')}) DO UPDATE SET ${sets.join(',\n    ')}`;
}

const RUN_Q = upsertSql('tail_run', RUN_COLS, ['trade_date', 'mode']);

// tail_pick 的 fill_json 用「空值保护」：传入空 {} 时不覆盖已回填的 fill，避免
// 同日「EOD 重跑」把 P5 收盘回填的结果清掉（实际时序上 EOD 早于 P5，本保护是双保险）。
const PICK_Q = upsertSql('tail_pick', PICK_COLS, ['trade_date', 'mode', 'code'], {
  except: ['fill_json'],
  extra: `fill_json = CASE WHEN excluded.fill_json IS NULL OR excluded.fill_json = '{}'
                     THEN tail_pick.fill_json ELSE excluded.fill_json END`,
});

function j(v) { return v == null ? null : JSON.stringify(v); }
function n(v) { return v == null ? null : v; }
function b1(v) { return v ? 1 : 0; }
/** 按列清单顺序把行对象摊平成绑定参数；缺列一律 null（绝不静默少一个参数）。 */
function toParams(cols, row) { return cols.map((c) => (row[c] === undefined ? null : row[c])); }

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
    const { runStmt, pickStmts } = buildStatements(doc);
    await d1.batch([runStmt, ...pickStmts]);
    return { run: 1, picks: pickStmts.length };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

/**
 * 由存档 doc 构造要发给 D1 的语句（**纯函数，不联网**）。
 * 抽出来是为了让自检能在离线状态下断言「列数 = 占位符数 = params 数」——
 * 这正是 2026-09-21 那次「有运行记录、没有候选」事故的直接原因。
 * @param {object} doc 同 store.saveRun 的返回 doc
 * @returns {{runStmt: {sql:string, params:any[]}, pickStmts: {sql:string, params:any[]}[]}}
 */
function buildStatements(doc) {
  const lastRun = Array.isArray(doc.runs) && doc.runs.length ? doc.runs[doc.runs.length - 1] : null;
  const runAt = (lastRun && lastRun.at) || doc.updatedAt || null;
  const mode = d1Mode(doc.mode);
  const runRow = {
    trade_date: doc.tradeDate, mode, cut_at: doc.cutAt ?? null, updated_at: doc.updatedAt ?? null,
    run_at: runAt,
    candidate_count: Number(doc.stats?.candidateCount ?? 0),
    group_count: Number(doc.stats?.groupCount ?? 0),
    pre_pass_count: Number(doc.stats?.prePassCount ?? 0),
    snapshot_count: Number(doc.stats?.snapshotCount ?? 0),
    runner: (lastRun && lastRun.runner) || 'local',
    runs_json: j(doc.runs), stats_json: j(doc.stats),
  };
  const runStmt = { sql: RUN_Q, params: toParams(RUN_COLS, runRow) };

  const records = doc.records || {};
  const pickStmts = Object.values(records).map((r) => {
    const row = {
      trade_date: doc.tradeDate, mode, code: r.code, name: n(r.name), sector: n(r.sector),
      board: n(r.board), board_label: n(r.boardLabel), price: n(r.price), prev_close: n(r.prevClose),
      high: n(r.high), chg_pct: n(r.chgPct), turnover: n(r.turnover), vol_ratio: n(r.volRatio),
      vol_ratio_est: n(r.volRatioEst), float_cap_yi: n(r.floatCapYi), avg_price: n(r.avgPrice),
      group_rank: n(r.groupRank), best_in_group: b1(r.bestInGroup), group_size: n(r.groupSize),
      total: n(r.total), sector_median_chg: n(r.sectorMedianChg), sector_rank: n(r.sectorRank),
      sector_total: n(r.sectorTotal), tail_seg_pct: n(r.tail?.segPct),
      tail_up_ratio: n(r.tail?.upRatio), tail_max_drawdown_pct: n(r.tail?.maxDrawdownPct),
      tail_price_vs_avg_pct: n(r.tail?.priceVsAvgPct), tail_avg_at_cut: n(r.tail?.avgAtCut),
      tail_p0: n(r.tail?.p0), tail_p1: n(r.tail?.p1), tail_bars: j(r.tail?.bars),
      score_json: j(r.score), fill_json: j(r.fill),
    };
    return { sql: PICK_Q, params: toParams(PICK_COLS, row) };
  });
  return { runStmt, pickStmts };
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
      params: [j(fill), tradeDate, d1Mode(mode), code],
    }));
    if (!stmts.length) return { updated: 0 };
    await d1.batch(stmts);
    return { updated: stmts.length };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

/**
 * 清理历史遗留口径行：本地旧叫法 `cut` 曾被直接写进 D1（2026-09-21 的 14:50 正式运行），
 * 而 D1 / 网页 API 只认 formal / observe。补发前先删掉，否则同一天会出现
 * 「cut + formal」两条同义运行，记录页里那一天会重复一行。
 * @returns {Promise<Record<string, number|string>>} 表名 -> 删除行数
 */
async function cleanupLegacyModes() {
  if (!d1.cfg()) return { skipped: true, reason: '未配置 CF_* 凭据，跳过遗留口径清理' };
  const res = {};
  for (const t of ['tail_run', 'tail_pick']) {
    try {
      const r = await d1.exec(`DELETE FROM ${t} WHERE mode NOT IN ('formal','observe')`);
      res[t] = (r && r.meta && r.meta.changes) || 0;
    } catch (e) {
      res[t] = `失败：${e.message || e}`;
    }
  }
  return res;
}

// d1Mode / SQL / COLS 仅为自测（eod/lib/trading.selftest.js 第 9 节）导出，
// 业务代码不要用它们拼 SQL —— 走 syncTailRun / applyTailFill。
module.exports = {
  syncTailRun, applyTailFill, ensureTables, d1Mode, cleanupLegacyModes, buildStatements,
  SQL: { RUN_Q, PICK_Q }, COLS: { RUN_COLS, PICK_COLS },
};
