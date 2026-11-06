# pulse/ 消息脉搏模块 · 实施方案（待确认）

> 状态：**方案阶段，未实施**。用户确认后按 P1→P5 推进。

## 定位

新增独立命令/任务：随时手动执行或定时执行，拉取消息面 + 行情/资金流，交叉分析，
发现行业热点与异动，输出 HTML 报告（行业/板块/股票榜单）；另提供常驻监听模式，
每 3-5 分钟增量扫描并对异动发系统通知。

## 技术路线

Node.js ESM + 内置 fetch，**零新增依赖**，不引入 akshare/efinance/Python：

| 对比项 | 纯 HTTP（选定） | akshare/efinance |
|---|---|---|
| 依赖 | 零新增 | 需维护 Python 环境 |
| 项目契合 | eod/ 已有东财接口实战经验 | 另起技术栈 |
| 稳定性 | 单源挂可切备源 | 上游改版连坐 |

需 API Key 的服务（聚合数据 / Tavily / hithink / AShareHub / Tushare）一律不用，保持零凭据。

## 数据源定级

| 类别 | 源 | 接入方式 | 定位 |
|---|---|---|---|
| 快讯 | 新浪 7×24 | zhibo.sina.com.cn 公开 JSON | 主力 |
| 快讯 | 东财 7×24 | newsapi.eastmoney.com JSON | 主力（交叉去重） |
| 快讯 | 财联社电报 | 有签名反爬，P1 实测 | 备选 |
| 行情/资金流 | 东财 push2 板块行情+资金流 | 与 build_industry_map.js 同族接口 | 主力 |
| 公告 | 巨潮资讯 | cninfo.com.cn POST query | 公告验证 |
| 情绪 | 雪球/股吧 | 需 cookie、噪音大 | v2 再做 |

## 模块设计（pulse/）

| 文件 | 职责 |
|---|---|
| sources/ | sina_news / em_news / cls / cninfo / market 采集器，独立容错 |
| analyze.js | 去重聚类 → 题材关键词 → 匹配板块成分股（复用 eod 行业映射）→ 热度评分 |
| gen_report.js | 单文件 HTML 报告，复用现有报告风格 |
| watch.js | 常驻轮询（默认 4min，可配），增量对比，异动触发通知 |
| notify_win.js | Windows Toast（PowerShell 原生，免依赖）；非 Windows 降级 console + notify.js Server酱 |
| 数据落盘 | data/pulse/YYYY-MM-DD/*.json，每轮快照留档 |

评分模型：热度分 = 新闻源覆盖数（≥2 源采信）× 时间衰减 + 板块资金流排名 + 涨幅异动 + 龙头股联动。

## 命令与调度

| 命令 | 用途 |
|---|---|
| npm run pulse | 手动单次全流程 |
| npm run pulse:watch | 常驻监听 + 系统通知 |
| WorkBuddy 定时 | 盘前/盘中/盘后各一次完整报告 |

## 分期

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 | 探针：实测 6 源可达性与字段 | 定主备源 |
| P2 | 采集器 + 落盘 | 快照稳定产出 |
| P3 | 分析引擎 + HTML 报告 | 报告可读、榜单合理 |
| P4 | watch 常驻 + Windows 通知 | 异动 5 分钟内弹通知 |
| P5 | 定时任务 + 文档 | 全链路免维护 |

## 风险与对策

| 风险 | 对策 |
|---|---|
| 财联社签名反爬 | P1 实测定生死；新浪+东财双源已够用 |
| 通知打扰 | 热度分门槛 + 冷却时间，同题材不重复弹 |
| 新闻↔板块映射误配 | 人工关键词映射表兜底，持续积累 |
| watch 常驻空转 | 15:30 后自动静默 |

## 待确认

1. 目录名 pulse/ 是否 OK
2. v1 砍掉情绪类（雪球/股吧），v2 再加
3. 通知渠道：Windows Toast + Server酱 双通道 or 仅 Toast
4. watch 进程：手动启动 or 开机自启
