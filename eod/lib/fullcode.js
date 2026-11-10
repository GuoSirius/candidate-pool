'use strict';
/*
 * eod/lib/fullcode.js —— 6 位代码 → 交易所前缀（全项目统一口径，2026-11-10 评审 #7）
 * ---------------------------------------------------------------------------
 * 背景：pool_reflow / nextday_backfill / kline_spark 各自持有一份 toFullCode，
 * 9 前缀归属不一致（前者 9→bj，后者 9→sh），北交 920 票在 mini K 线列会查空。
 * 统一规则：
 *   - 已带 sh/sz/bj 前缀 → 校验格式后原样小写返回
 *   - 裸 6 位：6 → 沪（主板/科创）；0/3/2 → 深（含 200 深B）；4/8 → 北交；
 *     9 → 920xxx 归北交（2024 起新号段），其余（900xxx 沪B）归沪
 *   - 其余号段（基金/债券等非股票）→ 返回 fallback（默认 null）
 * 调用方按需传 fallback：pool_reflow 用 ''（脏数据不入池），kline_spark 用默认 null。
 */
function toFullCode(c, { fallback = null } = {}) {
  const s = String(c == null ? '' : c).trim().toLowerCase().replace(/\s/g, '');
  if (/^(sh|sz|bj)\d{6}$/.test(s)) return s;
  if (!/^\d{6}$/.test(s)) return fallback;
  const h = s[0];
  if (h === '9') return /^920/.test(s) ? 'bj' + s : 'sh' + s;
  if (h === '6') return 'sh' + s;
  if (h === '0' || h === '3' || h === '2') return 'sz' + s;
  if (h === '4' || h === '8') return 'bj' + s;
  return fallback;
}

module.exports = { toFullCode };
