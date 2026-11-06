'use strict';
/*
 * pulse/watch.js —— 常驻监听：每轮跑完后计时 WATCH_INTERVAL_MIN 分钟再跑下一轮。
 * 与上一轮对比，发现新事件才弹系统通知（Windows Toast），无新异动保持静默。
 * 事件分两类（语义区分，避免"下跌也叫热点"的误导）：
 *   - 消息热点：多源交叉验证的新话题（方向不明，播报带涨跌/资金方向，|涨跌|>=1% 标"共振"）
 *   - 行情异动：涨幅相对上轮跳升（明确的盘中加速信号）
 * 防打扰：同板块通知冷却 NOTIFY_COOLDOWN_MIN 分钟（防榜缘进出反复弹）；首轮只建基准不通知。
 * 交易日活跃窗口外（默认 08:30–15:35）静默不请求。
 * 每轮打印结构化摘要（信源/消息面/热点/通知），ANSI 颜色仅 TTY（重定向日志自动纯文本）。
 * 用法：node pulse/watch.js（手动启动，Ctrl+C 退出）
 */
const dayjs = require('dayjs');
const cfg = require('./config');
const { runOnce } = require('./run');
const { notify } = require('./notify_win');
const store = require('./lib/store');
const ui = require('./lib/ui');

const now = () => dayjs().format('HH:mm:ss');
let roundNo = 0;

/** 交易日活跃窗口判断（周一~周五） */
function isActive() {
  const d = dayjs();
  if (d.day() === 0 || d.day() === 6) return false;
  const hm = d.format('HH:mm');
  return hm >= cfg.WATCH_ACTIVE_FROM && hm <= cfg.WATCH_ACTIVE_TO;
}

/** 资金方向文案：>0 净流入，<0 净流出 */
function flowText(flow) {
  if (flow == null || flow === 0) return '';
  return flow > 0 ? ` 主力净流入${flow}亿` : ` 主力净流出${Math.abs(flow)}亿`;
}

/** 涨跌文案：带方向箭头 ▲▼（GBK 安全，Toast 也能正常显示） */
function pctText(pct) {
  if (pct == null) return '';
  return ` 涨${pct >= 0 ? '▲' : '▼'}${Math.abs(pct)}%`;
}

/**
 * 与上一轮状态对比，产出新事件列表。
 * 会就地更新 state.notified（冷却时间戳），由 buildState 持久化。
 */
function diffEvents(analysis, state) {
  const events = [];
  const prevNames = new Set((state.hotBoards || []).map((b) => b.name));
  const prevPct = state.boardPct || {};
  const notified = state.notified || (state.notified = {});
  const cooldownMs = cfg.NOTIFY_COOLDOWN_MIN * 60e3;
  const nowTs = Date.now();

  for (const b of analysis.hotBoards) {
    // 1) 行情异动：涨幅相对上轮跳升（加速信号，不受冷却限制）
    const prev = prevPct[b.name];
    if (b.pct != null && prev != null && b.pct - prev >= cfg.NOTIFY_PCT_DELTA && b.score >= cfg.NOTIFY_MIN_SCORE) {
      events.push(`行情异动 ${b.name}：${prev.toFixed(1)}% → ${b.pct}%（+${(b.pct - prev).toFixed(1)}pp）${flowText(b.flow)}`);
      continue;
    }
    // 2) 消息热点：新出现的多源交叉验证话题 + 冷却期内不重复报
    if (b.sourceCount >= cfg.NOTIFY_NEW_VERIFY && !prevNames.has(b.name) && b.score >= cfg.NOTIFY_MIN_SCORE) {
      if (notified[b.name] && nowTs - notified[b.name] < cooldownMs) continue;
      notified[b.name] = nowTs;
      const kind = b.pct != null && Math.abs(b.pct) >= 1 ? '消息+行情共振' : '消息热点';
      events.push(`${kind} ${b.name}：${b.verify} 级验证(${b.sourceCount}源) 分${b.score}${pctText(b.pct)}${flowText(b.flow)}`);
    }
  }
  return events;
}

function buildState(analysis, prevState) {
  return {
    updatedAt: Date.now(),
    hotBoards: analysis.hotBoards.slice(0, 25).map((b) => ({ name: b.name, score: b.score })),
    boardPct: Object.fromEntries(analysis.hotBoards.filter((b) => b.pct != null).map((b) => [b.name, b.pct])),
    notified: (prevState && prevState.notified) || {},
  };
}

/** 每轮结构化摘要（分块 + 着色，重定向日志时自动纯文本） */
function printRound({ snapshot, analysis, events }, costS, hasError) {
  roundNo++;
  const failed = Object.values(snapshot.sourcesStatus).filter((v) => !v.startsWith('OK')).length;
  console.log(`${ui.gray(ui.LINE)}`);
  console.log(` ${ui.cyan(now())}  ${ui.bold('消息脉搏')} 第${roundNo}轮  ${failed ? ui.red(`${failed} 源失败`) : ui.green('信源全通')}  ${ui.gray(`${costS}s`)}`);
  console.log(` ${ui.gray('信源')}   ${ui.sourcesLine(snapshot.sourcesStatus, { boards: '板块', ...cfg.SOURCE_LABELS })}`);
  console.log(` ${ui.gray('消息面')} ${analysis.windowCount} 条 / ${analysis.lookbackHours}h   ${ui.gray('公告')} ${snapshot.announces.length} 条`);
  console.log(` ${ui.gray('热点')}   ${ui.hotText(analysis.hotBoards, 4) || ui.gray('无')}`);
  if (events.length) {
    console.log(` ${ui.gray('通知')}   ${events.length} 条新异动`);
    for (const e of events) console.log(`          ${ui.colorEvent(e)}`);
  }
  if (hasError) console.log(` ${ui.red('本轮执行有错误，详见上方日志')}`);
}

async function round() {
  const state = store.loadState();
  const { snapshot, analysis } = await runOnce();
  // 首轮（无基准状态）只建基准不通知，避免启动即弹屏
  const events = state.updatedAt ? diffEvents(analysis, state) : [];
  store.saveState(buildState(analysis, state));
  if (events.length) {
    notify(`A股消息脉搏 · ${events.length} 条新异动`, events.slice(0, 3).join('；'));
  }
  return { events, snapshot, analysis };
}

if (require.main === module) (async () => {
  console.log(`${ui.gray(ui.LINE)}`);
  console.log(` ${ui.bold('A股消息脉搏 · 常驻监听')}  每轮完成后计时 ${cfg.WATCH_INTERVAL_MIN} 分钟`);
  console.log(` ${ui.gray('活跃窗口')} ${cfg.WATCH_ACTIVE_FROM}-${cfg.WATCH_ACTIVE_TO}（工作日）  ${ui.gray('归档')} pulse/{data,report}  ${ui.gray('停止')} Ctrl+C`);
  for (;;) {
    if (!isActive()) {
      console.log(` ${ui.dim(`${now()}  窗口外静默，${cfg.WATCH_INTERVAL_MIN} 分钟后复查`)}`);
      await new Promise((r) => setTimeout(r, cfg.WATCH_INTERVAL_MIN * 60e3));
      continue;
    }
    const t0 = Date.now();
    let ok = true;
    let result;
    try { result = await round(); } catch (e) { ok = false; console.error(` ${ui.red(`[${now()}] 本轮失败: ${e.message}`)}`); }
    if (result) printRound(result, ((Date.now() - t0) / 1000).toFixed(1), !ok);
    await new Promise((r) => setTimeout(r, cfg.WATCH_INTERVAL_MIN * 60e3));
  }
})();

module.exports = { diffEvents };
