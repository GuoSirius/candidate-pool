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

/** 全部入选股票汇总：按 code 聚合的入选次数、各档数量、入选时间范围与短周期表现。 */
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
  /**
   * 短周期平均涨跌幅（%）：把该票**每一次**入选相对各自入选价的 N1/N2/N3 收益取算术平均。
   * 口径与个股详情页「各周期复盘」一致；没有任何可用样本时为 null。
   */
  n1_avg: number | null;
  n2_avg: number | null;
  n3_avg: number | null;
  /** 上述三个平均各自的样本数（该票「该周期已有数据」的入选次数），可能互不相同。 */
  n1_n: number;
  n2_n: number;
  n3_n: number;
  /**
   * 短周期涨跌幅（%）的「最近一次入选」口径：只取 `last_anchor` 那一次入选，
   * 相对该次自身入选价（锚定日收盘）的 N1/N2/N3 收益。
   *
   * 与 n*_avg 的区别：avg 是跨时间平均（适合筛「长期靠不靠谱」），
   * last 是单次快照（适合看「这只票眼下什么状态」）。
   * 若该次入选距今天数不足 N 个交易日、或缺少入选价/日线，对应值为 null。
   */
  last_n1: number | null;
  last_n2: number | null;
  last_n3: number | null;
}
