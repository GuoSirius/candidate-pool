'use strict';
/*
 * eod/lib/hotmoney.js —— 知名游资席位注册表与匹配（纯函数，零副作用）
 * ---------------------------------------------------------------------------
 * 名单唯一真相源：eod/hotmoney.config.js 的 registry.entries。
 * 动态更新（换马甲 / 改席位 / 晋升新游资）不改代码：
 *   在 eod/data/hotmoney-registry.json（registry.overrideFile）里写：
 *     [{ "name": "新游资", "seat": "XX证券.*YY营业部", "tier": "一线", "action": "add" },
 *      { "name": "旧游资", "action": "remove" }]
 *   add 按 name 追加/覆盖，remove 按 name 删除；每次匹配实时读取。
 *
 * preopen_rules.js 的 matchHotMoney / HOT_MONEY_SEATS 改为此处转发，
 * 盘前选股与回填的既有调用（PR.matchHotMoney(seats)）不受影响。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const cfg = require('../hotmoney.config');
const paths = require('../../paths');

function registryOverrideFile() {
  return path.join(paths.eodDir(), cfg.store.dataDir, cfg.registry.overrideFile);
}

/** 本地覆盖文件（可选；不存在/解析失败返回空数组，不阻断） */
function loadOverrides() {
  const f = registryOverrideFile();
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) || []; } catch (e) { return []; }
}

// mtime 缓存：逐票匹配不该重读 override + 重编译全部正则（单日 ~120 次、回补 20 日 ~2400 次，评审 #5）
let _regCache = null;   // { mtime, registry }
function effectiveRegistry() {
  const f = registryOverrideFile();
  let mtime = 0;
  try { mtime = fs.statSync(f).mtimeMs; } catch (e) { /* 无 override 文件 → 0 */ }
  if (_regCache && _regCache.mtime === mtime) return _regCache.registry;
  const adds = [];
  const removes = [];
  for (const o of loadOverrides()) {
    if (!o || !o.name) continue;
    if (o.action === 'remove') { removes.push(o.name); continue; }
    let re = null;
    try { re = new RegExp(o.seat || '', 'i'); } catch (e) { re = null; }
    if (re) adds.push([o.name, re, o.tier || cfg.registry.defaultTier]);
  }
  const base = cfg.registry.entries
    .filter(([n]) => !removes.includes(n) && !adds.some(([an]) => an === n))
    .map(([n, src, tier]) => [n, new RegExp(src, 'i'), tier]);
  const registry = base.concat(adds);
  _regCache = { mtime, registry };
  return registry;
}

/** 席位 → 游资（含买卖明细）。seats: [{ seat, buy, sell, net }] → [{ name, tier, seat, buy, sell, net }] */
function matchSeatTrades(seats, registry) {
  const reg = registry || effectiveRegistry();
  const out = [];
  for (const s of seats || []) {
    for (const [name, re, tier] of reg) {
      if (re.test(s.seat || '')) {
        out.push({ name, tier, seat: s.seat, buy: s.buy ?? null, sell: s.sell ?? null, net: s.net ?? null });
        break;
      }
    }
  }
  return out;
}

/** 旧接口兼容（盘前/回填在用）：[{ name, amt(买入额), tier }] */
function matchHotMoney(seats, registry) {
  return matchSeatTrades(seats, registry).map((m) => ({ name: m.name, amt: m.buy, tier: m.tier }));
}

module.exports = { registryOverrideFile, loadOverrides, effectiveRegistry, matchSeatTrades, matchHotMoney };
