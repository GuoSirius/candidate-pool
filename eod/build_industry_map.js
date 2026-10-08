#!/usr/bin/env node
'use strict';
/*
 * eod/build_industry_map.js —— 生成「代码 → 行业（+ 上市日期）」缓存
 * ---------------------------------------------------------------------------
 * 为什么单独做成低频脚本：
 *   行业归属几乎不变（一年也就调几次成分），但获取全市场映射必须翻全市场列表，
 *   而行情站对突发高频请求有风控（东财实测十余次请求即 socket hang up），所以
 *   绝不能放进 14:50 的关键路径 —— 那里只读本脚本产出的缓存文件。
 *
 * 为什么需要双源（2026-10-01 月更事故）：
 *   GitHub Actions runner 的机房段 IP 被**东财封禁**——月更运行第 1 页即在
 *   3 个主机 × 3 次重试内全灭（第 1 页获取失败），0 只解析触发安全闸退出。
 *   而腾讯行情（daily/tail 两个工作流的数据源）在 runner 上一直正常，说明
 *   不是 runner 整体断网，而是东财单方面的机房 IP 风控。故增加一个在
 *   runner 上可达的兜底源。
 *
 * 源与降级：
 *   1. 东财 clist（主源，含 f100 行业 + f26 上市日期）
 *      fs 覆盖 沪深A股 + 科创板 + 创业板 + 北交所；每页之间加节流，避免被封。
 *   2. 新浪行业分类（兜底源，runner 可达）：newSinaHy.php 取行业节点列表，
 *      Market_Center.getHQNodeData 逐节点翻成分股（symbol 自带 sh/sz/bj 前缀）。
 *      局限：不含上市日期（下游新股判定退回名称 N/C 前缀）；北交所多数不在
 *      新浪行业节点内，会落入统一的「未分类」桶。
 *   任一源解析 < 3000 只即判定抓取不完整；两源都失败则**保留既有缓存**，
 *   绝不用半截数据覆盖好数据。
 *
 * 用法：
 *   node eod/build_industry_map.js                  # 主源 -> 失败自动切兜底源
 *   node eod/build_industry_map.js --source=sina    # 强制只走新浪源
 *   node eod/build_industry_map.js --dry            # 只统计不写文件
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { httpGet } = require('./lib/http');
const { now } = require('../time');
const paths = require('../paths');

// 输出位置跟随工作目录（见 paths.js）：默认 <仓库根>/eod/data/industry-map.json
const OUT = paths.industryMapFile();
const GATE = 3000; // 解析条数低于此值判定抓取不完整

// --------------------------- 源 1：东财 clist ------------------------------

// 沪深A股 + 科创板 + 创业板 + 北交所。与全市场快照的代码覆盖面对齐。
const FS_ALL = 'm:1+t:2,m:1+t:23,m:0+t:6,m:0+t:80,m:0+t:81+s:2048';
const FIELDS = 'f12,f13,f14,f100,f26';
const PAGE_SIZE = 100;
// 东财有多个编号镜像主机；主站被封时换一个往往仍可用（实测 push2 全挂时 push2delay 正常）。
const HOSTS = [
  'https://push2.eastmoney.com',
  'https://push2delay.eastmoney.com',
  'https://82.push2.eastmoney.com',
];
const THROTTLE_MS = 220;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 东财返回的 6 位代码 -> 腾讯风格全码。
 * 注意不能用 f13（市场）判断：东财把北交所也归到市场 0，
 * 若按市场拼前缀会把 8xxxxx/920xxx 错拼成 sz。必须按代码首位判断。
 */
function toTsCode(code6) {
  const c = String(code6);
  if (/^6/.test(c)) return 'sh' + c;
  if (/^[03]/.test(c)) return 'sz' + c;
  if (/^[489]/.test(c)) return 'bj' + c;
  return null; // 无法归类的（如 B 股）直接丢弃
}

async function fetchPage(host, pn) {
  const url = `${host}/api/qt/clist/get?pn=${pn}&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2`
    + `&fid=f12&fs=${FS_ALL}&fields=${FIELDS}`;
  return httpGet(url, { json: true, retries: 3, timeout: 20000, referer: 'https://quote.eastmoney.com/' });
}

/** @returns {{stocks: Object, label: string} | null} 不完整时返回 null（不抛出） */
async function fetchFromEastmoney() {
  let host = null;
  const stocks = {};
  let page = 1;
  let total = 0;

  for (; page <= 200; page++) {
    let obj = null;
    // 逐主机降级：任一主机能出数就锁定它，后续页固定走同一台（避免来回换台被判定异常）
    const order = host ? [host, ...HOSTS.filter((h) => h !== host)] : HOSTS;
    let lastErr = null;
    for (const h of order) {
      try {
        obj = await fetchPage(h, page);
        if (obj && obj.data) {
          if (host !== h) {
            host = h;
            console.log(`  数据源: ${h}`);
          }
          break;
        }
      } catch (e) { lastErr = e; }
    }
    if (!obj || !obj.data) {
      console.error(`  第 ${page} 页获取失败（${lastErr ? lastErr.message : '空响应'}）`);
      break;
    }
    if (page === 1) {
      total = obj.data.total || 0;
      console.log(`  全市场 ${total} 只，约 ${Math.ceil(total / PAGE_SIZE)} 页`);
    }
    const rows = obj.data.diff || [];
    if (!rows.length) break;
    for (const r of rows) {
      const code = toTsCode(r.f12);
      if (!code) continue;
      // 东财对部分个股（B 股壳、未分类次新等）回 '-'：当作「无行业」处理，
      // 让下游落到统一的「未分类」桶，而不是把 '-' 当成一个真实行业参与板块强度排序。
      const sector = String(r.f100 || '').trim();
      if (!sector || sector === '-') continue;
      stocks[code] = { name: String(r.f14 || '').trim(), sector, listed: r.f26 ? String(r.f26) : null };
    }
    process.stdout.write(`\r  已抓 ${Object.keys(stocks).length} 条 / 共 ${total}`);
    if (rows.length < PAGE_SIZE) break;
    await sleep(THROTTLE_MS);
  }
  process.stdout.write('\n');

  const n = Object.keys(stocks).length;
  console.log(`\n[东财源] 共解析 ${n} 只（${(n / (total || 1) * 100).toFixed(1)}% 覆盖）`);
  if (n < GATE) return null;
  return { stocks, label: `eastmoney clist (${host})` };
}

// --------------------------- 源 2：新浪行业分类 ----------------------------

const SINA_BASE = 'https://vip.stock.finance.sina.com.cn';
const SINA_REFERER = 'https://finance.sina.com.cn/';
const SINA_THROTTLE_MS = 150;
const SINA_NUM = 100; // getHQNodeData 单页上限

/** 行业节点列表：GBK 编码的 var 声明，值为 "key,行业名,数量,..." */
async function fetchSinaNodes() {
  const txt = await httpGet(`${SINA_BASE}/q/view/newSinaHy.php`,
    { enc: 'gbk', retries: 3, timeout: 20000, referer: SINA_REFERER });
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('新浪行业节点列表解析失败');
  const obj = JSON.parse(m[0]);
  const nodes = Object.entries(obj)
    .map(([key, v]) => {
      const p = String(v).split(',');
      return { key, name: (p[1] || '').trim(), count: parseInt(p[2], 10) || 0 };
    })
    .filter((x) => x.name && x.count > 0);
  if (!nodes.length) throw new Error('新浪行业节点为空');
  return nodes;
}

/** @returns {{stocks: Object, label: string} | null} 单节点失败跳过，整体不完整时返回 null */
async function fetchFromSina() {
  console.log('\n-- 切换兜底源：新浪行业分类 --');
  let nodes;
  try {
    nodes = await fetchSinaNodes();
  } catch (e) {
    console.error(`  行业节点列表获取失败（${e.message}）`);
    return null;
  }
  console.log(`  行业节点 ${nodes.length} 个`);
  const stocks = {};
  for (const node of nodes) {
    const pages = Math.ceil(node.count / SINA_NUM) || 1;
    for (let p = 1; p <= pages; p++) {
      const url = `${SINA_BASE}/quotes_service/api/json_v2.php/Market_Center.getHQNodeData`
        + `?page=${p}&num=${SINA_NUM}&node=${node.key}&sort=symbol&asc=1`;
      let rows;
      try {
        rows = await httpGet(url, { json: true, retries: 2, timeout: 20000, referer: SINA_REFERER });
      } catch (e) {
        console.error(`\n  节点「${node.name}」第 ${p} 页失败（${e.message}），跳过该节点`);
        break;
      }
      if (!Array.isArray(rows) || !rows.length) break;
      for (const r of rows) {
        const sym = String(r.symbol || '');
        if (!/^(sh|sz|bj)\d{6}$/.test(sym)) continue;
        stocks[sym] = { name: String(r.name || '').trim(), sector: node.name, listed: null };
      }
      process.stdout.write(`\r  ${node.name}（累计 ${Object.keys(stocks).length}）   `);
      if (rows.length < SINA_NUM) break;
      await sleep(SINA_THROTTLE_MS);
    }
    await sleep(SINA_THROTTLE_MS);
  }
  process.stdout.write('\n');

  const n = Object.keys(stocks).length;
  const sectors = new Set(Object.values(stocks).map((v) => v.sector)).size;
  // 闸门按「该源自洽完整」判定：新浪行业分类宇宙本身只有 ~3000 只（分类偏旧），
  // 不能套东财的 3000 阈值；以节点列表声明的总数量为预期，抓到 >= 90% 即算完整。
  const expected = nodes.reduce((s, x) => s + x.count, 0);
  const gate = Math.max(1000, Math.floor(expected * 0.9));
  console.log(`\n[新浪源] 共解析 ${n} 只，${sectors} 个行业（预期 ${expected}，闸门 ${gate}）`);
  if (n < gate) return null;
  return { stocks, label: 'sina industry nodes (vip.stock.finance.sina.com.cn)' };
}

// ---------------------------------- 主流程 ---------------------------------

(async () => {
  const dry = process.argv.includes('--dry');
  const srcArg = process.argv.find((a) => a.startsWith('--source='));
  const forced = srcArg ? srcArg.split('=')[1] : null; // 'eastmoney' | 'sina'

  let result = null;
  if (forced !== 'sina') {
    result = await fetchFromEastmoney();
    if (!result) console.error('  东财源抓取不完整，尝试新浪兜底源…');
  }
  if (!result && forced !== 'eastmoney') {
    result = await fetchFromSina();
  }

  if (!result) {
    console.error(`\n✗ 两个源均解析不足 ${GATE} 只，判定抓取不完整，**不覆盖既有缓存**。`);
    console.error('  期间站点沿用旧缓存（不影响运行）；可稍后重试或在本机手动执行。');
    process.exit(1);
  }

  const { stocks, label } = result;
  const n = Object.keys(stocks).length;

  // 行业分布概览
  const bySector = {};
  for (const v of Object.values(stocks)) bySector[v.sector] = (bySector[v.sector] || 0) + 1;
  const sectors = Object.entries(bySector).sort((a, b) => b[1] - a[1]);
  console.log(`行业数 ${sectors.length}，前 12：`);
  for (const [s, c] of sectors.slice(0, 12)) console.log(`  ${s.padEnd(10)} ${c}`);
  const noListed = Object.values(stocks).filter((v) => !v.listed).length;
  console.log(`上市日期缺失 ${noListed} 只（缺失时新股判定退回名称 N/C 前缀）`);

  if (dry) { console.log('\n--dry：未写入文件'); return; }

  // 防降级闸：部分抓取（如东财 74% 覆盖也 >= 3000 过闸）或兜底源（新浪仅 ~3000）
  // 都不能覆盖既有的大映射 —— 缓存条数明显缩水视为降级，保留旧数据。
  let prevCount = 0;
  try { prevCount = JSON.parse(fs.readFileSync(OUT, 'utf8')).count || 0; } catch (e) { /* 首次运行无缓存 */ }
  if (prevCount > n * 1.2) {
    console.log(`\n既有缓存 ${prevCount} 条明显大于本次 ${n} 条，判定为覆盖面降级，**保留旧缓存不覆盖**。`);
    return; // 缓存保留即视为成功，不触发工作流失败/提交
  }

  const payload = {
    generatedAt: now(),
    source: label,
    count: n,
    stocks,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload), 'utf8');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`\n已写出 ${OUT}（${n} 条，${kb} KB）`);
})().catch((e) => {
  console.error('构建失败:', (e && e.stack) || e);
  process.exit(1);
});
