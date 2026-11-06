'use strict';
/*
 * pulse/sources/market.js —— 东财板块行情 + 主力资金流（行业 m:90+t:1 / 概念 m:90+t:2）
 * 与 eod/build_industry_map.js 同族接口。输出统一板块表（代码→行情+资金流+领涨股）。
 */
const httpGet = require('../../eod/lib/http').httpGet;

const FIELDS = 'f3,f12,f14,f62,f104,f105,f128,f136';

/** 拉一类板块（fs），返回 [{ code, name, pct, flow, up, down, lead, leadPct }] */
async function fetchBoardType(fs) {
  const out = [];
  for (let pn = 1; pn <= 5; pn++) {
    const j = await httpGet(
      `https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=${FIELDS}`,
      { json: true, referer: 'https://quote.eastmoney.com/' }
    );
    const diff = (j && j.data && j.data.diff) || [];
    for (const d of diff) {
      out.push({
        code: d.f12, name: d.f14,
        pct: typeof d.f3 === 'number' ? d.f3 : null,
        flow: typeof d.f62 === 'number' ? d.f62 : null, // 主力净流入（元）
        up: d.f104, down: d.f105,
        lead: d.f128 && d.f128 !== '-' ? d.f128 : '',
        leadPct: typeof d.f136 === 'number' ? d.f136 : null,
      });
    }
    if (diff.length < 100) break;
  }
  return out;
}

/** 行业+概念合并快照 */
async function fetchBoards() {
  const [industry, concept] = await Promise.all([
    fetchBoardType('m:90+t:1'),
    fetchBoardType('m:90+t:2').catch(() => []),
  ]);
  const seen = new Set();
  return [...industry, ...concept].filter((b) => (seen.has(b.code) ? false : (seen.add(b.code), true)));
}

module.exports = { fetchBoards };
