'use strict';
/*
 * eod/tail_screener.js —— 尾盘选股入口（FR-01 ~ FR-11 的编排层）
 * ---------------------------------------------------------------------------
 * 流程：
 *   1. 时段判定（sessionState）：非交易日 / 未到观察点 / 超宽限期 → 跳过或告警退出
 *   2. 全市场快照（fullMarketSnapshot）→ 行情时间戳众数推交易日 → 复核时段
 *   3. 初筛（preFilter）→ 幸存者抓分时（fetchMinutes，限速 + 熔断）
 *   4. buildCandidates：尾盘段校验 → 六项打分 → 行业分组
 *   5. 幂等落库（store.saveRun）→ 双语 HTML 报告 → notify（微信 + 邮箱）
 *
 * 用法：
 *   node eod/tail_screener.js                          # 正常运行（受时段限制）
 *   node eod/tail_screener.js --intraday               # 盘中模式：14:30 前也可跑，段=最近 20 分钟
 *   node eod/tail_screener.js --intraday --stamp        # 盘中模式并在文件名里保留时点
 *                                                      #   默认**不带时点**（一天一个文件，多次运行靠 runs[] 留痕）；
 *                                                      #   要对比不同窗口/不同时刻的完整 records 时才加 --stamp。
 *   node eod/tail_screener.js --intraday --seg-minutes 30
 *                                                      # 盘中模式的段长改用 30 分钟（默认 20）
 *                                                      #   注意：段长变了，尾盘段门槛（tailSegMinPct=0.5）
 *                                                      #   与满分线（2.0%）是按 20 分钟标定的，跨窗口
 *                                                      #   比较前先看 tail.config.js 的注释。
 *   node eod/tail_screener.js --now "2026-09-18 14:55" # 指定时刻（测试 / 补跑）
 *   node eod/tail_screener.js --force                  # 忽略时段，按 14:50 口径取数
 *   node eod/tail_screener.js --no-notify              # 不推送（测试用）
 *   node eod/tail_screener.js --replay data/eod-2026-09-18.json
 *                                                      # 离线回放：从存档重建报告，不抓行情
 *   node eod/tail_screener.js --resync data/eod-2026-09-21.json
 *                                                      # 把存档**重新同步到 D1**（不抓行情、不改本地
 *                                                      #   归档、不推送）。落库链路修好后用它补历史；
 *                                                      #   可传多份；会先清掉 mode 非 formal/observe
 *                                                      #   的遗留行，再按 d1Mode() 翻译后 UPSERT。
 *   node eod/tail_screener.js --json                   # stdout 输出机器可读摘要
 *   node eod/tail_screener.js --paths                  # 打印工作目录与归档/报告落点，不抓行情
 *   node eod/tail_screener.js --init                   # 补齐工作目录（首次运行会自动执行）
 *
 * 时段守卫（默认保留，别去掉）：
 *   不加参数时，14:30 之前一律「未到尾盘观察时点」→ 跳过且不产出任何文件。
 *   这是为定时任务设计的护栏（避免上午空跑推送 0 候选）。要盘中随手看一眼，
 *   用 --intraday：它**自动**关闭 D1 同步与推送，并另存 eod-<日>-intraday.json，
 *   绝不覆盖当天的正式口径文件（默认一天一个文件，多次运行记在 runs[]；
 *   要完整对比某一时刻的 records 时再加 --stamp）。
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const cfg = require('./tail.config');
const { sessionState, estimateFullDayVolRatio, nowBjt } = require('./lib/trading');
const market = require('./lib/market');
const { buildCandidates } = require('./lib/screen');
const { saveRun, loadDay, daySuffix } = require('./lib/store');
const { syncTailRun, cleanupLegacyModes, d1Mode } = require('./lib/store_d1');
const { buildHTML } = require('./lib/report');
const { notify } = require('../notify');
const paths = require('../paths');
// 首次运行脚手架：空工作目录时补齐目录（尾盘不依赖 candidates.json，但归档/报告目录要存在）
const scaffold = require('../scaffold');

// ---------- CLI ----------
const argv = process.argv.slice(2);
function argOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}
function argsOf(flag) {
  const out = [];
  argv.forEach((v, i) => { if (v === flag && argv[i + 1]) out.push(argv[i + 1]); });
  return out;
}
const OPT = {
  now: argOf('--now'),
  force: argv.includes('--force'),
  wait: argv.includes('--wait'),
  intraday: argv.includes('--intraday'),
  segMinutes: Number(argOf('--seg-minutes')) || null,
  stamp: argv.includes('--stamp'),
  noNotify: argv.includes('--no-notify'),
  json: argv.includes('--json'),
  noD1: argv.includes('--no-d1'),
  replay: argOf('--replay'),
  resync: argsOf('--resync'),
  paths: argv.includes('--paths'),
};

/**
 * 盘中模式（--intraday）是**只读自查**用途：口径本身是滚动窗口近似，
 * 不是当日的正式尾盘结果。故强制关掉「外发」两条链路，避免把近似值
 * 当成正式数据写进 D1（网页 /api/tail/* 会读它）或推送到微信/邮箱。
 * 想改这个行为前先想清楚：D1 的 tail_run/tail_pick 只有 formal/observe 两种口径，
 * 盘中数据一旦写进去，复盘页会把它当成正式记录参与对比。
 */
if (OPT.intraday) {
  OPT.noD1 = true;
  OPT.noNotify = true;
}

/** 运行环境标识：GitHub Actions runner 里 GITHUB_ACTIONS=true */
const RUNNER = process.env.GITHUB_ACTIONS ? 'github' : 'local';

function log(msg) { if (!OPT.json) console.log(msg); }

function fail(msg, err) {
  log(`[失败] ${msg}` + (err ? `\n${err && err.stack || err}` : ''));
  if (cfg.notify.enabled && cfg.notify.alertOnFailure && !OPT.noNotify) {
    notify({ title: `尾盘选股失败 · ${nowBjt().format('MM-DD HH:mm')}`, content: `${msg}\n\n${err && err.message || err || ''}` })
      .then((res) => { for (const [ch, [ok, info]] of res) log(`[notify] ${ch}: ${ok ? 'OK' : '失败'}`); })
      .catch(() => {});
  }
  process.exitCode = 1;
}

// ---------- 离线回放：从存档 JSON 重建报告 ----------
async function runReplay(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!doc.records || !doc.tradeDate) throw new Error('存档格式不对：缺少 records/tradeDate');
  // 存档只存了压缩记录，重建 result 的最小形状即可满足报告渲染
  const candidates = Object.values(doc.records).map((r) => ({
    ...r,
    tail: r.tail || null,
    score: r.score || {},
  }));
  const groupsMap = new Map();
  for (const c of candidates) {
    const k = c.sector || '未分类';
    if (!groupsMap.has(k)) groupsMap.set(k, []);
    groupsMap.get(k).push(c);
  }
  const groups = [...groupsMap.entries()].map(([sector, list]) => {
    list.sort((a, b) => b.total - a.total);
    list.forEach((c, i) => { c.groupRank = i + 1; c.bestInGroup = i === 0; c.groupSize = list.length; });
    return { sector, size: list.length, shown: list.slice(0, cfg.group.maxPerGroup), best: list[0] };
  }).sort((a, b) => b.best.total - a.best.total);
  candidates.sort((a, b) => b.total - a.total);

  const result = {
    candidates, groups,
    top: candidates.slice(0, cfg.group.topN),
    stats: doc.stats || {},
    dropped: [],
  };
  return emitResult({
    tradeDate: doc.tradeDate, mode: doc.mode || 'cut', cutHHMM: doc.cutAt || '1450',
    segFrom: cfg.session.observeFrom.replace(':', ''), result,
    meta: { slots: 0, batches: 0, failedBatches: 0, valid: candidates.length, marketDate: doc.tradeDate, elapsedMs: 0, outlierDates: [] },
    skipStore: true,
  });
}

// ---------- 补发：把本地存档重新同步到 D1 ----------
/**
 * 落库一侧修好之后，用存档把历史数据补进 D1（不抓行情、不写本地 JSON、不推送）。
 * 时序上 D1 只是网页的数据源，本地 JSON 始终是权威归档，所以「重发」是安全的：
 * 用同一份存档再推一次，结果应当与当初成功时一致（UPSERT 幂等）。
 *
 * 补发前会先清掉 mode 不是 formal/observe 的遗留行 —— 2026-09-21 的 14:50 运行曾被
 * 以本地叫法 `cut` 写进去，不清掉的话同一天会出现 `cut` + `formal` 两条同义记录。
 */
async function runResync(files) {
  log(`[补发] 目标 ${files.length} 份存档`);
  const clean = await cleanupLegacyModes();
  if (clean.skipped) log(`[补发] 清理遗留口径：跳过（${clean.reason}）`);
  else log(`[补发] 清理遗留口径：tail_run 删 ${clean.tail_run} 行 / tail_pick 删 ${clean.tail_pick} 行`);

  const report = [];
  for (const f of files) {
    const base = path.basename(f);
    try {
      const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!doc.records || !doc.tradeDate || !doc.mode) {
        throw new Error('存档格式不对：缺少 records / tradeDate / mode');
      }
      const res = await syncTailRun(doc);
      if (res.skipped) log(`[补发] ${base} → 跳过：${res.reason}`);
      else if (res.error) log(`[补发] ${base} → 失败：${res.error}`);
      else {
        log(`[补发] ${base} → D1 ${d1Mode(doc.mode)}（${doc.tradeDate}）：`
          + `${res.picks} 条候选 + 1 行运行记录`);
      }
      report.push({ file: base, tradeDate: doc.tradeDate, mode: d1Mode(doc.mode), ...res });
    } catch (e) {
      log(`[补发] ${base} → 失败：${e.message || e}`);
      report.push({ file: base, error: e.message || String(e) });
    }
  }
  return { resync: report };
}

// ---------- 主流程 ----------
async function run() {
  const t0 = Date.now();

  // --paths：仅打印路径解析结果，便于确认「归档与报告到底写到哪去了」，不抓行情
  if (OPT.paths) {
    const d = paths.describe();
    log(`工作目录: ${d.home}   (来源 ${d.source}${d.relocated ? '' : '，即包/仓库根'})`);
    log('  工作区（随工作目录移动）:');
    for (const [k, v] of Object.entries(d.workspace)) log(`    ${k.padEnd(14)} ${v}`);
    log('  代码资产（永远跟随程序）:');
    for (const [k, v] of Object.entries(d.codeAssets)) log(`    ${k.padEnd(14)} ${v}`);
    return { paths: d };
  }

  // 首次运行脚手架（放在 --paths 之后：纯诊断入口不应产生写入）
  //   --init  仅做初始化然后退出
  //   无参数  静默补齐后**继续正常运行**
  if (argv.includes('--init')) { scaffold.autoInit({ log, init: true }); return { init: true }; }
  scaffold.autoInit({ log });

  // 离线回放不依赖任何行情与时段（ Sundays 也要能重建报告）
  if (OPT.replay) return runReplay(OPT.replay);

  // 补发到 D1 同样不依赖行情与时段（可在任何时刻手动补历史）
  if (OPT.resync.length) return runResync(OPT.resync);

  // --wait：GitHub Actions 的 cron 有 1–5 分钟级延迟，故由程序内等到 14:50 再跑，
  // 保证「分时尾盘段完整 + 口径固定」。（计划任务本地触发时不需要它，但加了也无害）
  if (OPT.wait && !OPT.force) {
    const target = nowBjt().hour(+cfg.session.cutAt.slice(0, 2)).minute(+cfg.session.cutAt.slice(3, 5)).second(10);
    const diffMs = target.diff(nowBjt());
    if (diffMs > 0) {
      log(`[等待] 距 ${cfg.session.cutAt} 还有 ${(diffMs / 60000).toFixed(1)} 分钟，程序内等待…`);
      await new Promise((r) => setTimeout(r, diffMs));
    }
  }

  const now = OPT.now ? nowBjt().year(OPT.now.slice(0, 4)).month(+OPT.now.slice(5, 7) - 1)
    .date(+OPT.now.slice(8, 10)).hour(+OPT.now.slice(11, 13)).minute(+OPT.now.slice(14, 16)).second(0)
    : nowBjt();

  // 第一遍：本地时钟粗筛（还没行情，marketDate 未知）
  let ss = sessionState({ cfg, now, force: OPT.force, intraday: OPT.intraday, segMinutes: OPT.segMinutes });
  log(`[时段] ${ss.reason}`);
  if (!ss.ok) {
    // 非交易日静默跳过（不告警，这是正常情况；Q16 只要求「失败」告警）
    log('[结束] 跳过本次运行');
    return { skipped: ss.reason };
  }

  // 1. 全市场快照
  log('[1/4] 抓取全市场快照…');
  const snap = await market.fullMarketSnapshot(cfg, log);
  if (snap.meta.valid < cfg.market.minValidQuotes) {
    throw new Error(`有效报价 ${snap.meta.valid} 低于红线 ${cfg.market.minValidQuotes}，数据源疑似不可用`);
  }
  log(`      快照 ${snap.meta.valid} 只（交易日 ${snap.meta.marketDate}，${(snap.meta.elapsedMs / 1000).toFixed(1)}s）`);

  // 第二遍：用行情日期终筛（休市日行情时间戳不推进 → marketDate != today）
  ss = sessionState({ cfg, now, marketDate: snap.meta.marketDate, force: OPT.force, intraday: OPT.intraday, segMinutes: OPT.segMinutes });
  log(`[时段] ${ss.reason}`);
  if (!ss.ok) { log('[结束] 跳过本次运行'); return { skipped: ss.reason }; }

  // 2. 初筛
  // 尾盘段起点一律取 ss.segFrom：正式/观察 = 固定 1430，盘中 = 滚动窗口起点。
  // 不要再回退到 cfg.session.observeFrom —— 那样盘中模式会去找不存在的 14:30 K 线 → 0 候选。
  const segFrom = ss.segFrom || cfg.session.observeFrom.replace(':', '');
  const cutHHMM = ss.cutTime.replace(':', '');
  log('[2/4] 初筛过滤…');
  const { preFilter } = require('./lib/screen');
  const { passed, byReason } = preFilter(snap.quotes, cfg, map(), ss.tradeDate);
  log(`      初筛通过 ${passed.length} 只`);

  // 3. 分时抓取（只对幸存者）
  log('[3/4] 抓取分时（尾盘段校验用）…');
  const minutes = await market.fetchMinutes(passed.map((q) => q.code), cfg, log);
  log(`      分时完成，失败 ${[...minutes.values()].filter((m) => m.error).length} 只`);

  // 4. 打分 + 分组
  log('[4/4] 打分与分组…');
  const result = buildCandidates({
    quotes: snap.quotes, minutes, cfg, map: map(), tradeDate: ss.tradeDate,
    cutHHMM, segFrom,
    makeTail: (rows, code, cut, seg) => market.tailMetrics(rows, code, cut, seg),
  });
  // 收盘预估量比（参考值）
  for (const c of result.candidates) c.volRatioEst = estimateFullDayVolRatio(c.volRatio, ss.elapsed);

  return emitResult({
    tradeDate: ss.tradeDate, mode: ss.mode, cutHHMM, segFrom,
    segMinutes: ss.segMinutes ?? null, result, meta: snap.meta, _t0: t0,
  });
}

/** 行业映射缓存（懒加载，一次进程只用一份；sectorOf 期望完整文档结构 {stocks:{...}}） */
let _map = null;
function map() {
  if (_map) return _map;
  const { loadIndustryMap } = require('./lib/sector');
  _map = loadIndustryMap();
  if (_map.count < 3000) log(`[警告] 行业映射仅覆盖 ${_map.count} 只，分组与板块强度会失真`);
  return _map;
}

/** 落库 + 报告 + 通知（live 与 replay 共用） */
async function emitResult(p) {
  const { tradeDate, mode, cutHHMM, segFrom, segMinutes, result, meta } = p;

  // 落库
  let saved = null;
  if (!p.skipStore) {
    saved = saveRun({
      cfg, tradeDate, mode, cutHHMM, result, runner: RUNNER,
      segFrom, segMinutes, stamp: OPT.stamp,
    });
    log(`[落库] ${path.basename(saved.file)}（${saved.recordCount} 条 / 第 ${saved.runCount} 次运行）`);

    // 同步到 D1（网页 /api/tail/* 的数据源）；无 CF_* 凭据或 --no-d1 时跳过本地 JSON 仍保留
    if (saved.doc && !OPT.noD1) {
      const d1res = await syncTailRun(saved.doc);
      if (d1res.skipped) log(`[D1] 跳过：${d1res.reason}`);
      else if (d1res.error) log(`[D1] 同步失败（不影响本地归档）：${d1res.error}`);
      else log(`[D1] 已同步 ${d1res.picks} 条候选 + 1 行运行记录`);
    }
  }

  // 报告
  const reportDir = path.join(paths.eodDir(), cfg.store.reportDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const suffix = daySuffix(mode, cutHHMM, { stamp: OPT.stamp, segMinutes });
  const reportFile = path.join(reportDir, `eod-${tradeDate}${suffix}.html`);
  fs.writeFileSync(reportFile, buildHTML({
    cfg, tradeDate, mode, cutHHMM, segFrom, result, meta, runner: RUNNER,
  }), 'utf8');
  log(`[报告] ${reportFile}`);

  // 通知
  if (cfg.notify.enabled && !OPT.noNotify) {
    const top = result.top.slice(0, cfg.notify.topInMessage);
    const lines = top.map((c, i) =>
      `${i + 1}. ${c.name}（${c.code.replace(/^[a-z]+/, '')}）${c.sector} · 涨${c.chgPct?.toFixed(2)}% · 尾盘段${c.tail?.segPct?.toFixed(2)}% · 量比${c.volRatio?.toFixed(1)} · 总分${c.total.toFixed(1)}`);
    const content = [
      `交易日 ${tradeDate} · ${mode === 'observe' ? '观察模式' : '固定口径'} ${cutHHMM.slice(0, 2)}:${cutHHMM.slice(2)}`,
      `候选 ${result.stats.candidateCount} 只 / ${result.stats.groupCount} 个行业（快照 ${result.stats.snapshotCount} → 初筛 ${result.stats.prePassCount}）`,
      '',
      ...lines,
      '',
      `完整报告见附件（邮件）/ 本地：eod/reports/eod-${tradeDate}${suffix}.html`,
    ].join('\n');
    const res = await notify({ title: `尾盘选股 ${tradeDate}（${result.stats.candidateCount} 只候选）`, content, htmlPath: reportFile });
    for (const [ch, [ok, info]] of res) log(`[notify] ${ch}: ${ok ? 'OK' : '失败 ' + JSON.stringify(info)}`);
  }

  const summary = {
    tradeDate, mode, cutHHMM,
    snapshot: result.stats.snapshotCount,
    prePass: result.stats.prePassCount,
    candidates: result.stats.candidateCount,
    groups: result.stats.groupCount,
    top: result.top.slice(0, 10).map((c) => ({ code: c.code, name: c.name, total: +c.total.toFixed(1) })),
    reportFile, savedFile: saved ? saved.file : p.skipStore ? p.tradeDate : null,
    elapsedMs: Date.now() - (p._t0 || Date.now()),
  };
  if (OPT.json) console.log(JSON.stringify(summary, null, 2));
  return summary;
}

run().catch((e) => fail('尾盘选股流程异常', e));
