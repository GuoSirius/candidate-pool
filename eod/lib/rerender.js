'use strict';
/*
 * eod/lib/rerender.js —— 从归档重渲染 HTML 报告（回填后让报告与数据同步）
 * ---------------------------------------------------------------------------
 * 背景：verdict / 收盘回填只写 JSON 归档，HTML 是渲染时刻的快照——不重渲染，
 * 命中率区块、游资 T+1·T+3 列永远不会出现在已生成的报告里。
 *
 * 三个管道各一个函数；成功返回 HTML 绝对路径，跳过返回 { skipped: 原因 }：
 *  - 尾盘  rerenderTail(archiveFile)   复用 tail_screener --replay 现成链路（子进程，
 *          内置 skipStore + noNotify；raw 缺失自动退化为 records-only 渲染）
 *  - 盘前  rerenderPreopen(tradeDate)  与 preopen_backfill 收盘重渲染共用同一份逻辑
 *  - 游资  rerenderHotmoney(anchor)    从窗口日档聚合重建；「新席位」标注必须来自
 *          归档 doc.seatChanges（hotmoney_scan 扫描时落档，2026-11-09 起）——旧档没有
 *          就跳过不重渲染，宁缺毋滥（悄悄丢标注 = 报告失真）。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const paths = require('../../paths');
const { dayjs } = require('../../time');
const { lastClosedTradingDay } = require('../../rules');
const { minifyHTML } = require('./report_fmt');

// ---------- 尾盘：子进程走 --replay（重算/重渲染链路已内置幂等与关通知） ----------
function rerenderTail(archiveFile) {
  const doc = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
  if (!doc.records || !doc.tradeDate) throw new Error('存档格式不对：缺少 records/tradeDate');
  // 子进程要加载全量模块 + 离线重算 + 压缩 HTML：无超时会永久阻塞 18:30 链路（评审 #6）。
  const stdout = execFileSync(process.execPath, [path.join(__dirname, '..', 'tail_screener.js'), '--replay', archiveFile], {
    stdio: 'pipe', encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  // 优先用子进程回传的真实写入路径（emitResult 打印 `[报告] <path>`）；
  // 旧实现靠 mtime + startsWith 猜，会误匹配 -intraday / -obs / _probe（评审 #14a）。
  const reported = [...String(stdout || '').matchAll(/\[报告\]\s*([^\r\n]+\.html)/g)].pop();
  if (reported) return reported[1].trim();
  const dir = path.join(paths.eodDir(), 'reports', 'eod');
  const prefix = `eod-${doc.tradeDate}`;
  const files = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => f.startsWith(prefix) && f.endsWith('.html'));
  const exact = `${prefix}.html`;
  const hit = files.includes(exact) ? exact : files
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0]?.f;
  if (!hit) throw new Error('重渲染后未找到报告文件');
  return path.join(dir, hit);
}

// ---------- 盘前：重建 result → buildHTML（与 preopen_backfill 收盘重渲染同一逻辑） ----------
function rerenderPreopen(tradeDate) {
  const cfg = require('../preopen.config');
  const store = require('./preopen_store');
  const { buildHTML } = require('./preopen_report');
  const doc = store.loadRun(cfg, tradeDate);
  if (!doc || !doc.records || !Object.keys(doc.records).length) return { skipped: `无 ${tradeDate} 盘前归档或无候选` };

  const recs = Object.values(doc.records).sort((a, b) => b.total - a.total);
  const bySector = new Map();
  for (const c of recs) { if (!bySector.has(c.sector)) bySector.set(c.sector, []); bySector.get(c.sector).push(c); }
  const groups = [];
  for (const [sector, list] of bySector) {
    list.sort((a, b) => b.total - a.total);
    list.forEach((c, i) => { c.groupRank = i + 1; c.bestInGroup = i === 0; c.groupSize = list.length; });
    groups.push({ sector, size: list.length, shown: list.slice(0, cfg.group.maxPerGroup > 0 ? cfg.group.maxPerGroup : list.length), best: list[0] });
  }
  groups.sort((a, b) => b.best.total - a.best.total);
  const top = recs.slice(0, cfg.group.topN > 0 ? cfg.group.topN : recs.length);
  const rej = doc.meta && doc.meta.rejByReason ? Object.values(doc.meta.rejByReason).reduce((a, b) => a + b, 0) : 0;
  const stats = {
    snapshotCount: (doc.meta && doc.meta.snapshotCount) || 0,
    baselineCount: (doc.meta && doc.meta.baselineCount) || 0,
    candidateCount: recs.length, groupCount: groups.length, gapCount: rej,
    rejByReason: (doc.meta && doc.meta.rejByReason) || {},
  };
  const result = { candidates: recs, groups, top, stats, gaps: [], nearMiss: doc.nearMiss || [] };
  const reportDir = path.join(paths.eodDir(), cfg.store.reportDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, `${cfg.store.prefix}-${tradeDate}.html`);
  fs.writeFileSync(reportFile, minifyHTML(buildHTML({
    cfg, tradeDate, scope: doc.scope, anchor: doc.anchor || lastClosedTradingDay(dayjs.tz(tradeDate)),
    result, marketDate: doc.marketDate, runner: 'local', close: doc.close,
    regime: (doc.meta && doc.meta.regime) || null,
  })), 'utf8');
  return reportFile;
}

// ---------- 游资：窗口日档聚合重建（与 hotmoney_scan 聚合段同一逻辑） ----------
function rerenderHotmoney(anchor) {
  const cfg = require('../hotmoney.config');
  const ndCfg = require('../nextday.config');
  const hmStore = require('./hotmoney_store');
  const preopenStore = require('./preopen_store');
  const preopenCfg = require('../preopen.config');
  const { buildHTML } = require('./hotmoney_report');

  const anchorDoc = hmStore.loadDay(anchor);
  if (!anchorDoc || !anchorDoc.records || !anchorDoc.records.length) return { skipped: `无 ${anchor} 游资归档或无命中` };
  if (!Array.isArray(anchorDoc.seatChanges)) {
    return { skipped: '归档无 seatChanges（旧档）→ 跳过重渲染，避免丢「新席位」标注' };
  }

  // 窗口日档：≤anchor 的最近 N 份（缺档日无归档，与 scan 的缺档回补口径一致地只算有档的）
  const dir = path.join(paths.eodDir(), cfg.store.dataDir);
  const dates = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .map((f) => (f.match(/^hotmoney-(\d{4}-\d{2}-\d{2})\.json$/) || [])[1])
    .filter((d) => d && d <= anchor).sort().reverse().slice(0, cfg.history.days);
  const days = dates.map((d) => hmStore.loadDay(d)).filter((d) => d && d.records);

  // 观察名单合并（内存版不落盘；同日重复只计一次，与 scan 幂等口径一致）
  const wl = { ...hmStore.loadWatchlist() };
  for (const doc of days) {
    for (const u of doc.unmatched || []) {
      const w = wl[u.seat] || (wl[u.seat] = { days: {}, buy: 0, sell: 0 });
      if (!w.days[doc.date]) { w.days[doc.date] = true; w.buy += u.buy || 0; w.sell += u.sell || 0; }
    }
  }
  const watchTop = Object.entries(wl)
    .map(([seat, w]) => ({ seat, dayCount: Object.keys(w.days).length, buy: w.buy, sell: w.sell }))
    .filter((w) => w.dayCount >= cfg.watch.minDays)
    .sort((a, b) => (b.buy + b.sell) - (a.buy + a.sell))
    .slice(0, cfg.watch.topN);

  // 盘前候选交叉标注 + 明细 trades（rec.hot 已在扫描时匹配落档，直接复用）
  const preopenCodes = (date) => {
    const doc = preopenStore.loadRun(preopenCfg, date);
    return doc ? new Set(Object.keys(doc.records)) : new Set();
  };
  const changeKeys = new Set(anchorDoc.seatChanges.map((c) => `${c.name}\u0000${c.seat}`));
  const preopenSets = new Map(days.map((d) => [d.date, preopenCodes(d.date)]));
  const trades = [];
  for (const doc of days) {
    const pset = preopenSets.get(doc.date);
    for (const rec of doc.records) {
      for (const h of rec.hot || []) {
        trades.push({
          date: doc.date, code: rec.code, stock: rec.name, bbNet: rec.bbNet,
          name: h.name, tier: h.tier, seat: h.seat,
          buy: h.buy, sell: h.sell, net: h.net,
          preopen: pset.has(rec.code),
          newSeat: doc.date === anchor && changeKeys.has(`${h.name}\u0000${h.seat}`),
        });
      }
    }
  }
  const byTraderMap = new Map();
  for (const t of trades) {
    const tr = byTraderMap.get(t.name) || { name: t.name, tier: t.tier, buy: 0, sell: 0, net: 0, days: new Set(), stocks: new Set(), t1Rets: [], t3Rets: [], maxRets: [] };
    tr.buy += t.buy || 0; tr.sell += t.sell || 0; tr.net += t.net || 0;
    tr.days.add(t.date); tr.stocks.add(t.code);
    byTraderMap.set(t.name, tr);
  }
  for (const doc of days) {
    for (const rec of doc.records) {
      const v = rec.verdicts;
      if (!v) continue;
      const names = new Set((rec.hot || []).map((h) => h.name));
      for (const n of names) {
        const tr = byTraderMap.get(n);
        if (!tr) continue;
        if (v.t1 && v.t1.buyRet != null) tr.t1Rets.push(v.t1.buyRet);
        if (v.t3) {
          if (v.t3.buyRet != null) tr.t3Rets.push(v.t3.buyRet);
          if (v.t3.maxRet != null) tr.maxRets.push(v.t3.maxRet);
        }
      }
    }
  }
  const win = (arr, min) => arr.length
    ? { n: arr.length, rate: +((arr.filter((x) => x >= min).length / arr.length) * 100).toFixed(0), avg: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) }
    : null;
  const byTrader = [...byTraderMap.values()]
    .map((o) => ({
      name: o.name, tier: o.tier, buy: o.buy, sell: o.sell, net: o.net,
      dayCount: o.days.size, stockCount: o.stocks.size,
      t1: win(o.t1Rets, ndCfg.thresholds.t1HitMin * 100),
      t3: win(o.t3Rets, ndCfg.thresholds.t3HitMin * 100),
      avgMax: o.maxRets.length
        ? +(o.maxRets.reduce((a, b) => a + b, 0) / o.maxRets.length).toFixed(2) : null,
    }))
    .sort((a, b) => b.net - a.net);

  const result = {
    anchor,
    window: { nDays: days.length, days: days.map((d) => ({ date: d.date, stockCount: d.stockCount, hitCount: d.records.length })) },
    anchorDay: { date: anchorDoc.date, stockCount: anchorDoc.stockCount, records: anchorDoc.records },
    trades, byTrader, seatChanges: anchorDoc.seatChanges, watchTop,
  };
  const reportDir = path.join(paths.eodDir(), cfg.store.reportDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, `${cfg.store.prefix}-${anchor}.html`);
  fs.writeFileSync(reportFile, minifyHTML(buildHTML({ cfg, anchor, result, runner: 'local' })), 'utf8');
  return reportFile;
}

module.exports = { rerenderTail, rerenderPreopen, rerenderHotmoney };
