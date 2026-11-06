# pulse/ 消息脉搏模块

> 状态：**v1 已实施并实测跑通**（2026-11-06）。

## v1 实测结果

| 源 | 状态 | 说明 |
|---|---|---|
| 新浪 7×24 | ✅ | 40 条/轮 |
| 东财快讯 | ✅ | newsapi kuaixun JSONP 变量格式 |
| 金十数据 | ✅ | flash_newest.js |
| 华尔街见闻 | ✅ | apiv1/content/lives |
| 东财板块行情+主力资金流 | ✅ | 527 个板块（行业+概念） |
| 巨潮公告 | ✅ | 标题关键词过滤事件类 |
| 财联社电报 | ❌ v2 | nodeapi 全线 404（签名反爬），SSR 无数据 |
| 韭研公社 | ❌ v2 | XHR 需 token，SSR 不含列表；需浏览器渲染或逆向，专项处理 |

## 用法

| 命令 | 用途 |
|---|---|
| `npm run pulse` | 手动单次：采集→交叉分析→快照落盘→HTML 报告 |
| `npm run pulse:watch` | 常驻监听：每轮完成后计时 3 分钟再跑下一轮；交易日 08:30–15:35 活跃；事件分「消息热点」（多源新话题）/「消息+行情共振」/「行情异动」（涨幅跳升）三类，弹 Windows Toast；同板块 60min 冷却；无新异动静默；非 Windows 仅 console |
| `npm run pulse:probe` | 数据源探针（源接口变更时排查用） |

产物（按日期分层）：
- `pulse/data/YYYY-MM-DD/snap-HHmmss.json`（每轮快照，按日滚动保留 60 天）、`pulse/data/latest.json`（最近一轮）
- `pulse/report/YYYY-MM-DD/pulse-HHmmss.html` + `pulse/report/latest.html`（按日滚动保留 40 天）
- watch 基准状态：`pulse/data/watch-state.json`（首轮只建基准不通知）
- 以上均不入库（.gitignore 已排除 pulse/data/ 与 pulse/report/）。

## 交叉分析与评分

- 去重：同源文本去重；跨源重复保留，作为交叉验证素材。
- 交叉验证：按板块聚合回看窗口（12h）内新闻，命中源数 ≥2 视为验证；A(≥3源)/B(2源)/C(单源)。
- 板块热度分 = 消息权重×2 + 源覆盖×1.5 + 主力净流入排名分×2 + 涨幅分 + 验证加成。
- 个股榜 = 新闻命中（多源计分）+ 热点板块领涨股加成。
- 纯行情异动（无消息命中但涨幅 ≥2%）单独入榜。
- 词典匹配：东财板块名（行业+概念）+ eod 行业映射（个股名/行业），复用 `eod/lib/sector.js`。

## 复用与分层

- `eod/lib/http.js`：GET（重试+WAF 退避+GBK）直接复用；`pulse/lib/http.js` 只补 POST。
- `eod/lib/sector.js`：行业映射加载（含包内种子兜底）直接复用。
- 公共逻辑集中：配置 `pulse/config.js`、匹配 `pulse/lib/match.js`、落盘 `pulse/lib/store.js`。
- 采集源独立容错：单源失败不影响整体，状态记入报告头。

## 技术路线（定稿）

Node.js（CJS，与 eod/ 一致）+ 内置 https/fetch，**零新增依赖**，不引入 akshare/efinance/Python：

| 对比项 | 纯 HTTP（选定） | akshare/efinance |
|---|---|---|
| 依赖 | 零新增 | 需维护 Python 环境 |
| 项目契合 | eod/ 已有东财接口实战经验 | 另起技术栈 |
| 稳定性 | 单源挂可切备源 | 上游改版连坐 |

需 API Key 的服务（聚合数据 / Tavily / hithink / AShareHub / Tushare）一律不用，保持零凭据。
补选平台结论：金十数据、华尔街见闻免费无 key，已纳入 v1；财联社、韭研公社 v2 专项处理。

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
