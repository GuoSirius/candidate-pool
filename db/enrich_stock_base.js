'use strict';
// 股票档案补全：从东方财富 F10 公开接口低频抓取
//   题材概念 / 地域 / 主营业务 / 最赚钱业务，写入 stock_base（仅填缺失字段）。
// 用法：
//   node db/enrich_stock_base.js                 # 补全所有 concepts/region/main_business 为空的票
//   node db/enrich_stock_base.js --test sh600519 # 打印单只原始响应，便于校准字段路径
//   node db/enrich_stock_base.js --all           # 强制覆盖已存在的字段
// 注意：东方财富 F10 端点可能随版本调整，若字段取不到，用 --test 看原始 JSON 后微调下方解析。
const fs = require('fs');
const path = require('path');
const https = require('https');
const d1 = require('./d1client');
const localSqlite = require('./sqlite_client');
const { now: fmtNow } = require('../time');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const REF = 'https://emweb.securities.eastmoney.com/';

function emCode(code) {
  const m = String(code).toLowerCase().match(/^(sh|sz|bj)(\d{6})$/);
  if (!m) return null;
  return m[1].toUpperCase() + m[2];
}

function getJSON(url, tries = 3) {
  return new Promise(async (resolve, reject) => {
    let last;
    for (let i = 0; i < tries; i++) {
      if (i) await new Promise(r => setTimeout(r, 800 * i));
      try {
        const buf = await new Promise((res, rej) => {
          https.get(url, { headers: { 'User-Agent': UA, 'Referer': REF } }, r => {
            const cs = []; r.on('data', c => cs.push(c)); r.on('end', () => res(Buffer.concat(cs)));
          }).on('error', rej).on('timeout', () => rej(new Error('timeout')));
        });
        return resolve(JSON.parse(buf.toString('utf8')));
      } catch (e) { last = e; }
    }
    reject(last);
  });
}

// 取公司概况：主营业务 + 地域（省份）
async function companySurvey(em) {
  const url = `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${em}`;
  const j = await getJSON(url);
  const R = j && (j.Result || (Array.isArray(j) && j[0] && j[0].Result));
  if (!R) return {};
  const r = Array.isArray(R) ? R[0] : R;
  return { mainBusiness: r.MainBusiness || r.mainBusiness || '', region: r.Province || r.province || '' };
}

// 取主营构成：按毛利率挑「最赚钱业务」
async function operationsRequired(em) {
  const url = `https://emweb.securities.eastmoney.com/PC_HSF10/OperationsRequired/PageAjax?code=${em}`;
  const j = await getJSON(url);
  const R = j && (j.Result || (Array.isArray(j) && j[0] && j[0].Result));
  if (!R) return {};
  const main = (R.MainOp || R.mainOp || []);
  if (!main.length) return {};
  let best = null;
  for (const it of main) {
    const gm = parseFloat(it.GROSS_MARGIN != null ? it.GROSS_MARGIN : it.grossMargin);
    if (!isNaN(gm) && (!best || gm > best.gm)) best = { gm, name: it.ITEM_NAME || it.itemName, prop: it.PROPORTION != null ? it.PROPORTION : it.proportion };
  }
  if (!best) return {};
  return { topBusiness: `${best.name}（毛利率 ${Number(best.gm).toFixed(1)}%${best.prop != null ? `，营收占比 ${Number(best.prop).toFixed(1)}%` : ''}）` };
}

// 取题材概念
async function concepts(em) {
  const url = `https://emweb.securities.eastmoney.com/PC_HSF10/BusinessAnalysis/PageAjax?code=${em}`;
  const j = await getJSON(url);
  const R = j && (j.Result || (Array.isArray(j) && j[0] && j[0].Result));
  if (!R) return {};
  const arr = R.Concept || R.concept || R.THSConcept || [];
  const list = (Array.isArray(arr) ? arr : []).map(x => x.TITLE || x.title || x.ZTMC || x.conceptName).filter(Boolean);
  if (list.length) return { concepts: list.join('、') };
  // 兜底：一些版本把概念放在 HYSYL（行业）或核心题材字段
  const core = R.CoreConcept || R.coreConcept;
  if (Array.isArray(core)) return { concepts: core.map(x => x.TITLE || x.title).filter(Boolean).join('、') };
  return {};
}

async function enrichOne(code) {
  const em = emCode(code);
  if (!em) return {};
  const [cs, op, cp] = await Promise.allSettled([companySurvey(em), operationsRequired(em), concepts(em)]);
  return {
    mainBusiness: (cs.status === 'fulfilled' ? cs.value.mainBusiness : '') || '',
    region: (cs.status === 'fulfilled' ? cs.value.region : '') || '',
    topBusiness: (op.status === 'fulfilled' ? op.value.topBusiness : '') || '',
    concepts: (cp.status === 'fulfilled' ? cp.value.concepts : '') || '',
  };
}

(async () => {
  const test = process.argv.includes('--test');
  const all = process.argv.includes('--all');
  const isLocal = process.argv.includes('--local');
  const codeArg = (process.argv.find(a => a.startsWith('--code=')) || '').split('=')[1];
  const client = isLocal ? localSqlite.createClient() : d1;
  if (isLocal) console.log(`[enrich] 本地 SQLite 模式 -> ${client.file}`);

  if (test && codeArg) {
    const r = await enrichOne(codeArg);
    console.log(JSON.stringify(r, null, 2));
    if (client.close) client.close();
    return;
  }

  const rows = codeArg
    ? [{ code: codeArg }]
    : await client.query(`SELECT code FROM stock_base WHERE ${all ? '1=1' : "concepts IS NULL OR region IS NULL OR main_business IS NULL"}`);
  const codes = rows.map(r => r.code);
  console.log(`待补全 ${codes.length} 只${all ? '（强制覆盖）' : ''}`);

  let ok = 0, skip = 0;
  for (const code of codes) {
    try {
      const r = await enrichOne(code);
      const has = r.concepts || r.region || r.mainBusiness || r.topBusiness;
      if (!has) { skip++; console.log(`  · ${code}: 接口无数据，跳过`); continue; }
      if (test) { console.log(code, JSON.stringify(r)); continue; }
      await client.query(
        'UPDATE stock_base SET concepts=COALESCE(NULLIF(?,""),concepts), region=COALESCE(NULLIF(?,""),region), main_business=COALESCE(NULLIF(?,""),main_business), top_business=COALESCE(NULLIF(?,""),top_business), updated_at=? WHERE code=?',
        [r.concepts, r.region, r.mainBusiness, r.topBusiness, fmtNow(), code]
      );
      ok++;
      console.log(`  ✓ ${code} 概念=${r.concepts || '-'} 地域=${r.region || '-'} 主营=${r.mainBusiness || '-'} 最赚=${r.topBusiness || '-'}`);
    } catch (e) {
      console.log(`  ✗ ${code}: ${e.message}`);
    }
    if (!test) await new Promise(r => setTimeout(r, 250)); // 低频，避免触发东财限流
  }
  if (client.close) client.close();
  console.log(`[enrich] 完成：更新 ${ok} 跳过 ${skip}`);
})().catch(e => { console.error('[enrich] 中止:', e.message); process.exit(1); });
