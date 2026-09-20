# 部署指南

一句话：**前端静态资源 + API 同源打包在一个 Cloudflare Pages 项目里**（API 用 Pages Functions 复用同一套 Hono 代码），数据存 **Cloudflare D1**，本地与 GitHub Actions 通过 **D1 HTTP API** 写入。

> 为什么不用独立 Worker：`*.workers.dev` 在中国大陆被 DNS 污染 + SNI 拦截，`*.pages.dev` 不受影响。同源方案既绕开这个坑，又免掉 CORS 与跨域地址配置。详见 [README · API 服务](./README.md#api-服务workers--pages-functions)。

---

## 1. 部署拓扑

| 层 | 产物 | 位置 | 部署方式 |
|----|------|------|----------|
| 前端 | Vue3 + Vite PWA 静态资源 | Cloudflare Pages | `npm run deploy`（根目录，等价于 `cd web && npm run deploy`） |
| API | Pages Functions（`/api/*`、`/health`） | 同一个 Pages 项目 | 同上（`wrangler pages deploy` 自动带上 `web/functions/`） |
| 数据 | D1 库 `candidate-pool` | Cloudflare D1 | `wrangler d1 execute` 建表 + `node db/backfill.js` 灌数 |
| 生成 | 每日报告 / 快照 | `daily-artifacts` 分支 | GitHub Actions 定时（工作日 15:35） |

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
| Node.js | **>= 18**（本地跑 SQLite 需 **>= 22**） | `node:sqlite` 是 Node 22 才有的内置模块，`db/backfill.js --local` 依赖它 |
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

**⑤ 建表（7 张表 + 9 个索引）**

```bash
cd worker
npx wrangler d1 execute candidate-pool --remote --file=../db/schema.sql
```

> **`--remote` 不能省**：`wrangler d1 execute` 默认跑 local 模式，会去读 `wrangler.toml` 的 binding 而报错。

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

配完即为全自动：工作日 15:35 实时抓取 → 提交 `daily-artifacts` → 同步 D1 → 微信/邮件通知。

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
| 本地 `db/backfill.js --local` 报模块不存在 | Node < 22 无 `node:sqlite` | 升级到 Node 22+ |

---

## 5. 相关文档

| 文档 | 内容 |
|------|------|
| [`README.md`](./README.md) | 项目总览、规则说明、数据口径、接口一览 |
| [`db/.env.example`](./db/.env.example) | 入库凭据模板（复制为 `db/.env`） |
| [`notify_config.example.json`](./notify_config.example.json) | 微信 / 邮箱推送配置模板 |
| [`web/deploy.config.example.json`](./web/deploy.config.example.json) | 前端发布配置模板 |
