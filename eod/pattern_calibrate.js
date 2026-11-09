'use strict';
/*
 * eod/pattern_calibrate.js —— 模板票特征校准（npm run pattern:calibrate）
 * ---------------------------------------------------------------------------
 * 干什么：抓模板票的前复权日线，按定义里的 from→to 窗口算出特征向量，
 *         回填到 eod/pattern.templates.json 的 features 段并落盘。
 *
 * 为什么需要：形态相似度引擎运行时只读固化特征，零网络、可复现、不受行情漂移影响；
 *   但「改了模板票 / 起始日 / 截止日」必须重跑本脚本，否则用的是旧标尺。
 *   模板票自身在校准窗口下必然得 100 分 —— 这也是 B1 的验收基准。
 *
 * 用法：
 *   node eod/pattern_calibrate.js              # 校准全部 template 形态
 *   node eod/pattern_calibrate.js --dry        # 只打印特征值，不写文件
 *   node eod/pattern_calibrate.js --id vcp     # 单个（仅 template 有效）
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./pattern.config');
const market = require('./lib/market');
const F = require('./lib/pattern_features');
const { atomicWriteJSON } = require('./lib/atomic');

const argv = process.argv.slice(2);
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const OPT = { dry: argv.includes('--dry'), id: argOf('--id') };

const FILE = path.join(__dirname, cfg.templates.file);
const OVERRIDE = path.join(require('../paths').eodDir(), cfg.templates.overrideFile);
const TARGET = fs.existsSync(OVERRIDE) ? OVERRIDE : FILE;

function log(m) { console.log(m); }

/** 只取参与评分的键（排除 _meta） */
function scoreKeys(f) {
  const out = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === '_meta') continue;
    out[k] = Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  }
  return out;
}

async function main() {
  const doc = JSON.parse(fs.readFileSync(TARGET, 'utf8'));
  let changed = 0;
  for (const def of doc.patterns || []) {
    if (def.engine !== 'template') continue;
    if (OPT.id && def.id !== OPT.id) continue;
    const t = def.template || {};
    if (!t.code || !t.from || !t.to) throw new Error(`${def.id} 的 template 缺 code/from/to`);
    log(`[校准] ${def.name}（${def.id}）← ${t.name || t.code} ${t.from} → ${t.to}`);
    const kl = await market.fetchKline(t.code, t.to);
    const asc = F.toAsc(kl.rows);
    if (!asc.length) throw new Error(`${t.code} K线为空`);
    const lastDate = asc[asc.length - 1].date;
    if (lastDate > t.to) throw new Error(`${t.code} 最后一根 K 线 ${lastDate} 晚于截止日 ${t.to}`);
    // 模板票停牌 / 截止日非交易日 → 自动回退到最近有 K 线的一天，并写回定义
    if (lastDate < t.to) {
      log(`[提示] ${t.code} 截止日 ${t.to} 无 K 线，自动回退为 ${lastDate}（停牌或非交易日）`);
      t.to = lastDate;
      def.template.to = lastDate;
    }
    const li = asc.findIndex((r) => r.date === t.from);
    if (li < 20) throw new Error(`${t.code} 起始日 ${t.from} 不在 K 线窗口内（或前 20 日数据不足）`);
    const ser = F.series(asc);
    const f = F.features(asc, ser, li, t.code);
    if (!f) throw new Error(`${t.code} 特征计算失败`);
    // 启动日必须能被运行时的启动门槛识别，否则全市场扫描时找不到这个窗口
    const lc = F.launchCandidates(asc, ser, def.launch).some((x) => x.li === li);
    if (!lc) log(`[警告] ${def.id} 的起始日未通过启动门槛（chgMin=${def.launch.chgMin} / volXMin=${def.launch.volXMin}），请下调门槛`);
    const keys = scoreKeys(f);
    for (const [k, v] of Object.entries(keys)) log(`        ${k.padEnd(16)} ${v}`);
    def.features = keys;
    def.calibratedAt = new Date().toISOString();
    def.template.windowDays = f._meta.windowDays;
    changed++;
  }
  if (!changed) throw new Error('没有可校准的 template 形态（检查 --id）');
  if (OPT.dry) { log('[dry] 未写文件'); return; }
  atomicWriteJSON(TARGET, doc);
  log(`[完成] 已写入 ${TARGET}（${changed} 个模板形态）`);
  log('提示：这是代码资产，请随代码一起提交；改模板票/日期后需重跑。');
}

main().catch((e) => { console.error(`[失败] ${e.stack || e.message}`); process.exitCode = 1; });
