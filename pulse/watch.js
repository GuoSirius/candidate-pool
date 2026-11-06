'use strict';
/*
 * pulse/watch.js —— 常驻监听：每轮跑完后计时 WATCH_INTERVAL_MIN 分钟再跑下一轮。
 * 与上一轮对比，发现「新热点」才弹系统通知（Windows Toast），无新异动保持静默。
 * 交易日活跃窗口外（默认 08:30–15:35）静默不请求。
 * 用法：node pulse/watch.js（手动启动，Ctrl+C 退出）
 */
const dayjs = require('dayjs');
const cfg = require('./config');
const { runOnce } = require('./run');
const { notify } = require('./notify_win');
const store = require('./lib/store');

const now = () => dayjs().format('YYYY-MM-DD HH:mm:ss');

/** 交易日活跃窗口判断（周一~周五） */
function isActive() {
  const d = dayjs();
  if (d.day() === 0 || d.day() === 6) return false;
  const hm = d.format('HH:mm');
  return hm >= cfg.WATCH_ACTIVE_FROM && hm <= cfg.WATCH_ACTIVE_TO;
}

/** 与上一轮状态对比，产出新异动事件列表 */
function diffEvents(analysis, state) {
  const events = [];
  const prevNames = new Set((state.hotBoards || []).map((b) => b.name));
  const prevPct = state.boardPct || {};

  for (const b of analysis.hotBoards) {
    // 1) 新出现的多源验证热点（上轮不在榜）
    if (b.sourceCount >= cfg.NOTIFY_NEW_VERIFY && !prevNames.has(b.name) && b.score >= cfg.NOTIFY_MIN_SCORE) {
      events.push(`新热点 ${b.name}：${b.verify} 级验证(${b.sourceCount}源) 分${b.score}${b.pct != null ? ` 涨${b.pct}%` : ''}${b.flow != null ? ` 主力+${b.flow}亿` : ''}`);
      continue;
    }
    // 2) 涨幅相对上轮跳升（异动加速）
    const prev = prevPct[b.name];
    if (b.pct != null && prev != null && b.pct - prev >= cfg.NOTIFY_PCT_DELTA && b.score >= cfg.NOTIFY_MIN_SCORE) {
      events.push(`加速异动 ${b.name}：${prev.toFixed(1)}% → ${b.pct}%（+${(b.pct - prev).toFixed(1)}pp）${b.flow != null ? ` 主力+${b.flow}亿` : ''}`);
    }
  }
  return events;
}

function buildState(analysis) {
  return {
    updatedAt: Date.now(),
    hotBoards: analysis.hotBoards.slice(0, 15).map((b) => ({ name: b.name, score: b.score })),
    boardPct: Object.fromEntries(analysis.hotBoards.filter((b) => b.pct != null).map((b) => [b.name, b.pct])),
  };
}

async function round() {
  const state = store.loadState();
  const { snapshot, analysis } = await runOnce();
  // 首轮（无基准状态）只建基准不通知，避免启动即弹屏
  const events = state.updatedAt ? diffEvents(analysis, state) : [];
  if (events.length) {
    notify(`A股消息脉搏 · ${events.length} 条新异动`, events.slice(0, 3).join('；'));
  }
  store.saveState(buildState(analysis));
  return { events, snapshot };
}

if (require.main === module) (async () => {
  console.log(`[watch] 启动：每轮完成后计时 ${cfg.WATCH_INTERVAL_MIN} 分钟；活跃窗口 ${cfg.WATCH_ACTIVE_FROM}-${cfg.WATCH_ACTIVE_TO}（工作日）`);
  for (;;) {
    if (!isActive()) {
      console.log(`[${now()}] 窗口外静默，${cfg.WATCH_INTERVAL_MIN} 分钟后复查`);
      await new Promise((r) => setTimeout(r, cfg.WATCH_INTERVAL_MIN * 60e3));
      continue;
    }
    const t0 = Date.now();
    let ok = true;
    try { await round(); } catch (e) { ok = false; console.error(`[${now()}] 本轮失败: ${e.message}`); }
    const cost = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[${now()}] 轮次完成（${cost}s）${ok ? '' : ' [有错误]'}，${cfg.WATCH_INTERVAL_MIN} 分钟后开始下一轮`);
    await new Promise((r) => setTimeout(r, cfg.WATCH_INTERVAL_MIN * 60e3));
  }
})();

module.exports = { diffEvents };
