'use strict';
/*
 * eod/lib/pattern_engine.js —— 形态判定双引擎（纯函数，零网络）
 * ---------------------------------------------------------------------------
 * 引擎 A「template」：模板票特征向量（由 pattern:calibrate 固化）+ 滑动启动日窗口
 *                     + 尺度无关特征加权距离 → 0–100 匹配分。新增形态只改 JSON。
 * 引擎 B「rule」    ：老鸭头 / VCP 等有明确定义的形态，参数化门槛制，逐项可解释。
 *
 * 一只票可同时命中多类 → patterns[]，主形态取最高分，共振数 = 命中类数。
 * 参考价位（买入区间 / 止损 / 止盈）由形态支撑位推导，属量化参考位，非投资建议。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const paths = require('../../paths');
const F = require('./pattern_features');

/** 自动容差下限：防止模板值为 0 时容差塌成 0，导致「差一点就 0 分」 */
const TOL_FLOOR = {
  launchVolX: 2, launchChg: 3, windowDays: 8, cumChg: 12, boxAmp: 10,
  minVsMA20: 6, volMaintain: 3, volDecay: 0.6, aboveMA20Now: 6,
  maxDrawdown: 8, limitUpCount: 1.5, recentSurge: 1.0, launchBreak: 8,
};

/** 形态定义：工作目录覆盖文件优先（便于不改包加形态），否则包内默认 */
function loadDefs(cfg) {
  const override = path.join(paths.eodDir(), cfg.templates.overrideFile);
  const builtin = path.join(__dirname, '..', cfg.templates.file);
  const file = fs.existsSync(override) ? override : builtin;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`形态定义读取失败：${file}（${e.message}）`); }
  if (!doc || !Array.isArray(doc.patterns) || !doc.patterns.length) {
    throw new Error(`形态定义为空或格式错误：${file}`);
  }
  const ids = new Set();
  for (const p of doc.patterns) {
    if (!p.id || !p.name || ids.has(p.id)) throw new Error(`形态 id 缺失或重复：${p.id}`);
    ids.add(p.id);
    if (p.engine === 'template') {
      if (!p.features || !Object.keys(p.features).length) {
        throw new Error(`模板形态 ${p.id} 的 features 为空，请先跑 npm run pattern:calibrate`);
      }
    } else if (p.engine === 'rule') {
      if (!RULES[p.rule]) {
        throw new Error(`形态 ${p.id} 的规则引擎未注册：${p.rule}（支持 ${Object.keys(RULES).join('/')}）`);
      }
    } else {
      throw new Error(`形态 ${p.id} 的 engine 非法：${p.engine}（支持 template / rule）`);
    }
  }
  return { ...doc, source: file };
}

function tolOf(def, key, target) {
  if (def.tolerance && def.tolerance[key] != null) return Math.max(0.0001, def.tolerance[key]);
  return Math.max(Math.abs(Number(target) || 0) * 0.6, TOL_FLOOR[key] || 1);
}

/** 模板相似度：每个特征线性距离 → 加权归一 → 0–100；分项得分随结果返回（报告可展开） */
function scoreTemplate(f, def) {
  let acc = 0, wsum = 0;
  const parts = {};
  for (const [k, w] of Object.entries(def.weights || {})) {
    const target = def.features[k];
    const v = f[k];
    const tol = tolOf(def, k, target);
    let s = 0;
    if (Number.isFinite(target) && Number.isFinite(v)) s = Math.max(0, 1 - Math.abs(v - target) / tol);
    parts[k] = +(s * 100).toFixed(1);
    acc += w * s;
    wsum += w;
  }
  return { score: wsum ? +(acc / wsum * 100).toFixed(1) : 0, parts };
}

const gate = (key, ok, value, threshold) => ({ key, ok: !!ok, value, threshold });

/** 老鸭头：鸭颈上行 → 鸭头回落 → 鸭鼻孔地量 → 不破 MA60 → 鸭嘴（MA5 上穿 MA10） */
function ruleDuckHead(asc, ser, def, code) {
  const g = def.gates || {};
  const ci = asc.length - 1;
  if (ci < 70) return null;
  const look = Math.min(ci - 1, (g.pullbackMaxDays || 28) + 8);
  const from = ci - look;
  let headIdx = from, headHigh = -Infinity;
  for (let i = from; i <= ci; i++) if (asc[i].high > headHigh) { headHigh = asc[i].high; headIdx = i; }
  const pullbackDays = ci - headIdx;

  const rallyFrom = Math.max(0, headIdx - 40);
  let lowIdx = rallyFrom, lowLow = Infinity;
  for (let i = rallyFrom; i <= headIdx; i++) if (asc[i].low < lowLow) { lowLow = asc[i].low; lowIdx = i; }
  const priorRally = lowLow > 0 ? (headHigh / lowLow - 1) * 100 : null;

  const rallyVols = asc.slice(lowIdx, headIdx + 1).map((r) => r.vol);
  const pullVols = asc.slice(headIdx + 1, ci + 1).map((r) => r.vol);
  const rallyVol = F.mean(rallyVols);
  let noseVol = Infinity;
  for (let i = headIdx + 1; i + 2 <= ci; i++) noseVol = Math.min(noseVol, F.mean(asc.slice(i, i + 3).map((r) => r.vol)) || Infinity);
  const noseRatio = Number.isFinite(noseVol) && rallyVol > 0 ? noseVol / rallyVol : null;

  const pullCloses = asc.slice(headIdx + 1, ci + 1).map((r, j) => {
    const m = ser.ma60[headIdx + 1 + j];
    return m > 0 ? r.close / m : null;
  }).filter((v) => v != null);
  const minVsMA60 = pullCloses.length ? Math.min(...pullCloses) : null;

  const back = g.mouthLookback || 5;
  let mouth = false;
  for (let i = Math.max(1, ci - back + 1); i <= ci; i++) {
    if (ser.ma5[i] > 0 && ser.ma10[i] > 0 && ser.ma5[i - 1] > 0 && ser.ma10[i - 1] > 0
      && ser.ma5[i] > ser.ma10[i] && ser.ma5[i - 1] <= ser.ma10[i - 1]) { mouth = true; break; }
  }

  const ma60Rise = ser.ma60[ci] > 0 && ser.ma60[ci - 10] > 0 ? (ser.ma60[ci] / ser.ma60[ci - 10] - 1) * 100 : null;
  const recent3 = F.mean(asc.slice(Math.max(0, ci - 2), ci + 1).map((r) => r.vol));
  const volRecover = F.mean(pullVols) > 0 ? recent3 / F.mean(pullVols) : null;
  const nearHigh = headHigh > 0 ? (asc[ci].close / headHigh - 1) * 100 : null;

  const holdBuf = 1 - (g.holdMA60BufferPct || 4) / 100;
  const gates = [
    gate('ma60Up', ma60Rise != null && ma60Rise >= (g.ma60RiseMinPct || 0.5), ma60Rise, `≥${g.ma60RiseMinPct || 0.5}%`),
    gate('pullbackDays', pullbackDays >= (g.pullbackMinDays || 5) && pullbackDays <= (g.pullbackMaxDays || 28), pullbackDays, `${g.pullbackMinDays || 5}~${g.pullbackMaxDays || 28}`),
    gate('priorRally', priorRally != null && priorRally >= (g.priorRallyMinPct || 12), priorRally, `≥${g.priorRallyMinPct || 12}%`),
    gate('noseVolume', noseRatio != null && noseRatio <= (g.noseVolRatioMax || 0.7), noseRatio, `≤${g.noseVolRatioMax || 0.7}x`),
    gate('holdMA60', minVsMA60 != null && minVsMA60 >= holdBuf, minVsMA60, `≥${holdBuf.toFixed(2)}`),
    gate('duckMouth', mouth, mouth, 'MA5 上穿 MA10'),
    gate('nearHigh', nearHigh != null && nearHigh >= -(g.breakoutNearHighPct || 10), nearHigh, `≥-${g.breakoutNearHighPct || 10}%`),
    gate('volRecover', volRecover != null && volRecover >= (g.volRecoverMin || 1.0), volRecover, `≥${g.volRecoverMin || 1.0}x`),
  ];
  const hit = gates.every((x) => x.ok);
  let bonus = 0;
  if (hit) {
    bonus += Math.min(8, ((priorRally / (g.priorRallyMinPct || 12)) - 1) * 8);
    bonus += Math.min(6, Math.max(0, (nearHigh + (g.breakoutNearHighPct || 10)) / (g.breakoutNearHighPct || 10) * 6));
    bonus += Math.min(6, Math.max(0, (volRecover - 1) * 10));
  }
  return {
    hit,
    score: hit ? Math.min(100, +(80 + bonus).toFixed(1)) : 0,
    gates,
    features: { priorRally, pullbackDays, noseRatio, ma60Rise, volRecover, nearHigh, minVsMA60 },
    window: {
      startDate: asc[headIdx].date, endDate: asc[ci].date,
      windowDays: pullbackDays + 1, launchDate: asc[lowIdx].date,
      launchChgPct: null, launchVolX: null,
      boxHigh: headHigh, boxLow: lowLow,
      minClose: Math.min(...asc.slice(headIdx, ci + 1).map((r) => r.close)),
      price: asc[ci].close, ma20: ser.ma20[ci], ma60: ser.ma60[ci],
    },
  };
}

/** VCP：三段波动/量能逐级收缩 + 均线粘合 + 单日放量突破平台上沿 */
function ruleVCP(asc, ser, def, code) {
  const g = def.gates || {};
  const ci = asc.length - 1;
  const baseDays = g.baseDays || 45;
  if (ci < baseDays + 5) return null;
  const segN = g.segments || 3;
  const segLen = Math.floor(baseDays / segN);
  const amps = [], vols = [];
  // 收缩段仅度量「整理区间」(ci-baseDays .. ci-1)，刻意排除突破日 ci：
  // 突破日通常是放量长阳，若并入末段会把末段振幅/量抬高，导致 contractAmp/contractVol
  // 永不成立，使真正的 VCP 突破反而判不中。突破日仍留在 window 内供 breakout/baseChg/aboveMA 判定。
  const baseStart = ci - baseDays;
  for (let s = 0; s < segN; s++) {
    const seg = asc.slice(baseStart + s * segLen, baseStart + (s + 1) * segLen);
    if (!seg.length) return null;
    const hi = Math.max(...seg.map((r) => r.high));
    const lo = Math.min(...seg.map((r) => r.low));
    amps.push(lo > 0 ? (hi - lo) / lo * 100 : null);
    vols.push(F.mean(seg.map((r) => r.vol)));
  }
  const ampRatio = g.ampShrinkRatio || 0.9;
  const volRatio = g.volShrinkRatio || 1.0;
  const contractAmp = amps.every((a, i) => a != null && (i === 0 || a <= amps[i - 1] * ampRatio));
  const contractVol = vols.every((v, i) => v != null && (i === 0 || v <= vols[i - 1] * volRatio));

  const mas = [ser.ma5[ci], ser.ma10[ci], ser.ma20[ci], ser.ma60[ci]].filter((v) => v > 0);
  const glue = mas.length === 4 ? (Math.max(...mas) - Math.min(...mas)) / Math.min(...mas) * 100 : null;

  const lb = g.breakoutLookback || 20;
  const priorHigh = Math.max(...asc.slice(ci - lb, ci).map((r) => r.high));
  const volX = ser.volMa5[ci] > 0 ? asc[ci].vol / ser.volMa5[ci] : null;
  const chg = ser.chg[ci];
  const breakout = asc[ci].close >= priorHigh * 0.995
    && chg != null && chg >= (g.breakoutChgMin || 2)
    && volX != null && volX >= (g.breakoutVolX || 1.3);
  const baseChg = (asc[ci].close / asc[ci - baseDays].close - 1) * 100;
  const above = ser.ma20[ci] > 0 && ser.ma60[ci] > 0 && asc[ci].close > ser.ma20[ci] && ser.ma20[ci] > ser.ma60[ci];

  const gates = [
    gate('ampContract', contractAmp, amps, `逐级 ≤${ampRatio}x`),
    gate('volContract', contractVol, vols, `逐级 ≤${volRatio}x`),
    gate('maGlue', glue != null && glue <= (g.maGlueMaxPct || 8), glue, `≤${g.maGlueMaxPct || 8}%`),
    gate('breakout', breakout, { chg, volX, priorHigh, close: asc[ci].close }, `破${lb}日高 + 量≥${g.breakoutVolX || 1.3}x`),
    gate('baseChg', baseChg >= (g.baseChgMin || -18) && baseChg <= (g.baseChgMax || 32), baseChg, `${g.baseChgMin || -18}~${g.baseChgMax || 32}%`),
    gate('aboveMA', above, { ma20: ser.ma20[ci], ma60: ser.ma60[ci] }, 'close>MA20>MA60'),
  ];
  const hit = gates.every((x) => x.ok);
  const bonus = hit
    ? Math.min(20, Math.max(0, (volX - (g.breakoutVolX || 1.3)) * 8) + Math.max(0, (chg - (g.breakoutChgMin || 2)) * 2))
    : 0;
  const base = asc.slice(ci - baseDays + 1, ci + 1);
  return {
    hit,
    score: hit ? Math.min(100, +(80 + bonus).toFixed(1)) : 0,
    gates,
    features: { amps, vols, glue, breakoutVolX: volX, breakoutChg: chg, baseChg, priorHigh },
    window: {
      startDate: asc[ci - baseDays + 1].date, endDate: asc[ci].date,
      windowDays: baseDays, launchDate: asc[ci].date,
      launchChgPct: chg, launchVolX: volX,
      boxHigh: Math.max(...base.map((r) => r.high)),
      boxLow: Math.min(...base.map((r) => r.low)),
      minClose: Math.min(...base.map((r) => r.close)),
      price: asc[ci].close, ma20: ser.ma20[ci], ma60: ser.ma60[ci],
    },
  };
}

const RULES = { duckHead: ruleDuckHead, vcp: ruleVCP };

/** 由特征判阶段；破位样本保留但由主流程默认排除 */
function stageOf(f, windowDays) {
  if (f.minVsMA20 != null && f.minVsMA20 < -9) return '已破位';
  if (f.aboveMA20Now != null && f.aboveMA20Now < -6) return '已破位';
  if (windowDays <= 2) return '启动当日';
  if (f.recentSurge) return '二次启动';
  return '整理蓄势';
}

/**
 * 对单只票跑全部形态。
 * @returns {Array} 命中列表（含分项得分/门槛明细），已按分数降序；未命中为空数组
 */
function matchAll(asc, ser, defs, cfg, code) {
  const out = [];
  const ci = asc.length - 1;
  for (const def of defs.patterns) {
    if (def.engine === 'template') {
      const wmin = (def.window && def.window.minDays) || 6;
      const wmax = (def.window && def.window.maxDays) || 45;
      let best = null;
      for (const lc of F.launchCandidates(asc, ser, def.launch)) {
        const W = ci - lc.li + 1;
        if (W < wmin || W > wmax) continue;
        const f = F.features(asc, ser, lc.li, code);
        if (!f) continue;
        const sc = scoreTemplate(f, def);
        if (!best || sc.score > best.score) {
          best = { score: sc.score, parts: sc.parts, f, W };
        }
      }
      if (!best) continue;
      const stage = stageOf(best.f, best.W);
      out.push({
        id: def.id, name: def.name, nameEn: def.nameEn, engine: 'template',
        score: best.score, stage,
        featureScores: best.parts,
        features: Object.fromEntries(Object.entries(best.f).filter(([k]) => k !== '_meta')),
        gates: [],
        window: best.f._meta,
      });
    } else {
      const fn = RULES[def.rule];
      if (!fn) { console.warn(`[matchAll] 跳过未注册规则形态 ${def.id} → ${def.rule}`); continue; }
      const r = fn(asc, ser, def, code);
      if (!r || !r.hit) continue;
      out.push({
        id: def.id, name: def.name, nameEn: def.nameEn, engine: 'rule',
        score: r.score, stage: def.rule === 'vcp' ? '启动当日' : '二次启动',
        featureScores: {}, features: r.features, gates: r.gates,
        window: r.window,
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** 参考价位：支撑位取「窗口最低收盘」与「MA20×0.98」的较高者，且不高于现价×0.98 */
function priceLevels(window, cfg) {
  const p = cfg.price;
  const price = window && window.price;
  if (!Number.isFinite(price) || price <= 0) return null;
  const ma20 = window.ma20;
  const minClose = window.minClose;
  let support = Math.max(Number.isFinite(minClose) ? minClose : 0, Number.isFinite(ma20) ? ma20 * 0.98 : 0);
  if (!(support > 0)) support = price * 0.95;
  support = Math.min(support, price * 0.98);
  const chasePct = (price / support - 1) * 100;
  const status = chasePct > p.maxChasePct ? '等回踩' : '可观察';
  const buyLow = support;
  const buyHigh = status === '等回踩' ? support * 1.02 : price * (1 + p.chasePct / 100);
  const stopLoss = support * (1 - p.stopBufferPct / 100);
  const takeProfit = price + (price - stopLoss) * p.rewardRatio;
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    buyLow: r2(buyLow), buyHigh: r2(Math.max(buyLow, buyHigh)),
    stopLoss: r2(stopLoss), takeProfit: r2(takeProfit),
    support: r2(support), chasePct: +chasePct.toFixed(1),
    status, rewardRatio: p.rewardRatio,
  };
}

/** 汇总一只票：主形态 / 共振数 / 综合分 */
function summarize(matches, cfg) {
  if (!matches.length) return null;
  const primary = matches[0];
  const resonance = matches.length;
  const total = Math.min(100, +(primary.score + (resonance - 1) * 4).toFixed(1));
  return {
    primary, resonance, total,
    patternIds: matches.map((m) => m.id),
    patternNames: matches.map((m) => m.name),
    stage: primary.stage,
    price: priceLevels(primary.window, cfg),
  };
}

module.exports = {
  loadDefs, scoreTemplate, tolOf, matchAll, priceLevels, summarize,
  ruleDuckHead, ruleVCP, stageOf, RULES, TOL_FLOOR,
};
