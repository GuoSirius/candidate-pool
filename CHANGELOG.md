# Changelog

所有变动按 **Conventional Commits** 约定分类，由 `changelogen` 自动生成。

## v1.0.0 (2026-09-18)

初始版本。

- 🚀 **初筛流水线**：`gen_candidates.js` 基于可编辑观察池（`candidates.json`）套用 R01 量能验证突破 + R07 板块内补涨（+ R05 尾盘异动核验），输出单文件、资源全内联、支持中英切换的 HTML 报告。
- 🚀 **结构化入库**：本地 SQLite（开发）+ Cloudflare D1（生产）共用一套建表/写入逻辑，支持入选后 N1/N2/N3/N5/N7/N9/N10 日表现复盘。
- 🚀 **只读 API**：Hono + TypeScript，以 Worker 或 Pages Functions 两种形态暴露统一 `{ code, message, data }` 接口。
- 🚀 **Vue3 + Vite PWA 前端**：候选列表 / 复盘统计 / 规则释义 / 个股复盘四页。
