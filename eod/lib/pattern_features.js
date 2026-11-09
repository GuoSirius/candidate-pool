'use strict';
/*
 * eod/lib/pattern_features.js —— 形态特征层（纯函数，零网络、零副作用）
 * ---------------------------------------------------------------------------
 * 为什么不用 DTW 逐日模板匹配：对价格尺度、窗口长度、除权都敏感，且报告里
 * 无法解释「为什么像」。改用「启动日锚点对齐 + 尺度无关特征向量 + 加权距离」：
 *   - 每个特征都是百分比 / 倍数 / 天数 / 次数，与绝对股价无关；
 *   - 报告可逐项展示「哪个特征拉低了分」，调阈值有据可依。
 *
 * 输入约定：asc = 前复权日 K【升序】（最旧在前、最新在后），
 *           每根 { date, open, close, high, low, vol }。fetchKline 返回降序，先 toAsc。
 * ---------------------------------------------------------------------------
 */

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** 降序 → 升序，并剔除脏 bar（无收盘价 / 停牌 0 量保留，价格仍有效） */
function toAsc(rowsDesc) {
  return (rowsDesc || [])
    .filter((r) => r && r.date && Number.isFinite(r.close) && r.close > 0)
    .slice()
    .reverse();
}

function maAt(vals, i, k) {
  if (i + 1 < k) return null;
  return mean(vals.slice(i - k + 1, i + 1));
}

/** 全序列派生指标：均线、前5日均量、日涨幅（均为升序同下标） */
function series(asc) {
  const closes = asc.map((r) => r.close);
  const vols = asc.map((r) => r.vol);
  const n = asc.length;
  const s = { ma5: [], ma10: [], ma20: [], ma60: [], volMa5: [], chg: [] };
  for (let i = 0; i < n; i++) {
    s.ma5[i] = maAt(closes, i, 5);
    s.ma10[i] = maAt(closes, i, 10);
    s.ma20[i] = maAt(closes, i, 20);
    s.ma60[i] = maAt(closes, i, 60);
    s.volMa5[i] = i >= 5 ? mean(vols.slice(i - 5, i)) : null; // 前 5 日均量（不含当日）
    s.chg[i] = i > 0 && closes[i - 1] > 0 ? (closes[i] / closes[i - 1] - 1) * 100 : null;
  }
  return s;
}

/** 涨停阈值：北交所 30cm / 创业板·科创 20cm / 主板 10cm */
function limitUpPct(code) {
  if (/^bj/.test(code)) return 29;
  if (/^(sz30|sh68)/.test(code)) return 19;
  return 9.5;
}

/**
 * 找「启动日」候选：单日放量 + 上涨。突破前高只作为特征（launchBreak），
 * 不作硬门槛 —— 实测两只模板票的启动日都未必创 20 日新高，卡死会漏掉模板自身。
 */
function launchCandidates(asc, ser, launch) {
  const out = [];
  const chgMin = Number(launch && launch.chgMin) || 3;
  const volXMin = Number(launch && launch.volXMin) || 3;
  for (let i = 20; i < asc.length; i++) {
    const chg = ser.chg[i];
    const vx = ser.volMa5[i] > 0 ? asc[i].vol / ser.volMa5[i] : null;
    if (chg == null || vx == null) continue;
    if (chg >= chgMin && vx >= volXMin) out.push({ li: i, chgPct: chg, volX: vx });
  }
  return out;
}

/** 近 3 日是否出现「放量上攻」：≥4.5% 且量能≥1.4x，或涨停（缩量涨停也算） */
function hasRecentSurge(asc, ser, ci) {
  for (let i = Math.max(1, ci - 2); i <= ci; i++) {
    const chg = ser.chg[i];
    const vx = ser.volMa5[i] > 0 ? asc[i].vol / ser.volMa5[i] : 0;
    if (chg == null) continue;
    if (chg >= 9.5 || (chg >= 4.5 && vx >= 1.4)) return true;
  }
  return false;
}

/**
 * 以 li 为启动日、ci 为窗口右端，抽取尺度无关特征向量。
 * @returns {object|null} 评分键 + _meta（窗口元数据，不参与评分）
 */
function features(asc, ser, li, code) {
  const ci = asc.length - 1;
  if (!Number.isInteger(li) || li < 20 || li > ci) return null;
  const win = asc.slice(li, ci + 1);
  const W = win.length;
  const baseClose = asc[li - 1] && asc[li - 1].close;
  if (!baseClose) return null;
  const preVol = ser.volMa5[li];
  const preHighArr = asc.slice(Math.max(0, li - 20), li).map((r) => r.high);
  const preHigh = preHighArr.length ? Math.max(...preHighArr) : null;

  const hi = Math.max(...win.map((r) => r.high));
  const lo = Math.min(...win.map((r) => r.low));
  const minClose = Math.min(...win.map((r) => r.close));
  const vsMA20 = win
    .map((r, j) => { const m = ser.ma20[li + j]; return m > 0 ? (r.close / m - 1) * 100 : null; })
    .filter((v) => v != null && Number.isFinite(v));
  const afterVols = win.slice(1).map((r) => r.vol);
  const first3 = afterVols.slice(0, 3);
  const last3 = afterVols.slice(-3);
  const firstMean = first3.length >= 2 ? mean(first3) : null;
  const lastMean = last3.length >= 2 ? mean(last3) : null;
  const limitUp = limitUpPct(code);

  const f = {
    launchVolX: preVol > 0 ? asc[li].vol / preVol : null,
    launchChg: ser.chg[li],
    windowDays: W,
    cumChg: (asc[ci].close / baseClose - 1) * 100,
    boxAmp: (hi - lo) / baseClose * 100,
    minVsMA20: vsMA20.length ? Math.min(...vsMA20) : null,
    volMaintain: preVol > 0 && afterVols.length ? mean(afterVols) / preVol : null,
    volDecay: firstMean > 0 && lastMean != null ? lastMean / firstMean : null,
    aboveMA20Now: ser.ma20[ci] > 0 ? (asc[ci].close / ser.ma20[ci] - 1) * 100 : null,
    maxDrawdown: hi > 0 ? (lo / hi - 1) * 100 : null,
    limitUpCount: win.filter((r, j) => ser.chg[li + j] != null && ser.chg[li + j] >= limitUp).length,
    recentSurge: hasRecentSurge(asc, ser, ci) ? 1 : 0,
    launchBreak: preHigh > 0 ? (asc[li].close / preHigh - 1) * 100 : null,
  };
  f._meta = {
    startDate: asc[li].date,
    endDate: asc[ci].date,
    windowDays: W,
    launchDate: asc[li].date,
    launchChgPct: f.launchChg,
    launchVolX: f.launchVolX,
    boxHigh: hi,
    boxLow: lo,
    minClose,
    price: asc[ci].close,
    ma20: ser.ma20[ci],
    ma60: ser.ma60[ci],
  };
  return f;
}

/** mini K 线数据（报告内联 SVG 用）：最近 n 根，字段精简 */
function sparkBars(asc, n) {
  return asc.slice(-Math.max(1, n)).map((r) => [r.date, r.open, r.high, r.low, r.close, r.vol]);
}

module.exports = {
  toAsc, series, launchCandidates, features, sparkBars, limitUpPct,
  mean, maAt,
};
