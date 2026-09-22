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
 *   否则网页拿到 `cut` 会 400「mode 只能为 formal / observe / intraday」，记录页也会把它兜底显示成「观察」。
 *   （2026-09-21 事故：当天 14:50 的正式运行就是这样写进去的。）
 */
const path = require('path');
const d1 = require('../../db/d1client');
const ddl = require('../../db/ddl');
const clients = require('../../db/clients');

/**
 * 本地内部口径 → D1/API 口径。`cut` 是本地对「14:50 固定口径」的旧叫法，对外一律叫 `formal`。
 * `intraday`（盘中滚动窗口近似）自 2026-09-22 起也合法入库（mode='intraday'），供报告查看页列出。
 * 未知口径直接抛错（宁可在同步这一步报出来，也不要往 D1 写第四种口径）。
 */
const D1_MODE = { cut: 'formal', formal: 'formal', observe: 'observe', intraday: 'intraday' };
function d1Mode(mode) {
  const m = D1_MODE[mode];
  if (!m) throw new Error(`未知尾盘口径「${mode}」：D1 只接受 formal / observe / intraday`);
  return m;
}

// 已确认「tail_run / tail_pick 就绪」的客户端集合。用 WeakSet 而不是一个布尔量：
// 尾盘现在可能同时写远程 D1 与本地 db/local.db（--both），两边的就绪状态必须各自记。
const _tablesReady = new WeakSet();
/**
 * 建表兜底（自愈）。DDL 不再硬编码在这里 —— 统一从 db/ddl.js 取，
 * 也就是 db/schema.sql（唯一真相源）。先花 1 次请求探 sqlite_master：
 * 已就绪就直接返回，缺表才整份重放（schema.sql 全 IF NOT EXISTS，可重复执行）。
 */
async function ensureTables(client) {
  if (_tablesReady.has(client)) return;
  try {
    const rows = await client.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tail_run','tail_pick')",
    );
    if (Array.isArray(rows) && rows.length >= 2) { _tablesReady.add(client); return; }
  } catch (_) {
    // 探测失败（权限 / 网络抖动）时不要直接放弃，交给下面的整份重放兜底
  }
  await client.batch(ddl.loadStatements().map((sql) => ({ sql })));
  _tablesReady.add(client);
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
 * 写入目标解析：**本地运行默认两边都写，GitHub Actions 默认只写远程**。
 *
 * | 场景                    | 远程 D1 | 本地 db/local.db |
 * |-------------------------|---------|------------------|
 * | 本机跑（默认）          | 写      | 写               |
 * | GitHub Actions（默认）  | 写      | 不写             |
 * | 显式 `--local`          | 不写    | 写               |
 * | 显式 `--both`           | 写      | 写               |
 *
 * 为什么本地默认要补写本地库：尾盘原先**只**写远程 D1，于是 db/local.db 的
 * tail_run / tail_pick 永远是 0 行（`db/clients.js` 的注释里记着同一个毛病：
 * 「本机日常任务与 CI 都走远程，于是 db/local.db 永远停在旧数据上」）。
 * 本机跑一次就顺手把本地库补齐，复盘 / 离线查询才用得上。
 * GitHub runner 上没有有意义的 db/local.db（每次都是全新容器），所以只写远程。
 */
function targetArgv(argv) {
  if (argv.includes('--local') || argv.includes('--both')) return argv;
  return process.env.GITHUB_ACTIONS ? argv : [...argv, '--both'];
}

/** 目标的中文名，用于日志（远程显示 D1，本地带上文件名）。 */
function targetLabel(t) {
  return t.name === 'remote' ? 'D1' : `本地 ${path.basename(t.file || 'local.db')}`;
}

/**
 * 把一次 EOD 运行结果同步到**数据源**（远程 D1 / 本地 db/local.db）。
 * 写入目标见 targetArgv()（本地默认两边、CI 只远程；`--local` / `--both` 可覆盖）。
 *
 * @param {object} doc 与 store.saveRun 返回 doc 同构：{ tradeDate, mode, cutAt, updatedAt, runs, stats, records }
 * @param {{argv?: string[]}} [opts] argv 默认 process.argv
 * @returns {{skipped?:boolean, reason?:string, run?:number, picks?:number, error?:string,
 *            results?: Array<{name:string, ok:boolean, file?:string, error?:string}>, notes?: string[]}}
 */
async function syncTailRun(doc, { argv = process.argv } = {}) {
  let built;
  try { built = buildStatements(doc); } catch (e) { return { error: e.message || String(e) }; }

  const { targets, notes } = clients.resolveTargets(targetArgv(argv));
  if (!targets.length) {
    return { skipped: true, reason: notes.join('；') || '没有可写入的目标' };
  }

  const results = [];
  for (const t of targets) {
    try {
      await ensureTables(t.client);
      await t.client.batch([built.runStmt, ...built.pickStmts]);
      results.push({ name: t.name, ok: true, file: t.file });
    } catch (e) {
      results.push({ name: t.name, ok: false, file: t.file, error: e.message || String(e) });
    }
  }
  // 一端成功就算成功（另一端失败只影响那一端；本地 JSON 归档始终在）
  if (!results.some((r) => r.ok)) {
    return { error: results.map((r) => `${targetLabel(r)}: ${r.error || '未知错误'}`).join('；'), results };
  }
  return { run: 1, picks: built.pickStmts.length, results, notes };
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
 * 与 store.applyFill 不同，这里写数据库（远程 D1 / 本地 db/local.db，目标同 syncTailRun），
 * 本地 JSON 归档由 P5 脚本负责。
 * @param {string} tradeDate
 * @param {string} mode
 * @param {Record<string, object>} patch code -> { close, n1..n10, filledAt }
 * @param {{argv?: string[]}} [opts]
 */
async function applyTailFill(tradeDate, mode, patch, { argv = process.argv } = {}) {
  if (!Object.keys(patch || {}).length) return { updated: 0 };
  let filled;
  try { filled = d1Mode(mode); } catch (e) { return { error: e.message || String(e) }; }

  const { targets, notes } = clients.resolveTargets(targetArgv(argv));
  if (!targets.length) return { skipped: true, reason: notes.join('；') || '没有可写入的目标' };

  const stmts = Object.entries(patch).map(([code, fill]) => ({
    sql: `UPDATE tail_pick SET fill_json = ? WHERE trade_date = ? AND mode = ? AND code = ?`,
    params: [j(fill), tradeDate, filled, code],
  }));

  const results = [];
  for (const t of targets) {
    try {
      await ensureTables(t.client);
      await t.client.batch(stmts);
      results.push({ name: t.name, ok: true, file: t.file, updated: stmts.length });
    } catch (e) {
      results.push({ name: t.name, ok: false, file: t.file, error: e.message || String(e) });
    }
  }
  if (!results.some((r) => r.ok)) {
    return { error: results.map((r) => `${targetLabel(r)}: ${r.error || '未知错误'}`).join('；'), results };
  }
  return { updated: stmts.length, results, notes };
}

/**
 * 清理历史遗留口径行：本地旧叫法 `cut` 曾被直接写进 D1（2026-09-21 的 14:50 正式运行），
 * 而 D1 / 网页 API 只认 formal / observe / intraday。补发前先删掉，否则同一天会出现
 * 「cut + formal」两条同义运行，记录页里那一天会重复一行。
 * （2026-09-22 起 intraday 也是合法口径，不能一刀切删掉非 formal/observe 的行。）
 * 与 syncTailRun 同样作用于所有写入目标。
 * @param {{argv?: string[]}} [opts]
 * @returns {{results: Array<{name:string, file?:string, deleted?:Record<string,number|string>, error?:string}>, notes?:string[]}}
 */
async function cleanupLegacyModes({ argv = process.argv } = {}) {
  const { targets, notes } = clients.resolveTargets(targetArgv(argv));
  if (!targets.length) return { skipped: true, reason: notes.join('；') || '没有可写入的目标' };

  const results = [];
  for (const t of targets) {
    const deleted = {};
    try {
      for (const tbl of ['tail_run', 'tail_pick']) {
        const r = await t.client.exec(`DELETE FROM ${tbl} WHERE mode NOT IN ('formal','observe','intraday')`);
        const n = r && r.meta && r.meta.changes;
        // 远程 D1 会回报 meta.changes；本地 node:sqlite 的 exec 不回传，退回 'ok'
        deleted[tbl] = n == null ? 'ok' : n;
      }
      results.push({ name: t.name, file: t.file, deleted });
    } catch (e) {
      results.push({ name: t.name, file: t.file, error: e.message || String(e) });
    }
  }
  return { results, notes };
}

// d1Mode / SQL / COLS 仅为自测（eod/lib/trading.selftest.js 第 9 节）导出，
// 业务代码不要用它们拼 SQL —— 走 syncTailRun / applyTailFill。
module.exports = {
  syncTailRun, applyTailFill, ensureTables, d1Mode, cleanupLegacyModes, buildStatements,
  targetArgv, targetLabel,
  SQL: { RUN_Q, PICK_Q }, COLS: { RUN_COLS, PICK_COLS },
};
