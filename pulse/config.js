'use strict';
/*
 * pulse/config.js —— 消息脉搏模块配置（阈值/窗口/路径集中管理）
 */
const path = require('path');
const paths = require('../paths');

const PKG_ROOT = paths.PKG_ROOT;
const DATA_DIR = path.join(PKG_ROOT, 'pulse', 'data');
const REPORT_DIR = path.join(PKG_ROOT, 'pulse', 'report');

module.exports = {
  DATA_DIR,
  REPORT_DIR,

  // 新闻回看窗口（小时）：只统计窗口内的消息
  LOOKBACK_HOURS: 24,
  // 单源单轮最多条数（金十源上限约 50）
  NEWS_LIMIT: 60,

  // 信源权重（交叉验证计分用）
  SOURCE_WEIGHTS: { sina: 1.0, em: 1.0, jin10: 0.8, wscn: 0.8 },
  SOURCE_LABELS: { sina: '新浪7×24', em: '东财快讯', jin10: '金十数据', wscn: '华尔街见闻' },

  // 板块热度分中行情项占比
  FLOW_TOP_N: 20,          // 主力净流入前 N 名计入排名分
  PCT_ALERT: 2.0,          // 板块涨幅 >= 2% 视为纯行情异动
  VERIFY_A_SOURCES: 3,     // >=3 源 → 验证级别 A

  // watch
  WATCH_INTERVAL_MIN: 3,       // 上一轮完成后计时 N 分钟再跑下一轮
  WATCH_ACTIVE_FROM: '08:30',  // 交易日活跃窗口（本地时间），窗口外静默
  WATCH_ACTIVE_TO: '15:35',
  // 通知阈值：新增热点需满足其一
  NOTIFY_MIN_SCORE: 8,         // 板块热度分下限
  NOTIFY_PCT_DELTA: 1.0,       // 相比上一轮涨幅跳升（百分点）
  NOTIFY_NEW_VERIFY: 2,        // 新话题需 >=2 源验证
  NOTIFY_COOLDOWN_MIN: 20,     // 同板块通知冷却（分钟），防止榜缘进出反复弹

  // 保留上限：超量清理旧快照/旧报告（单位：天，按日期目录滚动）
  KEEP_SNAPSHOTS: 60,
  KEEP_REPORTS: 60,

  // 巨潮公告标题关键词过滤（只保留事件类，过滤海量例行披露）
  CNINFO_TITLE_KEYS: ['中标', '回购', '增持', '减持', '重组', '并购', '终止', '问询', '业绩', '预盈', '预亏', '涨停', '异动', '立案', '处罚', '澄清', '签订', '合同', '战略合作', '分红', '停牌', '复牌', '摘牌', '退市', '立案', '警示'],
};
