#!/usr/bin/env node
'use strict';
/*
 * eod/build_industry_map.js —— 生成「代码 → 行业（+ 上市日期）」缓存
 * ---------------------------------------------------------------------------
 * 为什么单独做成低频脚本：
 *   行业归属几乎不变（一年也就调几次成分），但获取全市场映射必须走东财 clist
 *   （一次 60 页、每页 100 只）。而**东财对突发高频请求会封 IP**（实测十余次请求后即
 *   socket hang up），所以绝不能放进 14:50 的关键路径 —— 那里只读本脚本产出的缓存文件。
 *
 * 源与降级：
 *   1. 东财 clist（主源，含 f100 行业 + f26 上市日期）
 *      fs 覆盖 沪深A股 + 科创板 + 创业板 + 北交所；每页之间加节流，避免被封。
 *   2. 失败时**保留既有缓存文件**并以非零码退出，绝不用半截数据覆盖好数据。
 *
 * 用法：
 *   node eod/build_industry_map.js              # 刷新缓存
 *   node eod/build_industry_map.js --dry        # 只统计不写文件
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { httpGet } = require('./lib/http');
const { now } = require('../time');
const paths = require('../paths');

// 输出位置跟随工作目录（见 paths.js）：默认 <仓库根>/eod/data/industry-map.json
const OUT = paths.industryMapFile();

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

(async () => {
  const dry = process.argv.includes('--dry');
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
  console.log(`\n共解析 ${n} 只（${(n / (total || 1) * 100).toFixed(1)}% 覆盖）`);

  if (n < 3000) {
    console.error(`\n✗ 解析条数过少（${n}），判定抓取不完整，**不覆盖既有缓存**。`);
    console.error('  若东财封禁本机 IP，可稍后重试；期间站点会沿用旧缓存（不影响运行）。');
    process.exit(1);
  }

  // 行业分布概览
  const bySector = {};
  for (const v of Object.values(stocks)) bySector[v.sector] = (bySector[v.sector] || 0) + 1;
  const sectors = Object.entries(bySector).sort((a, b) => b[1] - a[1]);
  console.log(`行业数 ${sectors.length}，前 12：`);
  for (const [s, c] of sectors.slice(0, 12)) console.log(`  ${s.padEnd(10)} ${c}`);
  const noListed = Object.values(stocks).filter((v) => !v.listed).length;
  console.log(`上市日期缺失 ${noListed} 只（缺失时新股判定退回名称 N/C 前缀）`);

  if (dry) { console.log('\n--dry：未写入文件'); return; }

  const payload = {
    generatedAt: now(),
    source: `eastmoney clist (${host})`,
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
