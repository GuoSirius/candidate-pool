#!/usr/bin/env node
'use strict';
/**
 * build_universe.js —— 生成/刷新候选观察池 candidates.json
 *
 * 背景：R01（量能验证突破）的市值门槛是 20~500 亿，属于中小盘短线打法；
 *       R07（板块内补涨）要求同行业有足够样本，中位涨幅才有代表性。
 *       因此观察池必须「行业铺得开 + 中小盘为主 + 保留少量龙头做行业锚」。
 *
 * 做法：种子清单只维护【6 位代码 + 申万一级行业】，其余全部由接口回填并校验：
 *   1. 批量拉 qt.gtimg.cn 报价（一次可查上百只，GBK 编码）
 *   2. 丢弃：代码不存在 / 停牌无价 / 名称含 ST / 总市值低于下限
 *   3. 股票名称一律以接口返回为准，避免人工维护的名称与代码错配
 *
 * 用法：
 *   node build_universe.js                 # 生成 candidates.json
 *   node build_universe.js --min-cap 15    # 自定义市值下限（亿）
 *   node build_universe.js --dry           # 只打印结果不写文件
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, 'candidates.json');
const BATCH = 60;          // 每批查询只数
const DEFAULT_MIN_CAP = 15; // 总市值下限（亿）

// ---------------------------------------------------------------------------
// 种子清单：申万一级行业 -> 6 位代码
// 以中小盘为主，并保留各行业龙头作为行业涨幅锚点（R01 会用 20~500 亿自行卡市值）
// ---------------------------------------------------------------------------
const SEED = {
  '食品饮料': ['600519', '000858', '600887', '603288', '002557', '002847', '002216', '600305',
    '002481', '603719', '300973', '603345', '002732', '603517', '603866', '600882',
    '603711', '603317', '002507', '002661', '603027', '603697'],
  '医药生物': ['600276', '603259', '300760', '300122', '300003', '002007', '300244', '300482',
    '603658', '300529', '688180', '300639', '603987', '002019', '600079', '000513',
    '600976', '603229', '300888', '002020'],
  '电力设备': ['300750', '601012', '300274', '002028', '601567', '300001', '002518', '603606',
    '002335', '300724', '002851', '603063', '300827', '002531', '300443', '603985',
    '002080', '600885', '002506'],
  '汽车': ['002594', '601633', '600104', '002472', '603596', '002536', '603997', '300258',
    '002101', '601965', '002906', '603178', '600699', '603348', '300825', '605005'],
  '家用电器': ['000333', '000651', '600690', '002032', '002242', '603868', '002508', '002959',
    '603579', '002614', '605365', '300894', '603515', '002035', '000921', '603355', '002403'],
  '电子': ['002475', '002241', '603501', '688981', '002049', '300623', '300782', '688396',
    '002156', '300661', '002185', '300223', '603160', '300458', '603662', '002138',
    '300408', '300207', '300679', '603236', '300346'],
  '计算机': ['002230', '688111', '603019', '300454', '002439', '300036', '300253', '300377',
    '300271', '603039', '300579', '300085', '002195', '300229', '600845', '002261', '300525'],
  '传媒': ['300413', '002027', '300251', '002739', '601801', '300058', '002400', '600088',
    '300148', '002803', '601928', '300182', '600551', '300364', '002624', '300043'],
  '银行': ['600036', '601398', '002142', '002966', '601528', '601860', '600926', '002807',
    '603323', '601128', '600908', '601077', '601187', '600928', '002958'],
  '非银金融': ['300059', '600030', '601377', '600909', '601198', '000728', '600155', '002926',
    '601108', '000750', '601375', '002673', '601696', '300773'],
  '房地产': ['600048', '000002', '000961', '600325', '002244', '600663', '600648', '000402',
    '600383', '600895', '000031', '600639', '002285'],
  '建筑材料': ['600585', '002271', '603737', '600801', '000401', '603916', '002088', '603601',
    '300715', '002233', '600720', '603266'],
  '基础化工': ['600309', '002324', '603650', '002326', '600409', '002250', '603067', '300848',
    '002741', '603379', '002497', '600596', '600426'],
  '机械设备': ['600031', '300124', '603338', '002158', '603611', '300415', '603757', '002559',
    '002438', '300185', '603025', '002097', '300747', '603667'],
  '有色金属': ['601899', '002460', '600549', '002203', '000807', '600711', '002378', '601168',
    '000630', '600497', '002114', '000751', '600459', '002240'],
  '煤炭': ['601088', '601225', '000983', '600971', '601001', '000933', '600985', '601699',
    '600395', '601918', '000552', '600123', '601666'],
  '石油石化': ['600028', '601857', '603353', '002554', '600583', '603727', '002207', '600871',
    '000637', '603619', '300084', '002828'],
  '钢铁': ['600019', '000709', '600507', '000825', '600282', '002110', '600581', '000778',
    '600808', '002478', '600117', '002756', '603878'],
  '交通运输': ['002352', '601816', '600233', '002468', '603056', '002120', '601008', '600717',
    '000088', '600798', '601018', '600018', '603565', '603967'],
  '农林牧渔': ['002714', '300498', '002567', '603477', '002385', '002124', '600975', '002100',
    '300761', '600598', '000998', '002299', '603609', '002234', '300087', '002311'],
  '公用事业': ['600900', '000883', '000539', '600863', '000027', '600995', '601016', '000531',
    '600236', '000601', '600098', '300070', '000544', '601158'],
  '通信': ['000063', '600941', '002396', '600498', '300394', '002281', '600487', '002115',
    '603322', '002446', '600522', '300628'],
  '国防军工': ['600760', '600893', '300696', '002389', '300719', '002465', '300775', '603267',
    '600435', '002025', '600501', '300581', '002829', '688122'],
  '商贸零售': ['601933', '002251', '600694', '000759', '600828', '002697', '603708', '002187',
    '600682', '000715', '603214', '603123'],
  '美容护理': ['603605', '603983', '300740', '605136', '002762', '603630', '300886', '605009'],
  '轻工制造': ['603833', '002572', '603816', '300616', '603313', '002853', '603898', '600433',
    '002078', '600966', '002511', '603116'],
};

// ---------------------------------------------------------------------------
function toFullCode(c) {
  const s = String(c).trim();
  if (/^6/.test(s)) return 'sh' + s;
  if (/^[03]/.test(s)) return 'sz' + s;
  if (/^[48]/.test(s)) return 'bj' + s;
  return 'sh' + s;
}

function decodeGbk(buf) {
  try { return new TextDecoder('gbk').decode(buf); }
  catch (e) { return buf.toString('binary'); } // 兜底：中文会乱码，但代码/数字仍可用
}

function getRaw(url, retries = 3) {
  return new Promise(async (resolve, reject) => {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 600 * i));
      try {
        return resolve(await new Promise((res, rej) => {
          const req = https.get(url, {
            timeout: 20000,
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://gu.qq.com/' },
          }, r => {
            const chunks = [];
            r.on('data', c => chunks.push(c));
            r.on('end', () => res(Buffer.concat(chunks)));
          });
          req.on('error', rej);
          req.on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
        }));
      } catch (e) { lastErr = e; }
    }
    reject(lastErr);
  });
}

async function fetchBatch(codes) {
  const buf = await getRaw('https://qt.gtimg.cn/q=' + codes.join(','));
  const txt = decodeGbk(buf);
  const out = {};
  for (const seg of txt.split(';')) {
    const m = seg.match(/v_([a-z]{2}\d{6})="([^"]*)"/);
    if (!m) continue;
    const f = m[2].split('~');
    if (f.length < 50) continue;
    const price = parseFloat(f[3]) || parseFloat(f[4]);
    out[m[1]] = {
      code: m[1],
      name: (f[1] || '').replace(/\s+/g, ''), // 交易所原始简称含空格（如“五 粮 液”），统一去掉
      price,
      circCapYi: parseFloat(f[44]),   // 流通市值（亿）
      totalCapYi: parseFloat(f[45]),  // 总市值（亿）
    };
  }
  return out;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  return { minCap: +get('--min-cap', DEFAULT_MIN_CAP), dry: a.includes('--dry') };
}

(async () => {
  const { minCap, dry } = parseArgs();

  // 展开种子清单并去重（同一代码若出现在多个行业，以首次出现为准）
  const seen = new Set();
  const wanted = [];
  for (const [sector, list] of Object.entries(SEED)) {
    for (const c of list) {
      const full = toFullCode(c);
      if (seen.has(full)) continue;
      seen.add(full);
      wanted.push({ code: full, sector });
    }
  }
  console.log(`种子清单 ${wanted.length} 只，覆盖 ${Object.keys(SEED).length} 个申万一级行业`);

  // 分批拉报价
  const quotes = {};
  for (let i = 0; i < wanted.length; i += BATCH) {
    const chunk = wanted.slice(i, i + BATCH);
    process.stdout.write(`  拉取报价 ${i + 1}~${Math.min(i + BATCH, wanted.length)} ...`);
    try {
      Object.assign(quotes, await fetchBatch(chunk.map(w => w.code)));
      console.log(' ok');
    } catch (e) { console.log(' 失败: ' + e.message); }
  }

  // 校验过滤
  const kept = [], dropped = [];
  for (const w of wanted) {
    const q = quotes[w.code];
    if (!q) { dropped.push([w.code, w.sector, '接口无返回（代码可能不存在）']); continue; }
    if (!q.price || !isFinite(q.price)) { dropped.push([w.code, w.sector, '无有效价格（长期停牌/退市）']); continue; }
    if (/ST|退/i.test(q.name)) { dropped.push([w.code, w.sector, `风险股 ${q.name}`]); continue; }
    const cap = isFinite(q.totalCapYi) ? q.totalCapYi : q.circCapYi;
    if (!isFinite(cap) || cap < minCap) { dropped.push([w.code, w.sector, `市值过小 ${cap}亿`]); continue; }
    kept.push({ code: w.code, name: q.name || w.code, sector: w.sector, capYi: Math.round(cap) });
  }

  // 统计
  const bySector = {};
  for (const k of kept) (bySector[k.sector] = bySector[k.sector] || []).push(k);
  const inR01Band = kept.filter(k => k.capYi >= 20 && k.capYi <= 500);

  console.log(`\n保留 ${kept.length} 只 / 剔除 ${dropped.length} 只`);
  if (dropped.length) {
    console.log('剔除明细:');
    dropped.forEach(d => console.log(`  ${d[0]}  [${d[1]}]  ${d[2]}`));
  }
  console.log(`\n落在 R01 市值带（20~500亿）的标的: ${inR01Band.length} 只`);
  console.log('各行业成分数:');
  Object.entries(bySector).sort((a, b) => b[1].length - a[1].length)
    .forEach(([s, v]) => {
      const band = v.filter(x => x.capYi >= 20 && x.capYi <= 500).length;
      console.log(`  ${s.padEnd(6)} 共 ${String(v.length).padStart(2)} 只（其中 R01 市值带 ${band} 只）`);
    });

  const thin = Object.entries(bySector).filter(([, v]) => v.length < 5).map(([s]) => s);
  if (thin.length) console.log(`\n⚠ 样本偏少(<5)的行业，R07 中位数代表性弱: ${thin.join('、')}`);

  if (dry) { console.log('\n--dry 模式，未写入文件'); return; }

  const payload = {
    name: 'A股短线候选观察池',
    note: '由 build_universe.js 生成；名称/市值来自腾讯行情接口校验，可手工增删 stocks 条目',
    generatedAt: new Date().toISOString(),
    minCapYi: minCap,
    count: kept.length,
    stocks: kept.map(k => ({ code: k.code, name: k.name, sector: k.sector })),
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n已写出 ${OUT}（${kept.length} 只）`);
})().catch(e => { console.error('构建失败:', e.message); process.exit(1); });
