// 规则 / 档位 / N 日周期 / 字段释义的**唯一事实来源**（Single Source of Truth）。
// 候选列表（RunsView）、复盘统计（StatsView）、规则释义（RulesView）、个股复盘（StockView）
// 一律引用此处，避免各页口径漂移（例如有的页面只写 n1/n3/n5）。
//
// 内容与 README「规则速览」、db/schema.sql、gen_candidates.js 的判定口径严格对齐。

import type { Tier, TimelinePoint } from '../api/types';

// —————————————————————————— N 日周期 ——————————————————————————

/** 全部观察周期：N1 / N2 / N3 / N5 / N7 / N9 / N10（与 worker computePerf 输出一致）。 */
export const HORIZONS = ['n1', 'n2', 'n3', 'n5', 'n7', 'n9', 'n10'] as const;
export type Horizon = (typeof HORIZONS)[number];

/** 短周期（入选后 3 个交易日内）与长周期分组，供走势图快捷选段使用。 */
export const H_SHORT: Horizon[] = ['n1', 'n2', 'n3'];
export const H_LONG: Horizon[] = ['n5', 'n7', 'n9', 'n10'];

export const H_LABEL: Record<Horizon, string> = {
  n1: 'N1',
  n2: 'N2',
  n3: 'N3',
  n5: 'N5',
  n7: 'N7',
  n9: 'N9',
  n10: 'N10',
};

/** 该周期对应的交易日偏移（N = 锚定日之后第 N 个交易日）。 */
export const H_OFFSET: Record<Horizon, number> = {
  n1: 1,
  n2: 2,
  n3: 3,
  n5: 5,
  n7: 7,
  n9: 9,
  n10: 10,
};

/** StatsResult.timeline 上的均值字段名（显式映射，避免模板字符串索引带来的类型风险）。 */
export const H_AVG_KEY: Record<Horizon, keyof TimelinePoint> = {
  n1: 'n1_avg',
  n2: 'n2_avg',
  n3: 'n3_avg',
  n5: 'n5_avg',
  n7: 'n7_avg',
  n9: 'n9_avg',
  n10: 'n10_avg',
};

/** 取某时间线点在指定周期上的均值（%），无数据返回 null。 */
export function timelineAvg(p: TimelinePoint, h: Horizon): number | null {
  const v = p[H_AVG_KEY[h]];
  return typeof v === 'number' ? v : null;
}

/** 折线配色：按 N 由短到长色相递进。仅作「序列区分」，与红涨绿跌（涨跌语义）无关。 */
export const H_COLOR: Record<Horizon, string> = {
  n1: '#ff7b72',
  n2: '#ffa657',
  n3: '#e3b341',
  n5: '#7ee787',
  n7: '#56d4dd',
  n9: '#79c0ff',
  n10: '#d2a8ff',
};

/** N 日口径的完整说明（长版，讲清「N 是什么、收益怎么算」）。 */
export const HORIZON_NOTE =
  'N = 相对锚定日（入选日）之后的第 N 个筛选周期 / 交易日；收益 = (该日收盘 − 入选价) ÷ 入选价，入选价取锚定日收盘价。例如想看「入选后 3 日内」的表现，就重点比较 N1 / N2 / N3（N1 即入选后的下一个交易日）。数据缺失显示 —。';

/** N 日口径的一句话版（列表 / 详情页脚注用）。 */
export const HORIZON_NOTE_SHORT = 'N = 锚定日之后的第 N 个交易日；收益 = (该日收盘 − 入选价) ÷ 入选价，入选价取锚定日收盘。';

// —————————————————————————— 三条规则 ——————————————————————————

export interface RuleDef {
  id: string;
  name: string;
  desc: string;
  gates: string[];
}

/** R01 / R07 / R05：初筛三条规则及其门槛。 */
export const RULES: RuleDef[] = [
  {
    id: 'R01',
    name: '量能验证突破',
    desc: '量价齐升的突破形态，是「重点 / 次级 / 条件」三档的唯一判定主线。',
    gates: [
      'C1 成交量 ≥ 近 5 日均量 150%（即量比 ≥ 1.5）',
      'C2 收盘价突破前 10 日最高',
      'C3 当日涨幅 3%–8%',
      'C4 换手率 ≥ 3%',
      '市值 20–500 亿（流通 / 总市值同时校验）',
      '未处于 52 周高位区',
    ],
  },
  {
    id: 'R07',
    name: '板块内补涨',
    desc: '强势板块里相对滞涨的标的，等待补涨空间（独立维度，与 R01 无关）。',
    gates: [
      '所属申万一级行业当日涨幅居前 10%',
      '个股当日涨幅 < 行业涨幅的一半',
      '行业样本建议 ≥ 5 只，否则判定无意义（脚本会告警）',
    ],
  },
  {
    id: 'R05',
    name: '尾盘异动',
    desc: '尾盘资金抢筹信号（独立维度，与 R01 无关）。',
    gates: [
      '14:30–15:00 涨幅 ≥ 2%',
      '尾盘量能占比 ≥ 20%',
      '全天涨幅 < 7%',
      '分时接口仅返回最新交易日，历史锚定日标注为「数据缺口」而非信号缺失',
    ],
  },
];

// —————————————————————————— 四档分类 ——————————————————————————

export interface TierDef {
  key: Tier;
  label: string;
  desc: string;
  cond: string;
}

/** 四档：仅表示 R01 梯队；R07 / R05 是并列的独立维度。 */
export const TIERS: TierDef[] = [
  {
    key: 'high',
    label: '重点',
    desc: 'R01 四道门槛（C1–C4）全部达标，量价突破最完整。',
    cond: 'r01_ok = 1（core = 4）',
  },
  {
    key: 'secondary',
    label: '次级',
    desc: 'R01 核心项达成 ≥ 3 项，且市值 / 高位区达标。',
    cond: 'core ≥ 3 且市值/高位达标',
  },
  {
    key: 'conditional',
    label: '条件',
    desc: 'R01 核心项达成 ≥ 2 项，且市值 / 高位区达标。',
    cond: 'core ≥ 2 且市值/高位达标',
  },
  {
    key: 'excluded',
    label: '排除',
    desc: '未达任何 R01 梯队；但只要触发 R07 / R05 仍会被记录（用独立维度标出）。',
    cond: 'r07_laggard / r05_partial 可能为 1',
  },
];

/** 档位标签速查：`重点 / 次级 / 条件 / 排除`。 */
export const TIER_LABEL_OF: Record<Tier, string> = {
  high: '重点',
  secondary: '次级',
  conditional: '条件',
  excluded: '排除',
};

// —————————————————————————— 标记位 ——————————————————————————

export interface FlagDef {
  k: string;
  t: string;
  d: string;
}

/** 记录里的判定标记位（三规则 + R01 核心项计数）。 */
export const RULE_FLAGS: FlagDef[] = [
  { k: 'r01_ok', t: 'R01 命中', d: '1 = R01 四道门槛全达标，直接进「重点」档。' },
  { k: 'core', t: 'R01 核心项计数', d: 'C1–C4 的达成项数（0–4），是「次级 / 条件」分档依据：≥3 → 次级，≥2 → 条件。' },
  { k: 'r07_laggard', t: 'R07 命中', d: '1 = 触发「板块内补涨」。与档位无关，排除档也可能为 1。' },
  { k: 'r05_partial', t: 'R05 命中', d: '1 = 触发「尾盘异动」。与档位无关，排除档也可能为 1。' },
  { k: 'tier', t: '档位', d: 'high / secondary / conditional / excluded，**仅反映 R01 梯队**，不代表综合推荐度。' },
  { k: 'reason', t: '入选理由', d: '脚本按命中的规则与门槛生成的说明文本。' },
];

// —————————————————————————— 列表字段 ——————————————————————————

/** 候选列表 / 个股页字段释义。 */
export const FIELDS: FlagDef[] = [
  { k: 'code', t: '代码', d: '沪深京 6 位代码。' },
  { k: 'name', t: '名称', d: '以行情接口返回为准。' },
  { k: 'sector', t: '板块', d: '所属申万一级行业。' },
  { k: 'price', t: '价格', d: '锚定日收盘价，也是 N 日收益的计算基准（入选价）。' },
  { k: 'r01_chg', t: 'R01 涨跌', d: '锚定日当日涨幅 %（R01 口径）。' },
  { k: 'turnover', t: '换手率', d: '当日换手率 %（成交量 ÷ 流通股本）。' },
  { k: 'vol_ratio', t: '量比', d: '当日成交量 ÷ 近 5 日均量，与 R01 C1 同一口径（≥ 1.5 视为放量）。' },
  { k: 'circ_market_cap', t: '流通市值', d: '单位元，前端按亿 / 万换算展示。' },
  { k: 'total_market_cap', t: '总市值', d: '单位元，前端按亿 / 万换算展示。' },
  { k: 'sector_pct', t: '板块强度', d: '所属申万一级行业当日涨幅中位数 %。' },
  { k: 'sector_rank', t: '板块排名', d: '该行业当日涨幅在全行业中的名次（越小越强）。' },
];

// —————————————————————————— 统计口径 ——————————————————————————

/** 复盘统计页的指标口径。 */
export const STAT_DEFS: FlagDef[] = [
  { k: '胜率', t: '胜率', d: '该周期收益 > 0 的样本占比；样本为 0 时显示 —（不是 0%）。' },
  { k: '平均收益', t: '平均收益', d: '该周期**有数据**样本的算术平均（%），无数据样本不计入分母。' },
  { k: '样本（胜/总）', t: '样本', d: '形如 12/20：分子 = 盈利笔数，分母 = 该周期有数据的入选笔数。距锚定日太近时后段周期会缺数据（如 N10 需要其后 10 个交易日）。' },
  { k: '时间线', t: '平均收益走势', d: '横轴为锚定日（旧 → 新），纵轴为当日入选票在该周期的平均收益 %，可按周期勾选显示。' },
];
