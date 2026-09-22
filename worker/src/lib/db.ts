import type {
  RunBatch,
  PickRecord,
  StockBase,
  WatchGroup,
  StockNote,
  Perf,
  StockHistory,
  HorizonStat,
  TierStats,
  TimelinePoint,
  StatsResult,
  StockRankRow,
  TailRun,
  TailPick,
  TailPickRow,
  TailRunDetail,
  TailReviewResult,
  TailReviewSummary,
  TailDiffResult,
  TailDiffRow,
  TailFill,
  TailMode,
} from '../types.js';

const RUN_COLS =
  'id, anchor_date, target_date, run_at, universe_count, r01_count, r07_count, r05_count, high_count, secondary_count, conditional_count, excluded_count, kline_fail_rate, source, note';

async function allRows<T>(db: D1Database, sql: string, params: unknown[] = []): Promise<T[]> {
  const stmt = params.length ? db.prepare(sql).bind(...(params as unknown[])) : db.prepare(sql);
  const res = await stmt.all<T>();
  return (res.results as T[]) ?? [];
}

async function firstRow<T>(db: D1Database, sql: string, params: unknown[] = []): Promise<T | null> {
  const stmt = params.length ? db.prepare(sql).bind(...(params as unknown[])) : db.prepare(sql);
  const row = await stmt.first<T>();
  return (row as T) ?? null;
}

/** 供写接口模块复用同一套「取多行 / 取单行」封装，避免各文件各写一份。 */
export { allRows as queryAll, firstRow as queryOne };

export async function listRuns(db: D1Database, limit: number): Promise<RunBatch[]> {
  return allRows<RunBatch>(
    db,
    `SELECT ${RUN_COLS} FROM run_batch ORDER BY anchor_date DESC LIMIT ?`,
    [limit],
  );
}

export async function getRunByAnchor(db: D1Database, anchor: string): Promise<RunBatch | null> {
  return firstRow<RunBatch>(db, `SELECT ${RUN_COLS} FROM run_batch WHERE anchor_date = ?`, [anchor]);
}

const TIER_ORDER =
  "CASE tier WHEN 'high' THEN 0 WHEN 'secondary' THEN 1 WHEN 'conditional' THEN 2 ELSE 3 END";

export async function getPicks(db: D1Database, runId: number, tier?: string): Promise<PickRecord[]> {
  if (tier) {
    return allRows<PickRecord>(
      db,
      'SELECT * FROM pick_record WHERE run_id = ? AND tier = ? ORDER BY r01_chg DESC',
      [runId, tier],
    );
  }
  return allRows<PickRecord>(
    db,
    `SELECT * FROM pick_record WHERE run_id = ? ORDER BY ${TIER_ORDER}, r01_chg DESC`,
    [runId],
  );
}

/**
 * 计算某票相对入选价（锚定日收盘）的 N 日表现。
 * prices 为该票全部日线（升序）；找到锚定日所在行后，向后取 1/2/3/5/7/9/10 个交易日，
 * 用 (后价 - 入选价) / 入选价 算涨幅 %。缺数据返回 null。
 * N 表示相对锚定日之后的第 N 个筛选周期/交易日。
 */
export function computePerf(
  prices: Array<{ date: string; close: number }>,
  anchorDate: string,
  basePrice: number,
): Perf | null {
  if (!basePrice) return null;
  const sorted = [...prices].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const idx = sorted.findIndex((p) => p.date >= anchorDate);
  if (idx < 0) return null;
  const pct = (later: number | undefined): number | null => {
    if (later == null) return null;
    return Math.round(((later - basePrice) / basePrice) * 1000) / 10;
  };
  const at = (n: number) => sorted[idx + n]?.close;
  return {
    n1: pct(at(1)),
    n2: pct(at(2)),
    n3: pct(at(3)),
    n5: pct(at(5)),
    n7: pct(at(7)),
    n9: pct(at(9)),
    n10: pct(at(10)),
  };
}

export async function getStockHistory(db: D1Database, code: string): Promise<StockHistory | null> {
  const base = await firstRow<StockBase>(db, 'SELECT * FROM stock_base WHERE code = ?', [code]);
  const picks = await allRows<PickRecord>(
    db,
    'SELECT * FROM pick_record WHERE code = ? ORDER BY anchor_date DESC',
    [code],
  );
  if (!base && picks.length === 0) return null;

  const groups = await allRows<WatchGroup>(
    db,
    `SELECT g.* FROM watch_group g
     JOIN pick_group_rel r ON r.group_id = g.id
     WHERE r.code = ? ORDER BY g.name`,
    [code],
  );
  const notes = await allRows<StockNote>(
    db,
    'SELECT * FROM stock_note WHERE code = ? ORDER BY created_at DESC',
    [code],
  );
  const prices = await allRows<{ date: string; close: number }>(
    db,
    'SELECT date, close FROM price_daily WHERE code = ? ORDER BY date ASC',
    [code],
  );

  const picksWithPerf = picks.map((p) => ({
    ...p,
    perf: p.price != null ? computePerf(prices, p.anchor_date, p.price) : null,
  }));
  return { base, groups, notes, picks: picksWithPerf };
}

export async function searchStockBase(
  db: D1Database,
  opts: { q?: string | null; group?: string | null },
): Promise<Array<StockBase & { groups: string | null }>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.q) {
    where.push('(b.code LIKE ? OR b.name LIKE ?)');
    params.push(`%${opts.q}%`, `%${opts.q}%`);
  }
  if (opts.group) {
    where.push(
      'b.code IN (SELECT code FROM pick_group_rel WHERE group_id = (SELECT id FROM watch_group WHERE name = ?))',
    );
    params.push(opts.group);
  }
  const sql =
    'SELECT b.*, ' +
    '(SELECT GROUP_CONCAT(g.name) FROM pick_group_rel r JOIN watch_group g ON g.id = r.group_id WHERE r.code = b.code) AS groups ' +
    'FROM stock_base b' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY b.code LIMIT 500';
  return allRows<StockBase & { groups: string | null }>(db, sql, params);
}

export async function listGroups(db: D1Database): Promise<WatchGroup[]> {
  return allRows<WatchGroup>(db, 'SELECT * FROM watch_group ORDER BY name');
}

const TIERS = ['high', 'secondary', 'conditional', 'excluded'] as const;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function horizonStat(perfs: Array<Perf | null>, key: keyof Perf): HorizonStat {
  const vals: number[] = [];
  for (const p of perfs) {
    const v = p?.[key];
    if (v != null) vals.push(v);
  }
  if (!vals.length) return { win: 0, lose: 0, samples: 0, avg: null };
  let win = 0;
  let sum = 0;
  for (const v of vals) {
    sum += v;
    if (v > 0) win += 1;
  }
  return { win, lose: vals.length - win, samples: vals.length, avg: round1(sum / vals.length) };
}

function tierStat(tier: string, perfs: Array<Perf | null>): TierStats {
  return {
    tier,
    picks: perfs.length,
    n1: horizonStat(perfs, 'n1'),
    n2: horizonStat(perfs, 'n2'),
    n3: horizonStat(perfs, 'n3'),
    n5: horizonStat(perfs, 'n5'),
    n7: horizonStat(perfs, 'n7'),
    n9: horizonStat(perfs, 'n9'),
    n10: horizonStat(perfs, 'n10'),
  };
}

/**
 * 复盘统计：对区间内全部入选记录计算 N1/N2/N3/N5/N7/N9/N10 命中率与均值。
 * 复用 computePerf 的「按交易日偏移」口径，与个股详情页保持一致。
 * 为避免一次拉全表，price_daily 按入选代码分块（D1 绑定参数上限 100，分块取 90）取回后在内存分组。
 */
export async function getStats(
  db: D1Database,
  opts: { from?: string | null; to?: string | null },
): Promise<StatsResult> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.from) {
    where.push('anchor_date >= ?');
    params.push(opts.from);
  }
  if (opts.to) {
    where.push('anchor_date <= ?');
    params.push(opts.to);
  }
  const picks = await allRows<{ code: string; anchor_date: string; tier: string; price: number | null }>(
    db,
    'SELECT code, anchor_date, tier, price FROM pick_record' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY anchor_date ASC',
    params,
  );

  // 按代码分块取日线，再在内存里按 code 分组。
  // 注意：Cloudflare D1 单条 SQL 的「绑定参数」上限是 100（不是 SQLite 的 999），
  // 分块必须 ≤ 100；此处取 90 留余量，否则 code 一多，IN(?,?,…) 会直接抛错 → /api/stats 500。
  //
  // price_daily 按「全观察池 × 每个交易日」写入（约 377 行/交易日），会随时间持续增长。
  // 这里补一个下界：computePerf 只从锚定日**往后**取价，而所有锚定日都 ≥ opts.from，
  // 所以 date < from 的行永远用不到 —— 不加会白取「整段历史 × 全部入选代码」。
  const priceFrom = opts.from ?? null;
  const codes = Array.from(new Set(picks.map((p) => p.code)));
  const priceMap = new Map<string, Array<{ date: string; close: number }>>();
  const CHUNK = 90;
  for (let i = 0; i < codes.length; i += CHUNK) {
    const chunk = codes.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await allRows<{ code: string; date: string; close: number }>(
      db,
      `SELECT code, date, close FROM price_daily WHERE code IN (${placeholders})` +
        (priceFrom ? ' AND date >= ?' : '') +
        ' ORDER BY code, date ASC',
      priceFrom ? [...chunk, priceFrom] : chunk,
    );
    for (const r of rows) {
      const arr = priceMap.get(r.code);
      if (arr) arr.push({ date: r.date, close: r.close });
      else priceMap.set(r.code, [{ date: r.date, close: r.close }]);
    }
  }

  const rows = picks.map((p) => ({
    tier: p.tier,
    anchor_date: p.anchor_date,
    perf: p.price != null ? computePerf(priceMap.get(p.code) ?? [], p.anchor_date, p.price) : null,
  }));

  const overall = tierStat('all', rows.map((r) => r.perf));
  const tiers = TIERS.map((t) => tierStat(t, rows.filter((r) => r.tier === t).map((r) => r.perf)));

  const byDate = new Map<string, Array<Perf | null>>();
  for (const r of rows) {
    const arr = byDate.get(r.anchor_date);
    if (arr) arr.push(r.perf);
    else byDate.set(r.anchor_date, [r.perf]);
  }
  const timeline: TimelinePoint[] = Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([anchor_date, perfs]) => ({
      anchor_date,
      picks: perfs.length,
      n1_avg: horizonStat(perfs, 'n1').avg,
      n2_avg: horizonStat(perfs, 'n2').avg,
      n3_avg: horizonStat(perfs, 'n3').avg,
      n5_avg: horizonStat(perfs, 'n5').avg,
      n7_avg: horizonStat(perfs, 'n7').avg,
      n9_avg: horizonStat(perfs, 'n9').avg,
      n10_avg: horizonStat(perfs, 'n10').avg,
    }));

  return {
    total_runs: byDate.size,
    total_picks: rows.length,
    overall,
    tiers,
    timeline,
    range: { from: opts.from ?? null, to: opts.to ?? null },
  };
}

/** 排序键 → 真实列名（白名单，避免拼接注入）。 */
/**
 * `?sort=` 取值 → 实际排序字段。
 *
 * ⚠️ 这里是 sort 的**唯一真相来源**：`index.ts` 的路由用 RANK_SORT_KEYS 做白名单校验，
 * 新增取值只改这一处即可。
 *
 * 历史教训：文档（README + `GET /` 的 endpoints 列表）一直写着支持 `ln1|ln2|ln3`
 * （最近一次入选口径），但表里漏了这三个键 → `?? 'last_anchor'` 静默回落成
 * 「按最近入选日排序」。而最近锚定日的票恰好都还没走到第 1 个交易日、`last_n*` 全是 null，
 * 于是 `?sort=ln1` 返回的结果看起来就是「空值排在最前」，极具误导性。
 * 现在：白名单校验 + 缺失即抛，不再有任何静默回落。
 */
const RANK_SORTS: Record<string, keyof StockRankRow> = {
  recent: 'last_anchor', // 默认：最近入选的在前
  first: 'first_anchor',
  picks: 'picks',
  high: 'high',
  secondary: 'secondary',
  conditional: 'conditional',
  excluded: 'excluded',
  n1: 'n1_avg', // 历史平均口径
  n2: 'n2_avg',
  n3: 'n3_avg',
  ln1: 'last_n1', // 最近一次入选口径
  ln2: 'last_n2',
  ln3: 'last_n3',
  code: 'code',
};

/** 合法 `?sort=` 取值，供路由做白名单校验（拼错时报 10003，而不是悄悄换个口径）。 */
export const RANK_SORT_KEYS: string[] = Object.keys(RANK_SORTS);

/** 一组数的算术平均（保留 1 位）；无样本返回 null。 */
function mean(vals: number[]): number | null {
  if (!vals.length) return null;
  return round1(vals.reduce((a, b) => a + b, 0) / vals.length);
}

type RankAcc = {
  code: string;
  name: string | null;
  sector: string | null;
  picks: number;
  high: number;
  secondary: number;
  conditional: number;
  excluded: number;
  first_anchor: string;
  last_anchor: string;
  n1: number[];
  n2: number[];
  n3: number[];
  /** 最近一次入选（last_anchor）那次的 N1/N2/N3；未到期或缺数据为 null */
  last_n1: number | null;
  last_n2: number | null;
  last_n3: number | null;
};

/**
 * 全部入选股票汇总：按 code 聚合出「入选总次数 + 各档数量 + 首次/最近入选日 + N1/N2/N3 收益」。
 *
 * N1/N2/N3 同时给两种口径，前端可切换：
 * - `n*_avg`：该票每一次入选相对各自入选价的收益取算术平均（跨时间平均，看长期靠不靠谱）；
 * - `last_n*`：只取最近一次入选（`last_anchor`）那次的收益（单次快照，看眼下什么状态）。
 *
 * 为什么改成在 JS 里聚合而不是一条 GROUP BY：
 * 各周期的收益必须按「每次入选各自的入选价」逐条算（computePerf），
 * 这是 SQL 聚合表达不了的（要按日线偏移取第 N 个交易日）。数据量是百级，取回内存聚合最直接，
 * 而且与 /api/stats、个股详情页共用同一个 computePerf，口径不会分叉。
 *
 * price_daily 按代码分块取回（D1 单条语句绑定参数上限 100，取 90 留余量）。
 */
export async function rankStocks(
  db: D1Database,
  opts: { sort?: string | null; order?: string | null; limit?: number } = {},
): Promise<StockRankRow[]> {
  const picks = await allRows<{
    code: string;
    name: string | null;
    sector: string | null;
    tier: string;
    anchor_date: string;
    price: number | null;
  }>(
    db,
    'SELECT code, name, sector, tier, anchor_date, price FROM pick_record ORDER BY anchor_date ASC, code ASC',
  );

  const codes = Array.from(new Set(picks.map((p) => p.code)));
  const priceMap = new Map<string, Array<{ date: string; close: number }>>();
  const CHUNK = 90;
  for (let i = 0; i < codes.length; i += CHUNK) {
    const chunk = codes.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await allRows<{ code: string; date: string; close: number }>(
      db,
      `SELECT code, date, close FROM price_daily WHERE code IN (${placeholders}) ORDER BY code, date ASC`,
      chunk,
    );
    for (const r of rows) {
      const arr = priceMap.get(r.code);
      if (arr) arr.push({ date: r.date, close: r.close });
      else priceMap.set(r.code, [{ date: r.date, close: r.close }]);
    }
  }

  const acc = new Map<string, RankAcc>();
  for (const p of picks) {
    let a = acc.get(p.code);
    if (!a) {
      a = {
        code: p.code,
        name: null,
        sector: null,
        picks: 0,
        high: 0,
        secondary: 0,
        conditional: 0,
        excluded: 0,
        first_anchor: p.anchor_date,
        last_anchor: p.anchor_date,
        n1: [],
        n2: [],
        n3: [],
        last_n1: null,
        last_n2: null,
        last_n3: null,
      };
      acc.set(p.code, a);
    }

    // picks 已按 anchor_date 升序取回，因此「本行是否该票最近一次入选」用 >= 判定即可
    // （同一锚定日 + 同一代码只会有 1 条入选记录，>= 只是为重复数据留个确定性：后写入者胜）。
    const isLatest = p.anchor_date >= a.last_anchor;

    a.picks += 1;
    if (p.tier === 'high') a.high += 1;
    else if (p.tier === 'secondary') a.secondary += 1;
    else if (p.tier === 'conditional') a.conditional += 1;
    else if (p.tier === 'excluded') a.excluded += 1;
    if (p.anchor_date < a.first_anchor) a.first_anchor = p.anchor_date;
    if (p.anchor_date > a.last_anchor) a.last_anchor = p.anchor_date;
    if (p.name) a.name = p.name;
    if (p.sector) a.sector = p.sector;

    const perf = p.price != null ? computePerf(priceMap.get(p.code) ?? [], p.anchor_date, p.price) : null;
    if (perf) {
      if (perf.n1 != null) a.n1.push(perf.n1);
      if (perf.n2 != null) a.n2.push(perf.n2);
      if (perf.n3 != null) a.n3.push(perf.n3);
    }
    // 「最近一次入选」口径：三个周期整体取同一次入选，不跨次拼装
    // （否则可能出现 N1 来自甲的入选、N3 来自乙的入选，行内自相矛盾）。
    // 该次若还没走到第 N 个交易日（或该次缺入选价），对应周期诚实留 null → 前端显示 —。
    if (isLatest) {
      a.last_n1 = perf?.n1 ?? null;
      a.last_n2 = perf?.n2 ?? null;
      a.last_n3 = perf?.n3 ?? null;
    }
  }

  const rows: StockRankRow[] = Array.from(acc.values()).map((a) => ({
    code: a.code,
    name: a.name,
    sector: a.sector,
    picks: a.picks,
    high: a.high,
    secondary: a.secondary,
    conditional: a.conditional,
    excluded: a.excluded,
    first_anchor: a.first_anchor,
    last_anchor: a.last_anchor,
    n1_avg: mean(a.n1),
    n2_avg: mean(a.n2),
    n3_avg: mean(a.n3),
    n1_n: a.n1.length,
    n2_n: a.n2.length,
    n3_n: a.n3.length,
    last_n1: a.last_n1,
    last_n2: a.last_n2,
    last_n3: a.last_n3,
  }));

  const sortKey = opts.sort ?? 'recent';
  const col = RANK_SORTS[sortKey];
  // 路由已做白名单校验；这里断言只为「万一有别的调用方绕过路由」时不再静默排错
  // ——宁可 500 暴露出来，也不要悄悄换一个口径返回看似合理的顺序。
  if (!col) throw new Error(`未知排序键 ${sortKey}，合法值：${RANK_SORT_KEYS.join(' / ')}`);
  const dir = (opts.order ?? 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const limit = Math.min(Math.max(opts.limit ?? 1000, 1), 5000);

  rows.sort((x, y) => {
    const xv = x[col];
    const yv = y[col];
    // 空值恒排最后，不参与方向翻转（否则升序时空值会挤到最前面）
    const xNull = xv === null || xv === undefined;
    const yNull = yv === null || yv === undefined;
    if (xNull || yNull) return xNull && yNull ? 0 : xNull ? 1 : -1;
    const c =
      typeof xv === 'number' && typeof yv === 'number'
        ? xv - yv
        : String(xv) < String(yv)
          ? -1
          : String(xv) > String(yv)
            ? 1
            : 0;
    return c * dir || x.code.localeCompare(y.code);
  });

  return rows.slice(0, limit);
}

// ===========================================================================
// 尾盘选股（EOD Tail Screener）读接口
// ---------------------------------------------------------------------------
// tail_run / tail_pick 由 EOD 脚本（eod/lib/store_d1.js）写入 D1，本模块只负责读取。
// N1~N10 复盘：优先用 tail_pick.fill_json（P5 收盘回填已算好，零额外读），
// 缺回填时回退到 price_daily 现算 —— 两条路径口径一致（都走 computePerf）。
// ===========================================================================

function safeParse<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return null; }
}

const TAIL_RUN_COLS =
  'trade_date, mode, cut_at, updated_at, run_at, candidate_count, group_count, pre_pass_count, snapshot_count, runner, runs_json, stats_json';

/**
 * 口径别名：本地脚本内部把「14:50 固定口径」叫 `cut`（eod/lib/trading.js 的 `mode`，文件名分桶也按它走），
 * 而 D1 与网页 API 的统一口径是 formal / observe / intraday（见 db/schema.sql、types.ts 的 TailMode）。
 * 2026-09-21 当天的正式运行因此被写成 `cut`（同日已修 eod/lib/store_d1.js 的落库翻译）；
 * 读取时两种写法一并匹配、返回前归一到 `formal`，历史行才不会「在记录页显示成观察」或请求直接 10003。
 * 2026-09-22 起盘中滚动窗口口径 `intraday` 也合法入库（eod/tail_screener.js --intraday 直写）。
 */
const MODE_ALIAS: Record<TailMode, string[]> = {
  formal: ['formal', 'cut'],
  observe: ['observe'],
  intraday: ['intraday'],
};

/** 口径匹配片段（`mode = ?` 的别名展开），返回 SQL 片段与绑定参数。 */
function modeMatch(mode: TailMode): { sql: string; params: string[] } {
  const list = MODE_ALIAS[mode];
  return { sql: `mode IN (${list.map(() => '?').join(',')})`, params: list };
}

/** D1 里的口径值 → 对外统一口径（历史 `cut` 归一为 `formal`） */
function toTailMode(v: unknown): TailMode {
  if (v === 'observe') return 'observe';
  if (v === 'intraday') return 'intraday';
  return 'formal';
}

function mapTailRun(r: Record<string, unknown>): TailRun {
  return {
    trade_date: r.trade_date as string,
    mode: toTailMode(r.mode),
    cut_at: (r.cut_at as string) ?? null,
    updated_at: (r.updated_at as string) ?? null,
    run_at: (r.run_at as string) ?? null,
    candidate_count: (r.candidate_count as number) ?? null,
    group_count: (r.group_count as number) ?? null,
    pre_pass_count: (r.pre_pass_count as number) ?? null,
    snapshot_count: (r.snapshot_count as number) ?? null,
    runner: (r.runner as string) ?? null,
    runs: safeParse(r.runs_json),
    stats: safeParse(r.stats_json),
  };
}

function mapTailPick(r: Record<string, unknown>): TailPick {
  const fill = safeParse<TailFill>(r.fill_json);
  return {
    trade_date: r.trade_date as string,
    mode: toTailMode(r.mode),
    code: r.code as string,
    name: (r.name as string) ?? null,
    sector: (r.sector as string) ?? null,
    board: (r.board as string) ?? null,
    board_label: (r.board_label as string) ?? null,
    price: (r.price as number) ?? null,
    prev_close: (r.prev_close as number) ?? null,
    high: (r.high as number) ?? null,
    chg_pct: (r.chg_pct as number) ?? null,
    turnover: (r.turnover as number) ?? null,
    vol_ratio: (r.vol_ratio as number) ?? null,
    vol_ratio_est: (r.vol_ratio_est as number) ?? null,
    float_cap_yi: (r.float_cap_yi as number) ?? null,
    avg_price: (r.avg_price as number) ?? null,
    group_rank: (r.group_rank as number) ?? null,
    best_in_group: (r.best_in_group as number) ?? null,
    group_size: (r.group_size as number) ?? null,
    total: (r.total as number) ?? null,
    sector_median_chg: (r.sector_median_chg as number) ?? null,
    sector_rank: (r.sector_rank as number) ?? null,
    sector_total: (r.sector_total as number) ?? null,
    tail_seg_pct: (r.tail_seg_pct as number) ?? null,
    tail_up_ratio: (r.tail_up_ratio as number) ?? null,
    tail_max_drawdown_pct: (r.tail_max_drawdown_pct as number) ?? null,
    tail_price_vs_avg_pct: (r.tail_price_vs_avg_pct as number) ?? null,
    tail_avg_at_cut: (r.tail_avg_at_cut as number) ?? null,
    tail_p0: (r.tail_p0 as number) ?? null,
    tail_p1: (r.tail_p1 as number) ?? null,
    tail_bars: safeParse<number[]>(r.tail_bars),
    score: safeParse<Record<string, number>>(r.score_json),
    fill,
  };
}

/** fill_json 已回填（任一 N 值有效）则直接转 Perf，否则返回 null（交给 price_daily 现算）。 */
function fillToPerf(fill: TailFill | null): Perf | null {
  if (!fill) return null;
  const { n1, n2, n3, n5, n7, n9, n10 } = fill;
  if (n1 == null && n2 == null && n3 == null && n5 == null && n7 == null && n9 == null && n10 == null) return null;
  return { n1, n2, n3, n5, n7, n9, n10 };
}

/** 已回填优先；否则用尾盘入选价（price，14:50 截点价）作基准，从 price_daily 现算 N1~N10。 */
function perfOf(pick: TailPick, priceMap: Map<string, Array<{ date: string; close: number }>>): Perf | null {
  const fromFill = fillToPerf(pick.fill);
  if (fromFill) return fromFill;
  if (pick.price == null) return null;
  return computePerf(priceMap.get(pick.code) ?? [], pick.trade_date, pick.price);
}

/** 取多只票从某日期起的全段日线（按 code 分块，D1 绑定参数上限 100，取 90 留余量）。 */
async function fetchTailPrices(
  db: D1Database,
  codes: string[],
  fromDate: string,
): Promise<Map<string, Array<{ date: string; close: number }>>> {
  const map = new Map<string, Array<{ date: string; close: number }>>();
  if (!codes.length) return map;
  const CHUNK = 90;
  for (let i = 0; i < codes.length; i += CHUNK) {
    const chunk = codes.slice(i, i + CHUNK);
    const ph = chunk.map(() => '?').join(',');
    const rows = await allRows<{ code: string; date: string; close: number }>(
      db,
      `SELECT code, date, close FROM price_daily WHERE code IN (${ph}) AND date >= ? ORDER BY code, date ASC`,
      [...chunk, fromDate],
    );
    for (const r of rows) {
      const arr = map.get(r.code);
      if (arr) arr.push({ date: r.date, close: r.close });
      else map.set(r.code, [{ date: r.date, close: r.close }]);
    }
  }
  return map;
}

export async function listTailRuns(db: D1Database, limit: number, mode?: TailMode): Promise<TailRun[]> {
  const mm = mode ? modeMatch(mode) : null;
  const where = mm ? `WHERE ${mm.sql}` : '';
  const params: unknown[] = mm ? [...mm.params] : [];
  const rows = await allRows<Record<string, unknown>>(
    db,
    `SELECT ${TAIL_RUN_COLS} FROM tail_run ${where} ORDER BY trade_date DESC, mode DESC LIMIT ?`,
    [...params, limit],
  );
  return rows.map(mapTailRun);
}

export async function getTailRun(db: D1Database, tradeDate: string, mode: TailMode): Promise<TailRunDetail | null> {
  const mm = modeMatch(mode);
  const r = await firstRow<Record<string, unknown>>(
    db,
    `SELECT ${TAIL_RUN_COLS} FROM tail_run WHERE trade_date = ? AND ${mm.sql}`,
    [tradeDate, ...mm.params],
  );
  if (!r) return null;
  const picks = await allRows<Record<string, unknown>>(
    db,
    `SELECT * FROM tail_pick WHERE trade_date = ? AND ${mm.sql} ORDER BY total DESC`,
    [tradeDate, ...mm.params],
  );
  const mapped = picks.map(mapTailPick);
  const needCodes = Array.from(new Set(mapped.filter((p) => !fillToPerf(p.fill)).map((p) => p.code)));
  const priceMap = await fetchTailPrices(db, needCodes, tradeDate);
  return {
    run: mapTailRun(r),
    picks: mapped.map((p) => ({ ...p, perf: perfOf(p, priceMap) })),
  };
}

export async function tailReview(
  db: D1Database,
  opts: { from?: string | null; to?: string | null; mode: TailMode },
): Promise<TailReviewResult> {
  const mm = modeMatch(opts.mode);
  const where = [mm.sql];
  const params: unknown[] = [...mm.params];
  if (opts.from) { where.push('trade_date >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('trade_date <= ?'); params.push(opts.to); }
  const picks = await allRows<Record<string, unknown>>(
    db,
    `SELECT * FROM tail_pick WHERE ${where.join(' AND ')} ORDER BY trade_date DESC, total DESC`,
    params,
  );
  const mapped = picks.map(mapTailPick);
  const needCodes = Array.from(new Set(mapped.filter((p) => !fillToPerf(p.fill)).map((p) => p.code)));
  const priceMap = await fetchTailPrices(db, needCodes, opts.from ?? '1970-01-01');
  const rows: TailPickRow[] = mapped.map((p) => ({ ...p, perf: perfOf(p, priceMap) }));

  const summary: TailReviewSummary = {
    picks: rows.length,
    n1: horizonStat(rows.map((r) => r.perf), 'n1'),
    n2: horizonStat(rows.map((r) => r.perf), 'n2'),
    n3: horizonStat(rows.map((r) => r.perf), 'n3'),
    n5: horizonStat(rows.map((r) => r.perf), 'n5'),
    n7: horizonStat(rows.map((r) => r.perf), 'n7'),
    n9: horizonStat(rows.map((r) => r.perf), 'n9'),
    n10: horizonStat(rows.map((r) => r.perf), 'n10'),
  };
  return { rows, summary, range: { from: opts.from ?? null, to: opts.to ?? null, mode: opts.mode } };
}

export async function tailDiff(db: D1Database, tradeDate: string): Promise<TailDiffResult> {
  const oMatch = modeMatch('observe');
  const fMatch = modeMatch('formal');
  const [observe, formal] = await Promise.all([
    allRows<Record<string, unknown>>(db, `SELECT * FROM tail_pick WHERE trade_date = ? AND ${oMatch.sql} ORDER BY total DESC`, [tradeDate, ...oMatch.params]),
    allRows<Record<string, unknown>>(db, `SELECT * FROM tail_pick WHERE trade_date = ? AND ${fMatch.sql} ORDER BY total DESC`, [tradeDate, ...fMatch.params]),
  ]);
  const oMapped = observe.map(mapTailPick);
  const fMapped = formal.map(mapTailPick);
  const oMap = new Map(oMapped.map((p) => [p.code, p]));
  const fMap = new Map(fMapped.map((p) => [p.code, p]));
  const needCodes = Array.from(new Set([...oMapped, ...fMapped].filter((p) => !fillToPerf(p.fill)).map((p) => p.code)));
  const priceMap = await fetchTailPrices(db, needCodes, tradeDate);
  const oRows = oMapped.map((p) => ({ ...p, perf: perfOf(p, priceMap) }));
  const fRows = fMapped.map((p) => ({ ...p, perf: perfOf(p, priceMap) }));
  const codes = Array.from(new Set([...oMap.keys(), ...fMap.keys()]));
  const diff: TailDiffRow[] = codes.map((code) => {
    const o = oMap.get(code);
    const f = fMap.get(code);
    const base = f ?? o;
    return {
      code,
      name: base?.name ?? null,
      sector: base?.sector ?? null,
      inObserve: !!o,
      inFormal: !!f,
      observeTotal: o?.total ?? null,
      formalTotal: f?.total ?? null,
      totalDelta: o && f && o.total != null && f.total != null ? Math.round((f.total - o.total) * 10) / 10 : null,
      perf: base ? perfOf(base, priceMap) : null,
    };
  });
  return { tradeDate, observe: oRows, formal: fRows, diff };
}
