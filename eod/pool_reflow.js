'use strict';
/*
 * eod/pool_reflow.js —— 观察池回流（批次 C2，18:40 / PAUSED）
 * ---------------------------------------------------------------------------
 * 干什么：从四类归档里收集「该进观察池」的信号，产出一份可审核的 diff 报告。
 *   - tailTopHit   尾盘正式档 TopN 且 T+1 命中
 *   - r01          16:00 次日快照 R01 触发
 *   - hotmoneyT1   一线游资介入
 *   - preopenBeat  盘前超预期
 *
 * ⚠️ 数据安全契约（2026-11-09 用户拍板：允许扩 meta，但必须及时/可靠/稳定/不丢失，
 *    默认不设上限、只出 diff、不推送）：
 *   1. **默认 dry-run**：只读 + 出报告，`candidates.json` 一个字节都不动。
 *   2. 只有显式 `--apply` 才写，且**只追加**：代码里没有任何删除/淘汰路径，
 *      `wouldRemove` 恒为 0，`maxSize=0`（不设上限）。
 *   3. 存量票（当前 378 只）**零改动**：`tagLegacy=false`，meta 只出现在本次新增票上，
 *      随时间自然分批，不做一次性 migration，避免批量改坏老数据。
 *   4. 写前 `assertNonDestructive()` 硬校验（旧票逐字不变、数量不减、无重复 code、
 *      顶层键不新增/不改值、新增票必带 meta）；写后回读再校验一次。
 *   5. 写前把原文件备份到 `.tmp/pool_reflow/backups/candidates-<时间戳>.json`。
 *   6. 来源归档**纯只读**：不走 readJSONSafe 的「损坏隔离改名」，本脚本绝不重命名/删除任何文件。
 *   7. 非法股票代码直接丢弃，脏数据不入池；某个来源缺档/无 verdicts 不影响其它来源。
 *
 * 用法：
 *   node eod/pool_reflow.js                    # dry-run（默认），出 diff 报告
 *   node eod/pool_reflow.js --days 10         # 回看最近 10 个有归档的交易日
 *   node eod/pool_reflow.js --date 2026-11-06 # 只处理指定交易日
 *   node eod/pool_reflow.js --apply           # 真正写回（先备份 + 双重校验）
 *   node eod/pool_reflow.js --json            # 机器可读摘要（stdout 纯 JSON）
 *
 * 恢复：`git show HEAD:candidates.json > candidates.json`，或取 `.tmp/pool_reflow/backups/` 下备份。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./pool_reflow.config');
const paths = require('../paths');
const { dayjs } = require('../time');
const { atomicWriteJSON } = require('./lib/atomic');

const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const OPT = {
  apply: argv.includes('--apply'),
  json: argv.includes('--json'),
  help: argv.includes('--help') || argv.includes('-h'),
  date: argOf('--date'),
  days: Math.max(1, parseInt(argOf('--days'), 10) || cfg.window.days),
};
const say = (m) => { if (!OPT.json) console.log(m); };
const warn = (m) => process.stderr.write(`${m}\n`);

const USAGE = `观察池回流 pool_reflow（${cfg.version}）
  node eod/pool_reflow.js [--days N] [--date YYYY-MM-DD] [--apply] [--json]
  默认 dry-run：只出 diff，不写 candidates.json；--apply 才追加写回（先备份 + 双重校验）。
  契约：只追加、不淘汰、不设上限、存量票零改动、不推送。`;

const SOURCE_KEYS = ['tailTopHit', 'r01', 'hotmoneyT1', 'preopenBeat'];
const SOURCE_LABEL = {
  tailTopHit: '尾盘TopN·T+1命中',
  r01: 'R01触发',
  hotmoneyT1: '一线游资',
  preopenBeat: '盘前超预期',
};
const RE_DATE = {
  tail: /^eod-(\d{4}-\d{2}-\d{2})\.json$/,          // 正式档，排除 -obs
  preopen: /^preopen-(\d{4}-\d{2}-\d{2})\.json$/,
  hotmoney: /^hotmoney-(\d{4}-\d{2}-\d{2})\.json$/,
  nextday: /^snapshot-(\d{4}-\d{2}-\d{2})\.json$/,
};

/** 6 位代码 → 交易所前缀；已带前缀原样返回；非法代码返回 ''（脏数据不入池） */
function toFullCode(c) {
  const s = String(c == null ? '' : c).trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(s)) return s;
  if (!/^\d{6}$/.test(s)) return '';
  if (/^6/.test(s)) return 'sh' + s;
  if (/^[03]/.test(s)) return 'sz' + s;
  if (/^[489]/.test(s)) return 'bj' + s;
  return 'sh' + s;
}

/** 纯只读 JSON：解析失败返回 null，绝不改动/隔离源文件 */
function readDoc(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return null; }
}

/** 最近 N 个「有归档」的交易日（四类归档日期并集，降序） */
function collectTradingDays(dirs, days) {
  const all = new Set();
  for (const [k, re] of Object.entries(RE_DATE)) {
    const dir = dirs[k];
    if (!dir || !fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(re);
      if (m) all.add(m[1]);
    }
  }
  return [...all].sort().reverse().slice(0, Math.max(1, days | 0));
}

/**
 * 收集信号（纯读，不写任何文件）。
 * @returns {{signals: Map<string, object>, status: object}}
 */
function collectSignals(dirs, dates, config = cfg) {
  const signals = new Map();
  const status = {};
  for (const k of SOURCE_KEYS) status[k] = { files: 0, days: 0, hits: 0, noVerdictDays: 0, state: config.sources[k].enabled ? 'empty' : 'disabled' };

  const add = (rawCode, name, sector, source, date) => {
    const code = toFullCode(rawCode);
    if (!code) return;
    let s = signals.get(code);
    if (!s) {
      s = { code, name: name || '', sector: sector || '', sources: new Set(), lastTrigger: date, detail: {} };
      signals.set(code, s);
    }
    if (name && !s.name) s.name = name;
    if (sector && !s.sector) s.sector = sector;
    s.sources.add(source);
    s.detail[source] = date;
    if (date > s.lastTrigger) s.lastTrigger = date;
    status[source].hits++;
  };

  const enabled = (k) => config.sources[k] && config.sources[k].enabled;

  // 1) 尾盘正式档 TopN 且 T+1 命中
  if (enabled('tailTopHit')) {
    const topN = config.sources.tailTopHit.topN;
    for (const date of dates) {
      const file = path.join(dirs.tail, `eod-${date}.json`);
      if (!fs.existsSync(file)) continue;
      status.tailTopHit.files++;
      const doc = readDoc(file);
      if (!doc) { status.tailTopHit.state = 'error'; continue; }
      const rows = Object.entries(doc.records || {})
        .map(([k, r]) => ({ ...r, code: r.code || k }))
        .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))
        .slice(0, Math.max(1, topN | 0));
      let hasVerdicts = false;
      for (const r of rows) {
        if (r.verdicts) hasVerdicts = true;
        if (r.verdicts && r.verdicts.t1 && r.verdicts.t1.hit === true) add(r.code, r.name, r.sector, 'tailTopHit', date);
      }
      status.tailTopHit.days++;
      // 只记「该日 TopN 全无 T+1 判定」，不覆盖整体状态：其它日子有命中仍应显示 ok
      if (rows.length && !hasVerdicts) status.tailTopHit.noVerdictDays++;
    }
  }

  // 2) 次日快照 R01 触发
  if (enabled('r01')) {
    for (const date of dates) {
      const file = path.join(dirs.nextday, `snapshot-${date}.json`);
      if (!fs.existsSync(file)) continue;
      status.r01.files++;
      const doc = readDoc(file);
      if (!doc) { status.r01.state = 'error'; continue; }
      for (const s of doc.stocks || []) if (s.r01 && s.r01.ok) add(s.code, s.name, s.sector, 'r01', date);
      status.r01.days++;
    }
  }

  // 3) 一线游资介入
  if (enabled('hotmoneyT1')) {
    const tier = config.sources.hotmoneyT1.tier;
    for (const date of dates) {
      const file = path.join(dirs.hotmoney, `hotmoney-${date}.json`);
      if (!fs.existsSync(file)) continue;
      status.hotmoneyT1.files++;
      const doc = readDoc(file);
      if (!doc) { status.hotmoneyT1.state = 'error'; continue; }
      for (const r of doc.records || []) {
        if ((r.hot || []).some((h) => h && h.tier === tier)) add(r.code, r.name, r.sector, 'hotmoneyT1', date);
      }
      status.hotmoneyT1.days++;
    }
  }

  // 4) 盘前超预期
  if (enabled('preopenBeat')) {
    const labels = new Set(config.sources.preopenBeat.labels || []);
    for (const date of dates) {
      const file = path.join(dirs.preopen, `preopen-${date}.json`);
      if (!fs.existsSync(file)) continue;
      status.preopenBeat.files++;
      const doc = readDoc(file);
      if (!doc) { status.preopenBeat.state = 'error'; continue; }
      for (const [k, r] of Object.entries(doc.records || {})) {
        if (labels.has(r.label)) add(r.code || k, r.name, r.sector, 'preopenBeat', date);
      }
      status.preopenBeat.days++;
    }
  }

  for (const k of SOURCE_KEYS) {
    const st = status[k];
    if (!enabled(k) || st.state === 'error') continue;
    if (!st.files) st.state = 'unavailable';
    else if (st.hits) st.state = 'ok';                                   // 有命中优先，no-verdicts 只作附注
    else st.state = st.noVerdictDays ? 'no-verdicts' : 'empty';
  }
  return { signals, status };
}

/** 与现有观察池对比：只算「拟新增 / 命中存量 / 保持不动」，删除恒为 0 */
function buildDiff(signals, doc) {
  const stocks = (doc && doc.stocks) || [];
  const existing = new Map(stocks.map((s) => [s.code, s]));
  const toAdd = [], toTagExisting = [];
  for (const s of signals.values()) (existing.has(s.code) ? toTagExisting : toAdd).push(s);
  const byCode = (a, b) => String(a.code).localeCompare(String(b.code));
  toAdd.sort(byCode);
  toTagExisting.sort(byCode);
  return {
    toAdd, toTagExisting,
    untouched: stocks.length - toTagExisting.length,
    wouldRemove: 0,
    totalBefore: stocks.length,
    totalAfter: stocks.length + toAdd.length,
  };
}

/** 纯函数：构造写回后的对象。只在末尾追加，存量票对象引用原样保留 */
function applyDiff(before, diff, config = cfg, today = dayjs.tz().format('YYYY-MM-DD')) {
  const added = diff.toAdd.map((s) => ({
    code: s.code,
    name: s.name || '',
    sector: s.sector || '',
    meta: {
      origin: 'reflow',
      sources: [...s.sources].sort(),
      addedAt: today,
      lastTrigger: s.lastTrigger,
      reflowVersion: config.version,
    },
  }));
  const stocks = [...(before.stocks || []), ...added];
  return { ...before, stocks, count: stocks.length };
}

/**
 * 非破坏性硬校验：任何一项不满足即抛错，调用方必须放弃写回。
 * 允许变化的顶层键只有 stocks / count；存量票必须逐字节（JSON 值）完全一致。
 */
function assertNonDestructive(before, after) {
  const errs = [];
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  for (const k of Object.keys(before)) {
    if (k === 'stocks' || k === 'count') continue;
    if (!eq(before[k], after[k])) errs.push(`顶层字段 ${k} 被改动`);
  }
  for (const k of Object.keys(after)) {
    if (k === 'stocks' || k === 'count') continue;
    if (!(k in before)) errs.push(`擅自新增顶层字段 ${k}`);
  }

  const beforeStocks = (before.stocks || []);
  const afterStocks = (after.stocks || []);
  if (afterStocks.length < beforeStocks.length) errs.push(`股票数量减少 ${beforeStocks.length} → ${afterStocks.length}`);
  if (after.count != null && after.count !== afterStocks.length) errs.push(`count(${after.count}) 与 stocks(${afterStocks.length}) 不一致`);

  const afterBy = new Map(afterStocks.map((s) => [s.code, s]));
  const seen = new Set();
  for (const s of afterStocks) {
    if (seen.has(s.code)) errs.push(`出现重复代码 ${s.code}`);
    seen.add(s.code);
  }
  for (const old of beforeStocks) {
    const now = afterBy.get(old.code);
    if (!now) { errs.push(`存量票丢失 ${old.code}`); continue; }
    if (!eq(now, old)) errs.push(`存量票被改动 ${old.code}`);
  }
  const oldCodes = new Set(beforeStocks.map((s) => s.code));
  for (const s of afterStocks) {
    if (oldCodes.has(s.code)) continue;
    if (!s.meta || !Array.isArray(s.meta.sources) || !s.meta.sources.length) errs.push(`新增票缺 meta ${s.code}`);
    if (!toFullCode(s.code)) errs.push(`新增票代码非法 ${s.code}`);
  }
  if (errs.length) throw new Error('非破坏性校验失败（已放弃写回）：\n  - ' + errs.slice(0, 20).join('\n  - '));
  return true;
}

const esc = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const srcNames = (s) => [...s.sources].sort().map((k) => SOURCE_LABEL[k] || k).join('、');

/** 渲染可审核的 Markdown diff 报告 */
function renderMarkdown(ctx) {
  const { mode, today, dates, status, diff, before, after, config } = ctx;
  const L = [];
  L.push(`# 观察池回流 diff · ${mode}`);
  L.push('');
  L.push(`- 运行日：${today}`);
  L.push(`- 回看交易日：${dates.length} 天（${dates[0]} → ${dates[dates.length - 1]}）`);
  L.push(`- 现有观察池：**${diff.totalBefore}** 只 · 写回后：**${diff.totalAfter}** 只`);
  L.push(`- **拟新增 ${diff.toAdd.length} 只 / 命中存量 ${diff.toTagExisting.length} 只（零改动）/ 保持不动 ${diff.untouched} 只 / 删除 ${diff.wouldRemove} 只**`);
  L.push('');
  L.push('## 数据安全契约');
  L.push('');
  L.push('| 项 | 本次取值 |');
  L.push('|---|---|');
  L.push(`| 模式 | ${mode} |`);
  L.push(`| 淘汰/删除 | 关闭（代码内无删除路径，删除恒为 0） |`);
  L.push(`| 上限 | ${config.write.maxSize === 0 ? '不设上限' : config.write.maxSize} |`);
  L.push(`| 存量票 | ${config.write.tagLegacy ? '打标' : '零改动（meta 仅出现在新增票）'} |`);
  L.push(`| 写回 | ${mode === 'APPLY' ? '已写 candidates.json（写前备份 + 写后回读校验）' : '**未写**（dry-run）'} |`);
  L.push(`| 恢复 | \`git show HEAD:candidates.json > candidates.json\` 或 \`.tmp/pool_reflow/backups/\` |`);
  L.push('');
  L.push('## 来源状态');
  L.push('');
  L.push('| 来源 | 状态 | 归档数 | 覆盖天数 | 命中条数 | 缺 T+1 档 |');
  L.push('|---|---|---:|---:|---:|---:|');
  for (const k of SOURCE_KEYS) {
    const s = status[k];
    L.push(`| ${esc(SOURCE_LABEL[k])} | ${esc(s.state)} | ${s.files} | ${s.days} | ${s.hits} | ${s.noVerdictDays || 0} |`);
  }
  L.push('');
  L.push('> `ok`=有信号（即使部分日期缺 T+1，仍以实际命中为准）；`empty`=档在但当日无触发；`unavailable`=窗口内无归档；`no-verdicts`=档在但**全部**日期都未回填 T+1（不产生伪信号）；`error`=解析失败（不影响其它来源）。「缺 T+1 档」只作附注，表示这些天的 TopN 尚无次日判定，待 18:30 回填后会自动纳入。');
  L.push('');
  L.push('## 拟新增（' + diff.toAdd.length + ' 只）');
  L.push('');
  if (diff.toAdd.length) {
    L.push('| 代码 | 名称 | 行业 | 来源 | 最近触发 |');
    L.push('|---|---|---|---|---|');
    for (const s of diff.toAdd) L.push(`| ${esc(s.code)} | ${esc(s.name)} | ${esc(s.sector)} | ${esc(srcNames(s))} | ${esc(s.lastTrigger)} |`);
  } else L.push('_无_');
  L.push('');
  L.push('## 命中但已在池（' + diff.toTagExisting.length + ' 只，零改动）');
  L.push('');
  if (diff.toTagExisting.length) {
    L.push('| 代码 | 名称 | 来源 | 最近触发 |');
    L.push('|---|---|---|---|');
    for (const s of diff.toTagExisting) L.push(`| ${esc(s.code)} | ${esc(s.name)} | ${esc(srcNames(s))} | ${esc(s.lastTrigger)} |`);
  } else L.push('_无_');
  L.push('');
  L.push(`> 本报告由 \`eod/pool_reflow.js\` 生成；存量 ${diff.totalBefore} 只手工观察池在任何模式下都不被删除、不被改名、不被改写。`);
  return L.join('\n') + '\n';
}

/** 主流程：组装真实路径、读写文件。核心逻辑全部是可单测的纯函数 */
function run() {
  if (OPT.help) { say(USAGE); return { help: true }; }
  if (!OPT.json) require('./lib/runlog').startRunLog('pool_reflow');

  const dirs = {
    tail: path.join(paths.eodDir(), 'data', 'eod'),
    preopen: path.join(paths.eodDir(), 'data', 'preopen'),
    hotmoney: path.join(paths.eodDir(), 'data', 'hotmoney'),
    nextday: paths.dataDir(),
  };
  const today = dayjs.tz().format('YYYY-MM-DD');
  const cfile = paths.candidatesFile();

  const before = readDoc(cfile);
  if (!before || !Array.isArray(before.stocks)) {
    throw new Error(`观察池读取失败或结构异常：${cfile} —— 拒绝新建空池，本次不写任何文件`);
  }

  const dates = OPT.date ? [OPT.date] : collectTradingDays(dirs, OPT.days);
  if (!dates.length) throw new Error('窗口内四类归档均无文件，拒绝产出空 diff（避免误判为「无信号」）');

  const { signals, status } = collectSignals(dirs, dates, cfg);
  const diff = buildDiff(signals, before);
  const mode = OPT.apply ? 'APPLY' : 'DRY-RUN';

  let backupPath = null;
  let after = null;
  let wrote = false;
  if (OPT.apply && diff.toAdd.length) {
    after = applyDiff(before, diff, cfg, today);
    assertNonDestructive(before, after);                       // 写前校验
    const bdir = path.join(paths.home(), '.tmp', 'pool_reflow', 'backups');
    fs.mkdirSync(bdir, { recursive: true });
    backupPath = path.join(bdir, `candidates-${dayjs.tz().format('YYYYMMDD-HHmmss')}.json`);
    fs.copyFileSync(cfile, backupPath);
    atomicWriteJSON(cfile, after);                            // 原子写
    const actual = readDoc(cfile);                            // 写后回读再校验
    if (!actual) throw new Error(`写后回读失败：${cfile}（备份在 ${backupPath}）`);
    assertNonDestructive(before, actual);
    if (JSON.stringify(actual) !== JSON.stringify(after)) throw new Error(`写后内容与预期不一致：${cfile}（备份在 ${backupPath}）`);
    wrote = true;
  }

  const rdir = path.join(paths.home(), cfg.report.dir);
  fs.mkdirSync(rdir, { recursive: true });
  const reportPath = path.join(rdir, `pool_reflow-${today}.md`);
  fs.writeFileSync(reportPath, renderMarkdown({ mode, today, dates, status, diff, before, after, config: cfg }), 'utf8');

  say(`[pool_reflow] 模式=${mode} 回看=${dates.length} 个交易日（${dates[0]} → ${dates[dates.length - 1]}）`);
  for (const k of SOURCE_KEYS) {
    const s = status[k];
    say(`[来源] ${SOURCE_LABEL[k]}: ${s.state} · 档 ${s.files} / 命中 ${s.hits}`);
  }
  say(`[diff] 拟新增 ${diff.toAdd.length} 只 / 命中存量 ${diff.toTagExisting.length} 只（零改动）/ 保持不动 ${diff.untouched} 只 / 删除 ${diff.wouldRemove} 只`);
  if (OPT.apply) say(wrote ? `[写回] 已追加 ${diff.toAdd.length} 只（${diff.totalBefore} → ${diff.totalAfter}），备份 ${backupPath}` : '[写回] 无新增，跳过写入（零 diff）');
  else say('[安全] 未写回 candidates.json；确认 diff 后加 --apply 才写');
  say(`[报告] ${reportPath}`);

  const summary = {
    mode, today, dates, status,
    totalBefore: diff.totalBefore, totalAfter: diff.totalAfter,
    toAdd: diff.toAdd.map((s) => ({ code: s.code, name: s.name, sector: s.sector, sources: [...s.sources].sort(), lastTrigger: s.lastTrigger })),
    hitExisting: diff.toTagExisting.length,
    untouched: diff.untouched,
    removed: 0,
    wrote, backupPath, reportPath,
  };
  if (OPT.json) console.log(JSON.stringify(summary, null, 2));
  return summary;
}

module.exports = {
  toFullCode, collectTradingDays, collectSignals, buildDiff,
  applyDiff, assertNonDestructive, renderMarkdown, run, OPT,
};

if (require.main === module) {
  try { run(); }
  catch (e) { warn(`[失败] pool_reflow：${(e && e.stack) || e}`); process.exitCode = 1; }
}
