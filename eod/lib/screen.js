'use strict';
/*
 * eod/lib/screen.js —— 初筛过滤 → 分时校验 → 强度打分 → 分组排序
 * ---------------------------------------------------------------------------
 * 口径要点（尾盘口径 ≠ 现有 R01 隔夜口径，两套独立，不要互相套用）：
 *
 *   1. 初筛（FR-03）只依赖快照字段，因此可以先在全市场 6000+ 只上跑一遍，
 *      把「不可买 / 明显不合格」的先剔掉，再对少数幸存者抓分时（否则请求量爆炸）。
 *   2. 「不可买」判定必须覆盖三件事，实测缺一不可：
 *        - 停牌/退市：成交量 0 或 行情时间戳停在 09:00:00
 *          （已退市个股仍会返回陈旧价格，只看价格会把它们放进来）
 *        - 一字板：开=高=低（全天一个价，实盘买不到）
 *        - 已封涨停：现价达到该板块涨停价（主板 10% / 双创 20% / 北交所 30%）
 *   3. 打分（FR-06）六项全部线性映射到 0..1 再加权，**每一项都能在报告里解释**，
 *      不做「黑箱总分」。任何一项缺数据记 0 分而不是猜值。
 *   4. 分组（FR-07）按行业聚合，组内按总分降序，标记组内最优。
 * ---------------------------------------------------------------------------
 */

const { dayjs } = require('../../time');
const { sectorOf, listedOf, computeSectorStats, UNKNOWN } = require('./sector');

/** 筛除原因（中文，直接进报告与日志） */
const REASON = {
  ST: 'ST / 退市风险股',
  SUSPENDED: '停牌或已退市（无成交）',
  NO_DATA: '关键字段缺失或分时数据不可用',
  CHG: '当日涨幅不在区间',
  VOL_RATIO: '量比不足',
  TURNOVER: '换手率不在区间',
  CAP: '流通市值不在区间',
  PRICE: '股价过低',
  ONE_WORD: '一字板（实际上买不到）',
  LIMIT_UP: '已封涨停（实际上买不到）',
  NEW: '上市时间过短',
  TAIL_SEG: '尾盘段涨幅不足',
  BELOW_AVG: '现价低于当日均价',
  FROM_HIGH: '距日内高点回落过多',
};

/** 板块判定：涨跌幅制度与成交量单位都与板块相关 */
function boardOf(code) {
  if (/^sh68[89]/.test(code)) return 'star';   // 科创板
  if (/^sz30/.test(code)) return 'gem';        // 创业板
  if (/^bj/.test(code)) return 'bj';           // 北交所
  return 'main';                               // 沪深主板
}

/** 该板块的涨停幅度（%）。ST 已在上游剔除，故不必再处理 5% 档 */
function limitUpPct(code) {
  const b = boardOf(code);
  if (b === 'star' || b === 'gem') return 20;
  if (b === 'bj') return 30;
  return 10;
}

const BOARD_LABEL = { main: '主板', star: '科创板', gem: '创业板', bj: '北交所' };

/** 两个 YYYYMMDD / YYYY-MM-DD 之间相差的自然日；任一无法解析返回 null */
function daysBetween(a, b) {
  const da = dayjs.tz(String(a).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') + ' 00:00:00');
  const db = dayjs.tz(String(b).slice(0, 10) + ' 00:00:00');
  if (!da.isValid() || !db.isValid()) return null;
  return Math.abs(db.diff(da, 'day'));
}

/**
 * 单只票的快照初筛。返回 null = 通过；返回字符串 = 淘汰原因。
 * 顺序有意从「便宜且决定性」到「贵」，便于统计各原因淘汰量。
 */
function preFilterOne(q, cfg, map, tradeDate) {
  const ex = cfg.exclude;
  const f = cfg.filter;

  if (ex.st && /ST|退/i.test(q.name)) return REASON.ST;

  if (ex.suspended) {
    const hhmmss = String(q.stamp || '').slice(8, 14);
    if (!(q.vol > 0) || hhmmss === '090000') return REASON.SUSPENDED;
  }

  if (q.chgPct == null || q.turnover == null || q.volRatio == null || q.floatCapYi == null || q.high == null) {
    return REASON.NO_DATA;
  }
  if (q.chgPct < f.chgPctMin || q.chgPct > f.chgPctMax) return REASON.CHG;
  if (q.volRatio < f.volRatioMin) return REASON.VOL_RATIO;
  if (q.turnover < f.turnoverMin || q.turnover > f.turnoverMax) return REASON.TURNOVER;
  if (q.floatCapYi < f.floatCapMinYi || q.floatCapYi > f.floatCapMaxYi) return REASON.CAP;
  if (q.price < f.priceMin) return REASON.PRICE;

  if (ex.oneWordBoard && q.open != null && q.high != null && q.low != null
      && q.open === q.high && q.high === q.low) {
    return REASON.ONE_WORD;
  }

  if (ex.limitUp && q.prevClose > 0) {
    const limitPrice = Math.round(q.prevClose * (1 + limitUpPct(q.code) / 100) * 100) / 100;
    if (q.price >= limitPrice - 0.005) return REASON.LIMIT_UP;
  }

  if (ex.newListing) {
    // 交易所对新股简称为「N 开头（首日）/ C 开头（上市后 5 日内）」
    if (/^[NC]/.test(q.name)) return REASON.NEW;
    const listed = listedOf(map, q.code);
    if (listed && tradeDate) {
      const days = daysBetween(listed, tradeDate);
      if (days != null && days < ex.newListingDays) return REASON.NEW;
    }
  }

  return null;
}

/**
 * 全市场初筛。
 * @returns {{passed:Array, rejected:Array<{code,name,reason}>, byReason:object}}
 */
function preFilter(quotes, cfg, map, tradeDate) {
  const passed = [];
  const rejected = [];
  const byReason = {};
  for (const q of quotes) {
    const reason = preFilterOne(q, cfg, map, tradeDate);
    if (reason) {
      byReason[reason] = (byReason[reason] || 0) + 1;
      rejected.push({ code: q.code, name: q.name, reason });
    } else {
      passed.push(q);
    }
  }
  return { passed, rejected, byReason };
}

/** 分时校验（FR-04）。返回原因数组，空数组 = 通过 */
function postCheck(q, tm, cfg) {
  const f = cfg.filter;
  if (!tm) return [REASON.NO_DATA];
  const out = [];
  if (tm.segPct == null || tm.segPct < f.tailSegMinPct) out.push(REASON.TAIL_SEG);
  if (f.aboveAvgMode === 'hard') {
    if (tm.priceVsAvgPct == null) out.push(REASON.NO_DATA);
    else if (tm.priceVsAvgPct < -Math.abs(f.aboveAvgTolerance || 0)) out.push(REASON.BELOW_AVG);
  }
  if (q.high > 0 && tm.p1 != null) {
    const fromHigh = ((q.high - tm.p1) / q.high) * 100;
    if (fromHigh > f.maxFromHighPct) out.push(REASON.FROM_HIGH);
  }
  return out;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/** 线性映射到 0..1；v 为空返回 0（缺数据不猜值） */
function lin(v, lo, hi) {
  if (v == null || !Number.isFinite(v)) return 0;
  if (hi === lo) return v >= hi ? 1 : 0;
  return clamp01((v - lo) / (hi - lo));
}

/**
 * 换手适中度：落在 [sweetLow, sweetHigh] 拿满分，
 * 低于 sweetLow 按 [filterMin, sweetLow] 递减，高于 sweetHigh 按 [sweetHigh, filterMax] 递减。
 * 这样「过低无人气」与「过高警惕出货」两端都平滑扣分，而不是一刀切。
 */
function turnoverFit(t, s, f) {
  if (t == null || !Number.isFinite(t)) return 0;
  if (t >= s.turnoverSweetLow && t <= s.turnoverSweetHigh) return 1;
  if (t < s.turnoverSweetLow) return clamp01((t - f.turnoverMin) / (s.turnoverSweetLow - f.turnoverMin));
  return clamp01((f.turnoverMax - t) / (f.turnoverMax - s.turnoverSweetHigh));
}

/**
 * 板块强度（实测后定的混合口径）。
 *
 * 只用「行业涨幅中位数的绝对阈值」会在普涨日整体饱和——实测 2026-09-18
 * 全市场 68.7% 个股上涨，多数行业中位数都超过 2%，导致候选清一色拿满分、该项失去区分度。
 * 只用「分位」则会在普跌日把「跌得最少的行业」也抬到满分，同样失真。
 * 故取两者折中：
 *   1. 行业中位数 ≤ sectorChgLoPct（默认 0%）→ 0 分：行业实际在跌，不给板块加分；
 *   2. 行业中位数 ≥ sectorChgHiPct（默认 2%）→ 满分：绝对强度已足够；
 *   3. 区间内 → 按该行业在全市场行业涨幅中的**分位**给分（相对强弱，自归一）。
 */
function sectorStrength(sec, s) {
  if (!sec || sec.median == null) return 0;
  if (sec.median <= s.sectorChgLoPct) return 0;
  if (sec.median >= s.sectorChgHiPct) return 1;
  if (!sec.total || sec.total <= 1) return 0;
  const pct = (sec.total - sec.rank) / (sec.total - 1);   // rank=1 → 1，最末 → 0
  return clamp01(pct);
}

/** 「距日内高点」百分比：越小越强 */
function fromHighPct(q, tm) {
  if (!(q.high > 0) || tm == null || tm.p1 == null) return null;
  return ((q.high - tm.p1) / q.high) * 100;
}

/**
 * 六项打分（FR-06）。总分 = Σ(权重 × 归一化值)。
 * @returns {{total:number, items:object, ctx:object}} items 为各项得分（已乘权重）
 */
function scoreStock(q, tm, cfg, sectorStats, sector) {
  const w = cfg.score.weights;
  const s = cfg.score;
  const f = cfg.filter;

  const fh = fromHighPct(q, tm);
  const sec = sectorStats.get(sector || UNKNOWN);

  const items = {
    // 尾盘动能：段涨幅 0 → 0 分，达到 tailMomentumFullPct → 满分
    tailMomentum: w.tailMomentum * lin(tm.segPct, 0, s.tailMomentumFullPct),
    // 量能：量比从门槛起到 volRatioFull 线性给分
    volume: w.volume * lin(q.volRatio, f.volRatioMin, s.volRatioFull),
    // 位置：距日内高点 0% → 满分，达到 maxFromHighPct → 0 分
    position: w.position * (1 - lin(fh, 0, f.maxFromHighPct)),
    // 均价线强度：高出均价 0% → 0 分，avgLineFullPct → 满分
    avgLine: w.avgLine * lin(tm.priceVsAvgPct, 0, s.avgLineFullPct),
    // 板块强度：见 sectorStrength() 的口径说明
    sector: w.sector * sectorStrength(sec, s),
    // 换手适中度
    turnoverFit: w.turnoverFit * turnoverFit(q.turnover, s, f),
  };

  const total = Object.values(items).reduce((a, b) => a + b, 0);
  return { items, total, context: { fromHighPct: fh, sectorMedian: sec ? sec.median : null } };
}

/**
 * 分组 + 组内排序（FR-07）。
 * 组间按「组内最高总分」降序，组内按总分降序，组内第一名标 bestInGroup。
 */
function groupAndRank(candidates, cfg) {
  const bySector = new Map();
  for (const c of candidates) {
    const k = c.sector || UNKNOWN;
    if (!bySector.has(k)) bySector.set(k, []);
    bySector.get(k).push(c);
  }

  const groups = [];
  for (const [sector, list] of bySector) {
    list.sort((a, b) => (b.total - a.total) || ((b.tail?.segPct ?? -99) - (a.tail?.segPct ?? -99)));
    list.forEach((c, i) => {
      c.groupRank = i + 1;
      c.bestInGroup = i === 0;
      c.groupSize = list.length;
    });
    groups.push({
      sector,
      size: list.length,
      // 展示用：同组内只留前 N 只，避免推一堆同质票（Q12）
      shown: list.slice(0, Math.max(1, cfg.group.maxPerGroup)),
      best: list[0],
    });
  }
  groups.sort((a, b) => b.best.total - a.best.total);
  return groups;
}

/**
 * 主入口：快照 + 分时 -> 候选、分组、TOP。
 *
 * @param {Array} quotes        全市场快照
 * @param {Map}   minutes       code -> { rows, date } | { error }
 * @param {object} cfg          配置
 * @param {object} map          行业映射
 * @param {string} tradeDate    'YYYY-MM-DD'
 * @param {string} cutHHMM      '1450'（或观察模式下的当前时点）
 * @param {string} segFrom      '1430'
 * @param {(code:string)=>object|null} makeTail 由 rows 计算 tailMetrics 的函数（注入以便复用/测试）
 */
function buildCandidates({ quotes, minutes, cfg, map, tradeDate, cutHHMM, segFrom, makeTail }) {
  const pre = preFilter(quotes, cfg, map, tradeDate);
  const sectorStats = computeSectorStats(pre.passed, map);

  const candidates = [];
  const dropped = [];
  const tailReasons = {};

  for (const q of pre.passed) {
    const m = minutes.get(q.code);
    if (!m || m.error) {
      tailReasons[REASON.NO_DATA] = (tailReasons[REASON.NO_DATA] || 0) + 1;
      dropped.push({ code: q.code, name: q.name, reason: REASON.NO_DATA });
      continue;
    }
    const tm = makeTail(m.rows, q.code, cutHHMM, segFrom);
    const reasons = postCheck(q, tm, cfg);
    if (reasons.length) {
      for (const r of reasons) tailReasons[r] = (tailReasons[r] || 0) + 1;
      dropped.push({ code: q.code, name: q.name, reason: reasons.join('、') });
      continue;
    }

    const sector = sectorOf(map, q.code) || UNKNOWN;
    const sc = scoreStock(q, tm, cfg, sectorStats, sector);
    const sec = sectorStats.get(sector);

    candidates.push({
      code: q.code,
      name: q.name,
      sector,
      board: boardOf(q.code),
      boardLabel: BOARD_LABEL[boardOf(q.code)],
      price: q.price,
      prevClose: q.prevClose,
      open: q.open,
      high: q.high,
      low: q.low,
      chgPct: q.chgPct,
      turnover: q.turnover,
      volRatio: q.volRatio,
      // 收盘预估量比：即时量比按已交易分钟外推，量能非匀速，仅作参考
      volRatioEst: null,
      floatCapYi: q.floatCapYi,
      totalCapYi: q.totalCapYi,
      avgPrice: tm.avgAtCut,
      stamp: q.stamp,
      tail: tm,
      score: sc.items,
      total: sc.total,
      scoreContext: sc.context,
      sectorMedianChg: sec ? sec.median : null,
      sectorRank: sec ? sec.rank : null,
      sectorTotal: sec ? sec.total : null,
      sectorMemberCount: sec ? sec.count : null,
    });
  }

  candidates.sort((a, b) => b.total - a.total);
  const groups = groupAndRank(candidates, cfg);

  return {
    candidates,
    groups,
    top: candidates.slice(0, Math.max(1, cfg.group.topN)),
    stats: {
      snapshotCount: quotes.length,
      prePassCount: pre.passed.length,
      preByReason: pre.byReason,
      minuteDropped: dropped.length,
      tailByReason: tailReasons,
      candidateCount: candidates.length,
      groupCount: groups.length,
    },
    dropped: [...pre.rejected, ...dropped],
  };
}

module.exports = {
  REASON, BOARD_LABEL, boardOf, limitUpPct, daysBetween,
  preFilterOne, preFilter, postCheck, scoreStock, turnoverFit, fromHighPct, lin,
  sectorStrength, groupAndRank, buildCandidates,
};
