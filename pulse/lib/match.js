'use strict';
/*
 * pulse/lib/match.js —— 词典匹配：新闻文本 → 板块/行业/个股
 * 词典来源：东财板块快照（行业+概念名）+ eod 行业映射（个股名、东财行业）。
 * 复用 eod/lib/sector.js 的 loadIndustryMap（含包内种子兜底）。
 */
const sectorLib = require('../../eod/lib/sector');

/** 构建词典：{ boards:[name], sectors:[name], stocks:[{name,code,sector}] }，长名优先匹配 */
function buildDict(boards, industryMap) {
  const sectors = new Set();
  for (const s of Object.values(industryMap.stocks)) if (s.sector) sectors.add(s.sector);
  const stocks = Object.entries(industryMap.stocks)
    .map(([code, s]) => ({ name: s.name, code, sector: s.sector || '' }))
    .filter((s) => s.name && s.name.length >= 2);
  const boardNames = boards.map((b) => b.name).filter((n) => n && n.length >= 2);
  return {
    boards: [...new Set(boardNames)].sort((a, b) => b.length - a.length),
    sectors: [...sectors].sort((a, b) => b.length - a.length),
    stocks: stocks.sort((a, b) => b.name.length - a.name.length),
  };
}

/**
 * 匹配一条新闻文本，返回 { boards:Set, sectors:Set, stocks:[{code,name,sector}] }
 * 板块/行业/个股名做子串匹配；命中个股同时计入其所属行业。
 */
function matchText(text, dict) {
  const hit = { boards: new Set(), sectors: new Set(), stocks: [] };
  if (!text) return hit;
  for (const n of dict.boards) if (text.includes(n)) hit.boards.add(n);
  for (const n of dict.sectors) if (text.includes(n)) hit.sectors.add(n);
  for (const s of dict.stocks) {
    if (text.includes(s.name)) { hit.stocks.push(s); if (s.sector) hit.sectors.add(s.sector); }
  }
  return hit;
}

/** 加载行业映射（降级安全） */
function loadMap() { return sectorLib.loadIndustryMap(); }

module.exports = { buildDict, matchText, loadMap };
