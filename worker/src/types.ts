/** Cloudflare Workers 通过 wrangler.toml 的 [[d1_databases]] 注入 D1 binding。 */
export interface Bindings {
  DB: D1Database;
  /**
   * 写接口共享令牌（机密变量，`wrangler secret put WRITE_TOKEN` 注入）。
   * 未配置时写接口一律拒绝（安全默认：宁可拒绝，也不「无令牌即放行」），见 lib/auth.ts。
   */
  WRITE_TOKEN?: string;
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
  tier: string;
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

/** 备注类型：comment = 评论，memo = 备忘。 */
export type NoteType = 'comment' | 'memo';

/** 分组内的成员（票 + 组内备注 + 入组时间） */
export interface GroupMember {
  code: string;
  name: string | null;
  sector: string | null;
  /** 入组备注（如加入该组的理由） */
  note: string | null;
  created_at: string | null;
}

/** 单个分组详情：组信息 + 成员列表。 */
export interface GroupDetail {
  group: WatchGroup;
  members: GroupMember[];
}

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

/** 某档位（或 overall）在 N1/N2/N3/N5/N7/N9/N10 上的表现。 */
export interface TierStats {
  tier: string;
  picks: number;
  n1: HorizonStat;
  n2: HorizonStat;
  n3: HorizonStat;
  n5: HorizonStat;
  n7: HorizonStat;
  n9: HorizonStat;
  n10: HorizonStat;
}

/** 时间线：每个锚定日的入选数与各周期平均收益。 */
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

/** 全部入选股票汇总：按 code 聚合的入选次数、各档数量与入选时间范围。 */
export interface StockRankRow {
  code: string;
  name: string | null;
  sector: string | null;
  /** 入选总次数（该票在 pick_record 中的记录数） */
  picks: number;
  high: number;
  secondary: number;
  conditional: number;
  excluded: number;
  /** 首次入选的锚定日 */
  first_anchor: string;
  /** 最近一次入选的锚定日 */
  last_anchor: string;
}
