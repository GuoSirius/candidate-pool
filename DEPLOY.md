# 部署指南

一句话：**前端静态资源 + API 同源打包在一个 Cloudflare Pages 项目里**（API 用 Pages Functions 复用同一套 Hono 代码），数据存 **Cloudflare D1**，本地与 GitHub Actions 通过 **D1 HTTP API** 写入。

> 为什么不用独立 Worker：`*.workers.dev` 在中国大陆被 DNS 污染 + SNI 拦截，`*.pages.dev` 不受影响。同源方案既绕开这个坑，又免掉 CORS 与跨域地址配置。详见 [README · API 服务](./README.md#api-服务workers--pages-functions)。

---

## 1. 部署拓扑

| 层 | 产物 | 位置 | 部署方式 |
|----|------|------|----------|
| 前端 | Vue3 + Vite PWA 静态资源 | Cloudflare Pages | `npm run deploy`（根目录，等价于 `cd web && npm run deploy`） |
| API | Pages Functions（`/api/*`、`/health`） | 同一个 Pages 项目 | 同上（`wrangler pages deploy` 自动带上 `web/functions/`） |
| 数据 | D1 库 `candidate-pool` | Cloudflare D1 | `npm run db:migrate:both` 建表 + `node db/backfill.js` 灌数 |
| 生成（初筛） | 每日报告 / 快照 | `daily-artifacts` 分支 | GitHub Actions 定时（工作日 15:30） |
| 生成（尾盘） | 尾盘报告 / 候选 | `daily-artifacts` 分支 | GitHub Actions 定时（14:20 观察、14:40 正式） |

> ⛔ **`worker/` 目录不是发布产物，不需要单独部署。** 它只提供两样东西：
> ① 被 Pages Functions 复用的 API 代码（`worker/src/lib/*`、`types.ts`、`pages.ts`）；② 本地开发用的 dev 后端（`npm run dev`）。
> **改了 `worker/src/` 下的代码，同样只需发布前端即可生效**（`wrangler pages deploy` 会把 `web/functions/` 连同它引用的 worker 代码一起打包）。
> 历史上存在的「独立 Worker」形态（`*.workers.dev`）已从发布流程中移除，原因见本文件顶部的「为什么不用独立 Worker」。

**线上地址**

| 用途 | 地址 |
|------|------|
| 前端 | `https://candidate-pool-web.pages.dev/` |
| 健康检查 | `https://candidate-pool-web.pages.dev/health` |
| API 示例 | `https://candidate-pool-web.pages.dev/api/runs?limit=3` |

**当前生产 ID（沿用即可，重建时才需要改）**

| 项 | 值 |
|----|-----|
| Pages 项目名 | `candidate-pool-web`（生产分支 `main`） |
| D1 库名 / ID | `candidate-pool` / `76a2aced-03ca-411d-b2e2-47290b6672ef` |

---

## 2. 全新环境从零部署

### 2.1 前置

| 项 | 要求 | 说明 |
|----|------|------|
| Node.js | **>= 24** | `node:sqlite` 等内置模块依赖；三包 `engines` 已统一声明 `>=24`（2026-11-06） |
| Cloudflare 账号 | 已开通 Workers / Pages / D1 | 免费额度足够本项目 |
| 仓库 | 已 clone 到本地 | `git clone https://github.com/GuoSirius/candidate-pool.git` |

### 2.2 步骤（按顺序执行）

**① 装依赖（三个 package 各一次）**

```bash
cd candidate-pool
npm install                    # 根：dayjs（时间）+ dotenv（读 db/.env）
cd worker && npm install       # API：hono + dayjs + wrangler + typescript
cd ../web && npm install       # 前端：vue + vue-router + dayjs + vite + vite-plugin-pwa
cd ..
```

> 等价的一条命令：根目录执行 `npm run setup`（依次装齐三个 package）。
> `worker/` 里的 wrangler 会被 `web/scripts/deploy.mjs` 复用，所以**先装 worker 再发布前端**，可省一次下载。

**② 登录 Cloudflare（一次性）**

```bash
cd worker
npx wrangler login             # 浏览器授权；CI/无头环境改用 CLOUDFLARE_API_TOKEN 环境变量
npx wrangler whoami            # 确认账号与 pages(write) / d1(write) 权限
```

**③ 建 D1 库**

```bash
npx wrangler d1 create candidate-pool      # 首次创建，返回 database_id
# 库已存在时改查：
npx wrangler d1 info candidate-pool
```

**④ 把 `database_id` 填进两个配置文件**

| 文件 | 字段 |
|------|------|
| `worker/wrangler.toml` | `[[d1_databases]].database_id` |
| `web/wrangler.toml` | `[[d1_databases]].database_id` |

> 两处必须指向**同一个库**，否则 Pages 版与 Worker 版读到的数据不一致。

**⑤ 建表（10 张表 + 12 个索引）**

```bash
cd ..
npm run db:migrate:both      # 推荐：按差异补两端（远程 D1 + 本地 db/local.db）
# 只同步远程：  npm run db:migrate
```

> 兜底：`cd worker && npx wrangler d1 execute candidate-pool --remote --file=../db/schema.sql`
> —— **只对新库有效**（已存在的表补不上新增字段），且 **`--remote` 不能省**（默认跑 local，会因读不到 binding 而报错）。
> 结构变更的完整口径（差异驱动、需人工介入的边界）见 [README · 结构变更一键同步](./README.md#表--列--索引结构变更一键同步npm-run-dbmigrate)。

**⑥ 配入库凭据并灌历史数据**

```bash
cd ..
cp db/.env.example db/.env          # 然后填入三个变量（该文件已被 .gitignore 忽略）
node db/backfill.js                 # 全量快照 → D1；幂等，可重复跑
```

| 变量 | 含义 | 获取位置 |
|------|------|----------|
| `CF_ACCOUNT_ID` | 账户 ID | Cloudflare 头像 → Account Home → Account ID |
| `CF_D1_DATABASE_ID` | D1 数据库 ID | 同上 `database_id` |
| `CF_API_TOKEN` | API 令牌 | API Tokens 页创建，权限 `Account → D1 → Edit` |

> 凭据命名有两套，**别混**：本项目脚本用 `CF_*`，wrangler 用 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`。
> 不想写 `db/.env` 就设系统环境变量 —— `dotenv` 默认**不覆盖**已存在的变量，CI Secrets 优先级更高。

**⑦ 建 Pages 项目（一次性）**

```bash
cd web
npx wrangler pages project create candidate-pool-web --production-branch main
cp deploy.config.example.json deploy.config.json   # Windows 用 copy
```

**⑧ 发布（一条命令，前端 + API 一起上线）**

```bash
cd web
npm run deploy
```

> 脚本以 `web/` 为 cwd 执行，wrangler 自动发现同目录的 `wrangler.toml` 与 `functions/`，因此**一次发布同时上线静态资源与 API**。
> ⚠️ `wrangler pages deploy` **不支持 `--config`**，只读当前工作目录的 `wrangler.toml` —— 必须在 `web/` 下执行。

**⑨ 冒烟验证**

```bash
cd ../worker
npm run smoke -- --api https://candidate-pool-web.pages.dev
```

校验 `/health`、`/api/runs`、`/api/stats`、`/api/groups` 及「最新批次 → 当日入选 → 个股详情」深度链路，每项要求 HTTP 200 + 业务码 200。

**⑩ 配置 GitHub Actions 自动化（可选）**

仓库 `Settings → Secrets and variables → Actions`：

| 分组 | Secrets | 用途 |
|------|---------|------|
| 推送 | `NOTIFY_WX_PROVIDER` / `NOTIFY_WX_KEY` / `NOTIFY_WX_TOKEN` | Server酱 / PushPlus 微信推送 |
| 推送 | `NOTIFY_MAIL_SENDER` / `NOTIFY_MAIL_AUTH` / `NOTIFY_MAIL_RECEIVER` / `NOTIFY_MAIL_HOST` / `NOTIFY_MAIL_PORT` | 163 邮箱推送 |
| 入库 | `CF_ACCOUNT_ID` / `CF_D1_DATABASE_ID` / `CF_API_TOKEN` | 每日自动同步 D1（未配则安全跳过） |
| 发布 | `CF_PAGES_TOKEN`（推荐）/ `CF_ACCOUNT_ID` | 工作日自动部署 Pages，权限 `Account → Cloudflare Pages → Edit`；未配则回落 `CF_API_TOKEN`，详见 §5 |

配完即为全自动（均为北京时间）：

| 时点 | 工作流 | 动作 |
|------|--------|------|
| 工作日 14:20 → 14:30 | `tail-observe.yml` | 观察口径 `eod-<日>-obs.json`（静默，不推送） |
| 工作日 14:40 → 14:50 | `tail-screen.yml` | 正式口径 `eod-<日>.json` + 微信/邮件 |
| 工作日 15:30 | `daily-screen.yml` | 次日候选初筛 → 同步 D1 → 微信/邮件 |
| **本机 19:00（主通道）** | **WorkBuddy 自动化「报告归档发布 deploy」** | **构建期归档 + 前端一起发布到 Cloudflare Pages；见 [`docs/automations/README.md`](./docs/automations/README.md) 第 15 节** |
| 工作日 21:05（云端兜底） | `deploy-archive.yml` | 仅本机 19:00 未成功时补位，幂等指纹去重；19:30 主触发已于 2026-11-12 停用 |
| 每月 1 日 11:00 | `refresh-industry-map.yml` | 刷新行业映射并提交 `main` |

产物提交 `daily-artifacts` 分支；D1 落库依赖分组「入库」的三个 `CF_*` Secrets，未配则安全跳过。完整拓扑见 [docs/ops/01-方案.md](./docs/ops/01-方案.md)。

> 本机 19:00 主通道用的不是仓库 Secrets，而是**本机凭据**：`cd worker && npx wrangler login`（一次性 OAuth），或系统环境变量 `CLOUDFLARE_API_TOKEN`（权限 `Account → Cloudflare Pages → Edit`）+ `CLOUDFLARE_ACCOUNT_ID`。凭据未就绪时 21:05 云端兜底会补位。

> 所有定时任务执行后都会自动 commit：GitHub Actions 由 workflow 末尾的 commit 步骤负责，本地 WorkBuddy 自动化由任务 Prompt 里的「git 推送块」负责（脚本内部不再写 git，避免重复提交）。统一约定见 [`docs/automations/README.md`](./docs/automations/README.md)。

---

## 3. 日常发布（环境已就绪）

| 改动范围 | 命令 | 说明 |
|----------|------|------|
| 前端页面 / 样式 / `web/functions/` / **`worker/src/` API** | `npm run deploy`（根目录） | 最常用，一条命令；**改 worker 代码也走这条** |
| 需要透传参数时（`--api` / `--project` / `--branch`） | `cd web && npm run deploy -- --api https://api.example.com` | 参数只从 `web/` 下的脚本透传；根目录的 `npm run deploy` **不支持传参** |
| 写接口密钥 `WRITE_TOKEN` | `cd web && npx wrangler pages secret put WRITE_TOKEN --project-name candidate-pool-web`，再 `npm run deploy` | **必须配在 Pages 项目**（写接口跑在 Pages Functions 里）；secrets 改动要一次新部署才生效 |
| 建表脚本 / 入库逻辑 | `node db/backfill.js` | 幂等；改 `db/schema.sql` 需重跑 `wrangler d1 execute ... --remote` |
| 只跑当日报告 | `run_today.cmd`（Windows）/ `./run_today.sh` | 生成报告后自动同步 D1 |

> 本地自测：`cd web && npm run dev`（默认 `:5173`）+ `cd worker && npm run dev`（`:8787`）两个终端并行，Vite 把 `/api` 代理到 worker dev 后端。
> ⚠️ **本地 `worker dev` 只是开发用后端**，生产环境这个角色由 Pages Functions 承担——所以**不要用「有没有部署 worker」来判断线上是否生效**。
> 另外，建表 / 加密钥这类数据库与项目配置改动**不在 `npm run deploy` 的覆盖范围内**，需按上表单独执行。

### 发布脚本参数

| 配置项 | 优先级 | 默认 | 说明 |
|--------|--------|------|------|
| API 地址 | `--api` > `VITE_API_BASE` > `deploy.config.json:apiBase` | `""`（同源） | **空字符串 = 同源 `/api`**，不要写成 `REPLACE_ME` |
| Pages 项目名 | `--project` > `PAGES_PROJECT` > `deploy.config.json:projectName` | `candidate-pool-web` | |
| 分支 | `--branch` > `PAGES_BRANCH` > `deploy.config.json:branch` | `main` | 与项目 production branch 一致即生产发布 |

> 脚本内置守卫：`apiBase` 仍是占位符、或选了同源模式但缺 `web/functions/` 目录 → 直接退出（码 1），不会误发布。

---

## 4. 排查

| 现象 | 原因 | 处理 |
|------|------|------|
| `wrangler` 报找不到项目配置 | `pages deploy` 不支持 `--config` | 确保 cwd 是 `web/` |
| `/api/*` 返回 404 | Pages 项目里没有 `functions/` 或 `_routes.json` 未包含该路径 | 确认 `web/functions/`、`web/public/_routes.json` 存在后重新 `npm run deploy` |
| `/api/runs` 返回空数组 | D1 库是空的 | `node db/backfill.js`（先确认 `db/.env` 或系统环境变量已配 `CF_*`） |
| `npm ci` 失败：lock 与 package.json 不同步 | 加了依赖但没更新 `package-lock.json` | 在仓库根跑一次 `npm install` 并提交 `package-lock.json`（CI 用的是 `npm ci`，对 lock 一致性是强校验） |
| `Cannot find module 'dotenv'` | 根依赖未安装 | 仓库根执行 `npm install` |
| 浏览器打不开 `*.workers.dev` | DNS 污染 / SNI 拦截，**链路问题非服务故障**（本项目已不使用该域名） | 统一走 `*.pages.dev` 同源地址 |
| 改了 `worker/src/` 但线上没变化 | `worker/` 不是发布产物，改它**不会**被自动带上线 | 重新执行 `npm run deploy`（Pages Functions 打包时会一并更新） |
| `wrangler d1 execute` 报 binding 相关错误 | 漏了 `--remote` | 补上 `--remote` |
| 本地 `db/backfill.js --local` 报模块不存在 | Node < 22 无 `node:sqlite` | 升级到 Node 24+（engines 已统一要求 >=24） |

---

## 5. 历史报告归档与自动部署（2026-11-11）

### 为什么是「只在部署产物」归档

`main` 上的报告比 `daily-artifacts` 分支更及时、更齐全，但 3 个产物 workflow 会把
`reports/`、`data/`、`eod/reports/`、`eod/data/` **原样**同步到 `daily-artifacts` 部署 GitHub Pages。
物理重组原目录会直接打断 Pages 旧直链，所以一行都不动：

| 约束 | 落地方式 |
|------|----------|
| GitHub Pages 必须继续可用 | 原 4 个目录、3 个 workflow 全部不改；`/reports`、`/tail/reports` 仍指向 Pages |
| Cloudflare 复用现有项目 | 同一个 `candidate-pool-web`，报告走同源 `/archive/...`，不新建项目、无跨域 |
| 前端能枚举 | Cloudflare Pages 无目录列表 API → 构建期生成 `archive/index.json` 清单驱动 |

### 归档链路

| 阶段 | 文件 | 动作 |
|------|------|------|
| 构建期扫描 | `web/scripts/build-archive.mjs` | **只读**扫描 7 类报告 / 数据档，按类型复制到 `web/public/archive/`，写 `index.json`（含指纹 / 计数 / URL） |
| 自动触发 | `web/package.json` | `dev` / `build` 前都先跑扫描；`public/archive/` 已 gitignore，约 90MB 不入库 |
| 打包 | Vite | `public/` → `dist/archive/`，随 `npm run deploy` 同源发布 |
| PWA 护栏 | `web/vite.config.ts` | `globIgnores: ['**/archive/**']` 不预缓存 90MB；`navigateFallbackDenylist` 防止报告 HTML 被 SPA 兜底套壳 |
| 同源路由 | `web/public/_routes.json` | 只有 `/api/*`、`/health` 交 Functions，`/archive/**` 静态直出 |

7 类：次日候选 / 尾盘选股 / 盘前选股 / 游资席位 / 形态选股 / 胜率周报 / 观察池回流。
周报与回流自 2026-11-11 起统一为单文件 HTML（共用 `eod/lib/brief_report.js`），旧 `.md` 存档等价转成同名 HTML、原件保留。
改共享样式后执行 `npm run report:history-briefs` 重建两份历史存档（只换版式、不重算数值）；`npm run selftest` 内的 `--check` 会在版式落后时直接失败。

### 前端页面

`/reports/archive`（导航「历史报告归档」）：读 `/archive/index.json` → **两个下拉框**（报告类型 / 该类型下具体 HTML）→ `iframe` 同源加载；
选择写进 `?type=&file=` 便于分享，并显示同交易日的数据档链接。旧的两页报告查看器保持原样。

### 自动部署（无需每天手动 `npm run deploy`）

| 触发 | 时刻 / 条件 | 行为 |
|------|-------------|------|
| **本机自动化（主通道）** | **工作日北京时间 19:00** | 归档扫描 → 线上指纹幂等判断 → `cd web && npm run deploy`；排在 18:30 回填之后，当日报告已齐全。见 [`docs/automations/README.md`](./docs/automations/README.md) 第 15 节 |
| `schedule` 主触发 | ~~工作日 19:30~~ **已停用（2026-11-12）** | 与本机 19:00 同职责、重复；cron 以注释形式保留在 workflow 里，取消注释即可恢复 |
| `schedule` 兜底 | 工作日 21:05 | 仅在本机 19:00 未成功时补位；本机已发布则由幂等判断直接跳过，不会重复部署 |
| `push` | `main` 上 `web/**` 或本 workflow 变更 | 代码 / 页面 / 归档规则改动立即上线；报告数据提交等本机 19:00 统一发布，避免一天多次推 90MB |
| `workflow_dispatch` | 手动，可选 `force=true` | 强制重新部署 |
| 幂等 | 仅 `schedule` | 比对线上 `/archive/index.json` 的 `fingerprint` 与本地；一致则跳过，不一致才发布 |
| 并发 | `concurrency` 按 workflow + ref 分组 | 定时与 push 撞车时取消旧实例 |

> 时区是 `on.schedule[].timezone`（GitHub 官方支持 IANA 时区名），与 `daily-screen.yml` 同一套写法，不是默认 UTC。

> **主通道迁移（2026-11-12）**：GitHub schedule 排队延迟不可控，每日发布改由本机 19:00 自动化承担，云端只留 21:05 幂等兜底。
> 恢复 19:30 只需取消 `deploy-archive.yml` 里那两行 cron 注释，并**同时停用本机 19:00 自动化**，避免双主通道。

### Secrets（与非部署用的 `CF_*` 区分）

| Secret | 权限 | 说明 |
|--------|------|------|
| `CF_PAGES_TOKEN` | `Account → Cloudflare Pages → Edit` | **推荐**：单独给定时部署用，权限最小化 |
| `CF_API_TOKEN` | 原为 `Account → D1 → Edit` | 未配 `CF_PAGES_TOKEN` 时回落；**必须补上 Pages:Edit**，否则 `wrangler pages deploy` 会 403 |
| `CF_ACCOUNT_ID` | — | 账户 ID，与入库共用 |

workflow 把上述命名映射成 wrangler 要求的 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`。

### 排查

| 现象 | 原因 | 处理 |
|------|------|------|
| 归档页提示清单加载失败 | 本地没跑构建期扫描 | `cd web && node scripts/build-archive.mjs`（或 `npm run dev` 自动跑） |
| 下拉框少了一类 / 少几天 | `build-archive.mjs` 的 `TYPES` 正则没覆盖新文件名 | 加类型映射后重跑，前端无需改动 |
| 部署 403 / permission denied | 令牌缺 `Cloudflare Pages → Edit` | 配 `CF_PAGES_TOKEN` 或给 `CF_API_TOKEN` 补权限 |
| iframe 里套出一层站点自身 | Service Worker 把 `/archive/*.html` 兜底成 `index.html` | 确认 `navigateFallbackDenylist: [/^\/archive\//]` 仍在 `vite.config.ts` |
| 手机首次安装 PWA 极慢 | 归档进了预缓存 | 确认 `globIgnores: ['**/archive/**']`；`dist/sw.js` 的 precache 不应出现 archive |

---

## 6. 相关文档

| 文档 | 内容 |
|------|------|
| [`README.md`](./README.md) | 项目总览、规则说明、数据口径、接口一览 |
| [`db/.env.example`](./db/.env.example) | 入库凭据模板（复制为 `db/.env`） |
| [`notify_config.example.json`](./notify_config.example.json) | 微信 / 邮箱推送配置模板 |
| [`web/deploy.config.example.json`](./web/deploy.config.example.json) | 前端发布配置模板 |
