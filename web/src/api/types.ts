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

/** 备注类型：comment = 评论，memo = 备忘（缺省 comment）。 */
export type NoteType = 'comment' | 'memo';

/** 分组内的成员（票 + 组内备注 + 入组时间）。 */
export interface GroupMember {
  code: string;
  name: string | null;
  sector: string | null;
  note: string | null;
  created_at: string | null;
}

/** 单个分组详情：组信息 + 成员列表。 */
export interface GroupDetail {
  group: WatchGroup;
  members: GroupMember[];
}

/** 新建分组的入参。 */
export interface GroupInput {
  name: string;
  color?: string | null;
  description?: string | null;
}

/** 更新分组：只传要改的字段；显式传 null 表示清空。 */
export interface GroupPatch {
  name?: string;
  color?: string | null;
  description?: string | null;
}

/** 新增备注的入参。 */
export interface NoteInput {
  code: string;
  content: string;
  type?: NoteType;
  /** 关联的入选锚定日；不传 = 通用备注 */
  anchor_date?: string | null;
}

/** 更新备注：只传要改的字段。 */
export interface NotePatch {
  content?: string;
  type?: NoteType;
  anchor_date?: string | null;
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

/** 全部入选股票汇总（按 code 聚合）：入选次数 + 各档数量 + 入选时间范围 + N1/N2/N3 平均涨跌幅。 */
export interface StockRankRow {
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
  /** 短周期平均涨跌幅（%）：该票每次入选相对各自入选价的 N1/N2/N3 收益取算术平均；无样本为 null */
  n1_avg: number | null;
  n2_avg: number | null;
  n3_avg: number | null;
  /** 上述平均各自的样本数（「该周期已有数据」的入选次数），三者可能不同 */
  n1_n: number;
  n2_n: number;
  n3_n: number;
}

export const TIER_LABELS: Record<Tier, string> = {
  high: '重点',
  secondary: '次级',
  conditional: '条件',
  excluded: '排除',
};

export const TIER_ORDER: Tier[] = ['high', 'secondary', 'conditional', 'excluded'];
