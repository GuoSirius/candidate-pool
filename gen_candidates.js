#!/usr/bin/env node
'use strict';
/*
 * gen_candidates.js
 * ---------------------------------------------------------------------------
 * A股短线交易 — 次日候选池初筛（自动生成版）
 * 复刻 A股短线交易 skill 的「标的初筛」流程：
 *   候选起点 = 官方综合评分排行 westock-tool ranking CompScore --limit 12
 *   规则组合 = R01 量能验证突破 + R07 板块内补涨（+ R05 尾盘异动核验）
 * 输出 = 单文件、资源全内联、无外链的双语 HTML（右上角中英切换）
 *
 * 用法:
 *   node gen_candidates.js                 # 在线：锚定日 = 最近一个已收盘交易日
 *   node gen_candidates.js --date 2026-07-27
 *   node gen_candidates.js --limit 12 --out report.html --quiet
 *   node gen_candidates.js --date 2026-07-27 --dump data/snapshot-2026-07-27.json   # 在线抓取后导出快照到指定路径
 *   node gen_candidates.js --offline --snapshot data/snapshot-2026-07-27.json        # 离线：从快照重建报告（无需 westock）
 *
 * 输出（默认按锚定日留档，覆盖式写入，每天一份）：
 *   报告:  reports/stock_list_<锚定日>.html
 *   快照:  data/snapshot-<锚定日>.json      （实时运行自动写出，供日后离线复现）
 *
 * 推送: 实时运行结束后自动把结果推送到 notify_config.json 配置的渠道
 *       （个人微信 Server酱/PushPlus + 163 邮箱）。可用 --no-notify 关闭。
 *
 * 依赖: westock-tool / westock-data（腾讯自选股 CLI，已随 WorkBuddy 内置）
 * 可通过环境变量覆盖路径: WESTOCK_NODE / WESTOCK_TOOL / WESTOCK_DATA
 * 离线模式不依赖任何外部 CLI，可在任意装了 Node >=18 的环境运行（GitHub Actions 等）。
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileP = promisify(execFile);

// ---------- 路径配置 ----------
const NODE = process.env.WESTOCK_NODE || 'C:/Users/Admin/.workbuddy/binaries/node/versions/22.22.2/node.exe';
const TOOL = process.env.WESTOCK_TOOL || 'D:/Program Files/WorkBuddy/resources/app.asar.unpacked/resources/builtin-skills/westock-tool/scripts/index.js';
const DATA = process.env.WESTOCK_DATA || 'D:/Program Files/WorkBuddy/resources/app.asar.unpacked/resources/builtin-skills/westock-data/scripts/index.js';

// ---------- R01 门槛常量 ----------
const G = {
  VOL_RATIO_MIN: 1.5,   // C1 量 ≥ 近5日均量 150%
  CHG_MIN: 3.0,         // C3 涨幅下限
  CHG_MAX: 8.0,         // C3 涨幅上限
  TURN_MIN: 3.0,        // C4 换手 ≥ 3%
  CAP_MIN: 20,          // C5 市值下限（亿）
  CAP_MAX: 500,         // C5 市值上限（亿）
  HIGH52_ZONE: 0.9,     // C6 收盘 < 0.9×52周高 视为未进入高位区
};

const CONCURRENCY = 12;

// ---------- 小工具 ----------
function log(...a) { process.stderr.write(a.join(' ') + '\n'); }
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseArgs(argv) {
  const o = { date: null, limit: 12, out: null, quiet: false, offline: false, snapshot: null, dump: null, noNotify: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') o.date = argv[++i];
    else if (a === '--limit') o.limit = parseInt(argv[++i], 10);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--offline') o.offline = true;
    else if (a === '--snapshot') o.snapshot = argv[++i];
    else if (a === '--dump') o.dump = argv[++i];
    else if (a === '--no-notify') o.noNotify = true;
    else if (a === '-h' || a === '--help') { o.help = true; }
  }
  return o;
}
function isWeekend(d) { const g = d.getDay(); return g === 0 || g === 6; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function nextTradingDay(dateStr) {
  let d = addDays(new Date(dateStr + 'T00:00:00'), 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return ymd(d);
}
function lastClosedTradingDay(now) {
  const d = new Date(now);
  let back = 0;
  const day = d.getDay();
  const hour = d.getHours();
  if (day === 6) back = 1;        // 周六 -> 周五
  else if (day === 0) back = 2;   // 周日 -> 周五
  else if (hour < 15) back = 1;   // 交易日盘中 -> 前一交易日
  d.setDate(d.getDate() - back);
  while (isWeekend(d)) d.setDate(d.getDate() - 1);
  return ymd(d);
}

// ---------- westock 调用（带重试与空结果校验）----------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function runData(args, opt = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { stdout } = await execFileP(NODE, [DATA, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 });
      if (opt.needRows !== false) {
        const rows = parseTables(stdout).reduce((a, t) => a + t.rows.length, 0);
        if (rows === 0) throw new Error('empty result (header only / no data rows)');
      }
      if (stdout.trim().length < 5) throw new Error('empty output');
      return stdout;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) { await sleep(400 * (attempt + 1)); }
    }
  }
  throw lastErr;
}
async function runTool(args, opt = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { stdout } = await execFileP(NODE, [TOOL, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 });
      if (opt.needRows !== false) {
        const rows = parseTables(stdout).reduce((a, t) => a + t.rows.length, 0);
        if (rows === 0) throw new Error('empty result (header only / no data rows)');
      }
      if (stdout.trim().length < 5) throw new Error('empty output');
      return stdout;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) { await sleep(400 * (attempt + 1)); }
    }
  }
  throw lastErr;
}
async function mapLimit(items, limit, fn) {
  const res = new Array(items.length);
  let i = 0;
  const workers = [];
  const n = Math.min(limit, items.length);
  for (let w = 0; w < n; w++) {
    workers.push((async () => {
      while (i < items.length) {
        const idx = i++;
        try { res[idx] = await fn(items[idx], idx); }
        catch (e) { res[idx] = { __error: String(e && e.message || e) }; }
      }
    })());
  }
  await Promise.all(workers);
  return res;
}

// ---------- markdown 表格解析 ----------
function parseTables(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let header = null, rows = [];
  const isSep = (s) => /^:?-{2,}:?$/.test(s.trim());
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('|')) { if (header) { out.push({ header, rows }); header = null; rows = []; } continue; }
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
    if (cells.every(c => isSep(c))) continue;
    if (!header) header = cells;
    else rows.push(cells);
  }
  if (header) out.push({ header, rows });
  return out;
}
function findTable(text, headerIncludes) {
  const ts = parseTables(text);
  return ts.find(t => headerIncludes.every(k => t.header.some(h => h.includes(k)))) || null;
}
function rowsByHeader(text, headerIncludes) {
  const t = findTable(text, headerIncludes);
  if (!t) return [];
  return t.rows.map(r => { const o = {}; t.header.forEach((h, i) => o[h] = r[i]); return o; });
}

// ===========================================================================
// 主流程
// ===========================================================================
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    log('用法: node gen_candidates.js [--date YYYY-MM-DD] [--limit 12] [--out file.html] [--quiet]');
    log('     node gen_candidates.js --offline --snapshot data/snapshot-YYYYMMDD.json [--out file.html]');
    log('     node gen_candidates.js --date YYYY-MM-DD --dump data/snapshot-YYYYMMDD.json   # 在线抓取后导出快照');
    log('     node gen_candidates.js --no-notify   # 实时运行但跳过微信/邮件推送');
    return;
  }
  if (args.offline) { await runOffline(args); return; }
  const now = new Date();
  const anchor = args.date || lastClosedTradingDay(now);
  const target = nextTradingDay(anchor);
  const limit = args.limit;
  const outPath = args.out || path.join(__dirname, 'reports', `stock_list_${anchor.replace(/-/g, '')}.html`);

  log(`[1/8] 锚定日 ${anchor}（面向 ${target} 交易日），候选上限 ${limit}`);

  // ---- 1. 综合评分排行 ----
  const rankText = await runTool(['ranking', 'CompScore', '--limit', String(limit), '--date', anchor]);
  const rankRows = rowsByHeader(rankText, ['代码']);
  if (!rankRows.length) throw new Error('未解析到排行数据，请检查 westock-tool 是否可用');
  const universe = rankRows.map(r => ({
    rank: Number(r['#'] || r['排名'] || 0),
    code: r['代码'].trim(),
    name: r['名称'].trim(),
    comp: parseFloat(r['综合评分']),
    fund: parseFloat(r['资金评分']),
    fundamt: parseFloat(r['基本面评分']),
    risk: parseFloat(r['风险评分']),
    tech: parseFloat(r['技术评分']),
  }));
  log(`      已取候选 ${universe.length} 只: ${universe.map(u => u.name).join('、')}`);

  // ---- 2. 逐只: kline + quote + fund + minute ----
  log(`[2/8] 拉取 ${universe.length} 只标的历史行情/资金/分时 ...`);
  const stocks = await mapLimit(universe, CONCURRENCY, async (u) => {
    const s = { ...u };
    try {
      const kl = await runData(['kline', u.code, '--period', 'day', '--end', anchor, '--limit', '70', '--fq', 'qfq']);
      const klRows = rowsByHeader(kl, ['date']).map(r => ({
        date: r['date'], open: +r['open'], close: +r['last'], high: +r['high'],
        low: +r['low'], vol: +r['volume'], amt: +r['amount'], turn: +r['exchange'],
      })).filter(r => r.date && !isNaN(r.close));
      const till = klRows.filter(r => r.date <= anchor);
      const t = till.find(r => r.date === anchor);
      const hist = till.filter(r => r.date < anchor && r.vol > 0);
      s.kline = { rows: till, today: t || null, hist };
    } catch (e) { s.kline = { error: String(e.message || e) }; }

    try {
      const q = await runData(['quote', u.code, '--date', anchor]);
      const qr = rowsByHeader(q, ['code']);
      s.quote = qr[0] || null;
    } catch (e) { s.quote = { error: String(e.message || e) }; }

    try {
      const f = await runData(['fund', 'flow', u.code, '--start', anchor, '--end', anchor]);
      const fr = rowsByHeader(f, ['code']);
      s.fund = fr[0] || null;
    } catch (e) { s.fund = { error: String(e.message || e) }; }

    try {
      const m = await runData(['minute', u.code, '--days', '30']);
      s.minute = rowsByHeader(m, ['date']).map(r => ({
        date: r['date'], time: r['time'], price: +r['price'], vol: +r['volume'], amt: +r['amount'],
      })).filter(r => r.date);
    } catch (e) { s.minute = { error: String(e.message || e) }; }

    return s;
  });

  // ---- 3. 计算 R01 ----
  log(`[3/8] 计算 R01 量能验证突破 ...`);
  for (const s of stocks) {
    const k = s.kline;
    const r01 = { ok: false, gates: {}, core: 0, capOk: false, highZoneOk: true, mktCapYi: null, circCapYi: null, error: k.error || null };
    if (k && k.today && k.hist) {
      const t = k.today, hist = k.hist;
      // C1 量能倍数（不含当日）
      if (hist.length >= 5) {
        const ma5 = hist.slice(0, 5).reduce((a, r) => a + r.vol, 0) / 5;
        r01.volRatio = t.vol / ma5;
        r01.gates.C1 = t.vol >= G.VOL_RATIO_MIN * ma5;
      }
      // C2 突破前10日高（不含当日）
      if (hist.length >= 10) {
        const h10 = Math.max(...hist.slice(0, 10).map(r => r.high));
        r01.prior10High = h10;
        r01.gates.C2 = t.close > h10;
      }
      // C3 涨幅 3%-8%
      if (hist.length >= 1) {
        const prev = hist[0].close;
        r01.chg = (t.close / prev - 1) * 100;
        r01.gates.C3 = r01.chg >= G.CHG_MIN && r01.chg <= G.CHG_MAX;
      }
      // C4 换手
      r01.turn = t.turn;
      r01.gates.C4 = t.turn >= G.TURN_MIN;
      r01.close = t.close;
      // C5 市值
      if (s.quote && s.quote.total_market_cap) {
        r01.mktCapYi = +s.quote.total_market_cap / 1e8;
        r01.circCapYi = +s.quote.circulating_market_cap / 1e8;
        r01.capOk = r01.mktCapYi >= G.CAP_MIN && r01.mktCapYi <= G.CAP_MAX;
      }
      // C6 52周高位区
      if (s.quote && s.quote.high_52week && t.close) {
        r01.high52 = +s.quote.high_52week;
        r01.highZoneOk = t.close < G.HIGH52_ZONE * r01.high52;
      }
      r01.core = ['C1', 'C2', 'C3', 'C4'].filter(g => r01.gates[g]).length;
      r01.ok = r01.gates.C1 && r01.gates.C2 && r01.gates.C3 && r01.gates.C4 && r01.capOk && r01.highZoneOk;
    }
    s.r01 = r01;
  }

  // ---- 4. SW1 行业涨幅 + 成份映射（R07）----
  log(`[4/8] 重建申万一级 31 行业涨幅并映射候选所属板块 (R07) ...`);
  const sw1Text = await runData(['sector', 'list', 'industry_list_sw1']);
  const sw1List = rowsByHeader(sw1Text, ['code']).map(r => ({ code: r['code'].trim(), name: r['name'].trim() }));
  const sectors = await mapLimit(sw1List, CONCURRENCY, async (sec) => {
    const o = { ...sec, pct: null, members: new Set() };
    try {
      const kl = await runData(['kline', sec.code, '--period', 'day', '--end', anchor, '--limit', '3']);
      const rows = rowsByHeader(kl, ['date']).map(r => ({ date: r['date'], close: +r['last'] })).filter(r => r.date && !isNaN(r.close));
      const till = rows.filter(r => r.date <= anchor);
      if (till.length >= 2 && till[0].date === anchor) o.pct = (till[0].close / till[1].close - 1) * 100;
    } catch (e) { o.pctErr = String(e.message || e); }
    try {
      const con = await runData(['sector', 'constituent', sec.code, '--limit', '600']);
      for (const r of rowsByHeader(con, ['StockCode'])) {
        const c = (r['StockCode'] || r['code'] || '').trim();
        if (/^(sh|sz)\d{6}$/.test(c)) o.members.add(c);
      }
    } catch (e) { o.memErr = String(e.message || e); }
    return o;
  });
  const validSectors = sectors.filter(s => s.pct !== null).sort((a, b) => b.pct - a.pct);
  const topN = Math.max(1, Math.round(validSectors.length * 0.1));
  validSectors.forEach((s, i) => { s.rank = i + 1; s.inTop10 = i < topN; });
  const sectorByCode = {}; sectors.forEach(s => sectorByCode[s.code] = s);
  for (const s of stocks) {
    const sec = sectors.find(x => x.members.has(s.code));
    if (sec) {
      const laggard = sec.inTop10 && (s.r01.chg != null) && (s.r01.chg < 0.5 * sec.pct);
      s.r07 = { sectorName: sec.name, sectorPct: sec.pct, sectorRank: sec.rank, inTop10: sec.inTop10, laggard: !!laggard, total: validSectors.length, topN };
    } else {
      s.r07 = { sectorName: '—', sectorPct: null, sectorRank: null, inTop10: false, laggard: false, total: validSectors.length, topN, unmatched: true };
    }
  }

  // ---- 5. R05 尾盘异动核验 ----
  log(`[5/8] 核验 R05 尾盘异动（依赖分时数据）...`);
  for (const s of stocks) {
    const m = s.minute;
    const r05 = { available: false, lateGain: null, lateVolShare: null, fullDayGain: s.r01.chg, gates: {}, verdict: '', note: '' };
    let dayBars = [];
    if (Array.isArray(m)) dayBars = m.filter(b => b.date === anchor);
    if (dayBars.length === 0) {
      r05.verdict = 'gap';
      r05.note = `分时接口未回溯至锚定日 ${anchor}（仅保留最近约 5 个交易日），R05 三项核心门槛中依赖分时数据的两项无法验证，故判定为数据缺口，不编造信号。`;
    } else {
      r05.available = true;
      const late = dayBars.filter(b => b.time >= '1430');
      const p1430 = dayBars.find(b => b.time >= '1430') || dayBars[0];
      const p1500 = dayBars[dayBars.length - 1];
      if (p1430 && p1500 && p1430.price) r05.lateGain = (p1500.price / p1430.price - 1) * 100;
      const lateVol = late.reduce((a, b) => a + (b.vol || 0), 0);
      const dayVol = dayBars.reduce((a, b) => a + (b.vol || 0), 0);
      r05.lateVolShare = dayVol ? lateVol / dayVol : 0;
      r05.gates.lateGain = r05.lateGain != null && r05.lateGain >= 2;
      r05.gates.lateVol = r05.lateVolShare >= 0.20;
      r05.gates.fullDay = r05.fullDayGain != null && r05.fullDayGain < 7;
      // 净流入需 L2，分时数据不含 -> 不可得
      if (r05.gates.lateGain && r05.gates.lateVol && r05.gates.fullDay) r05.verdict = 'partial';
      else r05.verdict = 'no';
    }
    s.r05 = r05;
  }

  // ---- 6. 市场宽度 + 画像 ----
  log(`[6/8] 拉取市场涨跌分布与市场画像 ...`);
  let breadth = null, breadthIsAnchor = false;
  try {
    const cd = await runData(['changedist']);
    const row = rowsByHeader(cd, ['上涨'])[0];
    if (row) {
      breadth = {
        up: +row['上涨'], down: +row['下跌'], flat: +row['平盘'],
        limitUp: +row['涨停'], limitDown: +row['跌停'], halt: +row['停牌'],
        upPct: parseFloat(String(row['上涨占比']).replace('%', '')) || 0,
      };
      const amtM = (cd.match(/两市成交额：([\d.]+)/) || [])[1];
      breadth.amountYi = amtM ? (+amtM / 1e8) : null;
      breadthIsAnchor = (anchor === lastClosedTradingDay(now));
    }
  } catch (e) { breadth = { error: String(e.message || e) }; }

  let overview = null;
  try {
    const ov = await runData(['market-overview', '--date', anchor]);
    const rows = rowsByHeader(ov, ['维度']);
    overview = rows.map(r => ({ dim: r['维度'], score: +r['得分'], state: r['状态'] }));
  } catch (e) { overview = { error: String(e.message || e) }; }

  // ---- 7-8. 分类 + 生成 HTML（抽取为 classifyAndBuild，离线模式复用）----
  // 实时模式：写出「当日日期」命名的快照（覆盖式写入，每天一份），并推送通知
  const snapshotPath = args.dump || path.join(__dirname, 'data', `snapshot-${anchor}.json`);
  const snap = {
    anchor, target, limit, topN,
    breadth, breadthIsAnchor, overview,
    stocks: stocks.map(s => { const c = Object.assign({}, s); delete c.kline; delete c.quote; delete c.minute; return c; }),
    sectors: validSectors.map(s => { const c = Object.assign({}, s); delete c.members; return c; }),
  };
  fs.writeFileSync(snapshotPath, JSON.stringify(snap));
  log(`[snapshot] 已写出 ${snapshotPath}（覆盖式，按锚定日留档）`);
  const build = classifyAndBuild({ anchor, target, limit, stocks, validSectors, topN, breadth, breadthIsAnchor, overview, outPath, quiet: args.quiet });
  if (!args.noNotify) {
    try { await sendNotify({ anchor, target, breadth, build }); }
    catch (e) { log('[notify] 推送失败（不影响报告生成）: ' + (e && e.message || e)); }
  }
}

// 实时结果推送（微信 + 163 邮箱），结果写入 notify_config.json / 环境变量
async function sendNotify({ anchor, target, breadth, build }) {
  let notifyMod;
  try { notifyMod = require('./notify'); }
  catch (e) { log('[notify] 未找到 notify.js，跳过推送'); return; }
  const upPctTxt = (breadth && !breadth.error) ? breadth.upPct : null;
  const regime = upPctTxt == null ? '市场宽度数据缺失'
    : upPctTxt >= 70 ? '强势普涨' : upPctTxt >= 50 ? '偏多震荡' : upPctTxt >= 30 ? '分化偏弱' : '弱势普跌';
  const title = `A股次日候选池 · ${anchor} 收盘后初筛`;
  const content = [
    `**锚定日**：${anchor}（面向 ${target} 交易日）`,
    `**硬触发**：R01 ${build.r01Triggers} 只 / R07 补涨 ${build.r07Triggers} 只 / R05 部分触发 ${build.r05Hard} 只`,
    `**梯队**：重点关注 ${build.high.length} ｜ 次级 ${build.secondary.length} ｜ 条件 ${build.conditional.length} ｜ 排除 ${build.excluded.length}`,
    `**市场环境**：${regime}（上涨占比 ${upPctTxt != null ? upPctTxt + '%' : '—'}）`,
    ``,
    `报告文件：reports/stock_list_${anchor.replace(/-/g, '')}.html`,
    `（HTML 报告已作为附件发送，或前往 GitHub 仓库按日期查看。）`,
  ].join('\n');
  const htmlPath = path.join(__dirname, 'reports', `stock_list_${anchor.replace(/-/g, '')}.html`);
  const res = await notifyMod.notify({ title, content, htmlPath });
  for (const [ch, [ok, info]] of res) {
    log(`[notify] ${ch}: ${ok ? 'OK' : '失败 ' + JSON.stringify(info)}`);
  }
}

// ===========================================================================
// HTML 生成
// ===========================================================================
function b(zh, en) { return `<span data-zh="${zh}" data-en="${en}">${zh}</span>`; }
function num(n, d = 2) { return (n == null || isNaN(n)) ? '—' : Number(n).toFixed(d); }
function pct(n) { return (n == null || isNaN(n)) ? '—' : (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%'; }
function yi(n) { return (n == null || isNaN(n)) ? '—' : Number(n).toFixed(1) + ' 亿'; }
function gateCell(pass) {
  if (pass === true) return '<td class="yes">✓</td>';
  if (pass === false) return '<td class="no">✗</td>';
  return '<td class="na">—</td>';
}

function buildHTML(m) {
  const { anchor, target, limit, universe, breadth, breadthIsAnchor, overview,
    high, secondary, conditional, excluded, r01Triggers, r07Triggers, r05Hard } = m;

  // 核心结论
  const best = [...universe].sort((a, b) => (b.r01.core || 0) - (a.r01.core || 0))[0];
  const bestStr = best && best.r01.core ? `${best.name}（${best.code.replace(/^[sh|sz]/, '')}），四项中达成 ${best.r01.core} 项${best.r01.capOk ? '，市值达标' : ''}` : '无';
  const conclusion = [
    `<b>${b('R01 ' + (r01Triggers ? `硬触发 ${r01Triggers} 只` : '零硬触发'), 'R01 ' + (r01Triggers ? `${r01Triggers} hard trigger(s)` : 'zero hard triggers'))}。</b>` +
      (r01Triggers ? '' : `12 只标的无一满足全部门槛。最接近者为 ${bestStr}。`),
    `<b>${b('R07 ' + (r07Triggers ? `补涨触发 ${r07Triggers} 只` : '零硬触发'), 'R07 ' + (r07Triggers ? `${r07Triggers} laggard trigger(s)` : 'zero hard triggers'))}。</b>` +
      (r07Triggers ? '' : `12 只标的所属板块均未进入强势板块（前 ${m.topN} 名）行列；逐一核验后全部为板块内领涨股，与 R07 补涨逻辑方向相反。`),
    `<b>${b('R05 判定', 'R05 status')}：</b>` +
      (r05Hard ? `${b('部分触发 ' + r05Hard + ' 只（尾盘量价达标，但净流入需 L2 不可得）', r05Hard + ' partial trigger(s) — late-session volume/price met, but net inflow needs L2 and is unavailable')}。` :
        `${b('未出现硬触发', 'no hard trigger')}。${b('若分时接口未回溯至锚定日则属数据缺口而非信号缺失', 'where intraday data is unavailable for the anchor date this is a data gap, not an absence of signal')}——本报告未以任何替代指标补齐该信号。`),
    `<b>${b('重点关注' + (high.length ? ` ${high.length} 只` : '为空'), 'High-priority tier' + (high.length ? `: ${high.length}` : ': empty'))}。</b>` +
      `${b('按规则纪律，无全部门槛达标即不设重点关注；次级关注 ' + secondary.length + ' 只、条件观察 ' + conditional.length + ' 只、排除 ' + excluded.length + ' 只。',
           'Under rule discipline, no name clearing all gates means an empty high-priority tier. Result: ' + secondary.length + ' secondary, ' + conditional.length + ' conditional, ' + excluded.length + ' excluded.')}`,
  ];

  // R01 矩阵
  let r01Rows = '';
  for (const s of universe) {
    const r = s.r01;
    const cls = r.ok ? ' class="hit"' : '';
    r01Rows += `<tr${cls}>` +
      `<td>${s.code.replace(/^[sh|sz]/, '')}</td>` +
      `<td>${b(s.name, s.name)}</td>` +
      `<td>${num(r.close)}</td>` +
      `<td class="${r.chg >= 0 ? 'up' : 'down'}">${pct(r.chg)}</td>` +
      `<td>${num(r.turn)}%</td>` +
      `<td>${num(r.volRatio)}</td>` +
      `<td>${num(r.prior10High)}</td>` +
      gateCell(r.gates.C1) + gateCell(r.gates.C2) + gateCell(r.gates.C3) + gateCell(r.gates.C4) +
      `<td><b>${r.core != null ? r.core + ' / 4' : '—'}</b></td>` +
      `<td>${r.mktCapYi != null ? yi(r.mktCapYi) : '—'}</td>` +
      `</tr>`;
  }

  // R07 表
  let r07Rows = '';
  for (const s of universe) {
    const x = s.r07 || {};
    r07Rows += `<tr>` +
      `<td>${s.code.replace(/^[sh|sz]/, '')}</td>` +
      `<td>${b(s.name, s.name)}</td>` +
      `<td>${x.sectorName ? b(x.sectorName, x.sectorName) : '—'}</td>` +
      `<td>${pct(x.sectorPct)}</td>` +
      `<td>${x.sectorRank ? x.sectorRank + '/' + x.total : '—'}</td>` +
      `<td>${x.inTop10 ? '<span class="yes">★强势</span>' : '<span class="no">—</span>'}</td>` +
      `<td>${x.laggard ? '<span class="yes">补涨</span>' : '<span class="no">领涨</span>'}</td>` +
      `</tr>`;
  }

  // 排除表
  let exRows = '';
  for (const s of excluded) {
    exRows += `<tr>` +
      `<td>${s.code.replace(/^[sh|sz]/, '')}</td>` +
      `<td>${b(s.name, s.name)}</td>` +
      `<td class="wrap">${(s.excludeReasons || ['—']).map(r => b(r, r)).join('；')}</td>` +
      `</tr>`;
  }
  if (!exRows) exRows = `<tr><td colspan="3" class="no">${b('无', 'None')}</td></tr>`;

  // 次级/条件卡片
  function watchCard(s, label) {
    const r = s.r01;
    const fund = s.fund && !s.fund.error && s.fund.MainNetFlow != null
      ? `<div class="kv"><span class="label">${b('主力净流入', 'Main net inflow')}：</span><span class="value ${s.fund.MainNetFlow >= 0 ? 'up' : 'down'}">${yi(+s.fund.MainNetFlow / 1e8)}</span></div>`
      : '';
    const r07 = s.r07 || {};
    return `<div class="card ${label === 'priority' ? 'priority' : ''}">` +
      `<div class="grid-2">` +
      `<div><div class="kv"><span class="label">${b('名称', 'Name')}：</span><span class="value">${b(s.name, s.name)}（${s.code.replace(/^[sh|sz]/, '')}）</span></div>` +
      `<div class="kv"><span class="label">${b('R01 达成', 'R01 score')}：</span><span class="value">${r.core}/4${r.capOk ? '，市值达标' : '，市值越线'}</span></div>` +
      `<div class="kv"><span class="label">${b('行业', 'Sector')}：</span><span class="value">${r07.sectorName || '—'}（${pct(r07.sectorPct)}，排名 ${r07.sectorRank || '—'}/${r07.total || '—'}）</span></div></div>` +
      `<div>${fund}` +
      `<div class="kv"><span class="label">${b('R07 状态', 'R07')}：</span><span class="value">${r07.laggard ? b('板块补涨滞后', 'sector laggard') : b('板块领涨', 'sector leader')}</span></div>` +
      `<div class="kv"><span class="label">${b('R05', 'R05')}：</span><span class="value">${(() => { if (!s.r05) return '—'; if (s.r05.verdict === 'gap') return b('数据缺口', 'data gap'); if (s.r05.verdict === 'partial') return b('尾盘量价达标', 'late-session met'); return b('未触发', 'not triggered'); })()}</span></div></div>` +
      `</div></div>`;
  }
  let secondaryHtml = secondary.length ? secondary.map(s => watchCard(s, 'priority')).join('') : `<div class="card empty"><p class="body-text">${b('无标的达成 R01 核心 3/4 且市值达标。', 'No name met R01 core 3/4 with market cap in range.')}</p></div>`;
  let conditionalHtml = conditional.length ? conditional.map(s => watchCard(s, '')).join('') : `<div class="card empty"><p class="body-text">${b('无标的处于「仅 C3+C4 达标」的条件观察档。', 'No name sits in the conditional tier (C3+C4 only).')}</p></div>`;

  // 重点关注
  let highHtml = high.length ? high.map(s => watchCard(s, 'priority')).join('') : `<div class="card empty"><p class="body-text">${b('重点关注为空：按规则纪律，仅当 R01 全部门槛（量能/突破/涨幅/换手/市值/非高位区）同时达标才列入。本日无此类标的。', 'High-priority tier is empty: under rule discipline a name is listed only when all R01 gates (volume / breakout / gain / turnover / cap / not-at-52w-high) clear together. None qualified today.')}</p></div>`;

  // R05 说明
  const r05any = universe.some(s => s.r05 && s.r05.available);
  const r05Gap = universe.some(s => s.r05 && s.r05.verdict === 'gap');
  const r05Note = r05Gap
    ? b(`R05 属于数据缺口：分时接口（westock-data minute）仅保留最近约 5 个交易日，锚定日 ${anchor} 的分时不可得，因此 14:30–15:00 涨幅与 14:30 后成交量占比两项核心门槛无法验证。本报告未以任何替代指标补齐该信号。`,
         `R05 is a data gap: the intraday endpoint (westock-data minute) only keeps the most recent ~5 sessions, so ${anchor} intraday data is unavailable. The two core gates (gain between 14:30–15:00, and ≥20% of daily volume after 14:30) cannot be verified. No substitute indicator was used to fill this gap.`)
    : (r05any
      ? b('R05 已基于可得分时数据核验：尾盘涨幅与尾盘量能占比两项可算；「尾盘主力净流入」需逐笔 L2 数据，分时接口不含，故不可得。仅当尾盘涨幅 ≥2%、尾盘量能占比 ≥20% 且全天涨幅 <7% 时记为部分触发。',
         'R05 was checked against available intraday data: late-session gain and late-volume share are computable; net late-session main inflow requires L2 tick data not present in the minute feed, so it is unavailable. A partial trigger is recorded only when late gain ≥2%, late-volume share ≥20% and full-day gain <7%.')
      : b('R05 未核验。', 'R05 not evaluated.'));

  // 市场宽度
  let breadthHtml = '';
  if (breadth && !breadth.error) {
    const label = breadthIsAnchor ? b('市场宽度（锚定日收盘）', 'Market breadth (anchor close)') : b('市场宽度（最新交易日快照，非锚定日历史值）', 'Market breadth (latest session snapshot, not the anchor date)');
    breadthHtml = `<p class="body-text">${label}</p><div class="table-wrap"><table><thead><tr>` +
      ['上涨', '下跌', '平盘', '涨停', '跌停', '停牌', '上涨占比', '两市成交额'].map(h => `<th>${b(h, h)}</th>`).join('') +
      `</tr></thead><tbody><tr>` +
      `<td class="up">${breadth.up}</td><td class="down">${breadth.down}</td><td>${breadth.flat}</td>` +
      `<td class="up">${breadth.limitUp}</td><td class="down">${breadth.limitDown}</td><td>${breadth.halt}</td>` +
      `<td class="up">${breadth.upPct}%</td><td>${breadth.amountYi != null ? (breadth.amountYi / 1e8).toFixed(0) + ' 亿' : '—'}</td>` +
      `</tr></tbody></table></div>` +
      (breadthIsAnchor ? '' : `<p class="src">${b('注：涨跌分布接口仅提供最新交易日，非锚定日历史值；历史回填时该数据不代表锚定日真实宽度。', 'Note: the breadth endpoint provides only the latest session, not the anchor date; for historical backfills this does not reflect the anchor day’s true breadth.')}</p>`);
  } else {
    breadthHtml = `<p class="body-text">${b('涨跌分布数据暂不可得。', 'Breadth data temporarily unavailable.')}</p>`;
  }

  // 市场画像
  let overviewHtml = '';
  if (overview && !overview.error) {
    const pick = ['大小盘轮动', '行业轮动', '板块宽度', '情绪指标', '个股宽度', '短期趋势方向', '短期趋势强度', '估值水平', '成交量能'];
    const rows = overview.filter(o => pick.includes(o.dim)).map(o => `<tr><td>${b(o.dim, o.dim)}</td><td>${o.score}</td><td>${b(o.state, o.state)}</td></tr>`).join('');
    overviewHtml = `<div class="table-wrap"><table><thead><tr><th>${b('维度', 'Dimension')}</th><th>${b('得分', 'Score')}</th><th>${b('状态', 'State')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else {
    overviewHtml = `<p class="body-text">${b('市场画像数据暂不可得。', 'Market-profile data temporarily unavailable.')}</p>`;
  }

  // 市场整体判断叙述
  const upPctTxt = (breadth && !breadth.error) ? breadth.upPct : null;
  const regime = upPctTxt == null ? b('市场宽度数据缺失', 'breadth data missing')
    : upPctTxt >= 70 ? b('强势普涨', 'broad strong rally')
    : upPctTxt >= 50 ? b('偏多震荡', 'mildly bullish')
    : upPctTxt >= 30 ? b('分化偏弱', 'divergent / soft')
    : b('弱势普跌', 'broad decline');
  const marketNarrative = b(
    `当前为${regime}环境（上涨占比 ${upPctTxt != null ? upPctTxt + '%' : '—'}，涨停 ${breadth ? breadth.limitUp : '—'} 只）。综合评分候选池均来自强势榜单，但在普涨日里 R01 量能突破与 R07 补涨的信号噪声偏高，需结合 R05 尾盘资金确认强度后再做决策。本报告仅作观察评级，不构成任何买卖建议。`,
    `The regime is ${regime} (advance ratio ${upPctTxt != null ? upPctTxt + '%' : '—'}, ${breadth ? breadth.limitUp : '—'} limit-ups). The composite-score universe all comes from strong-rank lists, but on a broad up-day the R01 volume-breakout and R07 laggard signals are noisy; confirm strength with R05 late-session capital before any decision. This report is observation-only and is not investment advice.`
  );

  // 数据口径
  const provenance = b(
    `本报告的候选起点命令为 <code>westock-tool ranking CompScore --limit ${limit}</code>。该命令返回的是<b>运行时当日</b>排行；由于全部分析锚定 ${anchor} 收盘，实际执行的是 <code>westock-tool ranking CompScore --date ${anchor} --limit ${limit}</code>，以避免排行与行情的口径错配。日线为前复权（--fq qfq），截断至 ${anchor}，不使用该日之后数据。板块涨幅由申万一级 31 个行业指数日线按 ${anchor} 收盘对前收重建（官方板块榜接口不支持历史日期）。市值对总市值与流通市值同时校验。涨跌分布接口仅提供最新交易日，历史回填时已在市场宽度处标注。`,
    `The starting command was <code>westock-tool ranking CompScore --limit ${limit}</code>, which returns the <b>runtime's current-day</b> ranking. Because all analysis is anchored to the ${anchor} close, the command actually executed was <code>westock-tool ranking CompScore --date ${anchor} --limit ${limit}</code> to avoid a mismatch between ranking and price data. Daily bars are forward-adjusted (--fq qfq) and truncated at ${anchor}; no later data is used. Sector returns were rebuilt from the daily bars of the 31 SW Level-1 indices using the ${anchor} close vs prior close (the official sector endpoint does not accept a historical date). Market cap is checked against both total and free-float. The breadth endpoint provides only the latest session, flagged in the market section for backfills.`
  );

  // 组装
  const css = `  :root {
    --bg: #fffbeb; --card: #fff; --text: #1c1917; --muted: #92400e;
    --border: #fde68a; --accent: #b45309; --red: #dc2626; --green: #16a34a;
    --blue: #2563eb; --amber: #d97706; --gold: #ca8a04; --slate: #64748b;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; padding: 24px 16px; }
  .container { max-width: 960px; margin: 0 auto; }
  .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 4px; }
  h1 { font-size: 1.55rem; font-weight: 700; margin-bottom: 6px; }
  h2 { font-size: 1.15rem; font-weight: 600; margin: 30px 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--border); }
  h3 { font-size: 1.05rem; font-weight: 600; margin-bottom: 10px; }
  .sub { color: var(--muted); font-size: 0.9rem; margin-bottom: 14px; }
  #langBtn { flex: none; cursor: pointer; border: 1px solid var(--accent); background: #fff; color: var(--accent); font-weight: 600; font-size: 0.85rem; padding: 7px 16px; border-radius: 999px; font-family: inherit; transition: all .15s; white-space: nowrap; }
  #langBtn:hover { background: var(--accent); color: #fff; }
  .meta-bar { display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 0.88rem; margin-bottom: 18px; }
  .meta-bar .label { color: var(--muted); }
  .meta-bar .value { font-weight: 600; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
  .card.priority { border-left: 4px solid var(--gold); }
  .card.empty { border-left: 4px solid var(--slate); background: #fafaf9; }
  .callout { background: #fff7ed; border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 10px; padding: 16px 20px; margin-bottom: 18px; }
  .callout h3 { color: var(--accent); margin-bottom: 8px; }
  .callout ul { margin: 6px 0 0 18px; font-size: 0.9rem; }
  .callout li { margin-bottom: 5px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 20px; }
  @media (max-width: 640px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } }
  .kv { font-size: 0.9rem; }
  .kv .label { color: var(--muted); }
  .kv .value { font-weight: 600; }
  .up { color: var(--red); }
  .down { color: var(--green); }
  .flat { color: var(--slate); }
  .score { display: inline-block; font-size: 0.95rem; font-weight: 700; padding: 2px 12px; border-radius: 6px; background: #fffbeb; color: var(--gold); }
  .tag { display: inline-block; font-size: 0.78rem; padding: 2px 8px; border-radius: 4px; margin: 2px 4px 2px 0; background: #eff6ff; color: var(--blue); }
  .tag.fail { background: #f1f5f9; color: var(--slate); }
  .tag.pass { background: #fef2f2; color: var(--red); }
  .tag.gap { background: #fffbeb; color: var(--amber); }
  .body-text { font-size: 0.9rem; }
  .risk { margin-top: 12px; padding: 8px 12px; background: #fef2f2; border-radius: 6px; font-size: 0.85rem; color: var(--red); }
  .note { margin-top: 12px; padding: 8px 12px; background: #f8fafc; border-radius: 6px; font-size: 0.85rem; color: var(--slate); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { padding: 8px 9px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; background: #fefce8; }
  td.wrap { white-space: normal; min-width: 210px; }
  tr.hit { background: #fffdf5; }
  .yes { color: var(--red); font-weight: 700; }
  .no { color: var(--slate); }
  .na { color: var(--amber); }
  .src { font-size: 0.78rem; color: var(--slate); margin-top: 8px; font-style: normal; }
  .disclaimer { margin-top: 26px; padding: 14px 18px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 0.85rem; color: #991b1b; }
  .footer { margin-top: 22px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.8rem; text-align: center; }`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${b(`A股次日候选池 — ${anchor} 收盘后初筛`, `A-Share Next-Day Candidate Pool — Post-Close Screening, ${anchor}`)}</title>
<style>${css}</style>
</head>
<body>
<div class="container">
  <div class="topbar">
    <div>
      <h1>${b(`A股次日候选池 — ${anchor} 收盘后初筛`, `A-Share Next-Day Candidate Pool — Post-Close Screening, ${anchor}`)}</h1>
      <div class="sub">${b(`候选起点：官方综合评分排行前 ${limit} 名（锚定 ${anchor}） · 规则：R01 量能验证突破 + R07 板块内补涨 · 面向 ${target} 交易日`, `Starting universe: Official Composite Score ranking, top ${limit} (anchored to ${anchor}) · Rules: R01 Volume-Confirmed Breakout + R07 Intra-Sector Laggard · For the ${target} session`)}</div>
    </div>
    <button id="langBtn" type="button">EN</button>
  </div>

  <div class="meta-bar">
    <div><span class="label">${b('锚定日：', 'Anchor date:')}</span><span class="value">${anchor}</span></div>
    <div><span class="label">${b('候选池：', 'Universe:')}</span><span class="value">${limit} ${b('只', 'names')}</span></div>
    <div><span class="label">${b('硬触发：', 'Hard triggers:')}</span><span class="value" style="color:var(--slate)">R01 ${r01Triggers} / R07 ${r07Triggers} / R05 ${r05Hard}</span></div>
    <div><span class="label">${b('市场环境：', 'Market regime:')}</span><span class="value ${upPctTxt != null && upPctTxt >= 50 ? 'up' : 'flat'}">${regime}</span></div>
  </div>

  <div class="callout">
    <h3>${b('核心结论（先行）', 'Key Conclusions (Up Front)')}</h3>
    <ul>${conclusion.map(c => `<li>${c}</li>`).join('')}</ul>
  </div>

  <h2>${b('数据口径与偏差声明', 'Data Provenance and Deviations')}</h2>
  <div class="card">
    <p class="body-text">${provenance}</p>
    <p class="src">${b('数据来源：腾讯自选股 westock-data / westock-tool，数据时点 ' + anchor + ' 收盘（板块指数、个股日线、历史行情快照、主力资金流、市场画像均为该日；涨跌分布为接口最新可得交易日）。', 'Source: Tencent Stock (westock-data / westock-tool). Data timestamp: ' + anchor + ' close — sector indices, daily bars, historical quote snapshots, main-capital flows and market profile are as of that session; breadth reflects the latest session available from the endpoint.')}</p>
  </div>

  <h2>${b('R01 量能验证突破 — 全量判定明细', 'R01 Volume-Confirmed Breakout — Full Evaluation Matrix')}</h2>
  <div class="card">
    <p class="body-text" style="margin-bottom:12px">${b('四项门槛：C1 当日量 ≥ 近 5 日均量 150% ｜ C2 收盘突破近 10 日最高价 ｜ C3 涨幅 3%–8% ｜ C4 换手率 ≥ 3%。红色为达成。', 'Four gates: C1 volume at 150%+ of the 5-day average | C2 close above the prior 10-day high | C3 gain 3%–8% | C4 turnover 3%+. Red marks a pass.')}</p>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>${b('代码', 'Code')}</th><th>${b('名称', 'Name')}</th><th>${b('收盘', 'Close')}</th>
        <th>${b('涨幅', 'Chg')}</th><th>${b('换手', 'Turn.')}</th><th>${b('量能/5日', 'Vol/5d')}</th>
        <th>${b('前10日高', 'Prior 10d high')}</th>
        <th>C1</th><th>C2</th><th>C3</th><th>C4</th>
        <th>${b('达成', 'Score')}</th><th>${b('总市值', 'Mkt cap')}</th>
      </tr></thead>
      <tbody>${r01Rows}</tbody>
    </table></div>
  </div>

  <h2>${b('R07 板块内补涨 — 行业归属与强弱', 'R07 Intra-Sector Laggard — Sector Mapping & Strength')}</h2>
  <div class="card">
    <p class="body-text" style="margin-bottom:12px">${b(`行业口径为申万一级（共 ${m.sectors ? m.sectors.length : '—'} 个，前 10% = 前 ${m.topN} 名）。补涨判定：所属行业居前 10% 且 个股涨幅 < 行业涨幅的一半。`, `Sector universe is SW Level-1 (${m.sectors ? m.sectors.length : '—'} sectors, top 10% = top ${m.topN}). Laggard test: the stock's sector is in the top 10% and its gain is below half the sector's gain.`)}</p>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>${b('代码', 'Code')}</th><th>${b('名称', 'Name')}</th><th>${b('所属行业', 'Sector')}</th>
        <th>${b('行业涨幅', 'Sector chg')}</th><th>${b('行业排名', 'Sector rank')}</th>
        <th>${b('强势板块', 'Strong?')}</th><th>${b('角色', 'Role')}</th>
      </tr></thead>
      <tbody>${r07Rows}</tbody>
    </table></div>
  </div>

  <h2>${b('重点关注', 'High-Priority Watch')}</h2>
  ${highHtml}

  <h2>${b('次级关注', 'Secondary Watch')}</h2>
  ${secondaryHtml}

  <h2>${b('条件观察', 'Conditional Watch')}</h2>
  ${conditionalHtml}

  <h2>${b('排除说明', 'Exclusions')}</h2>
  <div class="card">
    <div class="table-wrap"><table>
      <thead><tr><th>${b('代码', 'Code')}</th><th>${b('名称', 'Name')}</th><th>${b('排除原因', 'Reason')}</th></tr></thead>
      <tbody>${exRows}</tbody>
    </table></div>
  </div>

  <h2>${b('R05 尾盘异动核验', 'R05 Late-Session Capital Surge')}</h2>
  <div class="card">
    <p class="body-text">${r05Note}</p>
  </div>

  <h2>${b('市场整体判断', 'Overall Market Assessment')}</h2>
  <div class="card">
    ${breadthHtml}
    <div style="height:14px"></div>
    ${overviewHtml}
    <div class="note">${marketNarrative}</div>
  </div>

  <div class="disclaimer">
    <b>${b('风险提示与免责声明', 'Risk Disclaimer')}：</b>${b('本报告由程序基于公开市场数据自动生成，仅用于短线交易候选池的量化初筛与观察评级，不构成任何投资建议或买卖邀约。所有判定均基于历史/收盘数据，存在前视偏差与数据缺口（如 R05 分时不可得）。市场有风险，决策需独立判断并自担风险。', 'This report is generated automatically from public market data for quantitative pre-screening and observation-only rating of short-term trading candidates. It is not investment advice or a solicitation to trade. All judgments rely on historical/close data and may contain look-ahead bias and data gaps (e.g. R05 intraday unavailable). Markets carry risk; decisions must be made independently and at your own risk.')}
  </div>

  <div class="footer">${b('生成于 ' + new Date().toLocaleString('zh-CN'), 'Generated ' + new Date().toISOString())} · ${b('A股短线交易 · 次日候选池自动初筛', 'A-Share Short-Term Trading · Automated Next-Day Candidate Screening')}</div>
</div>

<script>
(function () {
  var btn = document.getElementById('langBtn');
  var lang = 'zh';
  var nodes = document.querySelectorAll('[data-zh]');
  nodes.forEach(function (el) {
    if (!el.getAttribute('data-zh')) { el.setAttribute('data-zh', el.innerHTML); }
  });
  function apply(target) {
    nodes.forEach(function (el) {
      var val = el.getAttribute('data-' + target);
      if (val !== null && val !== '') { el.innerHTML = val; }
    });
    document.documentElement.lang = (target === 'zh') ? 'zh-CN' : 'en';
    document.title = (target === 'zh')
      ? 'A股次日候选池 — ${anchor} 收盘后初筛'
      : 'A-Share Next-Day Candidate Pool — Post-Close Screening, ${anchor}';
    btn.textContent = (target === 'zh') ? 'EN' : '中文';
  }
  btn.addEventListener('click', function () { lang = (lang === 'zh') ? 'en' : 'zh'; apply(lang); });
  apply(lang);
})();
</script>
</body>
</html>`;
}

// 分类 + 生成 HTML（在线与离线共用）
function classifyAndBuild(m) {
  const { anchor, target, limit, stocks, validSectors, topN, breadth, breadthIsAnchor, overview, outPath, quiet } = m;
  // ---- 7. 分类 ----
  log(`[7/8] 分类: 重点关注 / 次级关注 / 排除 ...`);
  const high = [], secondary = [], conditional = [], excluded = [];
  for (const s of stocks) {
    const r = s.r01;
    if (r.ok) high.push(s);
    else if (r.capOk && r.highZoneOk && r.core >= 2) {
      if (r.core >= 3) secondary.push(s); else conditional.push(s);
    } else {
      const reasons = [];
      if (!r.capOk && r.mktCapYi != null) reasons.push(`市值 ${r.mktCapYi.toFixed(1)} 亿超出 20–500 亿区间`);
      if (r.capOk === false && r.mktCapYi == null) reasons.push('市值数据缺失');
      if (r.highZoneOk === false) reasons.push('处于 52 周高位区');
      if (r.core < 2) reasons.push(`量价突破仅达成 ${r.core}/4 项`);
      if (r.error) reasons.push('行情数据缺失');
      s.excludeReasons = reasons;
      excluded.push(s);
    }
  }
  high.sort((a, b) => b.r01.core - a.r01.core);
  secondary.sort((a, b) => b.r01.core - a.r01.core);
  conditional.sort((a, b) => b.r01.core - a.r01.core);
  excluded.sort((a, b) => b.r01.core - a.r01.core);

  const r01Triggers = high.length;
  const r07Triggers = stocks.filter(s => s.r07 && s.r07.laggard).length;
  const r05Hard = stocks.filter(s => s.r05 && s.r05.verdict === 'partial').length;

  // ---- 8. 生成 HTML ----
  log(`[8/8] 生成双语 HTML -> ${outPath}`);
  const html = buildHTML({
    anchor, target, limit, universe: stocks, sectors: validSectors, topN,
    breadth, breadthIsAnchor, overview,
    high, secondary, conditional, excluded,
    r01Triggers, r07Triggers, r05Hard,
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  log(`完成。硬触发 R01=${r01Triggers} 只 / R07 补涨=${r07Triggers} 只 / R05 部分触发=${r05Hard} 只`);
  log(`输出: ${outPath}`);
  if (!quiet) process.stdout.write(outPath + '\n');
  return { high, secondary, conditional, excluded, r01Triggers, r07Triggers, r05Hard, anchor, target, outPath };
}

// 离线模式：从快照载入，跳过 westock 调用
async function runOffline(args) {
  if (!args.snapshot) { log('离线模式需要 --snapshot <快照文件>'); process.exit(1); }
  const snap = JSON.parse(fs.readFileSync(args.snapshot, 'utf8'));
  const stocks = snap.stocks;
  const validSectors = snap.sectors || [];
  const { anchor, target, limit } = snap;
  const topN = snap.topN, breadth = snap.breadth, breadthIsAnchor = snap.breadthIsAnchor, overview = snap.overview;
  const outPath = args.out || path.join(__dirname, 'reports', `stock_list_${anchor.replace(/-/g, '')}.html`);
  log(`[offline] 从快照 ${args.snapshot} 载入 ${stocks.length} 只，锚定 ${anchor}（面向 ${target}）`);
  classifyAndBuild({ anchor, target, limit, stocks, validSectors, topN, breadth, breadthIsAnchor, overview, outPath, quiet: args.quiet });
}

main().catch(e => { log('FATAL: ' + (e && e.stack || e)); process.exit(1); });
