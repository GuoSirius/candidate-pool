'use strict';
/*
 * eod/lib/verdict.js —— T+1/T+3 三口径表现判定（纯函数，零副作用）
 * ---------------------------------------------------------------------------
 * 目的：给三类归档（尾盘 / 次日选股 / 游资票）补统一的 `verdicts` 段，
 * 攒够样本后做胜率回归（批次 D 周六简报），回答「总分 ρ≈0.04 怎么办」。
 *
 * 口径约定（买入基准价 basis）：
 *   尾盘 tail      → T 日尾盘 cut 价（记录里的 price，14:50 可成交价）
 *   盘前 preopen   → T 日开盘价（t0 已有，t1/t3 复用本模块，basis=当日 open）
 *   游资 hotmoney  → T+1 开盘价（榜单 ~17:00 才出，当日不可操作）
 *   次日 nextday   → T+1 开盘价（16:00 出报告，同理次日买）
 *
 * 输入 bars：**基准日 T 之后**的升序日 K（每根 {date,open,close,high,low}），
 * 停牌日自然缺 bar → 「T+1/T+3」按交易日计数，与 archive 语义一致。
 *
 * 输出（追加进记录的 verdicts 字段，旧归档无此段不报错）：
 *   {
 *     basis: 买入基准价,
 *     t1: { date, buyRet, hit }          // T+1 收盘 / basis − 1；hit: ≥ t1HitMin（默认 2%）
 *     t3: { date, buyRet, maxRet, hit3 } // T+3 收盘口径 + 期间最高收益（波段）；hit3 同理
 *   }
 *   bars 不足 3 根（如刚跑完只有 T+1）→ 只出 t1；无 bar → null。
 * ---------------------------------------------------------------------------
 */

/** 买入基准价 → 收益百分数（保留 2 位） */
function relRet(basis, v) {
  return basis > 0 ? +(((v / basis) - 1) * 100).toFixed(2) : null;
}

/** 从降序全量 K 线里取「T 之后」的前 n 根并翻成升序（T 当根不含；先翻升序再截断，保证取最近 T+1..T+n） */
function barsAfter(rowsDesc, fromDate, n = 3) {
  return (rowsDesc || [])
    .filter((r) => r && r.date > fromDate && r.open > 0 && r.close > 0)
    .reverse()
    .slice(0, n);
}

/**
 * 构造 verdicts。
 * @param {Array} bars T 之后的升序日 K（barsAfter 的输出；也可直接传升序行）
 * @param {object} opts { basis?: number（默认 bars[0].open，即 T+1 开盘）, t1HitMin?: 0.02, t3HitMin?: 0.02 }
 * @returns {object|null} { basis, t1, t3? }
 */
function buildVerdicts(bars, opts = {}) {
  const bs = (bars || []).filter((r) => r && r.date && r.open > 0 && r.close > 0).slice(0, 3);
  if (!bs.length) return null;
  const basis = opts.basis != null ? +opts.basis : bs[0].open;
  if (!(basis > 0)) return null;
  const t1HitMin = opts.t1HitMin != null ? opts.t1HitMin : 0.02;
  const t3HitMin = opts.t3HitMin != null ? opts.t3HitMin : t1HitMin;

  const b1 = bs[0];
  const t1Ret = relRet(basis, b1.close);
  const out = { basis, t1: { date: b1.date, buyRet: t1Ret, hit: t1Ret != null && t1Ret >= t1HitMin * 100 } };
  if (bs.length >= 3) {
    const b3 = bs[2];
    const maxHigh = Math.max(bs[0].high, bs[1].high, bs[2].high);
    const t3Ret = relRet(basis, b3.close);
    out.t3 = {
      date: b3.date,
      buyRet: t3Ret,
      maxRet: relRet(basis, maxHigh),
      hit3: t3Ret != null && t3Ret >= t3HitMin * 100,
    };
  }
  return out;
}

/**
 * 聚合一组 verdicts → 命中率/平均收益（胜率表用）。
 * @param {Array} list [{ verdicts }, ...]（缺段自动跳过）
 * @returns {object|null} { n, t1: {n, hit, rate, avg}, t3: {n, hit3, rate3, avg, avgMax} }
 */
function aggregate(list) {
  let t1N = 0, t1Hit = 0, t1Sum = 0;
  let t3N = 0, t3Hit = 0, t3Sum = 0, maxSum = 0;
  for (const it of list || []) {
    const v = it && it.verdicts;
    if (!v) continue;
    if (v.t1 && v.t1.buyRet != null) { t1N++; t1Sum += v.t1.buyRet; if (v.t1.hit) t1Hit++; }
    if (v.t3 && v.t3.buyRet != null) {
      t3N++; t3Sum += v.t3.buyRet; if (v.t3.hit3) t3Hit++;
      if (v.t3.maxRet != null) maxSum += v.t3.maxRet;
    }
  }
  if (!t1N && !t3N) return null;
  const round = (x, n = 1) => (x == null ? null : +x.toFixed(n));
  return {
    n: list.filter((x) => x && x.verdicts).length,
    t1: t1N ? { n: t1N, hit: t1Hit, rate: round(t1Hit / t1N * 100), avg: round(t1Sum / t1N, 2) } : null,
    t3: t3N ? { n: t3N, hit3: t3Hit, rate3: round(t3Hit / t3N * 100), avg: round(t3Sum / t3N, 2), avgMax: round(maxSum / t3N, 2) } : null,
  };
}

module.exports = { relRet, barsAfter, buildVerdicts, aggregate };
