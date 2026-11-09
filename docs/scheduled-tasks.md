# 本项目定时任务清单（本机 + 远程）

> 更新：2026-11-09。本机 Windows 计划任务：`pulse-watch`（登录触发，延迟 30s）——
> **已于 2026-11-09 禁用**（用户改为手动触发 `npm run pulse:watch`），其余调度走
> **WorkBuddy 任务**（本机执行）+ **GitHub Actions**（远程兜底）。
> 手动触发方式：WorkBuddy 任务列表中手动运行；GitHub Actions 用 workflow_dispatch。

## 一、本机 · WorkBuddy 任务（ACTIVE，工作日自动跑）

| 任务名 | 时间 | 执行内容 | 产物 / 日志 |
|---|---|---|---|
| 盘前基线预计算 | 03:00 | `node eod/preopen_screener.js --baseline`（全市场前一日 K 线指标缓存） | `eod/data/preopen/preopen-baseline-<日>.json`；日志 `eod/logs/preopen-<日期>.log` |
| 盘前纪要每日早间分析 | 08:30 | 盘前消息面分析（WorkBuddy 侧编排） | 见任务详情 |
| 盘前选股 | 09:25 | `node eod/preopen_screener.js`（9:20–9:35 时段守卫，竞价快照） | `eod/data/preopen/preopen-<日>.json` + `eod/reports/preopen/`；日志 `eod/logs/preopen-<日期>.log` |
| 早盘机会 | 10:30 | 盘中机会扫描（WorkBuddy 侧编排） | 见任务详情 |
| 午盘机会 | 11:30 | 同上（午盘时点） | 见任务详情 |
| 尾盘选股-观察模式 | 14:30 | `node eod/tail_screener.js --intraday`（盘中近似口径，不推送） | `eod/data/eod/eod-<日>-intraday.json`；日志 `eod/logs/tail-intraday-<日期>.log` |
| 尾盘选股-正式口径 | 14:50 | `node eod/tail_screener.js`（正式口径，微信+邮件推送） | `eod/data/eod/eod-<日>.json` + `eod/reports/eod/`；日志 `eod/logs/tail-<日期>.log` |
| 盘前回填 | 18:00 | `node eod/preopen_backfill.js`（含龙虎榜） | `eod/data/preopen/`（close 段合并进当日归档）；日志 `eod/logs/preopen-backfill-<日期>.log` |
| 游资席位扫描 | 18:20 | `node eod/hotmoney_scan.js`（最近交易日龙虎榜游资席位，缺档自动回补近10日窗口） | `eod/data/hotmoney/hotmoney-<日>.json` + `eod/reports/hotmoney/hotmoney-<日>.html`；日志 `eod/logs/hotmoney-<日期>.log` |
| A股次日候选池初筛 | 16:00 | `node gen_candidates.js`（R01/R07 规则，推送 GitHub + Server酱/邮件） | `candidates.json` + `reports/` |

**日志归位说明（2026-11-06 起）**：`eod/lib/runlog.js` 让脚本自身把 console 输出镜像到
`eod/logs/<prefix>-<日期>.log`（preopen / tail / tail-intraday / preopen-backfill），不再依赖外部重定向；
外部调度即使重定向到别处，规范落点也有保底。

## 二、本机 · WorkBuddy 任务（PAUSED，手动触发）

| 任务名 | 预约时间（仅占位） | 执行内容 |
|---|---|---|
| pulse 消息脉搏 · 一键报告 | 09:00 | `npm run pulse`：6 源采集 → 交叉分析 → 归档 → 打开 `pulse/reports/latest.html` |
| pulse watch · 常驻监听启动 | 08:30（PAUSED） | 查重后最小化窗口后台启动 `npm run pulse:watch`（每轮完成计时 3 分钟；异动弹 Windows Toast）；停止：taskkill PID |

**pulse watch 停用记录（2026-11-09）**：Windows 计划任务 `pulse-watch`（登录触发）已 `Disable-ScheduledTask` 禁用，
运行中的 watch 进程已终止；WorkBuddy 任务保持 PAUSED。此后完全手动：最小化窗口跑 `npm run pulse:watch`，
停止用 taskkill 对应 node PID。如需恢复开机自启：`Enable-ScheduledTask -TaskName 'pulse-watch'`。
| A股每日市场情绪日报 | 23:30 | 情绪日报生成（WorkBuddy 侧编排） |

pulse 数据/报告归档：`pulse/data/YYYY-MM-DD/`、`pulse/reports/YYYY-MM-DD/`（latest.json / latest.html 留根目录）；watch 控制台日志 `pulse/data/watch-console.log`。

## 三、远程 · GitHub Actions（workflow_dispatch 均可手动触发）

| workflow | 定时（北京） | 说明 |
|---|---|---|
| `daily-screen.yml` | 工作日 15:37 | A 股次日候选初筛（远程兜底，与本地 16:00 任务同口径） |
| `tail-observe.yml` | 工作日 14:20 | 尾盘观察口径（远程兜底） |
| `tail-screen.yml` | 工作日 14:40 | 尾盘正式口径（远程兜底） |
| `refresh-industry-map.yml` | 每月 1 日 11:00 | 行业映射刷新（东财封 IP 时靠新浪兜底，全量刷新需本机解封后执行） |

> 注：所有 cron 均写 `timezone: "Asia/Shanghai"`。
