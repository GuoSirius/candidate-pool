'use strict';
/*
 * eod/lib/trading.selftest.js —— 时段守卫与三种口径的回归自测
 * ---------------------------------------------------------------------------
 * 为什么必须有：`sessionState()` 决定「这一刻能不能跑、按哪个口径取数」，
 * 它同时承担两个互相矛盾的目标：
 *   · 守卫 —— 定时任务在 14:30 之前触发时必须**拒绝**（否则产出 0 候选空报告并推送）；
 *   · 盘中模式 —— 人工加 --intraday 时必须**放行**（否则盘中自查无从下手）。
 * 这类「一个开关控制相反行为」的逻辑极易被后人顺手放开或收紧，
 * 故用可重跑的断言把两条路径都钉住。
 *
 * 运行：node eod/lib/trading.selftest.js    （退出码非 0 = 失败）
 * 纯函数 + 注入时刻，不联网、不写任何文件。
 */

const { dayjs } = require('../../time');
const { sessionState, clampToTradedMinute, fmtMin } = require('./trading');

const cfg = require('../tail.config');
const TZ = 'Asia/Shanghai';

let failed = 0;
function check(name, cond, detail) {
  console.log(`${cond ? '  OK  ' : '    '}${name}${cond || detail === undefined ? '' : `  → ${detail}`}`);
  if (!cond) failed++;
}

/** 造一个北京时间时刻 */
const at = (s) => dayjs.tz(`2026-09-21 ${s}`, TZ);
/** 周六 / 周日（2026-09-19 / 09-20） */
const sat = (s) => dayjs.tz(`2026-09-19 ${s}`, TZ);

function run(opts) { return sessionState({ cfg, ...opts }); }

console.log('\n[1] 守卫：不加 --intraday 时，14:30 之前必须拒绝');
for (const t of ['09:35', '11:40', '13:10', '14:29']) {
  const r = run({ now: at(t) });
  check(`${t} 无参数 → ok=false`, r.ok === false, `ok=${r.ok} mode=${r.mode} reason=${r.reason}`);
  check(`${t} 拒绝理由提示 --intraday`, /--intraday/.test(r.reason), r.reason);
}

console.log('\n[2] 盘中模式：加 --intraday 后必须放行，且段=滚动窗口');
const i1120 = run({ now: at('11:20'), intraday: true });
check('11:20（盘中）→ ok=true', i1120.ok === true, JSON.stringify(i1120));
check('11:20（盘中）→ mode=intraday', i1120.mode === 'intraday', i1120.mode);
check('11:20（盘中）→ cut=11:20', i1120.cutTime === '11:20', i1120.cutTime);
check('11:20（盘中）→ segFrom=1100（20 分钟窗口）', i1120.segFrom === '1100', i1120.segFrom);

// 注意 11:40 已过 11:30，属**午休**：分时里没有 11:31–12:59 的 K 线，
// 故 cut 必须夹到 11:30（而不是显示 11:40 却取到 11:30 的数据 → 误导）。
const i1140 = run({ now: at('11:40'), intraday: true });
check('11:40（午休）→ cut 夹到 11:30', i1140.cutTime === '11:30', i1140.cutTime);
check('11:40（午休）→ segFrom=1110', i1140.segFrom === '1110', i1140.segFrom);

const i1230 = run({ now: at('12:30'), intraday: true });
check('12:30（午休）→ cut 夹到 11:30', i1230.cutTime === '11:30', i1230.cutTime);
check('12:30（午休）→ segFrom=1110', i1230.segFrom === '1110', i1230.segFrom);

const i0935 = run({ now: at('09:35'), intraday: true });
check('09:35 → segFrom 不早于开盘 09:30', i0935.segFrom === '0930', i0935.segFrom);
check('09:35 → cut=09:35', i0935.cutTime === '09:35', i0935.cutTime);

const i1310 = run({ now: at('13:10'), intraday: true });
check('13:10 → cut=13:10', i1310.cutTime === '13:10', i1310.cutTime);
check('13:10 → segFrom=1250', i1310.segFrom === '1250', i1310.segFrom);

console.log('\n[3] 盘中模式不夺权：14:30 之后仍走观察/正式口径');
const o1435 = run({ now: at('14:35') });
check('14:35 无参数 → observe', o1435.mode === 'observe', o1435.mode);
check('14:35 无参数 → segFrom=1430（固定起点）', o1435.segFrom === '1430', o1435.segFrom);
const i1435 = run({ now: at('14:35'), intraday: true });
check('14:35 加 --intraday → 仍 observe（开关无副作用）', i1435.mode === 'observe', i1435.mode);
check('14:35 加 --intraday → 仍 observe 且 segFrom=1430', i1435.segFrom === '1430', i1435.segFrom);

const c1455 = run({ now: at('14:55') });
check('14:55 → cut', c1455.mode === 'cut', c1455.mode);
check('14:55 → cutTime=14:50', c1455.cutTime === '14:50', c1455.cutTime);
check('14:55 → segFrom=1430', c1455.segFrom === '1430', c1455.segFrom);
const c1600 = run({ now: at('16:00') });
check('16:00 → cut（收盘后宽限期内补跑）', c1600.ok === true && c1600.mode === 'cut', JSON.stringify(c1600.mode));

console.log('\n[4] 盘中模式也守交易日边界');
check('周六 11:00 + --intraday → 拒绝', run({ now: sat('11:00'), intraday: true }).ok === false);
check('09:00 + --intraday → 拒绝（早于开盘）', run({ now: at('09:00'), intraday: true }).ok === false);
check('18:00 + --intraday → 拒绝（超宽限期）', run({ now: at('18:00'), intraday: true }).ok === false);
check('14:40 行情日期为上一交易日 → 拒绝',
  run({ now: at('14:40'), marketDate: '2026-09-18' }).ok === false);

console.log('\n[5] 开关可被配置彻底禁用（intraday.enabled=false）');
const cfgOff = { ...cfg, session: { ...cfg.session, intraday: { enabled: false, segMinutes: 20 } } };
const off = sessionState({ cfg: cfgOff, now: at('11:40'), intraday: true });
check('enabled=false 时传参也拒绝', off.ok === false, JSON.stringify(off.reason));
check('默认配置里 intraday.enabled 为 true', cfg.session.intraday.enabled === true);

console.log('\n[6] --force 语义不变');
const f = run({ now: at('11:40'), force: true });
check('force → ok=true / mode=cut', f.ok === true && f.mode === 'cut', `${f.mode}`);
check('force → segFrom 固定 1430', f.segFrom === '1430', f.segFrom);

console.log('\n[7] 辅助函数');
check('clampToTradedMinute: 12:00 → 11:30', clampToTradedMinute(12 * 60) === 11 * 60 + 30);
check('clampToTradedMinute: 13:00 → 13:00', clampToTradedMinute(13 * 60) === 13 * 60);
check('clampToTradedMinute: 15:30 → 15:00', clampToTradedMinute(15 * 60 + 30) === 15 * 60);
check('clampToTradedMinute: 08:00 → 09:30', clampToTradedMinute(8 * 60) === 9 * 60 + 30);
check('fmtMin: 555 → 09:15', fmtMin(555) === '09:15');

console.log(failed ? `\n自我检查失败：${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
