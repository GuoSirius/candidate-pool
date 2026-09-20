'use strict';
/*
 * eod/lib/market.js —— 行情抓取（全市场快照 + 分时）
 * ---------------------------------------------------------------------------
 * 数据源：腾讯公开行情接口（与 candidate-pool 主流程同源，零第三方依赖）
 *   - 全市场快照： https://qt.gtimg.cn/q=<code>,<code>,...   批量、GBK 编码
 *   - 个股分时：   https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=...
 *
 * 全市场怎么枚举（实测 2026-09-20）：
 *   腾讯没有「列出全部代码」的接口，但**不存在的代码会被响应直接省略**，
 *   所以按标准代码段盲扫即可：~30000 个槽位 / 60 一批 / 6 并发 ≈ 8 秒，完全可接受。
 *   （曾实测东财 clist 接口能一次拿到全市场 + 行业字段，但它在十余次请求后即
 *     socket hang up 封 IP，**不可作为 14:50 关键路径的数据源**，故仅用于低频刷行业缓存。）
 *
 * 字段布局（腾讯报价，以 ~ 分隔，实测核对过）：
 *   [1] 名称  [3] 现价  [4] 昨收  [5] 今开  [30] 行情时间戳 YYYYMMDDHHmmss
 *   [31] 涨跌额 [32] 涨跌幅% [33] 最高  [34] 最低
 *   [36] 成交量(手) [37] 成交额(万) [38] 换手率% [39] 市盈率
 *   [44] 流通市值(亿) [45] 总市值(亿) [47] 52周高 [48] 52周低
 *   [49] 量比 [51] 当日均价
 * ---------------------------------------------------------------------------
 */

const { httpGet, mapLimit, makeSticky, sleep, toCode } = require('./http');
const { stampToDate } = require('./trading');

const QT_QUOTE = 'https://qt.gtimg.cn/q=';
const IFZQ = 'https://web.ifzq.gtimg.cn/appstock/app';

// 模块级日志（默认静默，入口处 setLog 注入）。降级切换必须让人看得见。
let _log = () => {};
function setLog(fn) { _log = typeof fn === 'function' ? fn : () => {}; }

// ---------------------------------------------------------------------------
// 分时接口的多主机降级链（实测 2026-09-20）：
//   web.ifzq.gtimg.cn 被高频请求触发 WAF 后返回 HTTP 501 拦截页，
//   而同一路径在 ifzq.gtimg.cn 与 proxy.finance.qq.com 上**同时可用**（140ms 正常返回）。
//   与日K线一样，按链路逐个降级 + 粘性记忆，被封锁后不再反复撞同一堵墙。
//   注意 retries 压到 2：某台被拦时单台只烧 ~2.5s 就换下一台，
//   若沿用默认 4 次重试，单台要先烧 19s，486 只票会空跑半小时以上（实测教训）。
// ---------------------------------------------------------------------------
const MINUTE_ENDPOINTS = [
  { name: 'web.ifzq/minute', url: (c) => `${IFZQ}/minute/query?code=${c}` },
  { name: 'ifzq/minute', url: (c) => `https://ifzq.gtimg.cn/appstock/app/minute/query?code=${c}` },
  { name: 'proxy.finance/minute', url: (c) => `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/minute/query?code=${c}` },
];
const _minuteEp = makeSticky(MINUTE_ENDPOINTS);

/**
 * K 线 / 分时成交量单位（沿用 candidate-pool 主流程的实测结论）：
 *   主板 / 创业板 / 北交所 -> 「手」(1 手 = 100 股)；科创板 sh688/sh689 -> 直接是「股」。
 * 用错会整整差 100 倍，故均价折算必须区分。
 */
function volLotSize(code) {
  return /^sh68[89]/.test(String(code)) ? 1 : 100;
}

/** 把配置里的代码段展开成完整代码列表（已剔除排除前缀，如 B 股） */
function expandCodes(cfg) {
  const skip = cfg.market.excludePrefixes || [];
  const out = [];
  for (const r of cfg.market.ranges) {
    if (!r.enabled) continue;
    for (let i = r.from; i <= r.to; i++) {
      const c = toCode(r.prefix, i);
      if (skip.some((p) => c.startsWith(p))) continue;
      out.push(c);
    }
  }
  return out;
}

/**
 * 解析单条腾讯报价。
 * 无有效价（长期停牌 / 退市 / 代码不存在）返回 null —— 调用方据此整体丢弃，
 * 绝不用「现价 0」这种脏数据往下算（否则会污染涨幅、市值等筛选条件）。
 */
function parseQuote(code, inner) {
  const f = String(inner).split('~');
  if (f.length < 52) return null;
  const num = (i) => { const v = parseFloat(f[i]); return Number.isFinite(v) ? v : null; };
  const price = num(3);
  if (price == null || price <= 0) return null;

  const pyOf = (i) => {
    const v = num(i);
    return v == null ? null : v * 1e8;   // 腾讯市值单位为「亿」
  };

  return {
    code,
    name: (f[1] || '').replace(/\s+/g, ''),   // 交易所简称含空格（如「五 粮 液」）
    price,
    prevClose: num(4),
    open: num(5),
    high: num(33),
    low: num(34),
    chg: num(31),
    chgPct: num(32),
    vol: num(36),          // 手
    amountWan: num(37),    // 万元
    turnover: num(38),     // %
    volRatio: num(49),     // 量比
    avgPrice: num(51),     // 当日均价
    floatCap: pyOf(44),    // 元
    totalCap: pyOf(45),    // 元
    floatCapYi: num(44),   // 亿（筛选直接用这个，避免反复换算）
    totalCapYi: num(45),
    high52: num(47),
    low52: num(48),
    stamp: f[30] || '',    // YYYYMMDDHHmmss
  };
}

/** 抓一批代码（60 只左右），返回解析后的报价数组；代码不存在会被响应省略 */
async function fetchBatch(codes, cfg) {
  const txt = await httpGet(QT_QUOTE + codes.join(','), {
    enc: 'gbk',
    json: false,
    retries: cfg.market.retries,
    timeout: cfg.market.timeoutMs,
  });
  const out = [];
  for (const seg of txt.split(';')) {
    const m = seg.match(/v_([a-z]{2}\d{6})="([^"]*)"/);
    if (!m) continue;
    const q = parseQuote(m[1], m[2]);
    if (q) out.push(q);
  }
  return out;
}

/**
 * 全市场快照。
 * @returns {{quotes:Array, meta:object}}
 *   meta = { slots, batches, failedBatches, valid, marketStamp, marketDate, elapsedMs }
 *   marketDate 由**报价时间戳的众数**推出 —— 这是判断「今天到底开没开盘」的依据
 *   （比维护节假日日历可靠，且天然覆盖周末 / 法定节假日 / 临时休市）。
 */
async function fullMarketSnapshot(cfg, log = () => {}) {
  const codes = expandCodes(cfg);
  const B = cfg.market.batch;
  const batches = [];
  for (let i = 0; i < codes.length; i += B) batches.push(codes.slice(i, i + B));

  const t0 = Date.now();
  let done = 0;
  const results = await mapLimit(batches, cfg.market.concurrency, async (b) => {
    const r = await fetchBatch(b, cfg);
    done++;
    // 进度写 stderr，避免污染 stdout（stdout 留给 --json 之类的机器输出）
    if (done % 50 === 0) log(`      行情批次 ${done}/${batches.length}`);
    return r;
  });

  const quotes = [];
  let failedBatches = 0;
  for (const r of results) {
    if (r && r.__error) { failedBatches++; continue; }
    quotes.push(...r);
  }

  // 行情时间戳众数 -> 交易日
  const byDate = new Map();
  for (const q of quotes) {
    const d = String(q.stamp || '').slice(0, 8);
    if (d) byDate.set(d, (byDate.get(d) || 0) + 1);
  }
  let marketStamp = '';
  let best = 0;
  for (const [d, n] of byDate) if (n > best) { best = n; marketStamp = d; }

  return {
    quotes,
    meta: {
      slots: codes.length,
      batches: batches.length,
      failedBatches,
      valid: quotes.length,
      outlierDates: [...byDate.keys()].filter((d) => d !== marketStamp),
      marketStamp,
      marketDate: stampToDate(marketStamp),
      elapsedMs: Date.now() - t0,
    },
  };
}

/** 个股分时（返回最新一个交易日）；rows: [{t:'HHMM', price, cumVol, cumAmt}] */
async function fetchMinute(code, cfg) {
  const obj = await _minuteEp.tryAll(
    (ep) => httpGet(ep.url(code), {
      json: true,
      retries: 2,          // 故意压低：被拦时快速换下一台镜像
      timeout: cfg.market.timeoutMs,
    }),
    (ep) => _log(`[降级] 分时数据源切换为 ${ep.name}`),
  );
  const node = (obj.data && obj.data[code]) || {};
  const arr = (node.data && node.data.data) || [];
  const rows = arr
    .map((line) => {
      const p = String(line).split(/\s+/);
      return { t: p[0], price: +p[1], cumVol: +p[2], cumAmt: +p[3] };
    })
    .filter((r) => r.t && Number.isFinite(r.price) && r.price > 0);
  return { rows, date: (node.data && node.data.date) || null };
}

/** 取分时序列里「时间 ≤ hhmm」的最后一条（hhmm 为 'HHMM' 字符串，零填充可直接字典序比较） */
function barAtOrBefore(rows, hhmm) {
  let best = null;
  for (const r of rows) {
    if (r.t <= hhmm) best = r;
    else break;
  }
  return best;
}

/** 取分时序列里时间正好等于 hhmm 的一条 */
function barAt(rows, hhmm) {
  return rows.find((r) => r.t === hhmm) || null;
}

/**
 * 计算尾盘段指标（FR-04 的核心）。
 *
 * 段区间 segFrom → cut：
 *   - cut 通常取 '1450'（固定口径）；观察模式下取「当前时点」对应的最后一条，
 *     并在报告里标注口径未固定。
 *   - 起点用 segFrom 那根 K 线的**收盘价**（不是开盘价）：尾盘动能衡量的是
 *     「14:30 那一刻之后涨了多少」，用收盘价才能和 cut 端的收盘价同口径。
 *
 * @returns {object|null} 数据不足（起点或终点缺失）返回 null，调用方记为 data_gap
 */
function tailMetrics(rows, code, cutHHMM, segFrom) {
  const p0 = barAt(rows, segFrom);
  const p1 = barAtOrBefore(rows, cutHHMM);
  if (!p0 || !p1 || p1.t < segFrom || !(p0.price > 0)) return null;

  const lot = volLotSize(code);
  const segPct = ((p1.price - p0.price) / p0.price) * 100;

  // 段内明细：上涨分钟占比 + 最大回撤（判断是「一路走高」还是「尾盘一根拉起来」）
  const win = rows.filter((r) => r.t >= segFrom && r.t <= cutHHMM);
  let up = 0;
  let down = 0;
  let peak = -Infinity;
  let maxDd = 0;
  let prev = p0.price;
  for (const r of win) {
    if (r.price > prev) up++;
    else if (r.price < prev) down++;
    prev = r.price;
    if (r.price > peak) peak = r.price;
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - r.price) / peak) * 100);
  }
  const dirTotal = up + down;

  // 均价（VWAP）到 cut 时点：累计成交额 / 累计成交股数
  const avgAtCut = (p1.cumVol > 0 && p1.cumAmt > 0) ? p1.cumAmt / (p1.cumVol * lot) : null;
  const priceVsAvgPct = (avgAtCut && avgAtCut > 0) ? ((p1.price / avgAtCut) - 1) * 100 : null;

  return {
    segFrom,
    cut: p1.t,
    p0: p0.price,
    p1: p1.price,
    segPct,
    upRatio: dirTotal ? up / dirTotal : null,
    maxDrawdownPct: maxDd,
    avgAtCut,
    priceVsAvgPct,
    bars: win.length,
  };
}

/**
 * 并发抓多只票的分时（只对「初筛通过」的小集合调用）。
 *
 * 自带两道闸门，都来自实测教训：
 *   1. 限速：每个 worker 每次请求后 sleep minuteDelayMs，避免把分时接口打进 WAF；
 *   2. 熔断：失败率超过 minuteMaxFailRate 立即抛错中止。
 *      没有熔断时，被 WAF 拦截的 486 只票每只重试 19 秒，整体空跑半小时以上，
 *      而且**看起来像是在正常工作**——静默慢跑比报错危险得多。
 */
async function fetchMinutes(codes, cfg, log = _log) {
  const limit = Math.max(1, Math.min(cfg.market.minuteConcurrency, codes.length));
  const delay = cfg.market.minuteDelayMs || 0;
  const maxFails = Math.max(3, Math.ceil(codes.length * (cfg.market.minuteMaxFailRate || 0.3)));

  const res = new Map();
  let idx = 0;
  let done = 0;
  let fails = 0;
  let abort = null;

  const worker = async () => {
    while (idx < codes.length && !abort) {
      const c = codes[idx++];
      try {
        res.set(c, await fetchMinute(c, cfg));
      } catch (e) {
        res.set(c, { error: String((e && e.message) || e) });
        fails++;
        if (fails >= maxFails) {
          abort = new Error(
            `分时接口失败率过高（${fails} 次失败 / 已处理 ${done}），疑似被 WAF 拦截。`
            + `已中止本次分时抓取，避免在拦截状态下空跑数十分钟。`,
          );
        }
      }
      done++;
      if (done % 20 === 0) log(`      分时 ${done}/${codes.length}（失败 ${fails}）`);
      if (delay) await sleep(delay);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  if (abort) throw abort;
  return res;
}

module.exports = {
  volLotSize, expandCodes, parseQuote, fetchBatch, fullMarketSnapshot,
  fetchMinute, fetchMinutes, tailMetrics, barAt, barAtOrBefore, setLog,
};
