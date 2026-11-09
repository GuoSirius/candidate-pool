# 游资席位扫描（hotmoney_scan）

> 更新：2026-11-09。与盘前选股 / 收盘回填并列的第三条 A 股数据流：
> 统计**最近一个交易日的龙虎榜知名游资席位买卖**，任意时刻可执行。

## 一句话定位

龙虎榜全榜（~60-80 只/天，非候选池子集）→ 逐票抓席位买卖明细 → 按游资注册表匹配 →
倒排「游资 → 票 / 票 → 游资」，归档近 N 个交易日明细，HTML 报告多维筛选。

## 文件四件套

| 文件 | 职责 |
|---|---|
| `eod/hotmoney.config.js` | 全部参数 + **游资注册表**（唯一真相源：`registry.entries`，[名称, 席位正则, 分层]） |
| `eod/hotmoney_scan.js` | 入口脚本（扫锚定日 + 回补窗口 + 变动感知 + 报告） |
| `eod/lib/hotmoney.js` | 名单匹配纯函数（`matchSeatTrades` 含买/卖/净额；旧接口 `matchHotMoney` 转发兼容盘前） |
| `eod/lib/hotmoney_store.js` | 日档 / 席位快照 / 观察名单 三类归档（原子写） |
| `eod/lib/hotmoney_report.js` | HTML 报告（复用 preopen_report 的 CSS，主题/双语/chip 过滤同范式） |

## 用法

```bash
node eod/hotmoney_scan.js                  # 最近一个交易日 + 近10日窗口
node eod/hotmoney_scan.js --date 2026-11-06
node eod/hotmoney_scan.js --history 20     # 明细窗口扩到 20 个交易日
node eod/hotmoney_scan.js --no-history     # 只扫锚定日
node eod/hotmoney_scan.js --json           # 机器摘要
```

- **锚定日**：17:30 前跑（当天榜未出齐）→ 自动回退上一交易日；周末/节假日自动落到上一交易日；`--date` 指定任意历史日。
- **首次运行**逐日回补近 10 个交易日（每交易日 ~120 个低频请求，约半分钟-几分钟）；日档永久缓存，之后每天只抓锚定日新档。
- 日志自镜像：`eod/logs/hotmoney-<日期>.log`。

## 游资名单动态更新（不改代码）

1. **本地覆盖文件** `eod/data/hotmoney-registry.json`（可选，不存在即用 config 内置名单）：
   ```json
   [{ "name": "新游资", "seat": "XX证券.*YY营业部", "tier": "一线", "action": "add" },
    { "name": "旧游资", "action": "remove" }]
   ```
   add 按 name 追加/覆盖，remove 按 name 删除，下次运行即生效。
2. **变动自动感知**：
   - **席位变更**：锚定日席位与快照 `eod/data/hotmoney-seats-snapshot.json` 比对，
     游资出现历史未见席位 → 报告核心结论提示 + 行内「新席位」标注（换马甲/改营业部可见）。
     注：首跑无快照，全员标新；第二次运行起才有意义。
   - **观察名单**：未匹配任何游资的席位按天累计到 `eod/data/hotmoney-watchlist.json`，
     出现 ≥ `watch.minDays`（默认 3）天进报告观察表 → 高频新席位浮现，建议晋升进 registry。

## 报告内容（eod/reports/hotmoney-<日>.html）

| 区块 | 说明 | 过滤 chips |
|---|---|---|
| 当日交易明细 | 游资×票逐条记录：买/卖/净额/席位/标记 | 层级 + 方向（净买/净卖）+ 游资名；按游资/按票双视图 |
| 游资·近N日汇总 | 净额/买/卖/活跃天数/涉票数，按净额降序 | 层级 |
| 近N日交易明细 | 窗口内全部记录（含日期列） | 游资名 + 日期 + 方向 + 层级 |
| 票·近N日汇总 | 每票的游资名单（按净额） | — |
| 未识别席位观察名单 | ≥minDays 天的高频未识别席位 | — |

标记列：`盘前候选`（游资票 ∩ 当日盘前候选池，交叉确认信号）、`新席位`（变动感知）。

## 归档落点

| 文件 | 说明 |
|---|---|
| `eod/data/hotmoney-<日>.json` | 日档：榜单名单 + 逐票匹配结果 + 未识别席位汇总 |
| `eod/data/hotmoney-seats-snapshot.json` | 游资→席位全集快照（变动感知基准） |
| `eod/data/hotmoney-watchlist.json` | 未识别席位按天累计 |
| `eod/reports/hotmoney-<日>.html` | 报告 |

## 定时任务

WorkBuddy 自动化「游资席位扫描（工作日 18:20）」（排在 18:00 盘前回填之后），
见 `docs/automations/README.md` §11 与 `docs/scheduled-tasks.md`。

## 数据口径与已知偏差

- 金额为**龙虎榜口径**（上榜席位当日买卖额），非全日成交；买卖席位明细来自东财
  `RPT_BILLBOARD_DAILYDETAILSBUY`，`columns=ALL` 含 BUY/SELL/NET。
- 名单正则为公开常见归属（2026-11 复核），游资会换马甲 → 靠变动感知 + 观察名单持续维护。
- 东财可能临时封 IP：席位抓取失败留空不阻断（retries=2），次日自动恢复。
