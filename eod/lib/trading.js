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
 *        now <  observeFrom + intraday=true → mode='intraday'（**显式** --intraday 才走）
 *                                            取到当前已成交的最后一分钟，段 = 最近 segMinutes 分钟
 *
 * 关于「时段守卫」：默认（不传 --intraday）在 14:30 之前一律 ok:false，这是**有意保留**的——
 * 定时任务在用户机器上按点触发，若允许早跑就会产出 0 候选的空报告并推送。想看盘中近似口径，
 * 必须显式加 --intraday（见 eod/tail.config.js 的 session.intraday 说明）。
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

/** 分钟数 -> 'HH:MM' */
function fmtMin(m) {
  const x = Math.max(0, Math.min(24 * 60 - 1, Math.round(m)));
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
}

/**
 * 把分钟数夹到「最后一根已成交的分时」。
 * A 股分时是 09:30–11:30 / 13:00–15:00，**午休 11:30–13:00 没有任何 K 线**，
 * 所以 12:xx 时若拿当前时钟当 cut，取到的其实是 11:30 那根。
 * 这里显式夹一下，让报告里显示的「口径 HH:MM」与实际取数的时点一致（不误导）。
 */
function clampToTradedMinute(M) {
  const open = 9 * 60 + 30;
  const noon = 11 * 60 + 30;
  const noonEnd = 13 * 60;
  const close = 15 * 60;
  if (M <= open) return open;
  if (M <= noon) return M;
  if (M < noonEnd) return noon;
  if (M <= close) return M;
  return close;
}

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
 *   - intraday   盘中模式（--intraday）：在尾盘观察时点之前也允许运行，
 *                尾盘段改用「cut 往前 segMinutes 分钟」的滚动窗口。
 *                **默认 false** —— 不传则一切照旧（时段守卫原样保留）。
 *   - segMinutes 覆盖盘中模式的滚动窗口长度（分钟）。不传则用 cfg.session.intraday.segMinutes。
 * @returns {{ok:boolean, reason:string, mode:'cut'|'observe'|'intraday'|'invalid',
 *            tradeDate:string|null, cutTime:string, cutMinutes:number, segFrom:string,
 *            elapsed:number, estimateFullDay:boolean}}
 *          segFrom：尾盘段起点的 'HHMM'（正式/观察 = 固定 14:30；盘中 = 滚动窗口）
 */
function sessionState({ cfg, now = null, marketDate = null, force = false, intraday = false, segMinutes = null }) {
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

  // 尾盘段的**默认**起点：正式 / 观察口径都固定从 observeFrom（14:30）起算。
  // 盘中模式会用滚动窗口覆盖它 —— 故三种模式统一在返回值里带 segFrom，
  // 调用方只读 ss.segFrom，不要再各自去 cfg.session.observeFrom 里取（否则盘中模式会取错）。
  const segFromDefault = s.observeFrom.replace(':', '');

  const base = {
    mode: 'invalid', cutTime: s.cutAt, cutMinutes: cutAt, segFrom: segFromDefault,
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
    // ---- 盘中模式（--intraday）：尾盘时点之前也允许跑 ----
    // 段改成「cut 往前 segMinutes 分钟」的滚动窗口，因为此时分时里根本没有 14:30 那一根
    // （tailMetrics 要求起点 K 线存在，否则整只票会被判为 data_gap → 盘中跑必然 0 候选）。
    // **默认关闭**：不传 --intraday 时下面那条 ok:false 就是时段守卫，防止定时任务/上午误触发空跑。
    const ic = s.intraday || {};
    if (intraday && ic.enabled !== false) {
      const segMin = Math.max(1, Math.round(segMinutes || ic.segMinutes || 20));
      const cut = clampToTradedMinute(M);
      const from = Math.max(earliest, cut - segMin);
      return {
        ...base, ok: true, mode: 'intraday', tradeDate: today,
        reason: `盘中模式：未到 ${s.observeFrom}，按当前时点 ${fmtMin(cut)} 取数，`
          + `尾盘段用最近 ${segMin} 分钟（${fmtMin(from)}→${fmtMin(cut)}）近似，口径未固定`,
        cutTime: fmtMin(cut), cutMinutes: cut,
        segFrom: fmtMin(from).replace(':', ''),
        segMinutes: segMin,
        elapsed: elapsedTradingMinutes(cut),
        estimateFullDay: false,
      };
    }
    const mins = observeFrom - M;
    return {
      ...base, ok: false, tradeDate: today,
      reason: `当前 ${d.format('HH:mm')} 未到尾盘观察时点 ${s.observeFrom}（还差 ${mins} 分钟）`
        + `；如需盘中近似口径，加 --intraday`,
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
  nowBjt, hhmmToMin, minOfDay, fmtMin, clampToTradedMinute,
  stampToDate,
  elapsedTradingMinutes, sessionState, estimateFullDayVolRatio,
  TOTAL_TRADING_MINUTES, TZ,
};
