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

/** 备注列表项（GET /api/notes，已联表带上股票名称/行业）。 */
export interface NoteListItem extends StockNote {
  name: string | null;
  sector: string | null;
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
  /**
   * 「最近一次入选」口径的 N1/N2/N3 收益（%）：只取 `last_anchor` 那一次入选，相对该次自身入选价计算。
   * 该次入选后第 N 个交易日的行情尚未出来（或该次缺入选价）时为 null。
   *
   * 与 n*_avg 的分工：avg = 跨时间平均，看长期靠不靠谱；last = 单次快照，看眼下什么状态。
   */
  last_n1: number | null;
  last_n2: number | null;
  last_n3: number | null;
}

export const TIER_LABELS: Record<Tier, string> = {
  high: '重点',
  secondary: '次级',
  conditional: '条件',
  excluded: '排除',
};

export const TIER_ORDER: Tier[] = ['high', 'secondary', 'conditional', 'excluded'];

// ---------------------------------------------------------------------------
// 尾盘选股（EOD Tail Screener）镜像类型：与 worker/src/types.ts 保持一致
// ---------------------------------------------------------------------------

/** 尾盘口径：formal = 收盘后固定口径；observe = 盘中观察口径。 */
export type TailMode = 'formal' | 'observe' | 'intraday';

/** 尾盘运行批次（解析自 tail_run 的 runs_json / stats_json）。 */
export interface TailRun {
  trade_date: string;
  mode: TailMode;
  cut_at: string | null;
  updated_at: string | null;
  run_at: string | null;
  candidate_count: number | null;
  group_count: number | null;
  pre_pass_count: number | null;
  snapshot_count: number | null;
  runner: string | null;
  /** 当日多次运行历史（解析自 runs_json） */
  runs: unknown[] | null;
  /** 初筛 / 漏斗统计（解析自 stats_json） */
  stats: TailRunStats | null;
}

/** 漏斗与统计（stats_json 结构，宽松类型）。 */
export interface TailRunStats {
  snapshotCount?: number;
  prePassCount?: number;
  preByReason?: Record<string, number>;
  minuteDropped?: number;
  tailByReason?: Record<string, number>;
  candidateCount?: number;
  groupCount?: number;
  [k: string]: unknown;
}

/** 收盘回填表现（解析自 tail_pick.fill_json）。 */
export interface TailFill {
  close: number | null;
  n1: number | null;
  n2: number | null;
  n3: number | null;
  n5: number | null;
  n7: number | null;
  n9: number | null;
  n10: number | null;
  filledAt: string | null;
}

/** 尾盘候选记录（tail_pick，与 worker 字段对齐；score / bars / fill 已解析）。 */
export interface TailPick {
  trade_date: string;
  mode: TailMode;
  code: string;
  name: string | null;
  sector: string | null;
  board: string | null;
  board_label: string | null;
  price: number | null;
  prev_close: number | null;
  high: number | null;
  chg_pct: number | null;
  turnover: number | null;
  vol_ratio: number | null;
  vol_ratio_est: number | null;
  float_cap_yi: number | null;
  avg_price: number | null;
  group_rank: number | null;
  best_in_group: number | null;
  group_size: number | null;
  total: number | null;
  sector_median_chg: number | null;
  sector_rank: number | null;
  sector_total: number | null;
  tail_seg_pct: number | null;
  tail_up_ratio: number | null;
  tail_max_drawdown_pct: number | null;
  tail_price_vs_avg_pct: number | null;
  tail_avg_at_cut: number | null;
  tail_p0: number | null;
  tail_p1: number | null;
  /** 尾盘段分钟序列（解析自 tail_bars） */
  tail_bars: number[] | null;
  /** 六项子分（解析自 score_json）：尾盘动能 / 量能 / 位置 / 均线 / 板块 / 换手适中度（已乘权重） */
  score: Record<string, number> | null;
  /** 收盘回填表现（解析自 fill_json） */
  fill: TailFill | null;
}

/** 尾盘候选 + N1~N10 复盘表现。 */
export interface TailPickRow extends TailPick {
  perf: Perf | null;
}

/** /api/tail/run 返回：运行批次 + 当日候选（带表现）。 */
export interface TailRunDetail {
  run: TailRun;
  picks: TailPickRow[];
}

/** /api/tail/review 的区间汇总（各周期胜率 / 均值）。 */
export interface TailReviewSummary {
  picks: number;
  n1: HorizonStat;
  n2: HorizonStat;
  n3: HorizonStat;
  n5: HorizonStat;
  n7: HorizonStat;
  n9: HorizonStat;
  n10: HorizonStat;
}

/** /api/tail/review 返回：候选明细 + 区间汇总。 */
export interface TailReviewResult {
  rows: TailPickRow[];
  summary: TailReviewSummary;
  range: { from: string | null; to: string | null; mode: TailMode };
}

/** /api/tail/diff 单只票对照行。 */
export interface TailDiffRow {
  code: string;
  name: string | null;
  sector: string | null;
  inObserve: boolean;
  inFormal: boolean;
  observeTotal: number | null;
  formalTotal: number | null;
  /** 总分差（formal - observe）；仅当两端都有时有效 */
  totalDelta: number | null;
  /** 复盘表现（优先 formal，否则 observe） */
  perf: Perf | null;
}

/** /api/tail/diff 返回：某交易日观察口径 vs 固定口径的对照。 */
export interface TailDiffResult {
  tradeDate: string;
  observe: TailPickRow[];
  formal: TailPickRow[];
  diff: TailDiffRow[];
}
