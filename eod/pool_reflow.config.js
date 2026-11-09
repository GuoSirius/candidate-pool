'use strict';
/*
 * eod/pool_reflow.config.js —— 观察池回流（批次 C2）配置
 * ---------------------------------------------------------------------------
 * 数据安全契约（用户 2026-11-09 拍板）：允许扩 meta，但必须「及时、可靠、稳定、不丢失」；
 * 默认不设上限、只出 diff、不推送。因此本配置的默认值全部取最保守一档：
 *   - 默认 dry-run，只有显式 --apply 才写 candidates.json；
 *   - --apply 也**只追加**，代码里根本没有删除路径（retireEnabled 仅作占位说明）；
 *   - 存量 378 只手工观察池零改动（tagLegacy=false），meta 只出现在本次新增票上；
 *     随着时间自然分批，不做一次性 migration，避免批量改坏老数据。
 * ---------------------------------------------------------------------------
 */
module.exports = {
  version: '1.0.0',

  // 回看最近 N 个「有归档」的交易日。多天回看保证漏跑一天也能补上信号（及时性）。
  window: { days: 5 },

  sources: {
    // 尾盘正式档 TopN 且 T+1 命中（口径：按 total 降序取前 N，再要求 verdicts.t1.hit）
    tailTopHit: { enabled: true, topN: 10 },
    // 16:00 次日快照里 R01 触发的票
    r01: { enabled: true },
    // 一线游资介入（tier 精确匹配；「避坑」「二线」不算入池信号）
    hotmoneyT1: { enabled: true, tier: '一线' },
    // 盘前超预期（label 白名单）
    preopenBeat: { enabled: true, labels: ['超预期'] },
  },

  write: {
    maxSize: 0,           // 0 = 不设上限（用户拍板）
    retireEnabled: false, // 永久关闭；脚本内无删除实现，保留字段仅为口径留痕
    tagLegacy: false,     // 存量票零改动；改 true 前必须先 dry-run 审核 diff
  },

  report: { dir: 'eod/reports/pool_reflow' },
};
