'use strict';
/*
 * eod/nextday_backfill.js —— 统一次日回填：给三类归档补 T+1/T+3 表现（verdicts 段）
 * ---------------------------------------------------------------------------
 * 调度：工作日 18:30（盘前回填 18:00 → 游资 18:20 → 本任务）。批次 A3（2026-11-09 方案）。
 *
 * 逻辑：回扫最近 window.days 个「有归档的交易日」，逐管道给缺 verdicts（或 verdicts 不完整）的
 * 记录补 T+1/T+3 三口径判定（eod/lib/verdict.js 纯函数，K 线走腾讯 fqkline，无东财封 IP 风险）：
 *   1. 尾盘     eod/data/eod/eod-<日>.json（含 -obs）   basis = 记录 price（14:50 可成交价）
 *   1b. 盘前    eod/data/preopen/preopen-<日>.json      basis = 当日开盘价（开盘买入口径，A2 随此任务一并覆盖，不再单独排程）
 *   2. 次日选股 data/snapshot-<日>.json（r01.ok 触发票）  basis = T+1 开盘
 *   3. 游资票   eod/data/hotmoney/hotmoney-<日>.json      basis = T+1 开盘
 * verdicts 一律追加段：旧归档缺段不报错；t3 已齐的记录跳过（幂等，不重抓）。
 *
 * 产出：eod/data/perf-weekly.json 滚动聚合（按管道 × 命中率/均值）；由批次 D2 的 eod/weekly_winrate.js（周六 10:00 ACTIVE）读取出简报；
 *       回填后重渲染各管道最新一份正式报告（eod/lib/rerender.js）并打印改动 HTML 清单。
 *
 * 用法：
 *   node eod/nextday_backfill.js            # 常规补齐
 *   node eod/nextday_backfill.js --force    # 忽略已有 verdicts 全量重算
 *   node eod/nextday_backfill.js --days 20  # 回扫窗口覆盖（默认 10）
 *   node eod/nextday_backfill.js --json     # 机器可读汇总
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const cfg = require('./nextday.config');
const paths = require('../paths');
const market = require('./lib/market');
const V = require('./lib/verdict');
const { atomicWriteJSON, readJSONSafe } = require('./lib/atomic');
const { mapLimit } = require('./lib/http');

const OPT = {
  force: argv.includes('--force'),
  days: Math.max(1, parseInt(argOf('--days'), 10) || cfg.window.days),
  json: argv.includes('--json'),
};
const log = (m) => console.log(m);
if (!OPT.json) require('./lib/runlog').startRunLog('nextday');

const warn = (m) => process.stderr.write(`${m}\n`);
/** 6 位代码 → 交易所前缀（对齐 pulse/analyze.js 口径，含北交 920）。
 * 2026-11-10 评审 #7：三处 toFullCode 口径统一收口到 eod/lib/fullcode.js */
function toFullCode(c) {
  return require('./lib/fullcode').toFullCode(c, { fallback: null });
}
/** 记录已有完整 verdicts（t3 出齐）→ 跳过，幂等不重抓 */
function hasComplete(v) {
  return !!(v && v.t3 && v.t3.date);
}

// ---------- 三类归档的枚举与读写（统一抽象：{file, doc, items: [{ref, code, basis}]}） ----------

/** items 元素：ref 取值函数（写回 doc 用）；code 全前缀；basis 买入基准价（null = 用 T+1 开盘） */
function listTail() {
  const dir = path.join(paths.eodDir(), 'data', 'eod');
  const out = [];
  for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : [])) {
    const m = f.match(/^eod-(\d{4}-\d{2}-\d{2})(-obs)?\.json$/);
    if (!m) continue;
    out.push({ dir, file: f, date: m[1], kind: m[2] ? 'tail-obs' : 'tail' });
  }
  // 窗口按「不同交易日」取，不按文件数：尾盘一天有 formal + obs 两份，
  // 按文件 slice 会让 window.days=10 只覆盖 5 个交易日（2026-11-09 评审 #1）。
  return V.sliceByTradingDays(out, OPT.days);
}

function listNextday() {
  const dir = paths.dataDir();
  const out = [];
  for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : [])) {
    const m = f.match(/^snapshot-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    out.push({ dir, file: f, date: m[1], kind: 'nextday' });
  }
  // 窗口按「不同交易日」取，不按文件数：尾盘一天有 formal + obs 两份，
  // 按文件 slice 会让 window.days=10 只覆盖 5 个交易日（2026-11-09 评审 #1）。
  return V.sliceByTradingDays(out, OPT.days);
}

function listPreopen() {
  const dir = path.join(paths.eodDir(), 'data', 'preopen');
  const out = [];
  for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : [])) {
    const m = f.match(/^preopen-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    out.push({ dir, file: f, date: m[1], kind: 'preopen' });
  }
  // 窗口按「不同交易日」取，不按文件数：尾盘一天有 formal + obs 两份，
  // 按文件 slice 会让 window.days=10 只覆盖 5 个交易日（2026-11-09 评审 #1）。
  return V.sliceByTradingDays(out, OPT.days);
}

function listHotmoney() {
  const dir = path.join(paths.eodDir(), 'data', 'hotmoney');
  const out = [];
  for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : [])) {
    const m = f.match(/^hotmoney-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    out.push({ dir, file: f, date: m[1], kind: 'hotmoney' });
  }
  // 窗口按「不同交易日」取，不按文件数：尾盘一天有 formal + obs 两份，
  // 按文件 slice 会让 window.days=10 只覆盖 5 个交易日（2026-11-09 评审 #1）。
  return V.sliceByTradingDays(out, OPT.days);
}

/** 抽出某归档文件里所有待判记录：[{ ref, code, basis }] */
function extractItems(entry, doc) {
  const items = [];
  if (entry.kind === 'tail' || entry.kind === 'tail-obs') {
    for (const [code, rec] of Object.entries(doc.records || {})) {
      if (!OPT.force && hasComplete(rec.verdicts)) continue;
      items.push({ ref: () => rec, code, basis: rec.price != null ? rec.price : null });
    }
  } else if (entry.kind === 'nextday') {
    for (const s of doc.stocks || []) {
      if (!(s.r01 && s.r01.ok)) continue;          // 只给 R01 触发票判定
      if (!OPT.force && hasComplete(s.verdicts)) continue;
      items.push({ ref: () => s, code: s.code, basis: null });   // 16:00 出报告 → T+1 开盘买
    }
  } else if (entry.kind === 'preopen') {
    // 盘前：basis = T 开盘价（开盘买入口径，与 close 段的 t0 一致）
    for (const [code, rec] of Object.entries(doc.records || {})) {
      if (!OPT.force && hasComplete(rec.verdicts)) continue;
      items.push({ ref: () => rec, code, basis: rec.open != null ? rec.open : null });
    }
  } else if (entry.kind === 'hotmoney') {
    for (const rec of doc.records || []) {
      if (!OPT.force && hasComplete(rec.verdicts)) continue;
      items.push({ ref: () => rec, code: toFullCode(rec.code), basis: null });   // 榜单 17:00 后出 → T+1 开盘买
    }
  }
  return items;
}

// ---------- 主流程 ----------
async function run() {
  const t0 = Date.now();
  const pipelines = {
    tail: listTail(), preopen: listPreopen(), nextday: listNextday(), hotmoney: listHotmoney(),
  };
  for (const [k, list] of Object.entries(pipelines)) {
    log(`[${k}] 归档 ${list.length} 份（${list.length ? list[list.length - 1].date + ' → ' + list[0].date : '空'}）`);
  }

  // 1) 汇总所有待判条目 + 需要抓 K 的代码集合
  const jobs = [];            // { entry, doc, item }
  const needCodes = new Set();
  const docCache = new Map(); // file → doc：第 4 步聚合复用，避免同一批归档全量重读
  for (const [pipe, list] of Object.entries(pipelines)) {
    for (const entry of list) {
      const file = path.join(entry.dir, entry.file);
      const doc = readJSONSafe(file, null, warn);
      if (!doc) { log(`[${pipe}] 跳过（读取失败）：${entry.file}`); continue; }
      docCache.set(file, doc);
      for (const item of extractItems(entry, doc)) {
        jobs.push({ pipe, entry, file, doc, item });
        needCodes.add(item.code);
      }
    }
  }
  if (!jobs.length) log('[1/3] 无缺 verdicts 的记录（幂等跳过判定，仍做聚合 + 重渲染清单）');

  // 2) 逐代码抓全量日 K（降序，一次多日），进程内缓存；无任务则跳过抓取
  const kCache = new Map();       // code → rowsDesc | null
  const failedCodes = new Set();  // 抓取失败的代码：与「尚未到 T+1」严格区分
  const kErr = () => failedCodes.size;
  if (jobs.length) {
    log(`[1b/3] 待判 ${jobs.length} 条 / 涉及 ${needCodes.size} 只 · K线抓取（fqkline，并发 ${cfg.concurrency}）…`);
    await mapLimit([...needCodes], cfg.concurrency, async (code) => {
      try {
        const k = await market.fetchKline(code, '2099-12-31');   // 取全部行，T 之后自行过滤
        kCache.set(code, (k && k.rows) || null);
      } catch (e) { failedCodes.add(code); kCache.set(code, null); }
    });
    log(`[2/3] K线完成：${kCache.size - kErr()} 成功 / ${kErr()} 失败`);
  }

  // 数据源闸门（2026-11-09 评审 #3）：端点全挂 / WAF 拦截时，失败与「未到期」同形，
  // 旧逻辑会静默计入 pending 并照常覆盖 perf-weekly、退出码 0。此处直接中止并告警。
  const failRate = needCodes.size ? kErr() / needCodes.size : 0;
  if (failRate > cfg.maxKlineFailRate) {
    warn(`[闸门] K线失败率 ${(failRate * 100).toFixed(0)}%（${kErr()}/${needCodes.size}）超过 ${(cfg.maxKlineFailRate * 100).toFixed(0)}%，疑似数据源故障；不写回归档、不覆盖 perf-weekly、不重渲染`);
    process.exitCode = 1;
    const summary = { filled: 0, pending: 0, kErr: kErr(), failRate, aborted: true, elapsedMs: Date.now() - t0, changedHtml: [] };
    if (OPT.json) console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  // 3) 逐条判定并写回归档
  // fqkline 会带「今日盘中」的未收盘 bar：收盘前把今日 bar 当 T+1/T+3 收盘会算出盘中价
  // 且被幂等跳过冻结成错值 → 一律截断到最近一个已收盘交易日（评审意识：口径先行）。
  const { dayjs } = require('../time');
  const { lastClosedTradingDay } = require('../rules');
  const lastClosed = lastClosedTradingDay(dayjs.tz());
  const touchedFiles = new Map();   // file → doc（去重写盘）
  let filled = 0, pending = 0, noBasis = 0, kUnavailable = 0;
  for (const job of jobs) {
    const rows = kCache.get(job.item.code);
    const bars = V.barsAfter(rows || [], job.entry.date, 3).filter((b) => b.date <= lastClosed);
    if (!bars.length) {
      if (failedCodes.has(job.item.code)) kUnavailable++;      // 抓取失败 ≠ 待次日
      else pending++;                                          // T+1 还没走完（今日刚出报告）
      continue;
    }
    const basis = job.item.basis != null ? job.item.basis : bars[0].open;
    if (!(basis > 0)) { noBasis++; continue; }
    const v = V.buildVerdicts(bars, { basis, t1HitMin: cfg.thresholds.t1HitMin, t3HitMin: cfg.thresholds.t3HitMin });
    if (!v) continue;
    job.item.ref().verdicts = v;
    touchedFiles.set(job.file, job.doc);
    filled++;
  }
  for (const [file, doc] of touchedFiles) atomicWriteJSON(file, doc);
  log(`[3/3] 写回 ${touchedFiles.size} 份归档：补齐 ${filled} 条 / 待次日 ${pending} 条${kUnavailable ? ` / K线不可用 ${kUnavailable} 条` : ''}${noBasis ? ` / 缺基准价 ${noBasis}` : ''}`);

  // 4) 滚动聚合 → eod/data/perf-weekly.json（按管道 × 命中率/均值）
  const perf = { generatedAt: require('../time').now(), windowDays: OPT.days, pipelines: {} };
  for (const [pipe, list] of Object.entries(pipelines)) {
    const all = [];
    const byDay = {};
    for (const entry of list) {
      const file = path.join(entry.dir, entry.file);
      const doc = docCache.get(file) || readJSONSafe(file, null, warn);
      if (!doc) continue;
      const dayList = [];
      if (entry.kind === 'tail' || entry.kind === 'tail-obs' || entry.kind === 'preopen') {
        for (const rec of Object.values(doc.records || {})) dayList.push(rec);
      } else if (entry.kind === 'nextday') {
        for (const s of doc.stocks || []) { if (s.r01 && s.r01.ok) dayList.push(s); }
      } else {
        for (const rec of doc.records || []) dayList.push(rec);
      }
      const aggDay = V.aggregate(dayList);
      if (aggDay) byDay[V.dayKeyOf(entry)] = aggDay;   // 同日 formal/obs 分键，避免互相覆盖
      all.push(...dayList);
    }
    perf.pipelines[pipe] = {
      archives: list.length,
      tradingDays: new Set(list.map((e) => e.date)).size,
      ...V.aggregate(all),
      byDay,
    };
  }
  const perfFile = path.join(paths.eodDir(), 'data', cfg.store.perfFile);
  atomicWriteJSON(perfFile, perf);
  log(`[聚合] ${perfFile}`);

  // 5) 重渲染最新报告（批次 A 收尾）：命中率区块 / 游资 T+1·T+3 列只有重渲染才可见。
  //    **无条件执行**（2026-11-09 用户反馈：盘中跑 filled=0 也要求出清单）——重渲染幂等，
  //    无变化时产物与旧文件一致，git 无 diff；只重渲染各管道最新一份正式报告，
  //    历史报告是冻结的复盘快照，不悄悄改写；旧游资档缺 seatChanges 会跳过（宁缺毋滥）。
  const changedHtml = [];
  {
    const { rerenderTail, rerenderPreopen, rerenderHotmoney } = require('./lib/rerender');
    const tailEntry = pipelines.tail.find((e) => e.kind === 'tail');   // 最新正式档（排除 -obs）
    const jobs = [
      tailEntry && ['尾盘', () => rerenderTail(path.join(tailEntry.dir, tailEntry.file))],
      pipelines.preopen[0] && ['盘前', () => rerenderPreopen(pipelines.preopen[0].date)],
      pipelines.hotmoney[0] && ['游资', () => rerenderHotmoney(pipelines.hotmoney[0].date)],
    ].filter(Boolean);
    for (const [name, fn] of jobs) {
      try {
        const r = fn();
        if (typeof r === 'string') { changedHtml.push(r); log(`[HTML] ${name} 已重渲染：${r}`); }
        else log(`[HTML] ${name} 跳过：${(r && r.skipped) || '无数据'}`);
      } catch (e) { log(`[HTML] ${name} 重渲染失败（不影响归档）：${(e && e.message) || e}`); }
    }
  }

  const summary = {
    filled, pending, kErr: kErr(), kUnavailable, failRate, aborted: false,
    elapsedMs: Date.now() - t0, perfFile, changedHtml,
  };
  for (const [p, a] of Object.entries(perf.pipelines)) {
    if (a && a.t1) log(`[胜率] ${p}: n=${a.n} T1命中 ${a.t1.rate}%（均值 ${a.t1.avg}%）${a.t3 ? ` · T3命中 ${a.t3.rate3}%（均值 ${a.t3.avg}% / 期间最高均值 ${a.t3.avgMax}%）` : ''}`);
  }
  if (changedHtml.length) {
    log('[HTML] 本次改动清单（可逐个点开查看）：');
    for (const f of changedHtml) log(`  ${f}`);
  }
  if (OPT.json) console.log(JSON.stringify(summary, null, 2));
  return summary;
}

run().catch((e) => { log('[失败] nextday_backfill 异常\n' + ((e && e.stack) || e)); process.exitCode = 1; });
