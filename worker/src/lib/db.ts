import type {
  RunBatch,
  PickRecord,
  StockBase,
  WatchGroup,
  StockNote,
  Perf,
  StockHistory,
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
 * prices 为该票全部日线（升序）；找到锚定日所在行后，向后取 1/3/5/10 个交易日，
 * 用 (后价 - 入选价) / 入选价 算涨幅 %。缺数据返回 null。
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
    n3: pct(at(3)),
    n5: pct(at(5)),
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
