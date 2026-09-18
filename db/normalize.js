'use strict';
// 将一份初筛快照（data/snapshot-<锚定日>.json）规范化为入库结构。
// 关键：tier 由 r01/r07/r05 字段重新推导（快照里不含 tier，保证与流水线口径一致），
//      同票跨 run 自然成多行，满足「不同时期收录、全保留可区分」。

function tierOf(s) {
  const r = s.r01 || {};
  if (r.ok) return 'high';                                   // 重点关注：R01 四门槛全过
  if (r.capOk && r.highZoneOk && (r.core ?? 0) >= 2) {
    return (r.core >= 3) ? 'secondary' : 'conditional';      // 次级 / 条件
  }
  return 'excluded';
}

// 「是否入选」：只入库被分类的票（重点/次级/条件），或触发 R07 补涨 / R05 尾盘异动的票。
// 与用户要求一致——只保存分类(R01/R07/R05/重点、次级、条件)的票，不保存 377 只全部。
// 注意：R07/R05 是叠加在个股上的信号，可能单独触发（未达 R01 梯队），这类票 tier 记为 excluded
//       但 r07_laggard / r05_partial 标记为 1，前端据此仍能识别其入选维度。
function isPicked(s) {
  const r = s.r01 || {};
  if (r.ok) return true;                                              // 重点：R01 全过
  if (r.capOk && r.highZoneOk && (r.core ?? 0) >= 2) return true;     // 次级 / 条件
  if (s.r07 && s.r07.laggard) return true;                            // R07 板块内补涨
  if (s.r05 && s.r05.verdict === 'partial') return true;              // R05 尾盘异动部分触发
  return false;
}

function reasonOf(s) {
  const r = s.r01 || {};
  const parts = [];
  if (r.ok) parts.push('R01 量能验证突破（四门槛全过）');
  if (s.r07 && s.r07.laggard) parts.push('R07 板块内补涨滞后');
  if (s.r05 && s.r05.verdict === 'partial') parts.push('R05 尾盘量价达标（部分触发）');
  if (!parts.length) {
    if (r.capOk === false && r.mktCapYi != null) parts.push(`市值 ${Number(r.mktCapYi).toFixed(1)} 亿超出 20–500 亿区间`);
    else if (r.capOk === false && r.mktCapYi == null) parts.push('市值数据缺失');
    if (r.highZoneOk === false) parts.push('处于 52 周高位区');
    if ((r.core ?? 0) < 2) parts.push(`量价突破仅达成 ${r.core ?? 0}/4`);
    if (r.error) parts.push('行情数据缺失');
    if (s.r05 && s.r05.verdict === 'gap') parts.push('R05 分时数据缺口');
  }
  return parts.join('；') || '未触发';
}

// 入参 snap：{ anchor, target, stocks:[...], sectors:[...], ... }
function normalizeSnap(snap) {
  const { anchor, target, stocks = [] } = snap;
  const now = new Date().toISOString();
  const picks = [], prices = [], base = [];
  let high = 0, secondary = 0, conditional = 0, excluded = 0;
  let r01 = 0, r07 = 0, r05 = 0, err = 0;

  for (const s of stocks) {
    const r = s.r01 || {};
    const tier = tierOf(s);
    if (tier === 'high') high++;
    else if (tier === 'secondary') secondary++;
    else if (tier === 'conditional') conditional++;
    else excluded++;
    if (r.ok) r01++;
    if (s.r07 && s.r07.laggard) r07++;
    if (s.r05 && s.r05.verdict === 'partial') r05++;
    if (r.error) err++;
    if (!isPicked(s)) continue;   // 只入库被分类的票（重点/次级/条件/R07/R05），不保存全部 377 只

    picks.push({
      anchor_date: anchor, code: s.code, name: s.name,
      sector: s.sector || '未分类', tier,
      r01_ok: r.ok ? 1 : 0,
      r07_laggard: (s.r07 && s.r07.laggard) ? 1 : 0,
      r05_partial: (s.r05 && s.r05.verdict === 'partial') ? 1 : 0,
      core: r.core ?? null, r01_chg: r.chg ?? null, price: r.close ?? null,
      turnover: r.turn ?? null,
      circ_market_cap: r.circCapYi != null ? r.circCapYi * 1e8 : null,
      total_market_cap: r.mktCapYi != null ? r.mktCapYi * 1e8 : null,
      sector_pct: (s.r07 && s.r07.sectorPct) ?? null,
      sector_rank: (s.r07 && s.r07.sectorRank) ?? null,
      reason: reasonOf(s), picked_at: now,
    });

    prices.push({
      code: s.code, date: anchor, open: null, high: null, low: null,
      close: r.close ?? null, chg_pct: r.chg ?? null, turnover: r.turn ?? null,
      circ_market_cap: r.circCapYi != null ? r.circCapYi * 1e8 : null,
      total_market_cap: r.mktCapYi != null ? r.mktCapYi * 1e8 : null,
    });

    base.push({ code: s.code, name: s.name, sector: s.sector || '未分类', updated_at: now });
  }

  const run = {
    anchor_date: anchor, target_date: target, run_at: now,
    universe_count: stocks.length, r01_count: r01, r07_count: r07, r05_count: r05,
    high_count: high, secondary_count: secondary, conditional_count: conditional,
    excluded_count: excluded,
    kline_fail_rate: stocks.length ? err / stocks.length : null,
    source: 'tencent-live', note: '',
  };

  const seen = new Set();
  const baseUniq = base.filter(b => (seen.has(b.code) ? false : (seen.add(b.code), true)));
  return { run, picks, prices, base: baseUniq };
}

exports.normalizeSnap = normalizeSnap;
exports.tierOf = tierOf;
exports.reasonOf = reasonOf;
