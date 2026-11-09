'use strict';
/*
 * eod/hotmoney_scan.js —— 游资席位扫描（Hot-Money Seat Scan）
 * ---------------------------------------------------------------------------
 * 统计最近一个交易日的龙虎榜知名游资席位买卖，倒排成「游资 → 票 / 票 → 游资」，
 * 并归档近 N 个交易日的明细，报告提供层级/游资/方向/日期多维筛选与 10 日汇总。
 *
 * 任意时刻可执行：
 *   - 17:30 前跑（当天榜未出齐）→ 自动统计上一交易日；--date 指定任意历史日。
 *   - 近 N 日窗口：缺档自动回补（每交易日 ~120 个低频请求，几分钟），日档永久缓存，
 *     之后每天只抓锚定日新档，汇总零额外请求。
 *   - 变动感知：锚定日席位与快照比对 → 报告标注「新席位」（换马甲/改营业部可见）；
 *     未识别席位按天累计进观察名单 → 高频席位浮现提示晋升进 registry。
 *
 * 用法：
 *   node eod/hotmoney_scan.js                  # 最近一个交易日 + 近10日窗口
 *   node eod/hotmoney_scan.js --date 2026-11-06
 *   node eod/hotmoney_scan.js --history 20     # 明细窗口扩到 20 个交易日
 *   node eod/hotmoney_scan.js --no-history     # 只扫锚定日，不回补窗口
 *   node eod/hotmoney_scan.js --no-notify      # 失败不告警
 *   node eod/hotmoney_scan.js --json           # stdout 机器摘要
 *   node eod/hotmoney_scan.js --paths          # 打印落点
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./hotmoney.config');
const { dayjs } = require('../time');
const { lastClosedTradingDay } = require('../rules');
const market = require('./lib/market');
const HM = require('./lib/hotmoney');
const store = require('./lib/hotmoney_store');
const preopenStore = require('./lib/preopen_store');
const preopenCfg = require('./preopen.config');
const { buildHTML } = require('./lib/hotmoney_report');
const { mapLimit } = require('./lib/http');
const paths = require('../paths');
const scaffold = require('../scaffold');
const { notify } = require('../notify');

const argv = process.argv.slice(2);
function argOf(f) { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; }
const OPT = {
  date: argOf('--date'),
  force: argv.includes('--force'),
  noHistory: argv.includes('--no-history'),
  history: Math.max(1, parseInt(argOf('--history'), 10) || cfg.history.days),
  noNotify: argv.includes('--no-notify'),
  json: argv.includes('--json'),
  paths: argv.includes('--paths'),
};
function log(m) { if (!OPT.json) console.log(m); }
if (!OPT.paths) require('./lib/runlog').startRunLog('hotmoney');

function fail(msg, err) {
  log(`[失败] ${msg}` + (err ? `\n${err && err.stack || err}` : ''));
  if (cfg.notify.alertOnFailure && !OPT.noNotify) {
    notify({ title: `游资扫描失败 · ${dayjs.tz().format('MM-DD HH:mm')}`, content: `${msg}\n\n${err && err.message || err || ''}` })
      .catch(() => {});
  }
  process.exitCode = 1;
}

// ---------- 锚定日 ----------
/** --date 优先；否则最近已收盘交易日；当天 15:00–boardReadyFrom 之间榜单未出齐 → 回退上一交易日 */
function pickAnchor(now) {
  if (OPT.date) return OPT.date;
  const anchor = lastClosedTradingDay(now);
  const hhmm = now.hour() * 100 + now.minute();
  const boardReady = parseInt(cfg.session.boardReadyFrom.replace(':', ''), 10);
  if (anchor === now.format('YYYY-MM-DD') && hhmm < boardReady) {
    const prev = lastClosedTradingDay(dayjs.tz(anchor + ' 00:00:00'));
    log(`[锚定] ${anchor} 榜单未出齐（${cfg.session.boardReadyFrom} 前）→ 回退上一交易日 ${prev}`);
    return prev;
  }
  return anchor;
}

/** 交易日窗口：从 anchor 向前收集 n 个交易日（跳双休；节假日=空榜日自然跳过；已归档日直接复用） */
async function tradingDays(anchor, n) {
  const days = [];
  let d = dayjs.tz(anchor + ' 00:00:00');
  for (let i = 0; i < cfg.history.maxLookback && days.length < n; i++, d = d.subtract(1, 'day')) {
    if (d.day() === 6 || d.day() === 0) continue;
    const date = d.format('YYYY-MM-DD');
    const cached = store.loadDay(date);
    if (cached) { days.push({ date, bb: cached.bb || {} }); continue; }
    const bb = await market.fetchBillboard(date);
    if (!Object.keys(bb).length) { log(`[窗口] ${date} 空榜（非交易日或无数据）跳过`); continue; }
    days.push({ date, bb });
  }
  return days; // 降序：days[0] = anchor
}

// ---------- 单日扫描 ----------
/** 全榜 → 逐票席位明细 → 名单匹配；未匹配席位按票归并（观察名单用） */
async function scanDay(date, bb) {
  const codes = Object.keys(bb);
  log(`[扫描] ${date} 榜单 ${codes.length} 只，抓席位明细…`);
  const records = [];
  const unmatched = new Map();
  let done = 0;
  await mapLimit(codes, cfg.market.concurrency, async (code) => {
    const seats = await market.fetchBillboardSeats(code, date);
    if ((++done) % 50 === 0) log(`  [席位] 进度 ${done}/${codes.length}`);
    if (!seats.length) return;
    const hot = HM.matchSeatTrades(seats);
    for (const s of seats) {
      if (hot.some((h) => h.seat === s.seat)) continue;
      const u = unmatched.get(s.seat) || { seat: s.seat, buy: 0, sell: 0 };
      u.buy += s.buy || 0; u.sell += s.sell || 0;
      unmatched.set(s.seat, u);
    }
    if (hot.length) records.push({ code, name: bb[code].name || code, bbNet: bb[code].net, hot });
  });
  records.sort((a, b) => b.hot.reduce((x, h) => x + (h.net || 0), 0) - a.hot.reduce((x, h) => x + (h.net || 0), 0));
  return {
    date,
    stockCount: codes.length,
    records,
    unmatched: [...unmatched.values()].sort((a, b) => (b.buy + b.sell) - (a.buy + a.sell)),
  };
}

/** 盘前候选交叉标注（报告里给游资票打「盘前候选」标记，不耦合数据） */
function preopenCodes(date) {
  const doc = preopenStore.loadRun(preopenCfg, date);
  return doc ? new Set(Object.keys(doc.records)) : new Set();
}

// ---------- 主流程 ----------
async function run() {
  if (OPT.paths) {
    const d = paths.describe();
    log(`工作目录: ${d.home} (来源 ${d.source})`);
    for (const [k, v] of Object.entries(d.workspace)) log(`  ${k.padEnd(14)} ${v}`);
    return { paths: d };
  }
  scaffold.autoInit({ log });

  const t0 = Date.now();
  const now = dayjs.tz();
  const anchor = pickAnchor(now);
  log(`[锚定] ${anchor}${OPT.date ? '（--date 指定）' : ''}`);

  const nDays = OPT.noHistory ? 1 : OPT.history;
  log(`[窗口] 近 ${nDays} 个交易日（缺档自动回补；--no-history 只扫锚定日）`);
  const dayList = await tradingDays(anchor, nDays);
  log(`[窗口] 有效交易日 ${dayList.length} 天：${dayList.map((x) => x.date).join('、')}`);

  // 逐日取档（缺档才抓席位；日档缓存永久复用）
  const days = [];
  for (const { date, bb } of dayList) {
    let doc = store.loadDay(date);
    if (doc && doc.records) {
      log(`[日档] ${date} 已有归档（榜单 ${doc.stockCount} / 游资命中 ${doc.records.length} 只）复用`);
    } else {
      doc = await scanDay(date, bb);
      doc = { date, stockCount: doc.stockCount, records: doc.records, unmatched: doc.unmatched, bb };
      store.saveDay(date, doc);
      log(`[日档] ${date} 已归档（榜单 ${doc.stockCount} / 游资命中 ${doc.records.length} 只）`);
    }
    days.push(doc);
  }

  // 席位变更感知：锚定日每个 (游资,席位) 与快照比对 → 新席位标注；随后 union 更新快照
  const snap = store.loadSeatSnapshot();
  const seatChanges = [];
  const anchorDoc = days[0];
  for (const rec of anchorDoc.records) {
    for (const h of rec.hot) {
      const seen = snap.seatsByPerson[h.name] || [];
      if (!seen.includes(h.seat)) seatChanges.push({ name: h.name, tier: h.tier, seat: h.seat, code: rec.code, stock: rec.name });
    }
  }
  for (const doc of days) {
    for (const rec of doc.records) {
      for (const h of rec.hot) {
        const set = snap.seatsByPerson[h.name] || (snap.seatsByPerson[h.name] = []);
        if (!set.includes(h.seat)) set.push(h.seat);
      }
    }
  }
  store.saveSeatSnapshot(snap);
  log(`[感知] 席位变更 ${seatChanges.length} 条${seatChanges.length ? '：' + [...new Set(seatChanges.map((c) => c.name))].join('、') : ''}`);

  // 观察名单合并（各日未识别席位按天累计；同日重复合并只计一次）
  const wl = store.loadWatchlist();
  for (const doc of days) {
    for (const u of doc.unmatched || []) {
      const w = wl[u.seat] || (wl[u.seat] = { days: {}, buy: 0, sell: 0 });
      if (!w.days[doc.date]) { w.days[doc.date] = true; w.buy += u.buy || 0; w.sell += u.sell || 0; }
    }
  }
  store.saveWatchlist(wl);
  const watchTop = Object.entries(wl)
    .map(([seat, w]) => ({ seat, dayCount: Object.keys(w.days).length, buy: w.buy, sell: w.sell }))
    .filter((w) => w.dayCount >= cfg.watch.minDays)
    .sort((a, b) => (b.buy + b.sell) - (a.buy + a.sell))
    .slice(0, cfg.watch.topN);

  // 汇总：明细 trades（窗口内全部匹配记录）+ 按游资 + 按票
  const preopenSets = new Map(days.map((d) => [d.date, preopenCodes(d.date)]));
  const trades = [];
  for (const doc of days) {
    const pset = preopenSets.get(doc.date);
    for (const rec of doc.records) {
      for (const h of rec.hot) {
        trades.push({
          date: doc.date, code: rec.code, stock: rec.name, bbNet: rec.bbNet,
          name: h.name, tier: h.tier, seat: h.seat,
          buy: h.buy, sell: h.sell, net: h.net,
          preopen: pset.has(rec.code),
          newSeat: doc.date === anchor && seatChanges.some((c) => c.name === h.name && c.seat === h.seat),
        });
      }
    }
  }
  const byTraderMap = new Map();
  for (const t of trades) {
    const tr = byTraderMap.get(t.name) || { name: t.name, tier: t.tier, buy: 0, sell: 0, net: 0, days: new Set(), stocks: new Set() };
    tr.buy += t.buy || 0; tr.sell += t.sell || 0; tr.net += t.net || 0;
    tr.days.add(t.date); tr.stocks.add(t.code);
    byTraderMap.set(t.name, tr);
  }
  const byTrader = [...byTraderMap.values()]
    .map((o) => ({ name: o.name, tier: o.tier, buy: o.buy, sell: o.sell, net: o.net, dayCount: o.days.size, stockCount: o.stocks.size }))
    .sort((a, b) => b.net - a.net);

  const result = {
    anchor,
    window: { nDays, days: days.map((d) => ({ date: d.date, stockCount: d.stockCount, hitCount: d.records.length })) },
    anchorDay: { date: anchorDoc.date, stockCount: anchorDoc.stockCount, records: anchorDoc.records },
    trades, byTrader, seatChanges, watchTop,
  };

  // 报告（覆盖式单文件 HTML）
  const reportDir = path.join(paths.eodDir(), cfg.store.reportDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, `${cfg.store.prefix}-${anchor}.html`);
  fs.writeFileSync(reportFile, buildHTML({ cfg, anchor, result, runner: process.env.GITHUB_ACTIONS ? 'github' : 'local' }), 'utf8');
  log(`[报告] ${reportFile}`);

  if (cfg.notify.enabled && !OPT.noNotify) {
    const top = byTrader.slice(0, 8);
    const lines = top.map((t, i) => `${i + 1}. ${t.name}（${t.tier}）净 ${fmtWan(t.net)} · ${t.stockCount} 票 / ${t.dayCount} 天`);
    const content = [
      `交易日 ${anchor} · 游资席位扫描`,
      `榜单 ${anchorDoc.stockCount} 只 / 游资命中 ${anchorDoc.records.length} 只 / 窗口 ${nDays} 天`,
      '', ...lines,
    ].join('\n');
    const res = await notify({ title: `游资席位扫描 ${anchor}`, content, htmlPath: reportFile });
    for (const [ch, [ok, info]] of res) log(`[notify] ${ch}: ${ok ? 'OK' : '失败 ' + JSON.stringify(info)}`);
  }

  const summary = {
    anchor,
    window: result.window.days,
    anchorStocks: anchorDoc.stockCount,
    anchorHitStocks: anchorDoc.records.length,
    anchorTrades: trades.filter((t) => t.date === anchor).length,
    seatChanges: seatChanges.length,
    watchTop: watchTop.length,
    reportFile,
  };
  if (OPT.json) console.log(JSON.stringify(summary, null, 2));
  return summary;
}

function fmtWan(v) {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  return (v < 0 ? '-' : '') + (a >= 1e8 ? (a / 1e8).toFixed(2) + '亿' : Math.round(a / 1e4) + '万');
}

run().catch((e) => fail('游资席位扫描流程异常', e));
