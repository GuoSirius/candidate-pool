'use strict';
/*
 * eod/lib/regime.js —— 市场环境闸（批次 B1，2026-11-09 方案）
 * ---------------------------------------------------------------------------
 * 数据源：**已有的** fullMarketSnapshot 报价（腾讯批量行情，~5000 只）——
 * 不接东财情绪端点（不确定的接口不做），从涨跌分布推导四档标签：
 *   强市 / 正常 / 弱市 / 冰点
 *
 * 弱市行为约定（用户拍板）：**只提示不自动改阈值** —— 报告头部出提示条，
 * 建议降低仓位 / 临时抬高入选线，绝不悄悄改 minTotal（自动改不可控）。
 *
 * 涨停/跌停判定为近似口径：按板块涨跌幅制度（主板 10 / 创创科 20 / 北交 30 / ST 5）
 * 的 ±0.15% 容差，与交易所精确口径（收盘集合竞价撮合）可能有 ±几只的出入，
 * 只用于环境分档，不用于个股判定。
 * ---------------------------------------------------------------------------
 */

/** 各板涨跌幅制度（%）：北交 30；创业板(30x)/科创(688) 20（含 ST，注册制后与普通股一致）；
 *  沪深主板 ST 5；主板普通 10。注意判断顺序：先板块后 ST，否则创业/科创 ST 会被误判 5% */
function limitPctOf(code, name) {
  const c = String(code);
  if (/^bj(4|8|92)/.test(c)) return 30;
  if (/^sz3/.test(c) || /^sh688/.test(c)) return 20;
  if (/ST/i.test(String(name || ''))) return 5;
  return 10;
}

/** 默认分档阈值（全市场 ~5000 只口径）；调参改这里，一处生效 */
const THRESHOLDS = {
  iceUpPctMax: 15,      // 冰点：上涨占比 ≤15%
  iceLimitDownMin: 15,  //        且跌停家数 ≥15
  weakUpPctMax: 35,     // 弱市：上涨占比 <35%
  weakLimitDownMin: 10, //        或跌停家数 ≥10 且涨停 <40
  weakLimitUpMax: 40,
  strongUpPctMin: 70,   // 强市：上涨占比 ≥70%
  strongLimitUpMin: 60, //        且涨停家数 ≥60
  strongLimitDownMax: 5,//        且跌停 ≤5
};

/**
 * 从全市场报价算环境标签。
 * @param {Array} quotes parseQuote 输出数组（含 name/chgPct/code）
 * @param {object} opts { thresholds }
 * @returns {object|null} null = 无有效数据（调用方降级为不显示，绝不阻断主流程）
 */
function calcRegime(quotes, opts = {}) {
  const T = { ...THRESHOLDS, ...(opts.thresholds || {}) };
  const valid = (quotes || []).filter((q) => q && q.chgPct != null);
  if (valid.length < 1000) return null;   // 覆盖太低不判环境（半市数据会误档）
  let up = 0, down = 0, flat = 0, limitUp = 0, limitDown = 0, chgSum = 0, amountWanSum = 0;
  for (const q of valid) {
    const pct = q.chgPct;
    chgSum += pct;
    if (q.amountWan != null) amountWanSum += q.amountWan;
    const lim = limitPctOf(q.code, q.name);
    if (pct >= lim - 0.15) limitUp++;
    else if (pct <= -(lim - 0.15)) limitDown++;
    if (pct > 0) up++;
    else if (pct < 0) down++;
    else flat++;
  }
  const n = valid.length;
  const upPct = +(up / n * 100).toFixed(1);
  const avgChg = +(chgSum / n).toFixed(2);
  let label = '正常';
  if (upPct <= T.iceUpPctMax && limitDown >= T.iceLimitDownMin) label = '冰点';
  else if (upPct < T.weakUpPctMax || (limitDown >= T.weakLimitDownMin && limitUp < T.weakLimitUpMax)) label = '弱市';
  else if (upPct >= T.strongUpPctMin && limitUp >= T.strongLimitUpMin && limitDown <= T.strongLimitDownMax) label = '强市';

  return {
    label,
    up, down, flat, total: n,
    limitUp, limitDown,
    upPct,
    avgChg,
    amountYi: +(amountWanSum / 1e4).toFixed(0),   // 万 → 亿
    tip: (label === '弱市' || label === '冰点')
      ? '建议临时提高入选线 / 降低仓位（只提示，阈值未自动改动）'
      : null,
  };
}

/** 报告头部徽标 HTML（双语，无数据返回空串）——三份报告共用一种写法，避免漂移 */
function badgeHTML(r, b, esc) {
  if (!r) return '';
  const cls = { 强市: 'up', 弱市: 'down', 冰点: 'down', 正常: '' }[r.label] || '';
  const line = `涨停 ${r.limitUp} / 跌停 ${r.limitDown} · 上涨占比 ${r.upPct}% · 均涨 ${r.avgChg}% · 两市 ${r.amountYi} 亿`;
  return `<span class="tag ${cls}">环境·${r.label}</span> <span class="src">${line}${r.tip ? ' · ' + r.tip : ''}</span>`;
}

module.exports = { calcRegime, limitPctOf, THRESHOLDS, badgeHTML };
