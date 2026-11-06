'use strict';
/*
 * pulse/collect.js —— 并行采集所有源，单源失败不影响整体（错误记入 sourcesStatus）。
 * 输出 snapshot 骨架：{ runAt, news, boards, announces, sourcesStatus }
 */
const cfg = require('./config');
const news = require('./sources/news');
const market = require('./sources/market');
const announce = require('./sources/announce');
const { mapLimit } = require('../eod/lib/http');

// 给热度前 N 的板块拉成分领涨股（与 FLOW_TOP_N 对齐，资金流榜单规模一致）
const LEADER_BOARDS = cfg.FLOW_TOP_N;

const fmtBJ = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');

/** 安全执行：成功返回 {ok,data}，失败返回 {ok:false,error} */
async function guard(name, fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

async function collect() {
  const N = cfg.NEWS_LIMIT;
  const [sina, em, jin10, wscn, boards, ann] = await Promise.all([
    guard('sina', () => news.fetchSina(N)),
    guard('em', () => news.fetchEastmoney(N)),
    guard('jin10', () => news.fetchJin10(N)),
    guard('wscn', () => news.fetchWscn(N)),
    guard('boards', () => market.fetchBoards()),
    guard('cninfo', () => announce.fetchAnnouncements(30, cfg.CNINFO_TITLE_KEYS)),
  ]);

  const sourcesStatus = {
    sina: sina.ok ? `OK ${sina.data.length}条` : `FAIL ${sina.error}`,
    em: em.ok ? `OK ${em.data.length}条` : `FAIL ${em.error}`,
    jin10: jin10.ok ? `OK ${jin10.data.length}条` : `FAIL ${jin10.error}`,
    wscn: wscn.ok ? `OK ${wscn.data.length}条` : `FAIL ${wscn.error}`,
    boards: boards.ok ? `OK ${boards.data.length}个板块` : `FAIL ${boards.error}`,
    cninfo: ann.ok ? `OK ${ann.data.length}条` : `FAIL ${ann.error}`,
  };

  const newsItems = [
    ...(sina.ok ? sina.data : []),
    ...(em.ok ? em.data : []),
    ...(jin10.ok ? jin10.data : []),
    ...(wscn.ok ? wscn.data : []),
  ].filter((x) => x.timeMs > 0).sort((a, b) => b.timeMs - a.timeMs);

  return {
    runAt: Date.now(),
    runAtText: fmtBJ(Date.now()),
    sourcesStatus,
    news: newsItems,
    boards: boards.ok ? boards.data : [],
    announces: ann.ok ? ann.data : [],
    errors: [sina, em, jin10, wscn, boards, ann].filter((r) => !r.ok).map((r) => r.error),
  };
}

/**
 * 给热点板块补充成分领涨股（3-5 只，按涨幅降序）。
 * 只取热度榜前 LEADER_BOARDS 个、有板块代码的，控制请求数；单板块失败置空不影响整体。
 */
async function enrichLeaders(hotBoards) {
  const targets = hotBoards.filter((b) => b.code).slice(0, LEADER_BOARDS);
  const res = await mapLimit(targets, 4, (b) => market.fetchBoardLeaders(b.code, 5));
  const byCode = new Map(targets.map((b, i) => [b.code, res[i]]));
  for (const b of hotBoards) {
    const r = byCode.get(b.code);
    b.leaders = Array.isArray(r) ? r : [];
  }
  return hotBoards;
}

module.exports = { collect, enrichLeaders, fmtBJ };
