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
const { sessionState, clampToTradedMinute, backTradedMinutes, fmtMin } = require('./trading');
// 端到端那一节要用真实的 tailMetrics + 合成分时（不联网）：只有它才能证明
// 「起点 K 线真的存在」，而不是只证明字符串算对了。
const { tailMetrics } = require('./market');

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

// 跨午休：13:10 的「最近 20 分钟」**不是** 12:50（午休里没有 K 线），
// 而是 11:20→11:30 + 13:00→13:10。曾经这里写的是墙钟减法 `cut - 20`，
// 结果起点落进午休、tailMetrics 取不到起点 K 线 → 下午开盘后 20 分钟内跑盘中模式
// 静默 0 候选。下面的断言把这个坑钉死。
const i1310 = run({ now: at('13:10'), intraday: true });
check('13:10 → cut=13:10', i1310.cutTime === '13:10', i1310.cutTime);
check('13:10 → segFrom=1120（跨午休，不是 1250）', i1310.segFrom === '1120', i1310.segFrom);

const i1300 = run({ now: at('13:00'), intraday: true });
check('13:00（刚开盘）→ segFrom=1110（退到上午）', i1300.segFrom === '1110', i1300.segFrom);

const i1305 = run({ now: at('13:05'), intraday: true });
check('13:05 → segFrom=1115', i1305.segFrom === '1115', i1305.segFrom);

const i1329s30 = run({ now: at('13:29'), intraday: true, segMinutes: 30 });
check('13:29 + seg=30 → segFrom=1129（下午 29 分 + 上午 1 分）', i1329s30.segFrom === '1129', i1329s30.segFrom);

const i1400 = run({ now: at('14:00'), intraday: true });
check('14:00（下午盘中）→ segFrom=1340（不跨午休）', i1400.segFrom === '1340', i1400.segFrom);

// --seg-minutes 的显式覆盖必须真生效（不只是记在元数据里）
const i1335s40 = run({ now: at('13:35'), intraday: true, segMinutes: 40 });
check('13:35 + seg=40 → segFrom=1125（下午 35 分 + 上午 5 分）', i1335s40.segFrom === '1125', i1335s40.segFrom);
check('13:35 默认 seg=20 → segFrom=1315（对照：同一时刻窗口更短，确实被参数改变了）',
  run({ now: at('13:35'), intraday: true }).segFrom === '1315',
  run({ now: at('13:35'), intraday: true }).segFrom);
check('segMinutes 会随返回值带出（供存档 / 文件命名）', i1329s30.segMinutes === 30, String(i1329s30.segMinutes));
check('正式/观察口径 segMinutes 为 undefined（不是滚动窗口）',
  run({ now: at('14:35') }).segMinutes === undefined, String(run({ now: at('14:35') }).segMinutes));

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
// backTradedMinutes：起点必须落在**已成交**分钟上（午休区间内一律非法）
const inLunch = (hhmm) => {
  const m = (+hhmm.slice(0, 2)) * 60 + (+hhmm.slice(2, 4));
  return m > 11 * 60 + 30 && m < 13 * 60;
};
check('backTradedMinutes: 13:10 退 20 → 11:20', backTradedMinutes(13 * 60 + 10, 20) === 11 * 60 + 20);
check('backTradedMinutes: 13:10 退 30 → 11:10', backTradedMinutes(13 * 60 + 10, 30) === 11 * 60 + 10);
check('backTradedMinutes: 14:00 退 20 → 13:40', backTradedMinutes(14 * 60, 20) === 13 * 60 + 40);
check('backTradedMinutes: 11:20 退 20 → 11:00', backTradedMinutes(11 * 60 + 20, 20) === 11 * 60);
check('backTradedMinutes: 09:35 退 20 → 09:30（不早于开盘）', backTradedMinutes(9 * 60 + 35, 20) === 9 * 60 + 30);
check('backTradedMinutes: 12:30（午休）退 20 → 11:10', backTradedMinutes(12 * 60 + 30, 20) === 11 * 60 + 10);
// 全时段扫描：任何 cut / 任何窗口，起点都不得落进午休
let lunchHits = 0;
for (let cut = 9 * 60 + 30; cut <= 15 * 60; cut++) {
  for (const n of [1, 5, 20, 30, 60, 120]) {
    const f = backTradedMinutes(cut, n);
    if (inLunch(fmtMin(f).replace(':', ''))) lunchHits++;
  }
}
check('backTradedMinutes: 全天 × 各窗口长度扫描，起点均不落午休', lunchHits === 0, `${lunchHits} 处落入午休`);

console.log('\n[8] 端到端：下午刚开盘时起点 K 线必须真的存在（历史 bug：静默 0 候选）');
// 造一天的合法分时：09:30–11:30 + 13:00–15:00（午休无 K 线，与真实接口一致）
function mkMinuteRows() {
  const rows = [];
  let p = 10;
  const push = (m) => {
    p = +(p * 1.0005).toFixed(3);
    rows.push({ t: `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`, price: p, cumVol: 1000, cumAmt: p * 1000 });
  };
  for (let m = 9 * 60 + 30; m <= 11 * 60 + 30; m++) push(m);
  for (let m = 13 * 60; m <= 15 * 60; m++) push(m);
  return rows;
}
const rows = mkMinuteRows();
for (const t of ['09:40', '10:30', '11:20', '11:45', '12:30', '13:00', '13:05', '13:10', '13:29', '14:00']) {
  const ss = run({ now: at(t), intraday: true });
  const tm = tailMetrics(rows, 'sz000001', ss.cutTime.replace(':', ''), ss.segFrom);
  check(`${t} → segFrom=${ss.segFrom} 能算出段指标`, tm !== null && tm.segPct !== undefined,
    tm ? `segPct=${tm.segPct.toFixed(2)}% bars=${tm.bars}` : 'null（会被判 data_gap 剔除）');
}

console.log('\n[9] 落库口径：内部口径必须翻译成 D1/API 的 formal / observe');
// 历史 bug（2026-09-21）：本地内部把「14:50 固定口径」叫 `cut`，落库时原样写进 D1 →
//   · 记录页把正式运行显示成「观察」（前端 else 兜底）；
//   · /api/tail/run?mode=cut 被 worker 拒成 10003「mode 只能为 formal / observe」；
//   · 口径对照页找不到 formal 行 → 整页为空。
{
  const { d1Mode } = require('./store_d1');
  check('cut → formal（14:50 固定口径的旧叫法）', d1Mode('cut') === 'formal', d1Mode('cut'));
  check('formal → formal（幂等，重跑不会写成别的）', d1Mode('formal') === 'formal');
  check('observe → observe', d1Mode('observe') === 'observe');
  check('intraday → intraday（2026-09-22 起盘中版合法入库）', d1Mode('intraday') === 'intraday');
  let threw = false;
  try { d1Mode('bogus'); } catch (_) { threw = true; }
  check('未知口径直接抛错（绝不往 D1 写第四种口径）', threw);
}

console.log('\n[10] 落库 SQL：列数 / 占位符数 / 参数数 必须三者一致，且列清单对齐 schema.sql');
// 历史 bug（2026-09-21）：tail_pick 列清单 33 列但 VALUES 手写了 32 个 `?`
//   → 每条候选插入报 `7500 32 values for 33 columns`；db/d1client 的 batch 是
//     「分片 Promise.all」不是事务，tail_run 在第一批已提交 → 线上只剩运行记录、
//     候选一条没有（网页主表 / 分行业明细 / 口径对照全空）。
// 现在占位符由列清单派生，这里再把「列清单 vs schema.sql」钉住，
// 防止 schema 加了列而 store_d1 没跟上（反向漂移同样会让插入失败）。
{
  const fs = require('fs');
  const path = require('path');
  const { SQL, COLS, buildStatements } = require('./store_d1');

  for (const [name, sql] of Object.entries(SQL)) {
    const cols = sql.match(/INSERT INTO \w+ \(([^)]*)\)/)[1].split(',').length;
    const holders = sql.match(/VALUES \(([^)]*)\)/)[1].split(',').length;
    check(`${name}：占位符数(${holders}) = 列数(${cols})`, holders === cols);
  }

  // 从 db/schema.sql（唯一真相源）解析建表列名
  const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');
  const schemaCols = (table) => {
    const m = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
    if (!m) return null;
    return m[1].split('\n')
      .map((l) => l.replace(/--.*$/, '').trim())
      .filter((l) => l && !/^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|CHECK)\b/i.test(l))
      .map((l) => l.split(/\s+/)[0].replace(/["`[\]]/g, ''));
  };
  for (const [table, colList] of [['tail_run', COLS.RUN_COLS], ['tail_pick', COLS.PICK_COLS]]) {
    const fromSchema = schemaCols(table);
    check(`${table}：列清单与 schema.sql 完全一致（顺序敏感）`,
      fromSchema !== null && JSON.stringify(fromSchema) === JSON.stringify(colList),
      fromSchema === null ? 'schema.sql 未解析到该表' : `schema=${fromSchema.length} 列 / 代码=${colList.length} 列`);
  }

  // 真造一份 doc 走 buildStatements，断言每条语句的 params 数与占位符数相等
  const doc = {
    tradeDate: '2026-01-01', mode: 'cut', cutAt: '1450', updatedAt: '2026-01-01 14:50:00',
    runs: [{ at: '2026-01-01 14:50:00', runner: 'local' }],
    stats: { candidateCount: 1, groupCount: 1, prePassCount: 2, snapshotCount: 3 },
    records: {
      sh600000: {
        code: 'sh600000', name: '浦发银行', sector: '银行', board: 'sh', boardLabel: '上海',
        price: 10, prevClose: 9.9, high: 10.1, chgPct: 1.01, turnover: 1.2, volRatio: 1.3,
        volRatioEst: 1.4, floatCapYi: 100, avgPrice: 9.95, groupRank: 1, bestInGroup: true,
        groupSize: 1, total: 88, sectorMedianChg: 0.5, sectorRank: 1, sectorTotal: 1,
        tail: { segPct: 1.2, upRatio: 0.7, maxDrawdownPct: -0.3, priceVsAvgPct: 0.5, avgAtCut: 9.95, p0: 9.9, p1: 10, bars: [9.9, 10] },
        score: { momentum: 25 }, fill: {},
      },
    },
  };
  const built = buildStatements(doc);
  const stmts = [built.runStmt, ...built.pickStmts];
  check(`buildStatements 产出 1 行运行 + 1 行候选`, stmts.length === 2);
  const mismatch = stmts.filter((s) => {
    const holders = s.sql.match(/VALUES \(([^)]*)\)/)[1].split(',').length;
    return s.params.length !== holders;
  });
  check('每条的 params 数 = 占位符数', mismatch.length === 0,
    mismatch.length ? `${mismatch.length} 条不匹配（首条 params=${mismatch[0].params.length}）` : '');
  check('口径已翻译：buildStatements 里没有 cut', !JSON.stringify(built.runStmt.params).includes('cut'));
}

console.log('\n[11] 落库文件名：观察 / 盘中默认一天一个（不带时点），--stamp 才带');
// 历史做法：观察模式按 `-obs<HHMM>` 命名 → 文件名取决于启动分钟（同一天 14:30 与 14:32 两次
// 观察会落成两个文件），文档 / --replay 无法写死，且与 D1「(trade_date, mode) 一天一行」的
// 粒度对不上。现与盘中统一：默认一天一个，多次运行靠 runs[] 留痕，时点另存 doc.cutAt。
// 放在本套自检里，是因为 `npm run tail:selftest` 就是尾盘的唯一自检入口（无 store.selftest.js）。
{
  const { daySuffix, dayFile } = require('./store');
  const cfg = { store: { dataDir: 'data' } };

  check('正式 → 无后缀', daySuffix('cut', '1450') === '');
  check('观察 → -obs（不含时点）', daySuffix('observe', '1431') === '-obs');
  check('观察 + --stamp → -obs1431', daySuffix('observe', '1431', { stamp: true }) === '-obs1431');
  check('盘中 → -intraday（不含时点）', daySuffix('intraday', '1310') === '-intraday');
  check('盘中 + --stamp → 带时点与窗口', daySuffix('intraday', '1310', { stamp: true, segMinutes: 20 }) === '-intraday1310-w20');

  // 核心不变量：默认文件名与运行时点无关（同一天任意时刻 → 同一个文件）
  const pathA = dayFile(cfg, '2026-09-21', 'observe', '1431');
  const pathB = dayFile(cfg, '2026-09-21', 'observe', '1445');
  check('观察：不同时点落到同一文件（一天一个）', pathA === pathB && pathA.endsWith('eod-2026-09-21-obs.json'), pathA);
  check('盘中：不同时点落到同一文件（一天一个）',
    dayFile(cfg, '2026-09-21', 'intraday', '1030') === dayFile(cfg, '2026-09-21', 'intraday', '1400'));
  check('观察 / 盘中 / 正式三者互不覆盖',
    new Set([pathA, dayFile(cfg, '2026-09-21', 'intraday', '1431'), dayFile(cfg, '2026-09-21', 'cut', '1450')]).size === 3);
  check('--stamp 让观察按时点分文件（显式要求才分）',
    dayFile(cfg, '2026-09-21', 'observe', '1431', { stamp: true }) !== dayFile(cfg, '2026-09-21', 'observe', '1445', { stamp: true }));
}

console.log(failed ? `\n自我检查失败：${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
