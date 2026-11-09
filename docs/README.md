# 文档中心

本项目所有**沟通 / 需求 / 方案 / 计划 / 评审 / 复盘**类文档统一放在本目录，不再散落在仓库各处（仓库根只保留 `README.md` 作为工程总览）。

## 目录规划

| 目录 | 主题 |
|------|------|
| `docs/eod-tail-screener/` | 尾盘选股（收盘前 10 分钟）新功能：需求 / 方案 / 上线后复盘（含计划与待确认附录） |
| `docs/hotmoney-scan/` | 游资席位扫描：定位、游资注册表、席位变更感知、报告口径 |
| `docs/pulse/` | pulse 消息脉搏：六源采集、交叉分析、归档与报告（v1 已实施） |
| `docs/backtest/` | 参数回溯与调优：用 K 线回补真实收益，量化各参数区分度，输出优化建议 |
| `docs/code-review/` | 代码审查：审查标准与流程、历次评审报告与处置记录 |
| `docs/automations/` | 本机定时任务（WorkBuddy Automations）便携重建与对齐文档（单一真值源） |
| `docs/notes-groups/` | 评论（备注）与分组管理：可写能力方案 |
| `docs/npm-publish/` | 独立发布（npm 包 / 免拉代码运行）：三方案对比与落地顺序 / 实施计划 |
| `docs/ops/` | 定时任务与调度口径：双通道拓扑、尾盘三口径、落库目标、排查 |
| `docs/storage/` | 数据存储与入库：本地 SQLite / Cloudflare D1、结构同步、用量限额 |
| `docs/api/` | API 服务：Pages Functions 形态、接口一览、响应口径 |
| `docs/web/` | Web 前端：页面与口径、排序 / 移动端等硬约定 |
| `docs/release/` | 发布流程：八阶段、三条硬规则、常用命令 |

> 仓库根的 Markdown 只保留三份：`README.md`（工程总览 + 导航）、`DEPLOY.md`（部署唯一入口）、
> `CHANGELOG.md`（changelogen 自动生成，**勿手改**）；其余沟通 / 方案 / 复盘类一律放 `docs/`。

## 命名规范

| 规则 | 说明 |
|------|------|
| 一级目录 | 英文短横线 slug（如 `eod-tail-screener`），避免中文路径在各系统 / Git / 命令行下的编码问题 |
| 文件命名 | `两位序号-类型.md`，序号决定阅读顺序 |
| 类型白名单 | `需求` / `方案` / `计划` / `待确认` / `评审` / `复盘`；历史文件（`01-标准与流程.md`、`system-plan-*.md`、`automations/README.md`）沿用原名，不强制重命名 |
| 索引 | 每新增一篇，在本文件下方「文档索引」补一行；索引是唯一入口 |

## 文档索引

| 文档 | 说明 |
|------|------|
| [eod-tail-screener/01-需求.md](eod-tail-screener/01-需求.md) | 尾盘选股：目标、功能 / 非功能需求、验收标准 |
| [eod-tail-screener/02-方案.md](eod-tail-screener/02-方案.md) | 尾盘选股：数据链路、筛选规则、同类比较、调度、存储、风险 |
| [eod-tail-screener/03-复盘.md](eod-tail-screener/03-复盘.md) | 尾盘选股：**上线后复盘** —— 实际落地 vs 原设计的差异、口径速查入口、落库事故结论、GitHub cron 实测延迟、尚未实施项；附录 A/B 为已关闭的计划基线与待确认决策记录（2026-10-22 并入） |
| [backtest/01-复盘.md](backtest/01-复盘.md) | 参数回溯：尾盘 341 条 + R01 44 条 K 线回补收益，分桶 / 秩相关 / what-if。**§0–7 为 v1 结论，不可直接套用 v2 分制**；已执行调整与等效线见 §8 |
| [code-review/01-标准与流程.md](code-review/01-标准与流程.md) | 代码审查标准：按维度的 Checklist（正确性 / 健壮性 / 性能 / 结构）、红线依据、审查流程 |
| [code-review/02-评审-2026-10-22.md](code-review/02-评审-2026-10-22.md) | 2026-10-22 全量评审（2🔴/6🟡/5💭）· **已归档**，处置见 §7 |
| [code-review/03-评审-2026-11-09.md](code-review/03-评审-2026-11-09.md) | 2026-11-09 全量评审（4🔴/16🟡/6💭）· **已归档**，含报告生成方式专项 §6 |
| [code-review/04-评审-2026-11-09.md](code-review/04-评审-2026-11-09.md) | 2026-11-09 增量评审 · **已处置**（`790ab03` / `d04c28f`）：3🔴 全修，另补 1 处漏报（`overview.filter` 崩溃）、订正 1 处误报；6 项设计取舍待决策 |
| [automations/README.md](automations/README.md) | 本机定时任务单一真值源：全部自动化的 prompt / rrule / 状态，换设备可一句话重建 |
| [system-plan-2026-11-09.md](system-plan-2026-11-09.md) | 选股体系完善方案（**A/B 已落地；C2/D2 按用户拍板的保守形态已落地，C1/C3/D1 待启动**）：B1 落地口径为腾讯全市场快照，非初稿的东财 push2；C2 只出 diff 不写回、D2 不推送；附录 A 为体系审计结论 |
| [hotmoney-scan/01-方案.md](hotmoney-scan/01-方案.md) | 游资席位扫描：一句话定位、文件四件套、游资注册表、席位变更感知、调度（原 docs 根散落文档归位） |
| [pulse/01-方案.md](pulse/01-方案.md) | pulse 消息脉搏：六源采集实测、交叉分析、归档结构与 v2 遗留（原 docs 根散落文档归位） |
| [notes-groups/01-方案.md](notes-groups/01-方案.md) | 评论/分组：需求、接口清单、写鉴权方案、前端交互、边界 |
| [npm-publish/01-方案.md](npm-publish/01-方案.md) | 独立发布：两种运行模式差异、边界清单、全量打包 / 只发尾盘 / npx github 三方案对比、落地顺序、已完成的可重定位层 |
| [npm-publish/02-计划.md](npm-publish/02-计划.md) | 独立发布实施计划：方案 A 交付物、首次运行脚手架、发布链路、部署已解耦、向后兼容四条保票、npx 不 pin 版本、三道闸、踩坑、验证清单 |
| [ops/01-方案.md](ops/01-方案.md) | 定时任务：本地 ↔ GitHub Actions 双通道拓扑、cron 只作触发、尾盘三口径（cut/observe/intraday）、落库双写、三种「看着跑了其实没跑」排查 |
| [storage/01-方案.md](storage/01-方案.md) | 数据存储：两层存储与写入目标、两端一致性校验、D1 用量限额实测、10 张表说明、`npm run db:migrate` 差异驱动同步、两个「本地库」的区别 |
| [api/01-方案.md](api/01-方案.md) | API 服务：为什么只有 Pages Functions 同源一种形态、`worker/` 目录职责、读/写接口一览、响应信封与业务码、环境注入两条链路 |
| [web/01-方案.md](web/01-方案.md) | Web 前端：目录与依赖、六个页面能力、排序 / 空值 / 序号列 / 口径标签 / `<colgroup>` / 移动端等硬约定 |
| [release/01-方案.md](release/01-方案.md) | 发布流程：八阶段明细、三条硬规则（本机不 publish / 部署与发版解耦 / npx 不 pin 版本）、门禁来源、`release:notes` 与 `verify:pack` |
