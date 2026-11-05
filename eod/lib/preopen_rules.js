'use strict';
/*
 * eod/lib/preopen_rules.js —— 盘前选股规则引擎（纯函数，零副作用，可单测）
 * ---------------------------------------------------------------------------
 * 与 rules.js 同范式：所有计算函数入参为数据、出参为结果，不读网络、不改全局。
 * 三类信号：
 *   - P01 竞价强势：今开 vs 昨收的高开幅度 + 竞价量能比（竞价量 / 昨日量）
 *   - P02 弱转强/超预期：昨日涨幅(强势门槛) + 今日竞价高开区间 → 超预期/符合/不及预期
 *   - P03 趋势跟踪：均线多头 + N日新高 + 斜率（来自前一日 K 线）
 *
 * 输入数据约定：
 *   - quote：腾讯报价解析对象（market.parseQuote 产出），含 open/prevClose/vol/chgPct 等
 *   - kline.rows：前复权日K，【降序】最新在前，每根 { date, open, close, high, low, vol }
 *     锚定日 = 最近已收盘交易日（lastClosedTradingDay），rows[0] 即昨日 bar
 * ---------------------------------------------------------------------------
 */

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
/** 线性映射 0..1；v 为空返回 0（缺数据不猜值） */
function lin(v, lo, hi) {
  if (v == null || !Number.isFinite(v)) return 0;
  if (hi === lo) return v >= hi ? 1 : 0;
  return clamp01((v - lo) / (hi - lo));
}

// ---------- 趋势计算（P03）----------
/**
 * 由日K（降序）计算趋势指标。
 * @returns {object} { ma5..ma60, maBull, newHigh20, newHigh60, slope20(%/日), volPriceUp }
 */
function calcTrend(rowsDesc, cfg) {
  const closes = rowsDesc.map((r) => r.close).reverse(); // 升序：最旧在前
  const n = closes.length;
  const out = { ma5: null, ma10: null, ma20: null, ma60: null, maBull: false, newHigh20: false, newHigh60: false, slope20: null, volPriceUp: false };
  if (n < 5) return out;

  const ma = (k) => (n >= k ? closes.slice(n - k).reduce((a, b) => a + b, 0) / k : null);
  out.ma5 = ma(5);
  out.ma10 = ma(10);
  out.ma20 = ma(20);
  out.ma60 = ma(60);

  // 均线多头：MA5>MA10>MA20>MA60（各周期数据齐备才判定）
  if (out.ma5 != null && out.ma10 != null && out.ma20 != null && out.ma60 != null) {
    out.maBull = out.ma5 > out.ma10 && out.ma10 > out.ma20 && out.ma20 > out.ma60;
  }

  // N 日新高：昨日收盘为近 N 日最高
  const last20 = closes.slice(n - Math.min(20, n));
  const last60 = closes.slice(n - Math.min(60, n));
  out.newHigh20 = closes[n - 1] >= Math.max(...last20);
  out.newHigh60 = n >= 60 ? closes[n - 1] >= Math.max(...last60) : false;

  // 斜率：近 20 日收盘价 OLS 回归斜率，折算 %/日（相对均值）
  if (n >= 20) {
    const w = closes.slice(n - 20);
    const x = w.map((_, i) => i);
    const xm = x.reduce((a, b) => a + b, 0) / 20;
    const ym = w.reduce((a, b) => a + b, 0) / 20;
    let num = 0, den = 0;
    for (let i = 0; i < 20; i++) { num += (x[i] - xm) * (w[i] - ym); den += (x[i] - xm) ** 2; }
    const slope = den ? num / den : 0;          // 绝对斜率（元/日）
    out.slope20 = ym ? (slope / ym) * 100 : 0;   // %/日
  }

  // 量价齐升（近 5 日）：上涨日占比 ≥ 60%
  if (n >= 6) {
    const recent = rowsDesc.slice(0, 5); // 降序最新 5 日
    const ups = recent.filter((r, i) => i < recent.length - 1 && r.close >= rowsDesc[i + 1].close).length;
    out.volPriceUp = ups / Math.max(1, recent.length - 1) >= 0.6;
  }
  return out;
}

// ---------- 基线（前一日 K 线指标）----------
/**
 * 由 K 线计算「前一日」基线：昨日涨幅、昨日成交量、趋势。
 * @param {object} kline  { rows: 降序日K, today, hist }（fetchKline 产出）
 * @returns {object|null} { yesterdayChgPct, yesterdayVol, yesterdayVolRatio, trend }
 */
function calcBaseline(kline, code, cfg) {
  const rows = (kline && kline.rows) || [];
  if (!rows.length) return null;
  const y = rows[0];                 // 昨日 bar
  const prior = rows[1];             // 前日 bar
  let yesterdayChgPct = null;
  if (y && prior && prior.close > 0) {
    yesterdayChgPct = (y.close / prior.close - 1) * 100;
  }
  const yesterdayVol = y ? y.vol : null; // 手（与竞价量同口径）
  // 昨日量比 = 昨日成交量 / 前5日均量（日收盘口径下与「每分钟均量比」等价；复权对分子分母同缩放，比值不失真）
  let yesterdayVolRatio = null;
  if (y && y.vol > 0) {
    const prior5 = rows.slice(1, 6).filter((r) => r.vol > 0);
    if (prior5.length >= 3) yesterdayVolRatio = y.vol / (prior5.reduce((a, r) => a + r.vol, 0) / prior5.length);
  }
  const trend = calcTrend(rows, cfg);
  // 量能均线（P04 逐步放量用）：基准日（含）往前 5 / 20 日均量
  const volMa5 = rows.length >= 5 ? rows.slice(0, 5).reduce((a, r) => a + (r.vol || 0), 0) / 5 : null;
  const volMa20 = rows.length >= 20 ? rows.slice(0, 20).reduce((a, r) => a + (r.vol || 0), 0) / 20 : null;
  return { code, yesterdayChgPct, yesterdayVol, yesterdayVolRatio, volMa5, volMa20, boards: boardsInfo(rows, code), trend };
}

// ---------- P01 竞价强势 ----------
function calcP1(quote, baseline, cfg) {
  const p = cfg.rules.p1;
  const prevClose = quote.prevClose;
  const open = quote.open;
  let auctionChgPct = null;
  if (prevClose > 0 && open != null && open > 0) {
    auctionChgPct = (open / prevClose - 1) * 100;
  }
  // 竞价量能比 = 竞价成交量 / 昨日全天成交量（同口径，免单位换算）
  let auctionVolRatio = null;
  const yVol = baseline && baseline.yesterdayVol;
  if (quote.vol != null && yVol) auctionVolRatio = quote.vol / yVol;

  const highOpen = auctionChgPct != null && auctionChgPct >= p.auctionChgMin;
  const nearLimit = auctionChgPct != null && auctionChgPct >= p.auctionChgLimit;
  const volOk = auctionVolRatio != null && auctionVolRatio >= p.auctionVolRatioMin;

  // 打分：高开幅度(0.6) + 量能比(0.4)；未高开则 0 分
  const sChg = lin(auctionChgPct, p.auctionChgMin, p.auctionChgLimit);
  const sVol = lin(auctionVolRatio, p.auctionVolRatioMin, p.auctionVolRatioFull);
  const score = highOpen ? 0.6 * sChg + 0.4 * sVol : 0;

  return {
    auctionChgPct, auctionVolRatio, highOpen, nearLimit, volOk,
    score, ok: highOpen && volOk,
  };
}

// ---------- P02 弱转强 / 超预期 ----------
function calcP2(quote, baseline, cfg) {
  const p = cfg.rules.p2;
  const yChg = baseline ? baseline.yesterdayChgPct : null;
  // 竞价涨幅复用 P1 的计算（调用方传入，避免重复）
  const aChg = quote.__auctionChgPct != null ? quote.__auctionChgPct : null;
  const applicable = yChg != null && yChg >= p.yesterdayStrong;

  let verdict = '非强势股';
  let score = 0;
  let risk = false;
  if (applicable && aChg != null) {
    if (aChg >= p.exceed) {
      verdict = aChg >= p.yesterdayLimit ? '超预期·涨停预期' : '超预期·高开';
      score = 1.0;
    } else if (aChg >= p.expectLow) {
      verdict = '符合预期·健康高开';
      score = 0.7;
    } else if (aChg >= 0) {
      verdict = '偏弱高开';
      score = 0.3;
    } else {
      verdict = '不及预期·核按钮';
      score = 0.0;
      risk = true;
    }
  }
  return { yesterdayChgPct: yChg, auctionChgPct: aChg, applicable, verdict, score, risk };
}

// ---------- P03 趋势跟踪 ----------
function calcP3(baseline, cfg) {
  const p = cfg.rules.p3;
  const t = (baseline && baseline.trend) || {};
  const slope = t.slope20;
  const sSlope = lin(slope, p.slopeMinPerDay, p.slopeFullPerDay);
  const sHigh = (t.newHigh20 ? 1 : 0) * 0.3 + (t.newHigh60 ? 1 : 0) * 0.2;
  // 权重：多头 0.4 + 新高 0.3(20日0.3+60日0.2取含) + 斜率 0.3
  const score = (t.maBull ? 0.4 : 0) + Math.min(0.3, sHigh) + 0.3 * sSlope;
  return { ...t, score: clamp01(score), ok: !!t.maBull };
}

// ---------- P04 趋势放量通道（门槛制独立轨，不打分）----------
// 与 P1-P3 打分轨并集入选：均线多头 + 温和上行 + 逐步放量 + 竞价有承接（允许微低开）+ 防趋势末端乖离。
// 全部基于前一日 K 线基线与竞价快照；差一项门槛 → 调用方归档 nearMiss 供调参。
function calcP4(quote, baseline, cfg, p1) {
  const p = cfg.rules.p4;
  const t = (baseline && baseline.trend) || {};
  const gates = {};
  gates.trend = p.maBull ? !!t.maBull : !!(t.ma5 > t.ma10 && t.ma10 > t.ma20);
  gates.slope = t.slope20 != null && t.slope20 >= p.slopeMinPerDay;
  gates.volume = !!(baseline && baseline.volMa5 != null && baseline.volMa20 > 0 && baseline.volMa5 >= p.volRatio5v20 * baseline.volMa20);
  const aChg = quote && quote.__auctionChgPct != null ? quote.__auctionChgPct : null;
  const aVol = p1 ? p1.auctionVolRatio : null;
  gates.auction = aChg != null && aVol != null && aChg >= p.auctionChgMin && aVol >= p.auctionVolRatioMin;
  let biasPct = null;
  if (p.biasMaxPct > 0 && t.ma20 > 0 && quote && quote.prevClose > 0) {
    biasPct = (quote.prevClose / t.ma20 - 1) * 100;
    gates.bias = biasPct <= p.biasMaxPct;
  } else {
    gates.bias = true;
  }
  const failed = Object.keys(gates).filter((k) => !gates[k]);
  return { gates, biasPct: biasPct != null ? +biasPct.toFixed(2) : null, miss: failed.length, failed, ok: failed.length === 0 };
}

// ---------- 综合打分 ----------
function scorePreopen(p1, p2, p3, cfg) {
  const w = cfg.score.weights;
  const items = { p1: p1.score, p2: p2.score, p3: p3.score };
  const total = w.p1 * items.p1 + w.p2 * items.p2 + w.p3 * items.p3;
  return { total, items };
}

/** 由三项结果推导一句话标签（报告/通知用） */
function labelOf(p1, p2, p3) {
  if (p2.verdict && p2.verdict.startsWith('超预期')) return '超预期';
  if (p2.verdict === '符合预期·健康高开') return '弱转强·符合';
  if (p2.verdict === '不及预期·核按钮') return '不及预期·风险';
  if (p1.nearLimit) return '竞价涨停';
  if (p1.highOpen && p3.ok) return '竞价强+趋势';
  if (p1.highOpen) return '竞价强势';
  if (p3.ok) return '趋势向上';
  return '观察';
}

// ---------- 龙虎榜知名游资席位（公开常见归属，正则匹配席位全名，按需增补） ----------
const HOT_MONEY_SEATS = [
  ['章盟主', /国泰(君安|海通)[^,]*上海江苏路|银泰证券[^,]*上海嘉善路/],
  ['炒股养家', /华鑫证券[^,]*上海(分公司|宛平南路)/],
  ['作手新一', /国泰(君安|海通)[^,]*南京太平南路/],
  ['方新侠', /国盛证券[^,]*宁波桑田路/],
  ['孙哥', /中信证券[^,]*上海溧阳路/],
];

/** 从龙虎榜席位明细识别知名游资 → [{ name, amt(买入额,元) }] */
function matchHotMoney(seats) {
  const out = [];
  for (const s of seats || []) {
    for (const [name, re] of HOT_MONEY_SEATS) {
      if (re.test(s.seat || '')) { out.push({ name, amt: s.buy != null ? s.buy : null }); break; }
    }
  }
  return out;
}

/** 连续涨停天数（自 rowsDesc[0] 起向前数，几连板；ST 5% 板不适用但候选已排除 ST） */
function countLimitUpStreak(rowsDesc, code) {
  const p = /^sh68[89]/.test(code) ? 20 : /^sz30/.test(code) ? 20 : /^bj/.test(code) ? 30 : 10;
  let n = 0;
  for (let i = 0; i + 1 < rowsDesc.length; i++) {
    const r = rowsDesc[i], prev = rowsDesc[i + 1];
    if (prev.close > 0 && r.close >= prev.close * (1 + p / 100) - 0.005) n++;
    else break;
  }
  return n;
}

/**
 * 连板 + 几天几板（rowsDesc 降序，rowsDesc[0] 为基准日）。
 * 几天几板：默认回看 10 个交易日内的涨停 → 「N天M板」（N=最老板距基准日的交易日数）；
 * 最老板顶满窗口且再往前一天仍是涨停时逐日外扩（如 10天1板 → 倒推11日也是板则 11天2板）。
 * @returns {{streak:number, days:number, count:number}}
 */
function boardsInfo(rowsDesc, code, windowDays = 10) {
  const p = /^sh68[89]/.test(code) ? 20 : /^sz30/.test(code) ? 20 : /^bj/.test(code) ? 30 : 10;
  const n = rowsDesc.length;
  const isBoard = (i) => i + 1 < n && rowsDesc[i + 1].close > 0 && rowsDesc[i].close >= rowsDesc[i + 1].close * (1 + p / 100) - 0.005;
  let streak = 0;
  while (streak < n - 1 && isBoard(streak)) streak++;
  const days = [];
  for (let d = 1; d <= windowDays && d < n; d++) if (isBoard(d - 1)) days.push(d);
  if (!days.length) return { streak, days: 0, count: 0 };
  let N = days[days.length - 1], M = days.length;
  while (N >= windowDays && N + 1 < n && isBoard(N)) { N++; M++; }   // 边界外扩
  return { streak, days: N, count: M };
}

module.exports = {
  clamp01, lin,
  calcTrend, calcBaseline,
  calcP1, calcP2, calcP3, calcP4, scorePreopen, labelOf,
  countLimitUpStreak, boardsInfo, matchHotMoney, HOT_MONEY_SEATS,
};
