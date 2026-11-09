'use strict';
/*
 * eod/nextday.config.js —— 统一次日回填（T+1/T+3 表现判定）配置
 * ---------------------------------------------------------------------------
 * 归属：批次 A3（2026-11-09 方案）。调度：工作日 18:30（盘前回填 18:00 → 游资 18:20 → 本任务）。
 * 三类归档的 verdicts 口径：
 *   tail     尾盘 eod-<日>.json（含 -obs）  basis = 记录 price（14:50 可成交价）
 *   nextday  次日选股 data/snapshot-<日>.json basis = T+1 开盘（16:00 出报告，次日买）
 *   hotmoney 游资 hotmoney-<日>.json          basis = T+1 开盘（榜单 17:00 后出，次日买）
 * ---------------------------------------------------------------------------
 */
module.exports = {
  version: '1.0.0',

  // 回扫窗口（交易日 = 有归档文件的日子）：每天顺带补齐，永远追最近 N 天
  window: { days: 10 },

  // 命中阈值（占比）：T+1 收盘 / basis − 1 ≥ 2% 记命中；T+3 同阈值
  thresholds: { t1HitMin: 0.02, t3HitMin: 0.02 },

  // fqkline 为逐票请求（腾讯，无东财封 IP 风险）；并发对齐 preopen 的 6
  concurrency: 6,

  // 数据源失败率红线：K线抓取失败占比超过此值时，不写回归档/不覆盖 perf-weekly，
  // 并以非零退出码告警（否则「腾讯端点全挂」会被当成「待次日」静默通过）。
  // 与 tail.config.market.maxBatchFailRate 同一范式，见 01-标准与流程.md §1.3。
  maxKlineFailRate: 0.3,

  store: {
    // 滚动聚合产物（按管道 × 命中率），周六简报（批次 D）从这读
    perfFile: 'perf-weekly.json',
  },
};
