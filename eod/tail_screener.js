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
 *   node eod/tail_screener.js --now "2026-09-18 14:55" # 指定时刻（测试 / 补跑）
 *   node eod/tail_screener.js --force                  # 忽略时段，按 14:50 口径取数
 *   node eod/tail_screener.js --no-notify              # 不推送（测试用）
 *   node eod/tail_screener.js --replay data/eod-2026-09-18.json
 *                                                      # 离线回放：从存档重建报告，不抓行情
 *   node eod/tail_screener.js --json                   # stdout 输出机器可读摘要
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const cfg = require('./tail.config');
const { sessionState, estimateFullDayVolRatio, nowBjt } = require('./lib/trading');
const market = require('./lib/market');
const { buildCandidates } = require('./lib/screen');
const { saveRun, loadDay } = require('./lib/store');
const { syncTailRun } = require('./lib/store_d1');
const { buildHTML } = require('./lib/report');
const { notify } = require('../notify');

// ---------- CLI ----------
const argv = process.argv.slice(2);
function argOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}
const OPT = {
  now: argOf('--now'),
  force: argv.includes('--force'),
  wait: argv.includes('--wait'),
  noNotify: argv.includes('--no-notify'),
  json: argv.includes('--json'),
  noD1: argv.includes('--no-d1'),
  replay: argOf('--replay'),
};

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

// ---------- 主流程 ----------
async function run() {
  const t0 = Date.now();

  // 离线回放不依赖任何行情与时段（ Sundays 也要能重建报告）
  if (OPT.replay) return runReplay(OPT.replay);

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
  let ss = sessionState({ cfg, now, force: OPT.force });
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
  ss = sessionState({ cfg, now, marketDate: snap.meta.marketDate, force: OPT.force });
  log(`[时段] ${ss.reason}`);
  if (!ss.ok) { log('[结束] 跳过本次运行'); return { skipped: ss.reason }; }

  // 2. 初筛
  const segFrom = cfg.session.observeFrom.replace(':', '');
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
    tradeDate: ss.tradeDate, mode: ss.mode, cutHHMM, segFrom, result, meta: snap.meta, _t0: t0,
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
  const { tradeDate, mode, cutHHMM, segFrom, result, meta } = p;

  // 落库
  let saved = null;
  if (!p.skipStore) {
    saved = saveRun({ cfg, tradeDate, mode, cutHHMM, result, runner: RUNNER });
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
  const reportDir = path.join(__dirname, cfg.store.reportDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const suffix = mode === 'observe' ? `-obs${cutHHMM}` : '';
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
