'use strict';
/*
 * pulse/analyze.js —— 交叉分析与热度评分
 *
 * 三步：
 *   1. 去重：同源去重（文本完全一致）；跨源重复保留（正是交叉验证的素材）
 *   2. 交叉验证：按板块聚合窗口内新闻，命中源数 >=2 视为「多源验证」
 *      验证级别：A(>=3源) / B(2源) / C(单源)
 *   3. 评分：板块热度分 = 消息权重 + 源覆盖分 + 资金流排名分 + 涨幅分 + 验证加成
 *      输出热点板块榜（消息驱动 + 纯行情异动两类）、个股榜（新闻命中 + 热点板块领涨股）
 */
const cfg = require('./config');
const { buildDict, matchText, loadMap } = require('./lib/match');

const flowYi = (v) => (typeof v === 'number' ? +(v / 1e8).toFixed(2) : null); // 元 → 亿

function analyze(snapshot) {
  const cutoff = snapshot.runAt - cfg.LOOKBACK_HOURS * 3600e3;
  const windowNews = snapshot.news.filter((n) => n.timeMs >= cutoff);

  // 1) 同源去重（保留时间最早一条）
  const seen = new Set();
  const deduped = windowNews.filter((n) => {
    const k = `${n.source}|${n.text}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  // 2) 词典与匹配
  const industryMap = loadMap();
  const dict = buildDict(snapshot.boards, industryMap);
  const byBoard = new Map();  // boardName -> { sources:Set, weight, items:[], pct, flow, lead, code }
  const stockHits = new Map(); // stockName -> { code, sector, sources:Set, boards:Set }

  // 巨潮公告并入评分流：官方信源（权重最高、计入多源验证），secCode 可直连个股
  const items = [
    ...deduped,
    ...snapshot.announces.map((a) => ({ source: 'cninfo', timeMs: a.timeMs, title: a.title, text: `${a.name} ${a.title}`, secCode: a.code })),
  ];

  // 巨潮 secCode（6 位）→ 行业映射键（带交易所前缀）
  const codeKey = (code) => /^6/.test(code) ? `sh${code}` : /^(0|3)/.test(code) ? `sz${code}` : /^(4|8|9)/.test(code) ? `bj${code}` : null;

  for (const n of items) {
    if (n.timeMs < cutoff) continue; // 公告可能来自昨日，窗口外不计
    // 时间衰减：越旧权重越低（24h 后只剩 25%），热度=新近度
    const ageH = Math.max(0, (snapshot.runAt - n.timeMs) / 3600e3);
    const w = (cfg.SOURCE_WEIGHTS[n.source] || 0.5) * Math.max(0.25, 1 - ageH / cfg.WEIGHT_DECAY_HOURS);
    const hit = matchText(`${n.title ? n.title + ' ' : ''}${n.text}`, dict);
    const touch = (name, meta) => {
      if (cfg.NOISE_BOARDS.includes(name)) return; // 属性/风格类伪板块不计分
      if (!byBoard.has(name)) byBoard.set(name, { name, sources: new Set(), weight: 0, items: [], ...meta });
      const b = byBoard.get(name);
      // 板块行情信息后到（sector 兜底先占位）时回填
      if (meta.pct != null && b.pct == null) { b.pct = meta.pct; b.flow = meta.flow; b.lead = meta.lead; b.code = meta.code || b.code; }
      b.sources.add(n.source); b.weight += w; b.items.push(n);
    };
    for (const bn of hit.boards) {
      const board = snapshot.boards.find((b) => b.name === bn);
      touch(bn, board ? { code: board.code, pct: board.pct, flow: board.flow, lead: board.lead } : {});
    }
    for (const sn of hit.stocks) {
      if (!stockHits.has(sn.name)) stockHits.set(sn.name, { name: sn.name, code: sn.code, sector: sn.sector, sources: new Set(), boards: new Set() });
      const s = stockHits.get(sn.name);
      s.sources.add(n.source);
      for (const bn of hit.boards) s.boards.add(bn);
    }
    // 公告：secCode 直连个股（公司简称可能不在词典/简称有差异，代码最可靠）
    if (n.secCode) {
      const key = codeKey(n.secCode);
      const s0 = key && industryMap.stocks[key];
      if (s0) {
        if (!stockHits.has(s0.name)) stockHits.set(s0.name, { name: s0.name, code: key, sector: s0.sector || '', sources: new Set(), boards: new Set() });
        const s = stockHits.get(s0.name);
        s.sources.add(n.source);
        if (s0.sector) s.boards.add(s0.sector);
      }
    }
    // 未命中任何板块的行业兜底：个股命中的行业
    for (const sec of hit.sectors) {
      if (![...hit.boards].some((b) => b === sec)) touch(sec, { pct: null, flow: null, lead: '' });
    }
  }

  // 3) 行情分：主力净流入排名（前 FLOW_TOP_N 递减给分）
  const flowRanked = snapshot.boards
    .filter((b) => typeof b.flow === 'number' && b.flow > 0)
    .sort((a, b) => b.flow - a.flow);
  const flowScore = new Map();
  flowRanked.slice(0, cfg.FLOW_TOP_N).forEach((b, i) => flowScore.set(b.name, cfg.FLOW_TOP_N - i));

  // 板块热度榜
  const hotBoards = [];
  for (const b of byBoard.values()) {
    const verified = b.sources.size >= 2;
    const level = b.sources.size >= cfg.VERIFY_A_SOURCES ? 'A' : verified ? 'B' : 'C';
    const pct = typeof b.pct === 'number' ? b.pct : null;
    const score = b.weight * 2 + b.sources.size * 1.5 + (flowScore.get(b.name) || 0) * 2
      + (pct !== null ? Math.max(0, Math.min(10, pct)) / 2 : 0)
      + (verified ? 2 : 0);
    hotBoards.push({
      name: b.name, code: b.code || '', score: +score.toFixed(1),
      sources: [...b.sources], sourceCount: b.sources.size, verify: level,
      weight: +b.weight.toFixed(1), pct, flow: flowYi(b.flow), lead: b.lead || '',
      items: b.items.slice(0, 8),
    });
  }
  // 纯行情异动：无消息命中但涨幅/资金流显著
  const newsBoardNames = new Set(hotBoards.map((b) => b.name));
  for (const b of snapshot.boards) {
    if (newsBoardNames.has(b.name)) continue;
    if (cfg.NOISE_BOARDS.includes(b.name)) continue; // 属性/风格类伪板块不入纯行情异动榜
    const pct = b.pct, flow = flowYi(b.flow);
    if (pct !== null && pct >= cfg.PCT_ALERT) {
      hotBoards.push({
        name: b.name, code: b.code, score: +(pct / 2 + (flowScore.get(b.name) || 0)).toFixed(1),
        sources: [], sourceCount: 0, verify: '-', weight: 0, pct, flow,
        lead: b.lead || '', items: [],
      });
    }
  }
  hotBoards.sort((a, b) => b.score - a.score);

  // 个股榜：新闻命中次数 + 热点板块领涨股加成
  const leadNames = new Set(hotBoards.slice(0, 10).map((b) => b.lead).filter(Boolean));
  const hotStocks = [];
  for (const s of stockHits.values()) {
    const score = s.sources.size * 2 + (leadNames.has(s.name) ? 3 : 0);
    hotStocks.push({ name: s.name, code: s.code, sector: s.sector, sources: [...s.sources], score, isLead: leadNames.has(s.name) });
  }
  for (const ln of leadNames) { // 领涨股即使没被新闻直接命中也上榜
    if (![...stockHits.values()].some((s) => s.name === ln)) {
      hotStocks.push({ name: ln, code: '', sector: '', sources: [], score: 3, isLead: true });
    }
  }
  hotStocks.sort((a, b) => b.score - a.score);

  return {
    windowCount: deduped.length,
    lookbackHours: cfg.LOOKBACK_HOURS,
    hotBoards: hotBoards.slice(0, cfg.TOP_BOARDS),
    hotStocks: hotStocks.slice(0, cfg.TOP_STOCKS),
  };
}

module.exports = { analyze };
