# 文档中心

本项目所有**沟通 / 需求 / 方案 / 计划 / 评审 / 复盘**类文档统一放在本目录，不再散落在仓库各处（仓库根只保留 `README.md` 作为工程总览）。

## 目录规划

| 目录 | 主题 |
|------|------|
| `docs/eod-tail-screener/` | 尾盘选股（收盘前 10 分钟）新功能：需求 / 方案 / 计划 / 待确认 / 上线后复盘 |
| `docs/notes-groups/` | 评论（备注）与分组管理：可写能力方案 |
| `docs/npm-publish/` | 独立发布（npm 包 / 免拉代码运行）：三方案对比与落地顺序 / 实施计划 |
| `docs/ops/` | 定时任务与调度口径：双通道拓扑、尾盘三口径、落库目标、排查 |
| `docs/storage/` | 数据存储与入库：本地 SQLite / Cloudflare D1、结构同步、用量限额 |
| `docs/api/` | API 服务：Pages Functions 形态、接口一览、响应口径 |
| `docs/web/` | Web 前端：页面与口径、排序 / 移动端等硬约定 |
| `docs/release/` | 发布流程：八阶段、三条硬规则、常用命令 |

> 仓库根只保留两个文件：`README.md`（工程总览 + 导航）与 `DEPLOY.md`（部署唯一入口）；
> `CHANGELOG.md` 由 changelogen 自动生成，**勿手改**。

## 命名规范

| 规则 | 说明 |
|------|------|
| 一级目录 | 英文短横线 slug（如 `eod-tail-screener`），避免中文路径在各系统 / Git / 命令行下的编码问题 |
| 文件命名 | `两位序号-类型.md`，序号决定阅读顺序 |
| 类型白名单 | `需求` / `方案` / `计划` / `待确认` / `评审` / `复盘` |
| 索引 | 每新增一篇，在本文件下方「文档索引」补一行；索引是唯一入口 |

## 文档索引

| 文档 | 说明 |
|------|------|
| [eod-tail-screener/01-需求.md](eod-tail-screener/01-需求.md) | 尾盘选股：目标、功能 / 非功能需求、验收标准 |
| [eod-tail-screener/02-方案.md](eod-tail-screener/02-方案.md) | 尾盘选股：数据链路、筛选规则、同类比较、调度、存储、风险 |
| [eod-tail-screener/03-计划.md](eod-tail-screener/03-计划.md) | 尾盘选股：分阶段交付物与验证清单 |
| [eod-tail-screener/04-待确认.md](eod-tail-screener/04-待确认.md) | 尾盘选股：需你拍板的开放问题（**已全部关闭**；Q2/Q3/Q14 的最终选择与建议不同） |
| [eod-tail-screener/05-复盘.md](eod-tail-screener/05-复盘.md) | 尾盘选股：**上线后复盘** —— 实际落地 vs 原设计的差异、口径速查入口、落库事故结论、GitHub cron 实测延迟、尚未实施项 |
| [notes-groups/01-方案.md](notes-groups/01-方案.md) | 评论/分组：需求、接口清单、写鉴权方案、前端交互、边界 |
| [npm-publish/02-方案.md](npm-publish/02-方案.md) | 独立发布：两种运行模式差异、边界清单、全量打包 / 只发尾盘 / npx github 三方案对比、落地顺序、已完成的可重定位层 |
| [npm-publish/03-计划.md](npm-publish/03-计划.md) | 独立发布实施计划：方案 A 交付物、首次运行脚手架、发布链路、部署已解耦、向后兼容四条保票、npx 不 pin 版本、三道闸、踩坑、验证清单 |
| [ops/01-方案.md](ops/01-方案.md) | 定时任务：本地 ↔ GitHub Actions 双通道拓扑、cron 只作触发、尾盘三口径（cut/observe/intraday）、落库双写、三种「看着跑了其实没跑」排查 |
| [storage/01-方案.md](storage/01-方案.md) | 数据存储：两层存储与写入目标、两端一致性校验、D1 用量限额实测、10 张表说明、`npm run db:migrate` 差异驱动同步、两个「本地库」的区别 |
| [api/01-方案.md](api/01-方案.md) | API 服务：为什么只有 Pages Functions 同源一种形态、`worker/` 目录职责、读/写接口一览、响应信封与业务码、环境注入两条链路 |
| [web/01-方案.md](web/01-方案.md) | Web 前端：目录与依赖、六个页面能力、排序 / 空值 / 序号列 / 口径标签 / `<colgroup>` / 移动端等硬约定 |
| [release/01-方案.md](release/01-方案.md) | 发布流程：八阶段明细、三条硬规则（本机不 publish / 部署与发版解耦 / npx 不 pin 版本）、门禁来源、`release:notes` 与 `verify:pack` |
