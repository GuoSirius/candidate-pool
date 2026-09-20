'use strict';
/*
 * eod/lib/trading.js —— 交易日 / 交易时段判定（不依赖任何外部日历接口）
 * ---------------------------------------------------------------------------
 * 为什么不用节假日日历：
 *   维护一张 A 股节假日表意味着每年都要更新、且调休（周末补班）极易出错。
 *   而行情本身带时间戳（腾讯报价第 [30] 字段 = YYYYMMDDHHmmss）：
 *   **今天是交易日 ⟺ 行情时间戳的日期 == 今天**。停牌个股不推进，所以取全市场众数而非个例。
 *   这一条同时覆盖了「周末」「法定节假日」「临时休市」三种情况，零维护。
 *
 * 三段式判定：
 *   1. 本地时钟（北京时间）先做粗筛：周末 / 早于 earliest / 晚于收盘宽限期 → 直接跳过
 *   2. 行情时间戳做终筛：日期不是今天 → 今天没开盘，跳过
 *   3. 根据当前时点决定「数据截止时间」：
 *        now >= cutAt(14:50)  → mode='cut'     按 14:50 截断（固定口径，同日多次运行结果一致）
 *        observeFrom <= now < cutAt → mode='observe' 取到最新点位，但报告标注「观察模式」
 * ---------------------------------------------------------------------------
 */

const { dayjs } = require('../../time');

const TZ = 'Asia/Shanghai';

/** 当前北京时间（dayjs 对象） */
function nowBjt() { return dayjs.tz(); }

/** 'HH:mm' -> 当天分钟数 */
function hhmmToMin(hhmm) {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`时间格式应为 HH:mm，收到 ${hhmm}`);
  return (+m[1]) * 60 + (+m[2]);
}

/** 某个 dayjs 时刻的当日分钟数 */
function minOfDay(d) { return d.hour() * 60 + d.minute(); }

/** 'YYYYMMDDHHmmss' | 'YYYYMMDD' -> 'YYYY-MM-DD'；无法识别返回 null */
function stampToDate(stamp) {
  const s = String(stamp || '');
  if (!/^\d{8}/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** 已开盘交易分钟数（A 股：上午 120 + 下午 120 = 240）。用于把即时量比折算成「收盘预估量比」。 */
function elapsedTradingMinutes(minutesOfDay) {
  const M = minutesOfDay;
  if (M <= 9 * 60 + 30) return 0;
  if (M <= 11 * 60 + 30) return M - (9 * 60 + 30);
  if (M <= 13 * 60) return 120;
  if (M <= 15 * 60) return 120 + (M - 13 * 60);
  return 240;
}

const TOTAL_TRADING_MINUTES = 240;

/**
 * 判定当前是否可运行，以及数据口径。
 * @param {object} p
 *   - cfg        配置（cfg.session / cfg.market）
 *   - now        dayjs 时刻（默认当前北京时间）；可注入便于测试
 *   - marketDate 行情时间戳推导出的交易日 'YYYY-MM-DD'（可为 null：尚未抓行情）
 *   - force      忽略所有时段限制（用于 --force 补跑 / 离线回放）
 * @returns {{ok:boolean, reason:string, mode:'cut'|'observe'|'invalid', tradeDate:string|null,
 *            cutTime:string, cutMinutes:number, elapsed:number, estimateFullDay:boolean}}
 */
function sessionState({ cfg, now = null, marketDate = null, force = false }) {
  const d = now || nowBjt();
  const s = cfg.session;
  const today = d.format('YYYY-MM-DD');
  const day = d.day();                     // 0=周日 6=周六
  const M = minOfDay(d);

  const earliest = hhmmToMin(s.earliest);
  const observeFrom = hhmmToMin(s.observeFrom);
  const cutAt = hhmmToMin(s.cutAt);
  const close = hhmmToMin(s.close);
  const graceEnd = close + (s.graceMinutesAfterClose || 0);

  const base = {
    mode: 'invalid', cutTime: s.cutAt, cutMinutes: cutAt,
    elapsed: elapsedTradingMinutes(Math.min(M, close)),
    estimateFullDay: M >= close,
  };

  if (force) {
    // 强制模式：口径按已收盘处理（分时数据已完整），交易日取行情日期或今天
    return {
      ...base,
      ok: true,
      mode: 'cut',
      reason: '强制模式（忽略时段与交易日限制）',
      tradeDate: marketDate || today,
      elapsed: TOTAL_TRADING_MINUTES,
      estimateFullDay: true,
    };
  }

  if (day === 0 || day === 6) {
    return { ...base, ok: false, reason: `今天是${day === 0 ? '周日' : '周六'}，非交易日` , tradeDate: null };
  }
  if (M < earliest) {
    return { ...base, ok: false, reason: `当前 ${d.format('HH:mm')} 早于开盘可运行时点 ${s.earliest}`, tradeDate: null };
  }
  if (M > graceEnd) {
    return { ...base, ok: false, reason: `当前 ${d.format('HH:mm')} 已超出收盘后补跑宽限期（至 ${String(Math.floor(graceEnd / 60)).padStart(2, '0')}:${String(graceEnd % 60).padStart(2, '0')}）`, tradeDate: null };
  }
  // 行情终筛：今天到底有没有开盘
  if (marketDate && marketDate !== today) {
    return { ...base, ok: false, reason: `行情日期为 ${marketDate}，今日（${today}）未开盘（休市/停牌）`, tradeDate: marketDate };
  }

  if (M < observeFrom) {
    const mins = observeFrom - M;
    return {
      ...base, ok: false, tradeDate: today,
      reason: `当前 ${d.format('HH:mm')} 未到尾盘观察时点 ${s.observeFrom}（还差 ${mins} 分钟）`,
    };
  }

  if (M >= cutAt) {
    return {
      ...base, ok: true, mode: 'cut', tradeDate: today,
      reason: `标准口径：按 ${s.cutAt} 截断取数`,
      cutTime: s.cutAt, cutMinutes: cutAt,
      elapsed: elapsedTradingMinutes(Math.min(M, close)),
      estimateFullDay: M >= close,
    };
  }

  // 14:30 ≤ now < 14:50 —— 观察模式
  return {
    ...base, ok: true, mode: 'observe', tradeDate: today,
    reason: `观察模式：未到 ${s.cutAt}，按当前时点 ${d.format('HH:mm')} 取数（口径会变，结果仅供参考）`,
    cutTime: d.format('HH:mm'), cutMinutes: M,
    elapsed: elapsedTradingMinutes(M),
    estimateFullDay: false,
  };
}

/** 收盘预估量比：即时量比 × (240 / 已交易分钟)。量能非匀速，故仅作参考并需在报告中标注「估算」。 */
function estimateFullDayVolRatio(volRatio, elapsed) {
  if (!volRatio || !elapsed || elapsed <= 0) return null;
  if (elapsed >= TOTAL_TRADING_MINUTES) return volRatio;
  return volRatio * (TOTAL_TRADING_MINUTES / elapsed);
}

module.exports = {
  nowBjt, hhmmToMin, minOfDay, stampToDate,
  elapsedTradingMinutes, sessionState, estimateFullDayVolRatio,
  TOTAL_TRADING_MINUTES, TZ,
};
