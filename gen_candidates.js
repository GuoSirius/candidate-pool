#!/usr/bin/env node
'use strict';
/*
 * gen_candidates.js
 * ---------------------------------------------------------------------------
 * A股短线交易 — 次日候选池初筛（自动生成版）
 * 复刻 A股短线交易 skill 的「标的初筛」流程：
 *   候选起点 = 本目录 candidates.json 配置的可编辑观察池（覆盖主要行业，可自由增删）
 *   规则组合 = R01 量能验证突破 + R07 板块内补涨（+ R05 尾盘异动核验）
 * 输出 = 单文件、资源全内联、无外链的双语 HTML（右上角中英切换）
 *
 * 用法:
 *   node gen_candidates.js                 # 在线：锚定日 = 最近一个已收盘交易日
 *   node gen_candidates.js --date 2026-08-07
 *   node gen_candidates.js --limit 20 --out report.html --quiet
 *   node gen_candidates.js --date 2026-08-07 --dump data/snapshot-2026-08-07.json   # 在线抓取后导出快照到指定路径
 *   node gen_candidates.js --offline --snapshot data/snapshot-2026-08-07.json        # 离线：从快照重建报告
 *
 * 输出（默认按锚定日留档，覆盖式写入，每天一份）：
 *   报告:  reports/stock_list_<锚定日>.html
 *   快照:  data/snapshot-<锚定日>.json      （实时运行自动写出，供日后离线复现）
 *
 * 推送: 实时运行结束后自动把结果推送到 notify_config.json 配置的渠道
 *       （个人微信 Server酱/PushPlus + 163 邮箱）。可用 --no-notify 关闭。
 *
 * 工作目录（相对路径的落点，统一由 paths.js 解析）：
 *   默认 = 本仓库根（与历史行为一致）。**装成 npm 包 / 从别处调用时必须重定位**，
 *   否则产物会写进 node_modules 里那个包目录。两种覆盖方式：
 *     --cwd <dir>                  或    CANDIDATE_POOL_HOME=<dir>
 *   HOME 下保持相同布局：candidates.json / data/ / reports/ / notify_config.json
 *   （尾盘相关的 eod/data、eod/reports 同理）。`--paths` 可打印实际解析结果。
 *
 * 数据源: 腾讯公开行情接口（无需任何第三方 CLI / 内置技能）：
 *   - 实时报价 / 总市值 / 流通市值 / 52周高 / 换手率： qt.gtimg.cn
 *   - 日K线(前复权) / 分时：                  web.ifzq.gtimg.cn/appstock/app
 *   原 westock 内置技能在本机安装目录变更后已不可用，故改为直连上述公开接口；
 *   R01/R07/R05 判定逻辑、HTML、离线模式均保持不变。
 * 离线模式不依赖任何外部网络，可在任意装了 Node >=18 的环境运行（GitHub Actions 等）。
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { now: nowStr, dayjs } = require('./time');
// 工作目录解析：产物/配置的落点走 paths，代码资产（本文件等）仍锚在包内。
// 默认 HOME = 包根（与历史 __dirname 行为一致）；可用 CANDIDATE_POOL_HOME / --cwd 重定位。
const paths = require('./paths');
// 首次运行脚手架：空工作目录时补齐目录与观察池（已存在则完全不动作）
const scaffold = require('./scaffold');
// 规则引擎纯函数（R01/R07/R05/行业中位数/成交量单位/时区锚定）统一走 rules.js，
// 单测见 rules.test.js，避免与 gen_candidates 内联实现漂移导致双份真相。
const { lastClosedTradingDay, nextTradingDay, calcTurnover, computeSectors, calcR01, isLaggard, verifyR05 } = require('./rules');

// ---------- 数据源：腾讯公开行情接口（无需任何第三方 CLI / 内置技能）----------
const QT_QUOTE = 'https://qt.gtimg.cn/q=';
const IFZQ = 'https://web.ifzq.gtimg.cn/appstock/app';

// 日K线故障转移链。腾讯的 WAF 是【按接口路径】限流的：高频拉取会让
// web.ifzq.gtimg.cn 的 fqkline 路径返回 HTTP 501 拦截页，而同主机的其他路径、
// 以及镜像域名仍然正常。所以按顺序逐个降级，能显著提升可用性。
// 实测（2026-08-11 盘中，web.ifzq 已被封时）：后三条均返回 200。
const KLINE_ENDPOINTS = [
  { name: 'web.ifzq/fqkline', qfq: true, url: (c) => `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${c},day,,,260,qfq` },
  { name: 'ifzq/fqkline', qfq: true, url: (c) => `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${c},day,,,260,qfq` },
  { name: 'proxy.finance/fqkline', qfq: true, url: (c) => `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get?param=${c},day,,,260,qfq` },
  // 最后兜底：不复权。数据仍可用，但除权日附近的涨幅/均量会失真，报告中会标注。
  { name: 'web.ifzq/kline(不复权)', qfq: false, url: (c) => `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${c},day,,,260` },
];

// R01 门槛常量 G 已迁移至 rules.js（单一真相源，受 rules.test.js 守护）

// 并发太高会触发腾讯接口反爬拦截（盘中尤其敏感）。6 并发下 377 只约 10~15s，
// 兼顾速度与稳定；可用环境变量 CANDIDATE_CONCURRENCY 覆盖。
const CONCURRENCY = Number(process.env.CANDIDATE_CONCURRENCY) || 6;

// 数据健康度红线：K线获取失败率超过该比例即判定为"数据源不可用"，
// 直接中止并以非零码退出，绝不生成空报告、更不推送。
// 若没有这道闸门，一次全量拦截会静默产出"今日 0 触发"，看起来完全正常。
const MAX_FAIL_RATE = Number(process.env.CANDIDATE_MAX_FAIL_RATE) || 0.2;

// ---------- 小工具 ----------
function log(...a) { process.stderr.write(a.join(' ') + '\n'); }
// 交易日相关的小工具统一用 dayjs（北京时间），不用原生 Date：
// 原生 Date 的 getDay()/getHours() 读的是「机器本地时区」，换台时区不是 +8 的机器
// 就会把「15:00 前算盘中 / 周末顺延」判错；dayjs.tz 走显式时区，结果与机器设置无关。
// ymd 已随 lastClosedTradingDay/nextTradingDay 迁入 rules.js
function parseArgs(argv) {
  const o = { date: null, limit: 0, out: null, quiet: false, offline: false, snapshot: null, dump: null, noNotify: false };
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
    else if (a === '--print-anchor') o.printAnchor = true;
    else if (a === '--paths') o.paths = true;
    else if (a === '--cwd') { i++; }   // 由 paths.js 统一解析，这里只吃掉它的值
    else if (a === '-h' || a === '--help') { o.help = true; }
  }
  return o;
}
// isWeekendD / nextTradingDay / lastClosedTradingDay 已迁入 rules.js（受 rules.test.js 守护）

// ---------- HTTP 工具（腾讯公开行情接口，无需任何第三方 CLI）----------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 腾讯接口在短时间高频请求（尤其盘中）会返回一张 WAF 反爬跳转页而非 JSON：
//   <!DOCTYPE html><html><head><script>var i=location.href;var v=window.btoa? ...
// 它是 HTTP 200，靠 JSON.parse 报错才能发现。必须单独识别并用【长退避】重试，
// 短退避（几百毫秒）拿到的仍是同一张拦截页，等于白重试。
function looksLikeWaf(txt) {
  const head = String(txt).slice(0, 300);
  return /<!DOCTYPE html|<html[\s>]/i.test(head) && /window\.btoa|location\.href/i.test(head);
}
// 完整的浏览器 UA。残缺 UA（如裸 "Mozilla/5.0"）本身就是风控指纹特征。
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const WAF_BACKOFF = [2000, 5000, 12000, 25000]; // 命中拦截时的退避梯度（ms）

function httpGet(url, { json = true, retries = 4, timeout = 15000 } = {}) {
  return new Promise(async (resolve, reject) => {
    let lastErr;
    let wafHits = 0;
    for (let i = 0; i < retries; i++) {
      if (i > 0) {
        // 拦截用长退避，普通网络错误用短退避
        await sleep(lastErr && lastErr.waf
          ? WAF_BACKOFF[Math.min(wafHits - 1, WAF_BACKOFF.length - 1)]
          : 500 * i);
      }
      try {
        const { status, txt } = await new Promise((res, rej) => {
          const req = https.get(url, { timeout, headers: { 'User-Agent': UA, 'Referer': 'https://gu.qq.com/', 'Accept': '*/*' } }, (resp) => {
            let d = ''; resp.on('data', c => d += c); resp.on('end', () => res({ status: resp.statusCode, txt: d.trim() }));
          });
          req.on('error', rej);
          req.on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
        });
        // WAF 拦截返回 HTTP 501 + 跳转页；状态码判定比嗅探 body 更可靠，两者都查。
        if (status === 501 || looksLikeWaf(txt)) {
          wafHits++;
          const e = new Error(`被接口反爬拦截（HTTP ${status}）`);
          e.waf = true;
          throw e;
        }
        if (status && status >= 400) throw new Error(`HTTP ${status}`);
        if (!json) return resolve(txt);
        try { return resolve(JSON.parse(txt)); }
        catch (e) {
          const m = txt.match(/^[a-zA-Z0-9_]+\(([\s\S]*)\);?\s*$/);
          if (m) { try { return resolve(JSON.parse(m[1])); } catch (e2) {} }
          throw new Error('JSON 解析失败: ' + txt.slice(0, 120));
        }
      } catch (e) { lastErr = e; }
    }
    reject(lastErr || new Error('httpGet 失败'));
  });
}

// 候选源：HOME 下 candidates.json 配置的可编辑观察池（替代 westock ranking CompScore）
function loadUniverse(limit) {
  const file = paths.candidatesFile();
  if (!fs.existsSync(file)) {
    throw new Error(
      `未找到候选观察池 ${file}\n`
      + `  当前工作目录：${paths.home()}（来源 ${paths.homeSource()}）\n`
      + `  请在该目录创建 candidates.json（结构见仓库内 candidates.json / candidates.example.json），`
      + `或设置 CANDIDATE_POOL_HOME / --cwd 指向已有工作目录。`,
    );
  }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = (cfg.stocks || []).map(s => ({ code: String(s.code), name: String(s.name || s.code), sector: String(s.sector || '未分类') }));
  if (!list.length) throw new Error('candidates.json 的 stocks 为空，请配置候选观察池');
  return (limit && limit > 0) ? list.slice(0, limit) : list;
}

// 日K线（前复权 qfq），返回 { rows, today, hist }
// 注意：腾讯接口按日期【升序】返回（最旧在前），此处统一翻转为【降序】（最新在前），
//       与下游 hist[0]=前一交易日 / hist.slice(0,5)=最近5日 的口径保持一致。
// 粘性指针：记住当前可用的 K线端点。某条链路被 WAF 封掉后，指针前移，
// 后续标的直接走可用端点，不必每只票都去撞一次已知的墙。
let _klineEp = 0;

async function fetchKline(code, anchor) {
  let lastErr;
  for (let step = 0; step < KLINE_ENDPOINTS.length; step++) {
    const idx = (_klineEp + step) % KLINE_ENDPOINTS.length;
    const ep = KLINE_ENDPOINTS[idx];
    let obj;
    try {
      obj = await httpGet(ep.url(code), { retries: 2 });
    } catch (e) {
      lastErr = e;
      if (e.waf || /timeout|ECONN|socket|HTTP \d/i.test(String(e.message || ''))) continue; // 链路问题 -> 换端点
      throw e; // 数据层问题 -> 换端点也没用
    }
    const node = (obj.data && obj.data[code]) || {};
    const rows = node.qfqday || node.day || [];
    if (!rows.length) { lastErr = new Error('K线为空'); continue; }
    if (idx !== _klineEp) {
      _klineEp = idx;
      log(`      [降级] K线数据源切换为 ${ep.name}${ep.qfq ? '' : '（不复权，除权日附近数据会失真）'}`);
    }
    const norm = rows.map(r => ({ date: r[0], open: +r[1], close: +r[2], high: +r[3], low: +r[4], vol: +r[5] }))
      .filter(r => r.date && !isNaN(r.close))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // 降序：最新在前
    const till = norm.filter(r => r.date <= anchor);
    const today = till.find(r => r.date === anchor) || null;
    const hist = till.filter(r => r.date < anchor && r.vol > 0);
    return { rows: till, today, hist, source: ep.name, qfq: ep.qfq };
  }
  throw lastErr || new Error('全部 K线端点均不可用');
}

// 实时报价：市值 / 52周高 / 换手率等（qt.gtimg.cn，字段以 ~ 分隔）
// 字段核对（2026-08 实测）：idx44=流通市值(亿)、idx45=总市值(亿)，二者不可颠倒。
//   例：中国石油 idx44=17568亿(A股流通)、idx45=19857亿(总股本1830.21亿股×10.85)。
async function fetchQuote(code) {
  const txt = await httpGet(QT_QUOTE + code, { json: false });
  const inner = (txt.match(new RegExp('v_' + code + '="([^"]*)"')) || [])[1];
  if (!inner) throw new Error('报价解析失败');
  const f = inner.split('~');
  const num = (i) => { const v = parseFloat(f[i]); return isNaN(v) ? null : v; };
  const yi2unit = (i) => { const v = num(i); return v == null ? null : v * 1e8; }; // 腾讯市值单位为“亿”
  const q = {
    code, name: f[1] || code,
    current: num(3), prevClose: num(4), open: num(5),
    high: num(33), low: num(34),
    chg: num(31), chgPct: num(32),
    turnover: num(38),                       // 换手率 %（仅当日实时口径，盘前为 0）
    circulating_market_cap: yi2unit(44),     // 流通市值（元）
    total_market_cap: yi2unit(45),           // 总市值（元）
    high_52week: num(47), low_52week: num(48),
  };
  // 流通股本（股）= 流通市值 / 现价；用于按锚定日成交量反推该日换手率
  const px = q.current || q.prevClose;
  q.circulating_shares = (q.circulating_market_cap && px) ? q.circulating_market_cap / px : null;
  return q;
}

// volLotSize / calcTurnover 已迁入 rules.js（受 rules.test.js 守护）

// 分时（最新交易日），返回 [{ time, price, vol, amt }]
async function fetchMinute(code) {
  const url = `${IFZQ}/minute/query?code=${code}`;
  const obj = await httpGet(url);
  const arr = (obj.data && obj.data[code] && obj.data[code].data && obj.data[code].data.data) || [];
  return arr.map(line => {
    const p = String(line).split(/\s+/);
    return { time: p[0], price: +p[1], vol: +p[2], amt: +p[3] };
  }).filter(r => r.time && !isNaN(r.price));
}

// computeSectors 已迁入 rules.js（受 rules.test.js 守护）
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

// ---------- （以下为腾讯 JSON 接口，无需表格解析；原 westock 表格解析已移除）----------

// ===========================================================================
// 主流程
// ===========================================================================
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    log('用法: node gen_candidates.js [--date YYYY-MM-DD] [--limit N(0=全部)] [--out file.html] [--quiet]');
    log('     node gen_candidates.js --offline --snapshot data/snapshot-YYYYMMDD.json [--out file.html]');
    log('     node gen_candidates.js --date YYYY-MM-DD --dump data/snapshot-YYYYMMDD.json   # 在线抓取后导出快照');
    log('     node gen_candidates.js --no-notify   # 实时运行但跳过微信/邮件推送');
    log('     node gen_candidates.js --paths        # 打印实际使用的工作目录与各产物落点');
    log('     node gen_candidates.js --init         # 补齐工作目录（首次运行时自动执行，此为显式确认）');
    log('  工作目录（决定快照/报告/配置读写的位置）：');
    log('     默认 = 本仓库根；可用 --cwd <dir> 或环境变量 CANDIDATE_POOL_HOME 重定位。');
    return;
  }
  // --paths：仅打印路径解析结果，便于确认「文件到底写到哪去了」
  if (args.paths) {
    const d = paths.describe();
    log(`工作目录: ${d.home}   (来源 ${d.source}${d.relocated ? '' : '，即包/仓库根'})`);
    log('  工作区（随工作目录移动）:');
    for (const [k, v] of Object.entries(d.workspace)) log(`    ${k.padEnd(14)} ${v}`);
    log('  代码资产（永远跟随程序）:');
    for (const [k, v] of Object.entries(d.codeAssets)) log(`    ${k.padEnd(14)} ${v}`);
    return;
  }
  // 首次运行脚手架：空工作目录（npm 包 / npx 场景）补齐目录与观察池，
  // 已有仓库里什么都不缺 → 完全静默。放在 --paths / --print-anchor 之后，
  // 因为那两个是纯诊断入口，不应产生任何写入。
  //   --init  仅做初始化然后退出（显式确认环境，不去联网跑一遍）
  //   无参数  静默补齐后**继续正常运行**
  if (process.argv.includes('--init')) { scaffold.autoInit({ log, init: true }); return; }
  scaffold.autoInit({ log });
  // --print-anchor：仅解析并输出目标锚定日（北京时间推算，时区安全），不发起任何网络请求。
  // 供 CI / 本地定时任务判断「今日快照是否已存在」，避免重复生成造成两端数据分歧。
  if (args.printAnchor) {
    const now = dayjs.tz();
    console.log(args.date || lastClosedTradingDay(now));
    return;
  }
  if (args.offline) { await runOffline(args); return; }
  const now = dayjs.tz();            // 当前北京时间（dayjs 对象；交易日推算与机器时区无关）
  const anchor = args.date || lastClosedTradingDay(now);
  const target = nextTradingDay(anchor);
  let limit = args.limit || 0; // 0 = 不限制，筛查观察池全部标的
  const outPath = args.out || path.join(paths.reportsDir(), `stock_list_${anchor.replace(/-/g, '')}.html`);

  log(`[1/8] 锚定日 ${anchor}（面向 ${target} 交易日），候选上限 ${limit}`);

  // ---- 1. 候选观察池（candidates.json，可编辑；替代 westock ranking CompScore）----
  log(`[1/8] 载入候选观察池（candidates.json），上限 ${limit > 0 ? limit : '全部'} 只`);
  const universe = loadUniverse(limit);
  limit = universe.length;
  const minuteForAnchor = (anchor === lastClosedTradingDay(now));
  log(`      已载入候选 ${universe.length} 只: ${universe.map(u => u.name).join('、')}`);

  // ---- 2. 逐只: kline + quote + minute（腾讯接口）----
  log(`[2/8] 拉取 ${universe.length} 只标的历史行情/报价/分时 ...`);
  const stocks = await mapLimit(universe, CONCURRENCY, async (u) => {
    const s = { ...u };
    let quote = null;
    try { quote = await fetchQuote(u.code); s.quote = quote; }
    catch (e) { s.quote = { error: String(e.message || e) }; }
    try {
      const k = await fetchKline(u.code, anchor);
      // 锚定日换手率：按该日成交量 + 流通股本推算（不用报价 idx38，盘前为 0 且口径是“此刻”）
      if (k.today && quote && quote.circulating_shares) {
        k.today.turn = calcTurnover(k.today.vol, quote.circulating_shares, u.code);
      }
      s.kline = k;
    } catch (e) { s.kline = { error: String(e.message || e) }; }
    if (minuteForAnchor) {
      try {
        s.minute = (await fetchMinute(u.code)).map(b => ({ date: anchor, time: b.time, price: b.price, vol: b.vol, amt: b.amt }));
      } catch (e) { s.minute = { error: String(e.message || e) }; }
    } else {
      s.minute = []; // 分时接口仅返回最新交易日，与历史锚定日口径不符 -> R05 判为数据缺口
    }
    return s;
  });

  // ---- 2.5 数据健康度闸门 ----
  // 全量拦截/网络故障时，下游会把每只票都算成"不满足条件"，最终输出一份
  // "0 触发"的报告并照常推送——外观与真实的清淡行情完全一致，极易误导。
  // 因此这里必须先体检，不合格就带非零码中止。
  const klineFails = stocks.filter(s => !s.kline || s.kline.error || !s.kline.today);
  const quoteFails = stocks.filter(s => !s.quote || s.quote.error);
  const wafFails = stocks.filter(s => s.kline && /反爬拦截/.test(String(s.kline.error || '')));
  const failRate = klineFails.length / (stocks.length || 1);
  log(`      K线失败 ${klineFails.length}/${stocks.length}（其中被拦截 ${wafFails.length}）｜报价失败 ${quoteFails.length}/${stocks.length}`);
  if (failRate > MAX_FAIL_RATE) {
    const sample = (klineFails[0] && klineFails[0].kline && klineFails[0].kline.error) || '无有效K线';
    log('');
    const pct = (v) => (v * 100).toFixed(v < 0.01 ? 2 : v < 0.1 ? 1 : 0);
    log(`[中止] K线失败率 ${pct(failRate)}% 超过红线 ${pct(MAX_FAIL_RATE)}%，判定数据源不可用。`);
    log(`       首个错误：${String(sample).slice(0, 160)}`);
    if (wafFails.length > klineFails.length * 0.5) {
      log('       多数失败为反爬拦截：请降低并发（CANDIDATE_CONCURRENCY=3）或避开盘中时段，稍后重试。');
    }
    log('       本次不生成报告、不覆盖快照、不推送通知。');
    process.exitCode = 1;
    return;
  }

  // ---- 3. 计算 R01 ----
  log(`[3/8] 计算 R01 量能验证突破 ...`);
  for (const s of stocks) {
    const k = s.kline;
    s.r01 = calcR01(k && k.today, k && k.hist, s.quote, k && k.error);
  }

  // ---- 4. R07 行业涨幅 + 补涨映射（基于观察池内同行业个股涨幅中位数）----
  log(`[4/8] 计算观察池各行业当日涨幅中位数并映射 R07 补涨 ...`);
  const validSectors = computeSectors(stocks);
  const topN = validSectors.length ? validSectors[0].topN : 1;
  const sectorByName = {}; validSectors.forEach(s => sectorByName[s.name] = s);
  for (const s of stocks) {
    const sec = sectorByName[s.sector || '未分类'];
    if (sec) {
      const laggard = isLaggard(s.r01.chg, sec);
      s.r07 = { sectorName: sec.name, sectorPct: sec.pct, sectorRank: sec.rank, inTop10: sec.inTop10, laggard: !!laggard, total: sec.total, topN: sec.topN };
    } else {
      s.r07 = { sectorName: s.sector || '未分类', sectorPct: null, sectorRank: null, inTop10: false, laggard: false, total: validSectors.length, topN, unmatched: true };
    }
  }

  // ---- 5. R05 尾盘异动核验 ----
  log(`[5/8] 核验 R05 尾盘异动（依赖分时数据）...`);
  for (const s of stocks) {
    const m = s.minute;
    let dayBars = [];
    if (Array.isArray(m)) dayBars = m.filter(b => b.date === anchor);
    s.r05 = verifyR05(dayBars, s.r01.chg, anchor);
  }

  // ---- 6. 市场宽度 + 画像（无全市场公开源，标记为暂不可用）----
  log(`[6/8] 市场宽度/画像：本环境无全市场涨跌分布公开源，标记为暂不可用 ...`);
  let breadth = { error: '市场宽度接口暂不可用（需要全市场涨跌分布，本环境无对应公开数据源；可日后接入）' };
  let breadthIsAnchor = false;
  let overview = { error: '市场画像接口暂不可用（需要全市场成交额/情绪聚合，本环境无对应公开数据源；可日后接入）' };

  // ---- 7-8. 分类 + 生成 HTML（抽取为 classifyAndBuild，离线模式复用）----
  // 实时模式：写出「当日日期」命名的快照（覆盖式写入，每天一份），并推送通知
  const snapshotPath = args.dump || path.join(paths.dataDir(), `snapshot-${anchor}.json`);
  paths.ensureDir(path.dirname(snapshotPath));   // --dump 指向新目录时也要能写出去
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
  const htmlPath = path.join(paths.reportsDir(), `stock_list_${anchor.replace(/-/g, '')}.html`);
  const res = await notifyMod.notify({ title, content, htmlPath });
  for (const [ch, [ok, info]] of res) {
    log(`[notify] ${ch}: ${ok ? 'OK' : '失败 ' + JSON.stringify(info)}`);
  }
}

// ===========================================================================
// HTML 生成
// ===========================================================================
// 输出编码：所有外部数据（股票名/行业/动态字符串）写入 HTML 前必须转义，
// 防 API 名含 " < > 破坏结构或被注入。b() 与所有数据注入点统一走 esc()。
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function b(zh, en) { return `<span data-zh="${esc(zh)}" data-en="${esc(en)}">${esc(zh)}</span>`; }
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
  const bestStr = best && best.r01.core ? `${esc(best.name)}（${best.code.replace(/^[sh|sz]/, '')}），四项中达成 ${best.r01.core} 项${best.r01.capOk ? '，市值达标' : ''}` : '无';
  const conclusion = [
    `<b>${b('R01 ' + (r01Triggers ? `硬触发 ${r01Triggers} 只` : '零硬触发'), 'R01 ' + (r01Triggers ? `${r01Triggers} hard trigger(s)` : 'zero hard triggers'))}。</b>` +
      (r01Triggers ? '' : `${universe.length} 只标的无一满足全部门槛。最接近者为 ${bestStr}。`),
    `<b>${b('R07 ' + (r07Triggers ? `补涨触发 ${r07Triggers} 只` : '零硬触发'), 'R07 ' + (r07Triggers ? `${r07Triggers} laggard trigger(s)` : 'zero hard triggers'))}。</b>` +
      (r07Triggers ? '' : `${universe.length} 只标的中，位于强势行业（前 ${m.topN} 名）且个股涨幅落后于行业中位数一半的标的为零——强势行业内成分股均已跟涨，与 R07 补涨逻辑方向相反。`),
    `<b>${b('R05 判定', 'R05 status')}：</b>` +
      (r05Hard ? `${b('部分触发 ' + r05Hard + ' 只（尾盘量价达标，但净流入需 L2 不可得）', r05Hard + ' partial trigger(s) — late-session volume/price met, but net inflow needs L2 and is unavailable')}。` :
        `${b('未出现硬触发', 'no hard trigger')}。${b('若分时接口未回溯至锚定日则属数据缺口而非信号缺失', 'where intraday data is unavailable for the anchor date this is a data gap, not an absence of signal')}——本报告未以任何替代指标补齐该信号。`),
    `<b>${b('重点关注' + (high.length ? ` ${high.length} 只` : '为空'), 'High-priority tier' + (high.length ? `: ${high.length}` : ': empty'))}。</b>` +
      `${b('按规则纪律，无全部门槛达标即不设重点关注；次级关注 ' + secondary.length + ' 只、条件观察 ' + conditional.length + ' 只、排除 ' + excluded.length + ' 只。',
           'Under rule discipline, no name clearing all gates means an empty high-priority tier. Result: ' + secondary.length + ' secondary, ' + conditional.length + ' conditional, ' + excluded.length + ' excluded.')}`,
  ];

  // R01 + R07 全量判定矩阵（单表）：两张全量表本是同一批标的，合并后行数减半；
  // 每行带档位标记，配合顶部 chips 按档位筛选，避免「全量 377 行平铺找不到重点」。
  const tierOf = new Map();
  high.forEach(s => tierOf.set(s.code, 'high'));
  secondary.forEach(s => tierOf.set(s.code, 'secondary'));
  conditional.forEach(s => tierOf.set(s.code, 'conditional'));
  excluded.forEach(s => tierOf.set(s.code, 'excluded'));
  const TIER_LABEL = {
    high: b('重点关注', 'high'), secondary: b('次级关注', 'secondary'),
    conditional: b('条件观察', 'conditional'), excluded: b('排除', 'excluded'),
  };
  const tierCount = { high: high.length, secondary: secondary.length, conditional: conditional.length, excluded: excluded.length };
  const tierChips = [`<button type="button" class="chip active" data-tier="">${b(`全部 ${universe.length}`, `All ${universe.length}`)}</button>`]
    .concat(Object.keys(tierCount).map(k =>
      `<button type="button" class="chip" data-tier="${k}">${TIER_LABEL[k]}<i>${tierCount[k]}</i></button>`)).join('');
  let matrixRows = '';
  for (const s of universe) {
    const r = s.r01, x = s.r07 || {};
    const tier = tierOf.get(s.code) || 'excluded';
    const cls = r.ok ? ' class="hit"' : '';
    matrixRows += `<tr data-tier="${tier}"${cls}>` +
      `<td>${s.code.replace(/^[sh|sz]/, '')}</td>` +
      `<td>${b(s.name, s.name)}</td>` +
      `<td><span class="tag tier-${tier}">${TIER_LABEL[tier]}</span></td>` +
      `<td>${num(r.close)}</td>` +
      `<td class="${r.chg >= 0 ? 'up' : 'down'}">${pct(r.chg)}</td>` +
      `<td>${num(r.turn)}%</td>` +
      `<td>${num(r.volRatio)}</td>` +
      `<td>${num(r.prior10High)}</td>` +
      gateCell(r.gates.C1) + gateCell(r.gates.C2) + gateCell(r.gates.C3) + gateCell(r.gates.C4) +
      `<td><b>${r.core != null ? r.core + ' / 4' : '—'}</b></td>` +
      `<td>${r.mktCapYi != null ? yi(r.mktCapYi) : '—'}</td>` +
      `<td>${x.sectorName ? b(x.sectorName, x.sectorName) : '—'}</td>` +
      `<td>${pct(x.sectorPct)}</td>` +
      `<td>${x.sectorRank ? x.sectorRank + '/' + x.total : '—'}</td>` +
      `<td>${x.inTop10 ? '<span class="yes">★</span>' : '<span class="no">—</span>'}</td>` +
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
    ? b(`R05 属于数据缺口：分时接口（腾讯分时，仅返回最新交易日）与锚定日 ${anchor} 口径可能不符，因此 14:30–15:00 涨幅与 14:30 后成交量占比两项核心门槛无法验证。本报告未以任何替代指标补齐该信号。`,
         `R05 is a data gap: the intraday endpoint (Tencent minute, returns only the latest session) may not match the anchor date ${anchor}, so the two core gates (gain between 14:30–15:00, and ≥20% of daily volume after 14:30) cannot be verified. No substitute indicator was used to fill this gap.`)
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
    `候选起点为本目录 <code>candidates.json</code> 配置的可编辑观察池（覆盖主要行业，可自由增删），不再依赖已随 WorkBuddy 安装目录变更而失效的 westock 内置技能。行情数据改为直连腾讯公开接口：日线(前复权)与分时来自 <code>web.ifzq.gtimg.cn</code>，实时报价/总市值/流通市值/52周高/换手率来自 <code>qt.gtimg.cn</code>。全部分析锚定 ${anchor} 收盘，日线截断至 ${anchor}，不使用该日之后数据。R07 行业涨幅由观察池内同行业个股当日涨幅中位数推导（申万行业分类口径）。市值对总市值与流通市值同时校验。市场宽度与画像因本环境无全市场公开数据源，暂标记为不可用。`,
    `The starting universe is the editable watchlist in <code>candidates.json</code> (covers major sectors, freely editable), replacing the westock builtin skill that became unavailable after a WorkBuddy install-path change. Market data now comes directly from Tencent's public endpoints: daily bars (forward-adjusted) and intraday from <code>web.ifzq.gtimg.cn</code>; realtime quote / total cap / free-float cap / 52-week high / turnover from <code>qt.gtimg.cn</code>. All analysis is anchored to the ${anchor} close; daily bars are truncated at ${anchor} and no later data is used. R07 sector return is the median same-day gain of the watchlist's constituents in that sector (SW-sector classification). Market cap is checked against both total and free-float. Market breadth and profile are marked unavailable because no market-wide public source is available in this environment.`
  );

  // 组装
  const css = `  :root, :root[data-theme="light"] {
    --bg: #fffbeb; --card: #fff; --text: #1c1917; --muted: #92400e;
    --border: #fde68a; --accent: #b45309; --red: #dc2626; --green: #16a34a;
    --blue: #2563eb; --amber: #d97706; --gold: #ca8a04; --slate: #64748b;
    --btn-bg: #fff; --btn-fg: #b45309;
    --callout-bg: #fff7ed;
    --th-bg: #fefce8;
    --tag-bg: #eff6ff; --tag-fail-bg: #f1f5f9; --tag-pass-bg: #fef2f2; --tag-gap-bg: #fffbeb;
    --score-bg: #fffbeb;
    --disc-bg: #fef2f2; --disc-border: #fecaca; --disc-fg: #991b1b;
    --card-empty-bg: #fafaf9; --hit-bg: #fffdf5; --note-bg: #f8fafc; --risk-bg: #fef2f2;
  }
  :root[data-theme="dark"] {
    --bg: #0f1115; --card: #181b21; --text: #e7e9ec; --muted: #c9a684;
    --border: #343a44; --accent: #f59e0b; --red: #f87171; --green: #4ade80;
    --blue: #60a5fa; --amber: #fbbf24; --gold: #fbbf24; --slate: #94a3b8;
    --btn-bg: #1f2329; --btn-fg: #f59e0b;
    --callout-bg: #1f1c17;
    --th-bg: #1d2128;
    --tag-bg: #1b2533; --tag-fail-bg: #232831; --tag-pass-bg: #2a1e1e; --tag-gap-bg: #1f1c17;
    --score-bg: #211d14;
    --disc-bg: #2a1e1e; --disc-border: #5b2a2a; --disc-fg: #fca5a5;
    --card-empty-bg: #14171c; --hit-bg: #20242b; --note-bg: #1b1f26; --risk-bg: #2a1e1e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; padding: 24px 16px; }
  .container { max-width: 960px; margin: 0 auto; }
  .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 4px; }
  h1 { font-size: 1.55rem; font-weight: 700; margin-bottom: 6px; }
  h2 { font-size: 1.15rem; font-weight: 600; margin: 30px 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--border); }
  h3 { font-size: 1.05rem; font-weight: 600; margin-bottom: 10px; }
  .sub { color: var(--muted); font-size: 0.9rem; margin-bottom: 14px; }
  .topbtn { flex: none; cursor: pointer; border: 1px solid var(--accent); background: var(--btn-bg); color: var(--btn-fg); font-weight: 600; font-size: 0.85rem; padding: 7px 16px; border-radius: 999px; font-family: inherit; transition: all .15s; white-space: nowrap; }
  .topbtn:hover { background: var(--accent); color: var(--btn-bg); }
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
  .footer { margin-top: 22px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.8rem; text-align: center; }
  /* 暗黑主题：覆盖硬编码组件色（默认 data-theme="dark"，见 <html>） */
  :root[data-theme="dark"] .card.empty { background: var(--card-empty-bg); }
  :root[data-theme="dark"] .callout { background: var(--callout-bg); }
  :root[data-theme="dark"] .score { background: var(--score-bg); color: var(--gold); }
  :root[data-theme="dark"] .tag { background: var(--tag-bg); }
  :root[data-theme="dark"] .tag.fail { background: var(--tag-fail-bg); }
  :root[data-theme="dark"] .tag.pass { background: var(--tag-pass-bg); }
  :root[data-theme="dark"] .tag.gap { background: var(--tag-gap-bg); }
  :root[data-theme="dark"] .risk { background: var(--risk-bg); }
  :root[data-theme="dark"] .note { background: var(--note-bg); }
  :root[data-theme="dark"] tr.hit { background: var(--hit-bg); }
  :root[data-theme="dark"] th { background: var(--th-bg); }
  :root[data-theme="dark"] .disclaimer { background: var(--disc-bg); border-color: var(--disc-border); color: var(--disc-fg); }
  /* R01+R07 合并矩阵工具条：档位 chips 筛选（与 eod 报告同款交互） */
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin: 0 0 12px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { border: 1px solid var(--border); background: var(--btn-bg); color: var(--text); font: inherit; font-size: 0.8rem; padding: 3px 11px; border-radius: 999px; cursor: pointer; }
  .chip i { font-style: normal; color: var(--muted); margin-left: 3px; }
  .chip.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .chip.active i { color: inherit; opacity: 0.85; }
  .tag.tier-high { background: var(--tag-pass-bg); color: var(--red); }
  .tag.tier-secondary { background: var(--tag-bg); color: var(--blue); }
  .tag.tier-conditional { background: var(--tag-gap-bg); color: var(--amber); }
  .tag.tier-excluded { background: var(--tag-fail-bg); color: var(--slate); }`;

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
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
      <div class="sub">${b(`候选起点：candidates.json 可编辑观察池（${limit} 只上限，锚定 ${anchor}） · 规则：R01 量能验证突破 + R07 板块内补涨 · 面向 ${target} 交易日`, `Starting universe: editable candidates.json watchlist (cap ${limit}, anchored to ${anchor}) · Rules: R01 Volume-Confirmed Breakout + R07 Intra-Sector Laggard · For the ${target} session`)}</div>
    </div>
    <button id="themeBtn" type="button" class="topbtn" title="切换深浅色">🌙</button>
    <button id="langBtn" type="button" class="topbtn">EN</button>
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
    <p class="src">${b('数据来源：腾讯公开行情接口（web.ifzq.gtimg.cn 日线/分时、qt.gtimg.cn 报价/市值/52周高/换手），数据时点 ' + anchor + ' 收盘。', 'Source: Tencent public market-data endpoints (web.ifzq.gtimg.cn for daily/minute, qt.gtimg.cn for quote/cap/52w-high/turnover). Data timestamp: ' + anchor + ' close.')}</p>
  </div>

  <h2>${b('R01 + R07 全量判定矩阵', 'R01 + R07 Full Evaluation Matrix')}</h2>
  <div class="card">
    <p class="body-text" style="margin-bottom:12px">${b('四项门槛：C1 当日量 ≥ 近 5 日均量 150% ｜ C2 收盘突破近 10 日最高价 ｜ C3 涨幅 3%–8% ｜ C4 换手率 ≥ 3%。红色为达成。R07：所属行业居前 10% 且个股涨幅 < 行业涨幅一半记为补涨。点上方档位 chips 可只看某一档。', 'Four gates: C1 volume at 150%+ of the 5-day average | C2 close above the prior 10-day high | C3 gain 3%–8% | C4 turnover 3%+. Red marks a pass. R07 laggard: sector in the top 10% and gain below half the sector median. Use the tier chips above to focus on one tier.')}</p>
    <div class="toolbar"><div class="chips" id="tierChips">${tierChips}</div></div>
    <div class="table-wrap"><table id="matrixTable">
      <thead><tr>
        <th>${b('代码', 'Code')}</th><th>${b('名称', 'Name')}</th><th>${b('档位', 'Tier')}</th>
        <th>${b('收盘', 'Close')}</th><th>${b('涨幅', 'Chg')}</th><th>${b('换手', 'Turn.')}</th>
        <th>${b('量能/5日', 'Vol/5d')}</th><th>${b('前10日高', 'Prior 10d high')}</th>
        <th>C1</th><th>C2</th><th>C3</th><th>C4</th>
        <th>${b('达成', 'Score')}</th><th>${b('总市值', 'Mkt cap')}</th>
        <th>${b('所属行业', 'Sector')}</th><th>${b('行业涨幅', 'Sector chg')}</th>
        <th>${b('行业排名', 'Rank')}</th><th>${b('强势', 'Strong?')}</th><th>${b('角色', 'Role')}</th>
      </tr></thead>
      <tbody>${matrixRows}</tbody>
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
    <details><summary>${b(`排除明细（${excluded.length} 条，点击展开）`, `Exclusion details (${excluded.length}, click to expand)`)}</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>${b('代码', 'Code')}</th><th>${b('名称', 'Name')}</th><th>${b('排除原因', 'Reason')}</th></tr></thead>
      <tbody>${exRows}</tbody>
    </table></div>
    </details>
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

  <div class="footer">${b('生成于 ' + nowStr(), 'Generated ' + nowStr())} · ${b('A股短线交易 · 次日候选池自动初筛', 'A-Share Short-Term Trading · Automated Next-Day Candidate Screening')}</div>
</div>

<script>
(function () {
  // 主题切换：默认暗色（<html data-theme="dark">），选择持久化到 localStorage
  var themeBtn = document.getElementById('themeBtn');
  var root = document.documentElement;
  var savedTheme = null;
  try { savedTheme = localStorage.getItem('report-theme'); } catch (e) {}
  if (savedTheme === 'light' || savedTheme === 'dark') root.setAttribute('data-theme', savedTheme);
  function syncThemeLabel() {
    var t = root.getAttribute('data-theme');
    themeBtn.textContent = (t === 'dark') ? '☀' : '🌙';
  }
  syncThemeLabel();
  themeBtn.addEventListener('click', function () {
    var t = (root.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('report-theme', t); } catch (e) {}
    syncThemeLabel();
  });
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

  // R01+R07 矩阵：档位 chips 筛选（display 切换，不重排——全量行顺序保持观察池原序）
  var matrixBody = document.querySelector('#matrixTable tbody');
  var tierChips = document.getElementById('tierChips');
  if (matrixBody && tierChips) {
    tierChips.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      var tier = chip.getAttribute('data-tier') || '';
      Array.prototype.forEach.call(tierChips.querySelectorAll('.chip'), function (c) {
        c.classList.toggle('active', (c.getAttribute('data-tier') || '') === tier);
      });
      Array.prototype.forEach.call(matrixBody.querySelectorAll('tr[data-tier]'), function (tr) {
        tr.style.display = (!tier || tr.getAttribute('data-tier') === tier) ? '' : 'none';
      });
    });
  }
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

// 离线模式：从快照载入，跳过全部网络请求
async function runOffline(args) {
  let snapPath = args.snapshot;
  if (!snapPath) {
    // 未指定 --snapshot 时，自动取 HOME/data 下日期最新的一份快照（与 daily-screen.yml 离线兜底同口径）
    const dir = paths.dataDir();
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir)
        .filter(f => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      if (files.length) snapPath = path.join(dir, files[files.length - 1]);
    }
  }
  if (!snapPath) { log('离线模式需要 --snapshot <快照文件>，或 data/ 下存在 snapshot-YYYY-MM-DD.json'); process.exit(1); }
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const stocks = snap.stocks;
  const validSectors = snap.sectors || [];
  const { anchor, target, limit } = snap;
  const topN = snap.topN, breadth = snap.breadth, breadthIsAnchor = snap.breadthIsAnchor, overview = snap.overview;
  const outPath = args.out || path.join(paths.reportsDir(), `stock_list_${anchor.replace(/-/g, '')}.html`);
  log(`[offline] 从快照 ${snapPath} 载入 ${stocks.length} 只，锚定 ${anchor}（面向 ${target}）`);
  classifyAndBuild({ anchor, target, limit, stocks, validSectors, topN, breadth, breadthIsAnchor, overview, outPath, quiet: args.quiet });
}

main().catch(e => { log('FATAL: ' + (e && e.stack || e)); process.exit(1); });
