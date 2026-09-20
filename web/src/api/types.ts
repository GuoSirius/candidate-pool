// 与 candidate-pool/worker/src/types.ts 保持一致的前端镜像类型。

export type Tier = 'high' | 'secondary' | 'conditional' | 'excluded';

/** 统一响应信封：code 为业务码（200=成功，非 200 为业务错误），data 为真实业务数据。 */
export interface ApiEnvelope<T = unknown> {
  code: number;
  message: string;
  data: T | null;
}

export interface RunBatch {
  id: number;
  anchor_date: string;
  target_date: string | null;
  run_at: string | null;
  universe_count: number | null;
  r01_count: number | null;
  r07_count: number | null;
  r05_count: number | null;
  high_count: number | null;
  secondary_count: number | null;
  conditional_count: number | null;
  excluded_count: number | null;
  kline_fail_rate: number | null;
  source: string | null;
  note: string | null;
}

export interface PickRecord {
  id: number;
  run_id: number;
  anchor_date: string;
  code: string;
  name: string | null;
  sector: string | null;
  tier: Tier;
  r01_ok: number;
  r07_laggard: number;
  r05_partial: number;
  core: number | null;
  r01_chg: number | null;
  price: number | null;
  turnover: number | null;
  vol_ratio: number | null;
  circ_market_cap: number | null;
  total_market_cap: number | null;
  sector_pct: number | null;
  sector_rank: number | null;
  reason: string | null;
  picked_at: string | null;
}

export interface StockBase {
  code: string;
  name: string | null;
  sector: string | null;
  concepts: string | null;
  region: string | null;
  main_business: string | null;
  top_business: string | null;
  updated_at: string | null;
}

export interface WatchGroup {
  id: number;
  name: string;
  color: string | null;
  description: string | null;
  created_at: string | null;
}

export interface StockNote {
  id: number;
  code: string;
  anchor_date: string | null;
  type: string | null;
  content: string;
  created_at: string | null;
}

/** N 日收益率（相对锚定日收盘价），单位 %，可能为空（数据缺失）。
 *  N = 相对锚定日（入选日）之后的第 N 个筛选周期/交易日。 */
export interface Perf {
  n1: number | null;
  n2: number | null;
  n3: number | null;
  n5: number | null;
  n7: number | null;
  n9: number | null;
  n10: number | null;
}

export interface StockHistory {
  base: StockBase | null;
  groups: WatchGroup[];
  notes: StockNote[];
  picks: Array<PickRecord & { perf: Perf | null }>;
}

/** 单个持有周期的命中统计（胜=收益 > 0）。 */
export interface HorizonStat {
  win: number;
  lose: number;
  samples: number;
  avg: number | null;
}

/** 某档位在 N1/N2/N3/N5/N7/N9/N10 上的表现（stats.tiers 中的 tier 必为四档之一）。 */
export interface TierStats {
  tier: Tier;
  picks: number;
  n1: HorizonStat;
  n2: HorizonStat;
  n3: HorizonStat;
  n5: HorizonStat;
  n7: HorizonStat;
  n9: HorizonStat;
  n10: HorizonStat;
}

export interface TimelinePoint {
  anchor_date: string;
  picks: number;
  n1_avg: number | null;
  n2_avg: number | null;
  n3_avg: number | null;
  n5_avg: number | null;
  n7_avg: number | null;
  n9_avg: number | null;
  n10_avg: number | null;
}

export interface StatsResult {
  total_runs: number;
  total_picks: number;
  overall: TierStats;
  tiers: TierStats[];
  timeline: TimelinePoint[];
  range: { from: string | null; to: string | null };
}

export const TIER_LABELS: Record<Tier, string> = {
  high: '重点',
  secondary: '次级',
  conditional: '条件',
  excluded: '排除',
};

export const TIER_ORDER: Tier[] = ['high', 'secondary', 'conditional', 'excluded'];
