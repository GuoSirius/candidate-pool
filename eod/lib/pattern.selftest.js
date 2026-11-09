'use strict';
/*
 * eod/lib/pattern.selftest.js —— 形态引擎离线自测（npm run pattern:selftest）
 * ---------------------------------------------------------------------------
 * 零网络：K 线来自 pattern.fixture.json（模板票最近 100 根前复权日线）。
 * 核心验收（B1）：模板票在自身校准窗口下必须得满分，且是自己的主形态；
 *   一旦标尺漂移（改了特征口径 / 校准数据 / 权重），这里立刻变红。
 * ---------------------------------------------------------------------------
 */
const cfg = require('../pattern.config');
const E = require('./pattern_engine');
const F = require('./pattern_features');
const fixture = require('./pattern.fixture.json');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' → ' + detail : ''}`); }
}

const defs = E.loadDefs(cfg);
const ids = defs.patterns.map((p) => p.id);
check('四类形态齐全', defs.patterns.length === 4 && ['strong-platform', 'n-wave', 'duck-head', 'vcp'].every((x) => ids.includes(x)), ids.join(','));
check('双引擎均已注册', defs.patterns.filter((p) => p.engine === 'template').length === 2 && defs.patterns.filter((p) => p.engine === 'rule').length === 2);
check('模板特征已校准', defs.patterns.filter((p) => p.engine === 'template').every((p) => p.features && Object.keys(p.features).length >= 10));

for (const def of defs.patterns.filter((p) => p.engine === 'template')) {
  const t = def.template;
  const asc = fixture.bars[t.code];
  if (!asc) { check(`${def.name} 夹具存在`, false, t.code); continue; }
  const ser = F.series(asc);
  const matches = E.matchAll(asc, ser, defs, cfg, t.code);
  const hit = matches.find((m) => m.id === def.id);
  check(`${def.name}：模板票自身满分`, !!hit && hit.score >= 99.9, hit ? `score=${hit.score}` : '未命中');
  check(`${def.name}：是自身主形态`, !!matches[0] && matches[0].id === def.id, matches.map((m) => `${m.id}:${m.score}`).join(' | '));
  check(`${def.name}：窗口锚定到起始日`, !!hit && hit.window.launchDate === t.from, hit ? hit.window.launchDate : '—');
  check(`${def.name}：阶段非破位`, !!hit && hit.stage !== '已破位', hit ? hit.stage : '—');
  const sum = E.summarize(matches, cfg);
  check(`${def.name}：参考价位自洽`, !!sum && !!sum.price
    && sum.price.buyLow <= sum.price.buyHigh
    && sum.price.stopLoss < sum.price.support
    && sum.price.takeProfit > asc[asc.length - 1].close,
  sum && sum.price ? JSON.stringify(sum.price) : '—');
}

// 规则引擎：不抛错、门槛结构完整、命中时带窗口元数据
for (const def of defs.patterns.filter((p) => p.engine === 'rule')) {
  const asc = fixture.bars['sz002623'];
  const ser = F.series(asc);
  const r = E.RULES[def.rule](asc, ser, def, 'sz002623');
  check(`${def.name}：规则可计算`, !!r && Array.isArray(r.gates) && r.gates.length >= 5);
  check(`${def.name}：门槛含 ok/value/threshold`, !!r && r.gates.every((g) => typeof g.ok === 'boolean' && 'value' in g && 'threshold' in g));
  check(`${def.name}：窗口元数据完整`, !!r && !!r.window && Number.isFinite(r.window.price) && Number.isFinite(r.window.minClose));
}

// 规则引擎回归：合成一段「三段收缩 + 末日放量突破」的有效 VCP，必须命中。
// 重点锁住 2026-11-09 修复的 bug —— 收缩段若把突破日 ci 并入末段，会抬高末段
// 振幅/量，导致 contractAmp/contractVol 永不成立，真正的 VCP 突破反而判不中。
function makeVCPBars() {
  const n = 70;
  const bars = [];
  // 1) 前 25 根温和爬升（8→10），建立均线历史
  for (let i = 0; i < 25; i++) {
    const close = 8 + (i / 24) * 2;
    bars.push({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, open: close - 0.02, close, high: close + 0.03, low: close - 0.03, vol: 0.8 });
  }
  // 2) 45 根箱体（ci=69 为突破日，不在收缩段内）：三段振幅/量逐级收敛
  const baseStart = 25, segLen = 15;
  const segAmp = [16, 8, 3.5], segVol = [1.0, 0.7, 0.45];
  for (let i = baseStart; i < n - 1; i++) {
    const s = Math.min(2, Math.floor((i - baseStart) / segLen));
    const phase = ((i - baseStart - s * segLen) / segLen) * Math.PI * 2;
    const center = 10.0;
    const close = +(center + center * (segAmp[s] / 2) / 100 * Math.sin(phase)).toFixed(3);
    bars.push({
      date: `2026-02-${String(i - baseStart + 1).padStart(2, '0')}`,
      open: close - 0.02, close, high: +(close + 0.05).toFixed(3), low: +(close - 0.05).toFixed(3), vol: segVol[s],
    });
  }
  // 3) 突破日：跳空长阳 + 巨量
  bars.push({ date: '2026-03-01', open: 10.1, close: 11.0, high: 11.25, low: 10.05, vol: 2.5 });
  return bars;
}
const vcpAsc = makeVCPBars();
const vcpSer = F.series(vcpAsc);
const vcpDef = defs.patterns.find((p) => p.id === 'vcp');
const vcpR = E.RULES.vcp(vcpAsc, vcpSer, vcpDef, 'sh600000');
check('VCP：合成有效形态命中', !!vcpR && vcpR.hit, vcpR ? vcpR.gates.map((g) => `${g.key}:${g.ok ? 1 : 0}`).join(' ') : 'null');
check('VCP：命中带完整窗口元数据', !!vcpR && vcpR.hit && Number.isFinite(vcpR.window.price) && Number.isFinite(vcpR.window.minClose));
check('VCP：收缩段不含突破日（末段振幅逐级收敛）', !!vcpR && vcpR.hit && vcpR.features.amps
  && vcpR.features.amps[0] > vcpR.features.amps[1] && vcpR.features.amps[1] > vcpR.features.amps[2]);

// 防御：未知 rule 不应让 matchAll 抛错（降级跳过该形态，而非整条流水线崩）
const flatBars = Array.from({ length: 70 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, open: 10, close: 10, high: 10.1, low: 9.9, vol: 1 }));
const flatSer = F.series(flatBars);
const badDefs = { patterns: [{ id: 'x', name: 'X', engine: 'rule', rule: 'nope' }] };
let crash = false;
try { E.matchAll(flatBars, flatSer, badDefs, cfg, 'sh600000'); } catch (e) { crash = true; }
check('未知规则形态：matchAll 降级跳过不抛错', !crash);

// 边界：空特征不得静默给高分；破位判定；支撑位不得高于现价
const empty = E.scoreTemplate({}, { weights: { cumChg: 10 }, features: {} });
check('空特征不产生虚高分', empty.score === 0, JSON.stringify(empty));
check('破位判定', E.stageOf({ minVsMA20: -12, aboveMA20Now: -8, recentSurge: 1 }, 10) === '已破位');
check('启动当日判定', E.stageOf({ minVsMA20: 2, aboveMA20Now: 3, recentSurge: 0 }, 1) === '启动当日');
const lvl = E.priceLevels({ price: 10, ma20: 20, minClose: 30 }, cfg);
check('支撑位不高于现价（倒挂防护）', lvl.support <= 9.8 && lvl.stopLoss < lvl.support, JSON.stringify(lvl));

console.log(`\npattern.selftest: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
