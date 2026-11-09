'use strict';
/*
 * eod/pattern_backfill.js —— 形态选股 T+1/T+3 胜率回填（npm run pattern:backfill）
 * ---------------------------------------------------------------------------
 * 独立于 nextday_backfill.js：零改动现有管道，只处理 eod/data/pattern/ 归档。
 *   - 逐票补 verdicts（lib/verdict.js 纯函数），basis = T+1 开盘价
 *     （形态报告收盘后才出，T 日不可买，与游资/次日选股同口径）
 *   - 按形态分桶聚合 → 合并写入 eod/data/perf-weekly.json 的 pipelines.pattern
 *   - 硬门禁：有 verdicts 的交易日 < 20 时只报样本量，不给任何命中率结论
 *   - 报告顶部「形态胜率」表读的就是这里的 byPattern
 *
 * 用法：
 *   node eod/pattern_backfill.js             # 常规补齐（幂等，已有 t3 跳过）
 *   node eod/pattern_backfill.js --force     # 全量重算
 *   node eod/pattern_backfill.js --days 60   # 回扫窗口
 *   node eod/pattern_backfill.js --json      # 机器可读摘要
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./pattern.config');
const paths = require('../paths');
const { dayjs } = require('../time');
const market = require('./lib/market');
const V = require('./lib/verdict');
const { atomicWriteJSON, readJSONSafe } = require('./lib/atomic');
const { mapLimit } = require('./lib/http');

const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const OPT = {
  force: argv.includes('--force'),
  days: Math.max(1, parseInt(argOf('--days'), 10) || 60),
  json: argv.includes('--json'),
};
const log = (m) => { if (!OPT.json) console.log(m); };
const warn = (m) => process.stderr.write(`${m}\n`);
const MIN_TRADING_DAYS = 20;
const PERF_FILE = () => path.join(paths.eodDir(), 'data', 'perf-weekly.json');

/** 枚举形态归档（pattern-kline-* 缓存不匹配） */
function listArchives() {
  const dir = path.join(paths.eodDir(), cfg.store.dataDir);
  const out = [];
  for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : [])) {
    const m = f.match(/^pattern-(\d{4}-\d{2}-\d{2})\.json$/);
    if (m) out.push({ dir, file: f, date: m[1] });
  }
  return V.sliceByTradingDays(out.map((e) => ({ ...e, kind: 'pattern' })), OPT.days);
}

async function main() {
  const archives = listArchives();
  if (!archives.length) { log('[回填] 无形态归档，跳过'); return { archives: 0 }; }
  const today = dayjs.tz().format('YYYY-MM-DD');

  // 1) 逐票补 verdicts；同一代码跨日只抓一次 K 线
  const need = new Set();
  const docs = [];
  for (const a of archives) {
    const doc = readJSONSafe(path.join(a.dir, a.file), null, warn);
    if (!doc) continue;
    docs.push({ ...a, doc });
    for (const [code, r] of Object.entries(doc.records || {})) {
      const complete = !!(r.verdicts && r.verdicts.t3 && r.verdicts.t3.date);
      if (OPT.force || !complete) need.add(code);
    }
  }
  log(`[回填] ${archives.length} 份归档 · 待补 ${need.size} 只 · K线锚定 ${today}`);
  const klines = new Map();
  if (need.size) {
    const codes = [...need];
    const res = await mapLimit(codes, 6, async (code) => {
      try { return [code, (await market.fetchKline(code, today)).rows]; }
      catch (e) { return [code, null]; }
    });
    for (const [code, rows] of res) if (rows) klines.set(code, rows);
    log(`[回填] K线 ${klines.size}/${codes.length} 只成功`);
  }

  let filled = 0;
  for (const a of docs) {
    let dirty = false;
    for (const [code, r] of Object.entries(a.doc.records || {})) {
      const complete = !!(r.verdicts && r.verdicts.t3 && r.verdicts.t3.date);
      if (!OPT.force && complete) continue;
      const rows = klines.get(code);
      if (!rows) continue;
      const bars = V.barsAfter(rows, a.date, 3);
      const v = V.buildVerdicts(bars);
      if (!v) continue;
      r.verdicts = v;
      dirty = true;
      filled++;
    }
    if (dirty) atomicWriteJSON(path.join(a.dir, a.file), a.doc);
  }
  log(`[回填] 写入 verdicts ${filled} 条`);

  // 2) 按形态分桶聚合（一条记录命中多形态 → 各桶各计一次）
  const buckets = new Map();
  const tradingDays = new Set();
  for (const a of docs) {
    for (const r of Object.values(a.doc.records || {})) {
      if (!r.verdicts) continue;
      tradingDays.add(a.date);
      for (const id of (r.patternIds || [])) {
        if (!buckets.has(id)) buckets.set(id, []);
        buckets.get(id).push({ verdicts: r.verdicts });
      }
    }
  }
  const ready = tradingDays.size >= MIN_TRADING_DAYS;
  const byPattern = {};
  for (const [id, list] of buckets) {
    const agg = V.aggregate(list);
    byPattern[id] = ready && agg
      ? { n: agg.n, t1: agg.t1, t3: agg.t3, ready: true }
      : { n: list.length, ready: false };
  }
  const all = [...buckets.values()].flat();
  const overall = V.aggregate(all);
  const perf = readJSONSafe(PERF_FILE(), null, warn) || { windowDays: OPT.days, pipelines: {} };
  // 只写自己的管道段。generatedAt / windowDays 是整份文件的元数据，由 nextday_backfill 维护；
  // 这里覆盖会让 weekly_winrate 的窗口标注失真，也会把 git diff 撑成整行重写。
  perf.pipelines = perf.pipelines || {};
  perf.pipelines.pattern = {
    generatedAt: new Date().toISOString(),
    windowDays: OPT.days,
    archives: archives.length,
    tradingDays: tradingDays.size,
    n: overall ? overall.n : 0,
    t1: ready && overall ? overall.t1 : null,
    t3: ready && overall ? overall.t3 : null,
    byPattern,
    ready,
    minTradingDays: MIN_TRADING_DAYS,
  };
  atomicWriteJSON(PERF_FILE(), perf);
  log(`[聚合] 交易日 ${tradingDays.size} · 样本 ${overall ? overall.n : 0} · ${ready ? '已出结论' : `样本不足（<${MIN_TRADING_DAYS}），只报样本量`}`);
  log(`[产出] ${PERF_FILE()} → pipelines.pattern`);
  return { archives: archives.length, filled, tradingDays: tradingDays.size, ready, byPattern };
}

main()
  .then((s) => { if (OPT.json) console.log(JSON.stringify(s, null, 2)); })
  .catch((e) => { console.error(`[失败] ${e.stack || e.message}`); process.exitCode = 1; });
