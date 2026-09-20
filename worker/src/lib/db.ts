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
function computePerf(
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
const RANK_SORTS: Record<string, string> = {
  recent: 'last_anchor', // 默认：最近入选的在前
  first: 'first_anchor',
  picks: 'picks',
  high: 'high',
  secondary: 'secondary',
  conditional: 'conditional',
  excluded: 'excluded',
  code: 'code',
};

/**
 * 全部入选股票汇总：按 code 聚合出「入选总次数 + 各档数量 + 首次/最近入选日」。
 * 一次 GROUP BY 出全部结果（数据量为百级），排序既可由 sort/order 指定，前端也可就地再排。
 */
export async function rankStocks(
  db: D1Database,
  opts: { sort?: string | null; order?: string | null; limit?: number } = {},
): Promise<StockRankRow[]> {
  const col = RANK_SORTS[opts.sort ?? 'recent'] ?? 'last_anchor';
  const dir = (opts.order ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(opts.limit ?? 1000, 1), 5000);
  return allRows<StockRankRow>(
    db,
    `SELECT code,
            MAX(name)   AS name,
            MAX(sector) AS sector,
            COUNT(*)    AS picks,
            SUM(CASE WHEN tier = 'high'        THEN 1 ELSE 0 END) AS high,
            SUM(CASE WHEN tier = 'secondary'   THEN 1 ELSE 0 END) AS secondary,
            SUM(CASE WHEN tier = 'conditional' THEN 1 ELSE 0 END) AS conditional,
            SUM(CASE WHEN tier = 'excluded'    THEN 1 ELSE 0 END) AS excluded,
            MIN(anchor_date) AS first_anchor,
            MAX(anchor_date) AS last_anchor
       FROM pick_record
      GROUP BY code
      ORDER BY ${col} ${dir}, code ASC
      LIMIT ?`,
    [limit],
  );
}
