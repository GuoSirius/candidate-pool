# Changelog

所有变动按 **Conventional Commits** 约定分类，由 `changelogen` 自动生成。

## v1.1.0


### 🚀 新功能 (Features)

- A股次日候选池自动初筛脚本 + 离线快照 + GitHub Actions 工作流 ([1f670ae](https://github.com/GuoSirius/candidate-pool/commit/1f670ae))
- 实时模式按日留档+覆盖 + 微信/163邮件推送(notify.js) + 工作流默认live ([7503b79](https://github.com/GuoSirius/candidate-pool/commit/7503b79))
- **db:** 新增 D1 入库层 + 本地 SQLite 开发模式（零依赖 node:sqlite） ([e4b7d6a](https://github.com/GuoSirius/candidate-pool/commit/e4b7d6a))
- **db:** 统一时间处理为 dayjs（北京时间）并为建表语句补充列注释 ([145e99d](https://github.com/GuoSirius/candidate-pool/commit/145e99d))
- **worker:** Add Cloudflare Workers API exposing D1 candidate-pool data ([e4d8fd4](https://github.com/GuoSirius/candidate-pool/commit/e4d8fd4))
- **web:** Add Vue3/Vite PWA frontend (candidate list, rules, stock detail) ([6ae62c2](https://github.com/GuoSirius/candidate-pool/commit/6ae62c2))
- **worker:** Add /api/stats review aggregation (N-day win rate, per-tier, timeline) ([2984a0a](https://github.com/GuoSirius/candidate-pool/commit/2984a0a))
- **web:** Add review stats page (win rate, per-tier, timeline chart) ([d5864d8](https://github.com/GuoSirius/candidate-pool/commit/d5864d8))
- **web:** Serve Worker API as same-origin Pages Functions ([ad50bdc](https://github.com/GuoSirius/candidate-pool/commit/ad50bdc))
- **web:** Candidate list becomes responsive cards + pagination + search; sticky first column ([3205569](https://github.com/GuoSirius/candidate-pool/commit/3205569))
- 扩展 N 日涨幅口径到 N1/N2/N3/N5/N7/N9/N10（覆盖四档与个股详情） ([0275fb5](https://github.com/GuoSirius/candidate-pool/commit/0275fb5))
- **db:** D1/本地双写冲突防护 recency guard + run_at 列 + 幂等迁移，及锚定日解析 --print-anchor ([8261218](https://github.com/GuoSirius/candidate-pool/commit/8261218))

### 🐛 缺陷修复 (Bug Fixes)

- Offline 模式自动选最新快照 + 简化 npm offline 脚本 ([5d8685c](https://github.com/GuoSirius/candidate-pool/commit/5d8685c))
- **worker:** Type status as ContentfulStatusCode; pin real D1 id; add lockfile ([c341654](https://github.com/GuoSirius/candidate-pool/commit/c341654))
- **web:** Remove unused router in StockView; add lockfile ([348bcb9](https://github.com/GuoSirius/candidate-pool/commit/348bcb9))
- **db:** D1 batch now submits per-statement via /query; /execute 404s on this account ([8aced0c](https://github.com/GuoSirius/candidate-pool/commit/8aced0c))

### ♻️ 代码重构 (Refactors)

- **worker:** Decouple envelope code from HTTP status; add BizCode + fix workers-types version ([0be7245](https://github.com/GuoSirius/candidate-pool/commit/0be7245))
- **db:** Load env via dotenv instead of hand-rolled loader ([f4a262a](https://github.com/GuoSirius/candidate-pool/commit/f4a262a))

### 📚 文档 (Documentation)

- D1 建表命令补 --remote（默认 local 模式会报错） ([a917251](https://github.com/GuoSirius/candidate-pool/commit/a917251))
- Add DEPLOY.md (fresh-env 0->1 + daily publish) and refresh README ([5b333ca](https://github.com/GuoSirius/candidate-pool/commit/5b333ca))

### 🔧 构建 (Build)

- 接入 commitlint + changelogen + husky，新增 npm run release 全流程（未提交检测/类型门禁/版本/changelog/发布/部署） ([a180c17](https://github.com/GuoSirius/candidate-pool/commit/a180c17))

### 📦 杂项维护 (Chores)

- 每日实时初筛 2026-08-10 ([c933b00](https://github.com/GuoSirius/candidate-pool/commit/c933b00))
- 从快照重建报告 2026-08-10T09:00:02Z ([34ef9de](https://github.com/GuoSirius/candidate-pool/commit/34ef9de))
- 每日初筛 2026-08-11T08:33:04Z ([fa67638](https://github.com/GuoSirius/candidate-pool/commit/fa67638))
- 每日实时初筛 2026-08-12 ([3b33ccb](https://github.com/GuoSirius/candidate-pool/commit/3b33ccb))
- 每日初筛 2026-08-12T08:50:23Z ([dae14e8](https://github.com/GuoSirius/candidate-pool/commit/dae14e8))
- 每日实时初筛 2026-08-13 ([791ed2f](https://github.com/GuoSirius/candidate-pool/commit/791ed2f))
- 每日初筛 2026-08-13T08:53:28Z ([5db74a5](https://github.com/GuoSirius/candidate-pool/commit/5db74a5))
- 每日实时初筛 2026-08-14 ([146e02b](https://github.com/GuoSirius/candidate-pool/commit/146e02b))
- 每日初筛 2026-08-14T08:47:30Z ([9419c64](https://github.com/GuoSirius/candidate-pool/commit/9419c64))
- 每日实时初筛 2026-08-17 ([bd84250](https://github.com/GuoSirius/candidate-pool/commit/bd84250))
- 每日初筛 2026-08-17T08:10:53Z ([0b8b81e](https://github.com/GuoSirius/candidate-pool/commit/0b8b81e))
- 每日初筛 2026-08-18T08:06:05Z ([27fc1f7](https://github.com/GuoSirius/candidate-pool/commit/27fc1f7))
- 每日实时初筛 2026-08-19 ([0af96de](https://github.com/GuoSirius/candidate-pool/commit/0af96de))
- 每日实时初筛 2026-08-19（15:35 复核） ([9e3b3d4](https://github.com/GuoSirius/candidate-pool/commit/9e3b3d4))
- 每日初筛 2026-08-19T08:06:39Z ([2f2ec78](https://github.com/GuoSirius/candidate-pool/commit/2f2ec78))
- 每日实时初筛 2026-08-20 ([c992cb9](https://github.com/GuoSirius/candidate-pool/commit/c992cb9))
- 每日初筛 2026-08-20T08:08:44Z ([ff48c3f](https://github.com/GuoSirius/candidate-pool/commit/ff48c3f))
- 每日实时初筛 2026-08-21 ([ee0f8ac](https://github.com/GuoSirius/candidate-pool/commit/ee0f8ac))
- 每日初筛 2026-08-21T08:09:35Z ([fc272d1](https://github.com/GuoSirius/candidate-pool/commit/fc272d1))
- 每日初筛 2026-08-24T08:23:22Z ([c7b81e9](https://github.com/GuoSirius/candidate-pool/commit/c7b81e9))
- 每日初筛 2026-08-25T08:21:37Z ([c5e4c2a](https://github.com/GuoSirius/candidate-pool/commit/c5e4c2a))
- 每日实时初筛 2026-08-26 ([cce38ae](https://github.com/GuoSirius/candidate-pool/commit/cce38ae))
- 每日初筛 2026-08-26T08:21:52Z ([c4f0485](https://github.com/GuoSirius/candidate-pool/commit/c4f0485))
- 每日实时初筛 2026-08-27 ([89ffcc6](https://github.com/GuoSirius/candidate-pool/commit/89ffcc6))
- 每日初筛 2026-08-27T18:24:12Z ([a636f76](https://github.com/GuoSirius/candidate-pool/commit/a636f76))
- 每日实时初筛 2026-08-28 ([ffdb15b](https://github.com/GuoSirius/candidate-pool/commit/ffdb15b))
- 每日初筛 2026-08-28T19:34:56Z ([b57f011](https://github.com/GuoSirius/candidate-pool/commit/b57f011))
- 每日实时初筛 2026-08-31 ([66d6cd8](https://github.com/GuoSirius/candidate-pool/commit/66d6cd8))
- 每日初筛 2026-08-31T15:22:08Z ([bed5045](https://github.com/GuoSirius/candidate-pool/commit/bed5045))
- 每日实时初筛 2026-09-01 ([4ebca43](https://github.com/GuoSirius/candidate-pool/commit/4ebca43))
- 每日初筛 2026-09-01T12:43:42Z ([c389af9](https://github.com/GuoSirius/candidate-pool/commit/c389af9))
- 每日实时初筛 2026-09-02 ([6b11169](https://github.com/GuoSirius/candidate-pool/commit/6b11169))
- 每日初筛 2026-09-02T12:16:39Z ([a5ef4ab](https://github.com/GuoSirius/candidate-pool/commit/a5ef4ab))
- 每日实时初筛 2026-09-03 ([585f73c](https://github.com/GuoSirius/candidate-pool/commit/585f73c))
- 每日初筛 2026-09-03T12:14:28Z ([8b9e728](https://github.com/GuoSirius/candidate-pool/commit/8b9e728))
- 每日实时初筛 2026-09-04 ([41b41aa](https://github.com/GuoSirius/candidate-pool/commit/41b41aa))
- 每日初筛 2026-09-04T12:15:22Z ([cbb3eb5](https://github.com/GuoSirius/candidate-pool/commit/cbb3eb5))
- 每日实时初筛 2026-09-07 ([902abea](https://github.com/GuoSirius/candidate-pool/commit/902abea))
- 每日初筛 2026-09-07T13:40:00Z ([5e4a085](https://github.com/GuoSirius/candidate-pool/commit/5e4a085))
- 每日实时初筛 2026-09-08 ([d70f495](https://github.com/GuoSirius/candidate-pool/commit/d70f495))
- 每日初筛 2026-09-08T12:17:11Z ([fb96810](https://github.com/GuoSirius/candidate-pool/commit/fb96810))
- 每日实时初筛 2026-09-09 ([6c6f239](https://github.com/GuoSirius/candidate-pool/commit/6c6f239))
- 每日初筛 2026-09-09T12:28:24Z ([3501c55](https://github.com/GuoSirius/candidate-pool/commit/3501c55))
- 每日实时初筛 2026-09-10 ([8ee7774](https://github.com/GuoSirius/candidate-pool/commit/8ee7774))
- 每日初筛 2026-09-10T12:21:41Z ([0b0007a](https://github.com/GuoSirius/candidate-pool/commit/0b0007a))
- 每日实时初筛 2026-09-11 ([19d6ec9](https://github.com/GuoSirius/candidate-pool/commit/19d6ec9))
- 每日初筛 2026-09-11T12:20:31Z ([22d417a](https://github.com/GuoSirius/candidate-pool/commit/22d417a))
- 每日实时初筛 2026-09-14 ([1858b90](https://github.com/GuoSirius/candidate-pool/commit/1858b90))
- 每日初筛 2026-09-14T14:23:09Z ([8b58919](https://github.com/GuoSirius/candidate-pool/commit/8b58919))
- 每日实时初筛 2026-09-15 ([0810ac3](https://github.com/GuoSirius/candidate-pool/commit/0810ac3))
- 每日初筛 2026-09-15T12:52:40Z ([807fade](https://github.com/GuoSirius/candidate-pool/commit/807fade))
- 每日实时初筛 2026-09-16 ([ef70d16](https://github.com/GuoSirius/candidate-pool/commit/ef70d16))
- 每日初筛 2026-09-16T12:48:34Z ([84a9da8](https://github.com/GuoSirius/candidate-pool/commit/84a9da8))
- 每日实时初筛 2026-09-17 ([e610a0b](https://github.com/GuoSirius/candidate-pool/commit/e610a0b))
- 产物改走 daily-artifacts 分支分离 + 工作流补 npm ci + README 数据/部署说明 ([3364ff9](https://github.com/GuoSirius/candidate-pool/commit/3364ff9))
- One-click web deploy script (Pages) + worker smoke test ([dfb958b](https://github.com/GuoSirius/candidate-pool/commit/dfb958b))
- Ignore wrangler local state (.wrangler/, .dev.vars) ([5949954](https://github.com/GuoSirius/candidate-pool/commit/5949954))
- Add npm run setup to install all three packages in one command ([03ce0e5](https://github.com/GuoSirius/candidate-pool/commit/03ce0e5))
- Install ([edea5fa](https://github.com/GuoSirius/candidate-pool/commit/edea5fa))

### ⚙️ 持续集成 (CI)

- Bump workflow node-version to 24; qualify daily-artifacts push ref ([109a1f5](https://github.com/GuoSirius/candidate-pool/commit/109a1f5))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](http://github.com/siriusSupreme))
- WorkBuddy <workbuddy@local>

## v1.0.0 (2026-09-18)

初始版本。

- 🚀 **初筛流水线**：`gen_candidates.js` 基于可编辑观察池（`candidates.json`）套用 R01 量能验证突破 + R07 板块内补涨（+ R05 尾盘异动核验），输出单文件、资源全内联、支持中英切换的 HTML 报告。
- 🚀 **结构化入库**：本地 SQLite（开发）+ Cloudflare D1（生产）共用一套建表/写入逻辑，支持入选后 N1/N2/N3/N5/N7/N9/N10 日表现复盘。
- 🚀 **只读 API**：Hono + TypeScript，以 Worker 或 Pages Functions 两种形态暴露统一 `{ code, message, data }` 接口。
- 🚀 **Vue3 + Vite PWA 前端**：候选列表 / 复盘统计 / 规则释义 / 个股复盘四页。
