# A股次日候选池 · 自动初筛

把 **A股短线交易** 的「标的初筛」流程固化为可定时运行的脚本：以一份**可编辑的行业观察池**（`candidates.json`，当前 377 只、覆盖 26 个申万一级行业）为候选起点，套用 **R01 量能验证突破 + R07 板块内补涨**（并以 **R05 尾盘异动** 核验），输出一份 **单文件、资源全内联、无外链、支持中英切换** 的 HTML 报告，并把实时结果**推送到个人微信 / 163 邮箱**。

行情数据直连**腾讯公开行情接口**，不依赖任何本机技能、CLI 或账号，装了 Node 就能跑（全量 377 只约 6 秒）。

> 报告即「观察评级」，不构成任何投资建议。详见文末免责声明。

---

## 环境要求

- **Node.js >= 18**（本地测试用 22）。运行时依赖仅 `dayjs`（`npm install` 一次即可，统一处理北京时间），其余功能零第三方依赖。
- **在线模式** 只要能访问下列腾讯公开接口即可，无需账号、Key 或任何本机技能：
  | 用途 | 接口 |
  |------|------|
  | 报价 / 市值 / 52周高 | `https://qt.gtimg.cn/q=<code>`（支持一次批量查上百只，GBK 编码） |
  | 日 K 线（前复权） | `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=<code>,day,,,260,qfq` |
  | 分时 | `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=<code>` |
- 运行脚本的 Node 路径可用 `CANDIDATE_NODE` 环境变量指定（旧变量名 `WESTOCK_NODE` 仍兼容）。
- **离线模式** 完全不发网络请求，从已提交的快照重建报告，任何机器 / CI 上都能跑。

## 工作目录（产物与配置的落点）

默认就是**本仓库根**——即「拉代码运行」的行为与历史完全一致，无需任何配置。

如果你把本仓库当作一个工具从**别处调用**（例如当作依赖装进 `node_modules`、或 `npx github:...`），
那么代码目录 ≠ 你的工作目录，产物会写进包目录（重装即丢）。此时显式指定工作目录：

```bash
# 环境变量（推荐：所有脚本都认，含 db/*.js）
CANDIDATE_POOL_HOME=/your/workdir node gen_candidates.js

# 或命令行（仅两个入口脚本）
node gen_candidates.js --cwd /your/workdir
node eod/tail_screener.js --cwd /your/workdir
```

工作目录下保持相同布局（相对路径不变，只是换了根）：`candidates.json`、`data/`、`reports/`、
`notify_config.json`、`eod/data/`、`eod/reports/`、`db/local.db`、`db/.env`。
而 `db/schema.sql`、`db/migrations/` 属于**代码资产**，永远跟程序走、不随工作目录移动。

想知道「文件到底写到哪去了」：

```bash
npm run paths                 # = gen_candidates.js --paths
node eod/tail_screener.js --paths
```

会打印解析出的工作目录、来源（env / argv / 包根）与全部落点。回归自测：`npm run paths:selftest`。

### 作为 npm 包运行（免拉代码）

```bash
npx candidate-pool --help         # 次日候选池初筛（= gen_candidates.js）
npx tail-screener --help          # 尾盘选股（= eod/tail_screener.js）
```

装包运行时默认工作目录是**当前目录**（而非包目录），因此产物落在你执行命令的地方；
`CANDIDATE_POOL_HOME` / `--cwd` 可覆盖。

**首次运行会自动补齐工作目录**（幂等，已有文件一个字节都不动）：

| 自动创建 | 说明 |
|---|---|
| `data/` `reports/` `eod/data/` `eod/reports/` `db/` | 产物目录 |
| `candidates.json` | 观察池，来自包内示例模板（52 只 / 26 个行业），**请按自己的口径替换**（推荐 `npx candidate-pool` 后跑 `node build_universe.js`） |

**不会**自动创建 `notify_config.json`（推送凭据）与 `db/.env`（D1 凭据）—— 占位值会让程序从
「未配置 → 跳过」变成「配了假值 → 真的去发」。它们只以 `cp` 命令的形式提示：

```bash
npx candidate-pool --init         # 只做初始化 + 打印可选配置的复制命令，不联网
npx candidate-pool --paths        # 只看落点（纯诊断，不产生任何写入）
```

> 定时任务与临时使用一律用 `npx candidate-pool`，**不固定版本**——阈值与口径的调整发布即生效。

### 发布（一条命令，npm publish 与 Release 在云端完成）

```bash
npm run release
```

一条命令跑完：类型门禁 → 未提交检测 → 选 patch/minor/major → changelogen 写版本号与 CHANGELOG
→ **打印 Release 说明预览**（CI 用的是同一个脚本，所见即所得）→ 提交 → 打 tag → push。

**不含部署**（已与发版解耦，见 [docs/npm-publish/03-计划.md](docs/npm-publish/03-计划.md) §5）；
需要上线前端与接口时单独 `npm run deploy`。

本机到此为止。tag 推送即触发 `.github/workflows/release.yml` 接力：
**版本一致性校验 → 离线自测 → 打包体检 → `npm publish`（需仓库 Secret `NPM_TOKEN`）→ 建 GitHub Release**，
收尾会把「运行日志 / npm 页面 / Release 页面」三条链接打出来。**本机不执行 `npm publish`。**

`npm run release:notes` 是上面那步预览的**独立入口**：只生成说明文本、**不发布任何东西**，
用于发版前核对或事后排障（它也支持「tag 还没创建」的预览场景，会自动按 HEAD 统计）。

```bash
npm run release:notes -- --tag v1.2.0                # 预览说明（默认打到 stdout）
npm run release:notes -- --tag v1.2.0 --source git   # 强制走 git 兜底分支，便于比对
npm run verify:pack                                  # 打包体检：敏感文件守门 + 必需文件 + 体积红线
```

---

## 数据存储与入库（本地 SQLite 开发 + Cloudflare D1 生产）

初筛结果除了产出 HTML 报告，还会**结构化入库**，用于日后复盘、入选后 N 日表现追踪，以及 Web / PWA 前端查询。两层存储共用同一套建表与写入逻辑——开发用本地 SQLite、生产用 Cloudflare D1，可无缝切换：

| 层 | 用途 | 客户端 | 触发方式 |
|----|------|--------|----------|
| 本地 SQLite | 开发 / 自查 | `db/sqlite_client.js`（Node 22 内置 `node:sqlite`，零依赖） | `node db/write_live.js --local`（当天）/ `node db/backfill.js --local`（全量） |
| Cloudflare D1 | 生产 / 线上查询 | `db/d1client.js`（Cloudflare D1 HTTP API） | 本机任务与工作流自动同步（见「GitHub Actions」一节） |

**写入目标由参数决定**（`db/clients.js` 统一解析，`backfill.js` 与 `write_live.js` 共用）：

| 参数 | 远程 D1 | 本地 `db/local.db` |
|------|---------|--------------------|
| （不带） | 有凭据则写 | 不写 |
| `--local` | 不写 | 写 |
| `--both` | 有凭据则写 | 写 |

> 本机日常任务（`run_today.cmd` / `run_today.sh`）已固定用 `--both`，跑完一次两端同时前进。

### 本地与线上一致性（`db/verify_sync.js`）

`db/local.db` 被 `.gitignore` 排除、**不在仓库里**，CI（GitHub Actions）根本碰不到它 —— 所以「两端一致」只可能由**本机**保证。此前默认只写远程，于是本机任务跑完后本地库永远停在旧数据上（表现为本地 `price_daily` 停在 613 行，线上已是 11,296 行）。

| 场景 | 命令 | 效果 |
|------|------|------|
| 本机日常跑任务 | `run_today.cmd` / `run_today.sh` | 报告 + **双写**（远程与本地同时更新） |
| 手动补当天 | `node db/write_live.js --both` | 只把最新一份快照写到两端 |
| 手动补全量 | `npm run db:sync` | = `backfill.js --both`，全量幂等重放，**哪端落后就补齐哪端** |
| 核对是否一致 | `npm run db:verify` | 逐字段比对派生表指纹，不一致则非 0 退出，可直接当定时任务哨兵 |
| GitHub 定时任务 | `daily-screen.yml` → `node db/backfill.js` | **只写远程**（CI 里没有本地库，也不需要） |

比对范围是**由快照派生的 4 张表**：`run_batch` / `pick_record` / `price_daily` / `stock_base`。
`watch_group` / `pick_group_rel` / `stock_note` 由网页写接口产生、只存在于线上，**明确排除**在比对之外。

因为 `data/snapshot-*.json` 是唯一真相来源，写入又是纯函数式规范化 + 幂等（UNIQUE 约束 + `run_at` recency guard），两端只要回放过同一批快照，指纹必然逐字段相等 —— **不需要增量同步，也不需要人工 diff**。

### D1 用量限额（免费额度按「扫描行数」计量，务必留意）

官方定价：<https://developers.cloudflare.com/d1/platform/pricing/>

| 计费项 | Workers Free | Workers Paid |
|--------|--------------|--------------|
| Rows read | **5,000,000 / 天** | 前 25 billion / 月，超出 $0.001 / 百万行 |
| Rows written | **100,000 / 天** | 前 50 million / 月，超出 $1.00 / 百万行 |
| Storage | 5 GB（账号合计） | 前 5 GB，超出 $0.75 / GB-月 |

关键细节：免费额度按**查询扫描到的行数**计，与行大小无关；过滤条件没走索引时，即便只返回少量行也按扫描量算。免费额度**每天 UTC 00:00 重置**，超额后当天 D1 直接拒绝查询。

本项目实测（2026-09-20，`price_daily` 11,296 行 / 261 只入选票）：

| 行为 | 行数 | 说明 |
|------|------|------|
| 日常入库（`write_live --both` 的远程侧） | ≈ 415 行写 | 19 入选 + ≈377 日线 + 19 档案；占日写额度 0.4% |
| 全量回填（`backfill --both` 的远程侧） | ≈ 13,300 行写 | 32 份快照重放；占日写额度 13% |
| `GET /api/stock-rank` | ≈ 8,240 行读 | 7,624（`price_daily`，已命中索引）+ 613（`pick_record`） |
| `GET /api/stats`（不带 `from`） | ≈ 8,240 行读 | 同上 |
| 打开一次「全部标的」+「复盘统计」 | ≈ 16,500 行读 | 占日读额度 0.33%，即免费额度约够 **300 次**页面访问 / 天 |

> ⚠️ **读量随 `price_daily` 线性增长**（全池逐日后约 377 行/交易日，一年 ≈ 9 万行），届时单次页面访问的读量会到 6 万行量级，免费额度只够约 80 次访问/天。相应对策：
> - `/api/stock-rank` 与 `/api/stats` 已加 `Cache-Control: max-age=300`（派生行情一天只变一次，重复打开页面不再产生 D1 读取）；
> - 只看某个区间时给 `/api/stats?from=YYYY-MM-DD`，`getStats` 会据此裁剪 `price_daily` 的扫描下界；
> - **不要**把 `backfill.js` 放进每日定时任务（每次重放全部历史，约 13k 行写）；日常只需 `write_live.js`；
> - 想进一步压读量，可把 N 周期收益在**写入时**算好并落到 `pick_record`，让汇总接口只读 613 行而非 8,000+ 行（未实施）；
> - 用量自查：Dashboard → D1 → 选中 `candidate-pool` → **Metrics → Row Metrics**（GraphQL Analytics API 也可，但 token 需具备 Account Analytics 读权限）。

### 表结构（带注释）

建表脚本在 `db/schema.sql`，共 **10 张表 + 12 个索引**，覆盖「运行批次 / 入选记录 / 日线行情 / 股票档案 / 分组 / 备注 / 尾盘选股 / 结构元信息」：

- `run_batch`：每次初筛（一个 anchor_date）一行汇总（全池数、各梯队数、K 线失败率、数据来源等）。
- `pick_record`：每次运行 × 每只入选票一行，`UNIQUE(run_id, code)`，**同一只票跨多个运行自动成多行**，满足「不同时期被收录全部保留、可区分」的复盘需求。
- `price_daily`：**全观察池 × 每个交易日的收盘**（一条 = 一个「代码 × 行情日」），是入选后 N 日表现复盘的收益底座。
  > **为什么必须全池逐日**：N 周期口径是「锚定日之后第 N 个**交易日**」的收盘 vs 入选价。只有每只票每个交易日都有行，`N1/N2/N3` 才真的等于 1/2/3 个交易日。
  > 历史实现只写「入选日」那一行，序列因此断档——下一行往往是该票**下一次被入选**那天，实测平均隔 **8.9 个自然日**（最长 37 天）、仅 19% 真的隔 1 天，于是 `N1` 报的其实是第 8~37 天，且「最近一次入选」口径结构性恒为 `null`。
  > 现已在 `db/normalize.js` 中改为**全池逐日写入**（快照 `stocks[]` 里 377 只各含 `r01.close`，停牌 / 无收盘不写行，避免 `null` 占掉一个交易日的位置）。回填后实测：N1 可得率 **57% → 96%**、N 列平均间隔 **8.9 → 1.4 天**、「最近一次入选」可得 **0/261 → 234/261**。
  > **存量数据需重跑一次回填**：`node db/backfill.js` 写**远程 D1**，`node db/backfill.js --local` 写 `db/local.db`。二者是**两个彼此独立的库**，不加 `--local` 时**完全不碰本地文件**；每日流水线（`daily-screen.yml`）走的也是远程，所以 `db/local.db` 本质是一个「手动快照」，不显式跑 `--local` 就会一直停在旧数据上。
  > 已回填并实测（远程 D1）：`price_daily` **11,296 行 / 397 只 / 32 个交易日**，`close` 无空值；32 天中 30 天为全池逐日（约 376 行/天），按锚定日逐日核算 `N1` 平均间隔 = **1 或 3 个自然日**（3 天 = 跨周末），整体 N1 可得率 **95.6%**。
  > ⚠️ **已知残留**：`2026-07-27`、`2026-08-07` 两个锚定日的快照是旧的 Top-12 格式（只含 12 只、无全池行情），共 **8 条**入选记录（613 条中的 1.3%）的 N 周期因此仍不可用或偏大；要彻底修正需从行情源补抓这两个日期区间的日线，暂未实施。
- `stock_base`：股票基础档案（名称 / 行业 / 题材 / 地域 / 主营 / 最赚钱业务），一票一档长期复用。
- `watch_group` / `pick_group_rel`：自定义主题分组（如「军工」「低位补涨」），一只票可加入多组。
- `stock_note`：按运行（anchor_date）或纯按票的评论 / 备忘。
- `tail_run`：尾盘选股运行批次，`PRIMARY KEY (trade_date, mode)`，`mode = formal`（14:50 固定口径）/ `observe`（14:30 起观察口径）；`runs_json` / `stats_json` 存当日多次运行历史与初筛漏斗（JSON）。
- `tail_pick`：尾盘选股候选，`PRIMARY KEY (trade_date, mode, code)`；六项打分在 `score_json`、尾盘段明细在 `tail_*`、收盘回填的 N1~N10 在 `fill_json`（P5 脚本写入，缺失时由 worker 从 `price_daily` 现算）。
- `schema_meta`：**结构同步元信息，业务代码不读**。记 `schema_hash`（本库已应用的 `schema.sql` 指纹）与 `mig:<文件名>`（已执行的增量迁移），用于核对两端结构是否同版本。

> ⚠️ 本节说的「10 张表」是 `schema.sql` 的期望结构；**代码里引用某张表不等于库里就有**。2026-09-21 线上四个尾盘页面全 500 就是因为 `tail_run` / `tail_pick` 只在代码与 schema.sql 里，两个库都没建。改完 schema 记得跑 `npm run db:migrate:both`（见上一节）。

> **表 / 列注释**：SQLite 没有原生 `COMMENT` 语法，本项目用 SQL 行内注释（`--`）写在 `CREATE TABLE` 里。这些注释会**原样写入 `sqlite_master` 的建表原文**，在 DB Browser for SQLite / DBeaver 的「DDL / SQL」视图中可直接看到中文列说明，无需额外文档。所有时间字段统一为「北京时间字符串」`YYYY-MM-DD HH:mm:ss`（无 `Z`），由 `dayjs` 生成，彻底杜绝裸 `new Date().toISOString()` 带来的 `+8h` 时差。

### 表 / 列 / 索引结构变更：一键同步（`npm run db:migrate`）

**唯一真相源是 `db/schema.sql`** —— 想加表、加列、加索引，只改这一个文件，然后跑一条命令把两端补齐。代码里不要再写第二份 `CREATE TABLE`（历史事故就是这么来的：同一份 DDL 曾散落在 `db/schema.sql`、`eod/lib/store_d1.js`、`db/persist.js` 三处，且两条「自动应用」路径都是坏的）。

| 命令 | 作用 | 什么时候用 |
|------|------|------------|
| `npm run db:migrate:dry` | **只打印差异，不写任何库** | 改完 schema.sql 先看一眼要动什么（默认只预览远程；加 `--local` / `--both` 可预览本地） |
| `npm run db:migrate` | 同步**线上 D1**（默认目标；无 `CF_*` 凭据则提示跳过） | 线上表缺失 / 落后 |
| `npm run db:migrate:local` | 同步**本地 `db/local.db`** | 本地表缺失 / 落后 |
| `npm run db:migrate:both` | **两端一起**（推荐，日常就用这个） | 所有结构变更 |
| `npm run db:selftest` | 跑结构同步的回归自测（零依赖，19 项断言） | 改动 `db/diff.js` / `db/migrate.js` 后 |

执行是**差异驱动**，不是「整份重放」：先把 `schema.sql`（期望）与库中 `sqlite_master`（实际）做结构比对，**只补真正缺的东西** —— 缺表 `CREATE TABLE`、缺列 `ALTER TABLE ADD COLUMN`、缺索引 `CREATE INDEX`。之所以必须做差异识别：`CREATE TABLE IF NOT EXISTS` 对**已存在**的表是空操作，整份重放**永远补不上新增字段**（本项目已手工加过 `run_at`、`vol_ratio`，都是这么补的）。

自动处理与需要人工介入的边界：

| 变更 | 处理方式 |
|------|----------|
| 新增表 / 新增列 / 新增索引 | ✅ 自动执行（`ALTER TABLE ADD COLUMN` 对存量行补 `NULL` 或 `DEFAULT`） |
| 新增列是主键 / `UNIQUE` / `NOT NULL` 且无 `DEFAULT` | ⚠️ 只**警告**不执行（SQLite 的 `ALTER` 不支持），需手写迁移 |
| 改列定义（类型 / 约束） | ⚠️ 只警告不执行（SQLite 不支持直接改列，需重建表） |
| 删列 / 删表 | ⚠️ 只警告不执行（涉及数据丢弃，**绝不静默删**） |

上面这些「⚠️ 需人工」的变更，写成 `db/migrations/NNN-描述.sql`（如 `001-rebuild-pick_record.sql`），`db/migrate.*` 会按文件名顺序执行，并在 `schema_meta` 里记录 `mig:<文件名>` 保证**只跑一次**。目录当前为空（还没有需要重建表的变更），不存在时自动跳过。

跑完会往 `schema_meta` 写一条 `schema_hash`（`schema.sql` 的 sha1 前 12 位），**两端 hash 相同 = 两端结构同版本**，一眼可核对：

```bash
# 服务端 / 本地都应是同一个 hash
node db/query_local.js "SELECT key,value,updated_at FROM schema_meta"
# 线上（D1）
npx wrangler d1 execute candidate-pool --remote --command "SELECT * FROM schema_meta"
```

CI 兜底：`daily-screen.yml` 在入库前会跑一次结构同步，所以**即使忘了手动跑，第二天线上也会自动补齐**（容器内无本地库，故只作用于远程）。

### 本地开发流程

```bash
# 1. 装依赖（dayjs 处理北京时间 + dotenv 加载 db/.env）
npm install

# 2. 跑一次实时初筛，生成 reports/ + data/snapshot-<日期>.json
node gen_candidates.js

# 3. 把快照规范化写入本地 SQLite（db/local.db，首次自动建表）
node db/backfill.js --local
#    历史全量回填（遍历 data/snapshot-*.json，可重复跑，幂等）
node db/backfill.js --local --dry     # 仅解析统计，不写库

# 4. 只读查询本地库（只允许 SELECT / WITH，避免误改）
node db/query_local.js                                       # 打印内置概览（批次 / 分类分布 / 多次入选）
node db/query_local.js "SELECT * FROM run_batch ORDER BY anchor_date"
node db/query_local.js "SELECT code,name,tier,reason FROM pick_record WHERE code='sz002594'"
```

`db/local.db*` 已被 `.gitignore` 忽略，不会入库。

### 部署到 Cloudflare D1（生产存储）

1. **建库**：在 Cloudflare 控制台 `Storage → D1` 创建数据库，或用 Wrangler：
   ```bash
   npx wrangler d1 create candidate-pool
   ```
2. **建表**：配好第 3 步的凭据后，跑一条命令按差异建表（推荐，幂等、可重复跑、顺带记录 `schema_hash`）：
   ```bash
   npm run db:migrate         # 只同步线上 D1
   npm run db:migrate:both    # 线上 + 本地 db/local.db 一起（日常用这个）
   ```
   兜底方案（不依赖项目脚本，直接执行整份 `db/schema.sql`；**只对新库有效**，已存在的表补不上新增字段）：
   ```bash
   npx wrangler d1 execute candidate-pool --remote --file=db/schema.sql
   ```
   > **务必加 `--remote`**：`wrangler d1 execute` 默认跑 local 模式，会去 `wrangler.toml` 找 binding 而报错；加 `--remote` 才作用于真实远程库（按库名命中，无需配置文件）。
3. **配置凭据**：复制 `db/.env.example` 为 `db/.env`（已忽略，不入库），填入三个变量；或直接写入系统环境变量：
   | 变量 | 含义 | 获取位置 |
   |------|------|----------|
   | `CF_ACCOUNT_ID` | 账户 ID | 头像 → Account Home → Account ID |
   | `CF_D1_DATABASE_ID` | D1 数据库 ID | `wrangler d1 create` 返回 / D1 详情页 |
   | `CF_API_TOKEN` | API 令牌 | API Tokens 页创建，权限勾选 `Account → D1 → Edit` |

   > `db/.env` 由 `db/d1client.js` 通过 **`dotenv`** 加载（`config({ path: db/.env })`），所有入库脚本（`backfill.js` / `write_live.js` / `enrich_stock_base.js`）共用。dotenv 默认**不覆盖已存在的变量**，因此 CI Secrets / 系统环境变量优先级更高。
   > ⚠️ 凭据命名有两套：**本项目脚本用 `CF_*`**，wrangler 用 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`，不要混用。
4. **全量初始化入库**（本地一次性把历史快照同步到 D1，幂等，可重复跑）：
   ```bash
   node db/backfill.js          # 不设 --local 且检测到 CF_* 即写入 D1
   ```
5. **每日自动同步**：`daily-screen.yml` 在生成报告后自动调用 `node db/backfill.js`，凭仓库 Secrets 中的 `CF_*` 把当日快照同步进 D1（详见下一节）。未配置 `CF_*` 时该步骤安全跳过，不影响报告生成。

> 写入是**幂等**的：`run_batch` 按 `anchor_date` UNIQUE、`pick_record` 按 `UNIQUE(run_id, code)`，`INSERT OR IGNORE / OR REPLACE`，重复跑不会重复插入。

---

## 用法

### 1. 在线（实时抓取）—— 默认模式

```bash
node gen_candidates.js                  # 锚定日 = 最近一个已收盘交易日，筛全部观察池
node gen_candidates.js --date 2026-07-27   # 回填指定日期
node gen_candidates.js --limit 50 --quiet  # 只取观察池前 50 只（默认 0 = 全部）
node gen_candidates.js --no-notify      # 实时运行但跳过微信/邮件推送
```

Windows 直接双击 `run_today.cmd` 亦可。**实时运行会**：
- 写出报告 `reports/stock_list_<锚定日>.html`
- 写出快照 `data/snapshot-<锚定日>.json`（供日后离线复现）
- 把结果摘要推送到 `notify_config.json` 配置的微信 / 邮箱渠道

> 同名文件重复运行时为**覆盖式写入**：每天一份，重复执行不产生多份堆积。

### 2. 离线（从快照重建，零网络请求 —— 推荐在 CI / 其他设备查看用）

```bash
npm run offline                                                          # 自动取 data/ 下日期最新的快照重建
node gen_candidates.js --offline --snapshot data/snapshot-2026-07-27.json   # 显式指定某天快照（可选）
```

### 3. 导出快照（先把某次在线结果存下来，供日后离线复现）

```bash
node gen_candidates.js --date 2026-07-27 --dump data/snapshot-2026-07-27.json
```

> 快照已剥离 `kline/quote/minute` 等大体积原始数据，仅保留判定所需字段，可安全入库。

### 4. 维护候选观察池

`candidates.json` 是整个流水线的入口，可以直接手工编辑（增删 `stocks` 条目即可）。
若要批量刷新或校验，用 `build_universe.js`：

```bash
node build_universe.js --dry     # 只体检不写文件：打印剔除明细与各行业成分数
node build_universe.js           # 重新生成 candidates.json
node build_universe.js --min-cap 30   # 自定义市值下限（亿），默认 15
```

种子清单维护在 `build_universe.js` 顶部的 `SEED`，**只需要写「6 位代码 + 申万一级行业」**，其余全部由接口回填与校验：

- 自动补 `sh` / `sz` / `bj` 前缀，自动去重
- 剔除代码不存在、长期停牌无价、名称含 `ST`/`退` 的标的
- 剔除总市值低于下限的标的
- 股票名称**一律以接口返回为准**（并去掉「五 粮 液」这类交易所原始简称里的空格），避免人工维护的名称与代码错配

选池有两条硬约束，改动时请留意：

1. **R01 的市值门槛是 20–500 亿**，池子里全塞大盘白马会导致 C5 几乎无人通过、常年零触发；
2. **R07 的行业中位涨幅需要样本量**，每个行业建议不少于 5 只，否则「补涨」判定没有意义（脚本会对 <5 只的行业给出告警）。

---

## 结果推送（微信 / 163 邮箱）

实时运行结束后，脚本自动调用 `notify.js` 把结果摘要推送出去（离线模式不推送）。

### 配置（二选一，凭据不要提交）

**方式 A：本地文件** — 复制模板后填写：

```bash
cp notify_config.example.json notify_config.json
```

```jsonc
{
  "wechat": {
    "provider": "serverchan",          // serverchan | pushplus
    "key": "SCTxxxxxxxx",              // serverchan 的 SendKey
    "token": ""                        // pushplus 的 token（provider=pushplus 时用）
  },
  "email": {
    "smtp_host": "smtp.163.com",
    "smtp_port": 465,
    "sender": "you@163.com",
    "auth_code": "你的163授权码",       // 不是登录密码，是邮箱设置里生成的授权码
    "receiver": "you@163.com"          // 可省略，默认同 sender
  }
}
```

**方式 B：环境变量**（适合 CI / self-hosted runner，避免把凭据放到仓库）：

```
NOTIFY_WX_PROVIDER / NOTIFY_WX_KEY / NOTIFY_WX_TOKEN
NOTIFY_MAIL_SENDER / NOTIFY_MAIL_AUTH / NOTIFY_MAIL_RECEIVER / NOTIFY_MAIL_HOST / NOTIFY_MAIL_PORT
```

- 微信：Server酱 `https://sctapi.ftqq.com/{key}.send` 或 PushPlus `https://www.pushplus.plus/send`（markdown 模板）。
- 邮箱：163 `SMTP_SSL`（smtp.163.com:465），HTML 报告作为附件发送；`notify.js` 用 Node 内置 `tls` 实现，**无需 nodemailer**。
- 自检：`npm run notify` 会打印「微信/邮箱是否已配置」。
- 未配置任何渠道时优雅跳过，不影响报告生成。

---

## 规则速览

| 规则 | 含义 | 关键门槛 |
|------|------|----------|
| **R01** 量能验证突破 | 量价齐升的突破形态 | C1 量≥近5日均量150% ｜ C2 收盘突破前10日高 ｜ C3 涨幅3%–8% ｜ C4 换手≥3% ｜ 市值20–500亿 ｜ 未处52周高位区 |
| **R07** 板块内补涨 | 强势板块里的滞涨标的 | 所属申万一级行业居前10%，且个股涨幅 < 行业涨幅的一半 |
| **R05** 尾盘异动 | 尾盘资金抢筹 | 14:30–15:00 涨幅≥2% 且 尾盘量能占比≥20% 且 全天涨幅<7%（净流入需 L2，分时接口不含） |

报告按「重点关注（R01 全部门槛达标）/ 次级关注（核心3/4且市值达标）/ 条件观察 / 排除」四档分类。

---

## 数据来源与口径

- 数据来源：腾讯公开行情接口，数据时点为锚定日收盘。
- 候选起点为 `candidates.json` 观察池（不再依赖任何排行榜接口），因此**不存在排行时点与行情时点错配**的问题。
- 日线取**前复权**（`fqkline/get ... qfq`），截断至锚定日，不使用之后数据。
- 板块涨幅 = 观察池内**同行业成分股当日涨幅的中位数**。这是自建口径，不等于官方申万行业指数涨幅，但胜在可回溯到任意历史日期，且与「池子里实际能买的标的」口径一致。
- 市值对总市值与流通市值**同时**校验。
- 涨跌分布 / 市场画像：本环境无全市场公开数据源，报告中明确标注「暂不可用」，不以任何替代指标充数。
- **R05 数据缺口声明**：分时接口只返回**最新交易日**，回填历史锚定日时分时不可得，明确标注为「数据缺口」而非信号缺失，绝不编造替代指标。

### 接口的几个坑（都已在代码里处理，改动前请先看）

| 坑 | 实际情况 |
|----|----------|
| K 线排序 | 腾讯按日期**升序**返回（最旧在前）。代码内部统一翻转为降序，保证 `hist[0]` 是前一交易日。若误用升序，算出来的「日涨幅」会变成**近一年涨幅**。 |
| 复权 | `kline/kline` 是不复权，`fqkline/get?...,qfq` 才是前复权，读 `qfqday` 字段。 |
| 市值字段 | `idx44 = 流通市值`、`idx45 = 总市值`，**别搞反**。可用中国石油验证：44=17568亿（A股流通），45=19857亿（总股本 1830.21 亿股 × 股价）。 |
| 成交量单位 | 主板/创业板是**手**（1手=100股），科创板 `sh688`/`sh689` 直接就是**股**。金山办公按「手」折算成交额会得到荒谬的 2600 亿。代码按代码前缀区分，并对换手率 >100% 的结果做自动纠偏。 |
| 换手率 | 报价里的 `idx38` 只反映「此刻」，**盘前恒为 0**，且口径是当日而非锚定日。代码一律按「锚定日成交量 ÷ 流通股本」自行推算（流通股本 = 流通市值 ÷ 现价）。 |
| 编码 | `qt.gtimg.cn` 返回 **GBK**，直接按 UTF-8 读会把股票名读成乱码。 |
| 行长度可变 | K 线某些行会多出第 7 个元素（除权分红信息，如宁德时代 `10派14.11元`），解析时只取前 6 个字段。 |
| **WAF 反爬拦截** | 高频拉取会被腾讯 WAF 拦截，返回 **HTTP 501** + 一张 `waf.tencent.com` 跳转页（`<!DOCTYPE html>...window.btoa...`）。它**不是**网络错误，短退避重试拿到的还是同一张页面。限流是**按接口路径**算的：`web.ifzq` 的 `fqkline` 被封时，同主机的 `minute/query` 和镜像域名照常可用。 |

> 自检小技巧：跑完看一眼全池涨幅区间，正常应当严丝合缝落在 **±10%**（科创/创业板 ±20%）以内。若出现 ±100% 这种数字，基本可以断定是排序或字段映射出了问题。

### 抗封与数据健康度

被 WAF 拦截时最危险的不是报错，而是**不报错**——每只票都取不到 K 线，下游就把它们全判成「不满足条件」，最终输出一份「今日 0 触发」的报告并照常推送微信。这跟真实的清淡行情**长得一模一样**，极难察觉。为此做了两道防线：

**1. K 线端点故障转移链**（按顺序自动降级，命中后用粘性指针记住可用端点，后续标的不再撞墙）

| 顺序 | 端点 | 复权 |
|----|------|------|
| 1 | `web.ifzq.gtimg.cn/.../fqkline/get` | 前复权 |
| 2 | `ifzq.gtimg.cn/.../fqkline/get`（去掉 `web.`） | 前复权 |
| 3 | `proxy.finance.qq.com/ifzqgtimg/.../fqkline/get` | 前复权 |
| 4 | `web.ifzq.gtimg.cn/.../kline/kline` | **不复权**（兜底，除权日附近会失真，日志会标注） |

**2. 数据健康度闸门**：K 线失败率超过红线（默认 20%）即判定数据源不可用，**中止运行、以退出码 1 退出**，不生成报告、不覆盖快照、不推送通知。CI 会因此直接标红，而不是悄悄发一条假的「无候选」。

可调环境变量：

| 变量 | 默认 | 说明 |
|------|------|------|
| `CANDIDATE_CONCURRENCY` | `6` | 并发数。被拦截时调到 `3` 更稳；377 只在 6 并发下约 10~15 秒。 |
| `CANDIDATE_MAX_FAIL_RATE` | `0.2` | 健康度红线。 |

被拦截后若想尽快恢复：降并发 + 避开盘中时段重试即可，链路一般在分钟级自行解封。

---

## GitHub Actions 配置与使用流程

**默认 `live`（实时抓取），在 GitHub 托管 Runner（`ubuntu-latest`）上直接运行——不再需要 self-hosted runner。**

> 这是脱离 westock 之后的直接收益：过去 live 依赖本机内置技能，调度触发只能退化跑 offline；现在数据源是公开 HTTP 接口，托管 Runner 就能实时抓取。
> 工作流对实时步骤设了 `continue-on-error`，万一 Runner 所在网络访问不到腾讯接口，会自动回退到「用仓库内最新快照重建报告」，保证每天都有产物，并在 Summary 里标一条 warning 提示当次数据非当日口径。

### 第 1 步：配置仓库 Secrets

仓库 `Settings → Secrets and variables → Actions → New repository secret`。

**行情数据无需任何凭据**。以下按用途分两组：

**A. 结果推送（仅实时运行需要）**

| Secret | 说明 |
|--------|------|
| `NOTIFY_WX_PROVIDER` | `serverchan` 或 `pushplus`（可选，缺省 serverchan） |
| `NOTIFY_WX_KEY` | Server酱 SendKey（用微信推送时必填） |
| `NOTIFY_WX_TOKEN` | PushPlus token（provider=pushplus 时填） |
| `NOTIFY_MAIL_SENDER` / `NOTIFY_MAIL_AUTH` | 163 邮箱与授权码（用邮件推送时填） |
| `NOTIFY_MAIL_RECEIVER` / `NOTIFY_MAIL_HOST` / `NOTIFY_MAIL_PORT` | 收件人 / SMTP 主机 / 端口（可选，有默认值） |

**B. 入库同步（可选，配置后每天自动同步到 Cloudflare D1）**

| Secret | 说明 |
|--------|------|
| `CF_ACCOUNT_ID` | Cloudflare 账户 ID |
| `CF_D1_DATABASE_ID` | D1 数据库 ID |
| `CF_API_TOKEN` | Cloudflare API 令牌，权限 `Account → D1 → Edit` |

> 本地运行则不用 Secrets，推送放一份 `notify_config.json`（已被 `.gitignore` 忽略）；入库放一份 `db/.env`（同样被忽略，或写系统环境变量）。

### 第 2 步：触发

- **手动**：`Actions → Daily A-Share Screening → Run workflow`。`mode` 默认 `live`，另可填 `date` 回填指定锚定日。
- **定时**：`cron 35 7 * * 1-5`（北京时间 15:35，周一至周五），**走实时抓取**。

### 输出与提交

- 实时运行按锚定日写出 `reports/stock_list_<锚定日>.html` 与 `data/snapshot-<锚定日>.json`（每天一份，覆盖式）。
- **产物与代码分库**：这些报告/快照由工作流提交到独立的 `daily-artifacts` 分支，**不污染 `main` 代码分支**；`main` 始终只放代码，本地提交代码也不会与定时任务撞车。推送用 `GITHUB_TOKEN`（`permissions: contents: write`），无需 PAT。
- **本地仍可提交产物**：你本地想保留报告/快照，照常把它们提交到 `main` 即可，与定时任务写入的 `daily-artifacts` 互不影响。
- **入库同步（可选）**：若配置了 `CF_*` Secrets，工作流在提交报告后会自动调用 `node db/backfill.js`，把当日（及全部历史）快照规范化写入 Cloudflare D1。未配置时该步骤安全跳过，不影响报告。写入幂等，重复运行不会重复插入。

---

## API 服务（Workers / Pages Functions）

初筛数据入库到 Cloudflare D1 后，需要一套接口供 Web / PWA 前端读写。本项目用 **Hono + TypeScript** 写一套 API（代码放在 `worker/` 目录），把 D1 暴露成统一 `{ code, message, data }` 结构的 JSON 接口，与另一套服务（`zhiliaowo-proxy`）的响应规范保持一致。

**部署形态：Pages Functions，与前端同源。API 代码不单独部署。**

| 形态 | 入口 | 访问地址 | 说明 |
|------|------|----------|------|
| **Pages Functions** | `web/functions/` → 复用 `worker/src/pages.ts` | `*.pages.dev/api/*` | 与前端**同源**：免 CORS、免跨域地址配置，且 `*.pages.dev` 在国内可达 |

> `worker/` 目录**不是发布产物**，它只承担两件事：① 存放被 Pages Functions 复用的 Hono app（`src/lib/*`、`src/types.ts`、`src/pages.ts`）；② 本地开发时用 `npm run dev` 起一个 dev 后端。
> **改了 `worker/src/` 下的代码，同样只需要发布前端**（根目录 `npm run deploy`）即可生效——不需要、也不应该再去部署独立 Worker。
> 历史上支持过「独立 Worker」形态（`*.workers.dev`），因中国大陆 DNS 污染 + SNI 拦截，已从发布流程中移除。

### 目录与依赖

| 文件 | 作用 |
|------|------|
| `worker/src/index.ts` | Hono app 入口：注册路由、CORS、统一错误处理 |
| `worker/src/pages.ts` | Pages Functions 适配层：把同一个 Hono app 转成 Pages 的 `onRequest` 签名 |
| `worker/src/lib/response.ts` | 统一信封 `ok / fail`（`{ code, message, data }`）+ 业务码常量 |
| `worker/src/lib/db.ts` | D1 查询封装（批次 / 详情 / 选股史 / N 日表现 / 汇总排名 / 复盘统计） |
| `worker/src/lib/notes.ts` | 写接口数据层（分组、分组内成员、评论 / 备忘的增删改） |
| `worker/src/lib/errors.ts` | `BizError` 与 `invalid / notFound / conflict` 业务错误工厂 |
| `worker/src/lib/validate.ts` | 入参校验（代码 / 日期 / 颜色 / 长度 / 枚举），不合法即抛 `10003` |
| `worker/src/lib/time.ts` | 北京时间字符串（dayjs + `Asia/Shanghai`），与脚本 / 前端同一口径 |
| `worker/src/types.ts` | 接口类型 + `Bindings`（D1 binding、`WRITE_TOKEN`） |
| `worker/wrangler.toml` | **仅本地** `wrangler dev` 用（D1 绑定），不参与发布 |
| `worker/package.json` | `hono` + `dayjs` 运行时依赖；`wrangler` / `typescript` 开发依赖 |

> **环境注入说明**：两条链路的注入方式不同，别混用。
>
> | 运行位置 | 注入方式 | 是否需要 dotenv |
> |----------|----------|-----------------|
> | Pages Functions 运行时（含本地 `wrangler dev`） | `wrangler.toml` 的 `[[d1_databases]]` binding → `c.env.DB`；本地 `wrangler dev` 读 `.dev.vars`，生产用 `wrangler pages secret put`（**配在 Pages 项目上，不是 Worker**） | ❌ 不需要（不是 Node 环境） |
> | 本机 / CI 的入库脚本（`db/*.js`） | `dotenv` 读 `db/.env`，或直接用系统环境变量 / CI Secrets | ✅ 需要 |
>
> **只读接口无需任何密钥**；写接口（分组 / 评论 / 备忘）需要 `WRITE_TOKEN`，配置步骤见 [DEPLOY.md · 日常发布](./DEPLOY.md#3-日常发布环境已就绪)。

### 接口一览

| 方法 | 路径 | 说明 | 关键参数 |
|------|------|------|----------|
| GET | `/api/runs` | 运行批次列表（按锚定日倒序） | `?limit=30`（1–100） |
| GET | `/api/runs/:anchor` | 某日运行详情：批次汇总 + 当日全部入选票 | `?tier=high\|secondary\|conditional\|excluded` 可只取某梯队 |
| GET | `/api/stocks/:code` | 某票全量选股史 + 分组 + 备注 + 入选后 N 日表现 | 无 |
| GET | `/api/stock-base` | 股票档案库（可按名称/代码搜索、按分组过滤） | `?q=关键词`、`?group=分组名` |
| GET | `/api/groups` | 自定义分组列表（前端筛选 chips 用） | 无 |
| GET | `/api/stats` | 复盘统计：区间内 N1/N2/N3/N5/N7/N9/N10 命中率与均值 + 各档位 + 锚定日时间线 | `?from=YYYY-MM-DD`、`?to=YYYY-MM-DD`（可选） |
| GET | `/api/stock-rank` | 全部入选标的汇总：每只票的入选次数、各档数量、首次 / 最近入选日，以及 N1/N2/N3 收益（`n*_avg` 历史平均口径 + `last_n*` 最近一次入选口径） | `?sort=recent\|first\|picks\|high\|secondary\|conditional\|excluded\|n1\|n2\|n3\|ln1\|ln2\|ln3\|code`、`?order=desc\|asc`、`?limit=`（默认 1000，上限 5000）。**`sort` / `order` 走白名单校验，非法取值返回 `10003`**（不静默回落，避免「看着合理、口径已换」） |
| GET | `/health` | 健康检查 | 无 |

**写接口**（分组 / 评论 / 备忘）需带 `x-write-token` 请求头，值为 Pages 项目里配置的 `WRITE_TOKEN`；未配置或令牌不符一律返回业务码 `10005`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/groups/:id` | 单个分组详情（组信息 + 成员列表） |
| POST | `/api/groups` | 新建分组 |
| PUT | `/api/groups/:id` | 改分组（只传要改的字段，显式传 `null` = 清空） |
| DELETE | `/api/groups/:id` | 删分组（先解除组内关联，再删组） |
| POST | `/api/groups/:id/stocks` | 把某票加入分组（重复加入为幂等更新组内备注） |
| DELETE | `/api/groups/:id/stocks/:code` | 把某票移出分组 |
| POST | `/api/notes` | 新增评论 / 备忘（可关联某个 `anchor_date`，不传即通用备注） |
| PUT | `/api/notes/:id` | 改评论内容 / 类型 / 关联锚定日 |
| DELETE | `/api/notes/:id` | 删评论 |

所有成功响应形如 `{ "code": 200, "message": "success", "data": ... }`。`code` 是**业务码**（非 HTTP 状态码）：200 表示成功，非 200 为业务错误码——如 `10001` 通用错误、`10002` 资源不存在、`10003` 参数错误、`10004` 服务内部错误、`10005` 写权限校验失败（`WRITE_TOKEN` 未配置或令牌不匹配）。`/api/runs/:anchor` 在锚定日不存在时返回 `{ "code": 10002, "message": "未找到锚定日 ...", "data": null }`，**HTTP 状态恒为 200**，前端统一读 `code` 判定即可。`/api/stocks/:code` 的 `data.picks[].perf` 给出该票相对入选价（锚定日收盘）的 `n1 / n2 / n3 / n5 / n7 / n9 / n10` 日涨幅（%），缺数据时为 `null`——这是复盘统计的底座。

### 本地开发

```bash
cd worker
npm install
npm run dev            # 直连真实 D1（--remote），前提是已按上文建库建表
# 或本地 D1（首次需先建本地库并灌表）：
#   npm run dev:local
#   npx wrangler d1 execute candidate-pool --local --file=../db/schema.sql
#   node ../db/backfill.js --local
```

> ⚠️ 注意这里有**两个不同的「本地库」**，别混：`npx wrangler d1 execute --local` 操作的是 wrangler/miniflare 的本地 D1（存在 `worker/.wrangler/state`），只服务于 `npm run dev:local` 起的后端；而 `db/*.js` 脚本（`backfill.js --local`、`query_local.js`）读写的是仓库根的 `db/local.db`。**结构变更要同步的是后者**（`npm run db:migrate:local`）。

> 这里的 `worker` 只起**本地 dev 后端**（`http://127.0.0.1:8787`）的作用，前端 `cd web && npm run dev` 会把 `/api` 代理过去。
> 它不是发布形态——生产由 Pages Functions 承担，前端 `npm run dev` 也应对着真实数据读写（见上文「部署形态」）。

> ℹ️ 本项目**不部署独立 Worker**。历史上支持过 `cd worker && npm run deploy`（产出 `*.workers.dev` 地址），
> 但该域名在中国大陆被 DNS 污染 + SNI 拦截，且前端同源 `/api` 根本不依赖它，因此**已从发布流程中移除**。
> `worker/` 目录现在的定位只有两个：① 存放被 Pages Functions 复用的 API 代码；② 本地开发用的 dev 后端。
> 改了 `worker/src/` 下的代码，同样只需发布前端即可生效。

### 部署到 Pages Functions（同源）

把 API 挂到已有的 Pages 前端项目下，与静态资源**同源**，彻底绕开 `*.workers.dev`：

| 文件 | 作用 |
|------|------|
| `web/wrangler.toml` | Pages 项目配置：`pages_build_output_dir` + `[[d1_databases]]`（与 worker 同一个库） |
| `web/functions/api/[[route]].ts` | 文件路由：`/api/*` 全部转发给共享 Hono app |
| `web/functions/health.ts` | 文件路由：`/health` |
| `web/public/_routes.json` | 限定仅 `/api/*` 与 `/health` 触发 Functions，静态请求保持免费不限量 |

部署命令就是前端的「一键发布」——根目录 `npm run deploy`，或 `cd web && npm run deploy`（两者等价，都会构建后发布），**无需额外步骤**。要点：

| 事项 | 说明 |
|------|------|
| 访问地址 | `https://candidate-pool-web.pages.dev/api/runs`、`.../health` |
| 前端地址配置 | `apiBase` 留**空字符串**（走相对 `/api`），不再指向外部 Worker |
| CORS | 同源，已不需要（Hono 中仍保留，不影响） |
| 依赖 | 与 `worker/` 共用同一套运行时依赖（`hono` / `dayjs`），由 `worker/node_modules` 解析即可，`web/` 无需为 API 额外安装 |
| 配置源 | `web/wrangler.toml` 含 `pages_build_output_dir` 后成为该 Pages 项目的配置源，控制台对应字段转为**只读** |

### 部署后验证

一条命令冒烟（Node 18+ 内置 `fetch`，零依赖；检测到代理环境变量会自动走代理）：

```bash
cd worker
npm run smoke -- --api https://candidate-pool-web.pages.dev
# 或：WORKER_URL=https://... npm run smoke
```

校验项：`/health`、`/api/runs`、`/api/stats`、`/api/groups`，以及「最新批次 → 当日入选 → 个股详情（含 perf）」的深度链路；每项校验 HTTP 200 + 业务码 200。

也可直接用浏览器打开（GET 返回 JSON）：

| 地址 | 期望 |
|------|------|
| `/health` | `{"code":200,"message":"success","data":{"ok":true,...}}` |
| `/api/runs?limit=3` | 最近 3 个批次数组 |
| `/api/stats` | 统计对象（`total_picks`/`tiers`/`timeline`） |
| `/api/stocks/<code>` | 个股详情（`picks[].perf` 含 n1–n10 全量周期） |

> ⚠️ 中国大陆网络直连 `*.workers.dev` 会被 DNS 污染 / SNI 拦截（解析到非 Cloudflare IP、TCP 超时），属**链路问题而非服务故障**；`*.pages.dev` 不受影响。本项目已统一走 [Pages Functions 同源部署](#部署到-pages-functions同源)，本机可直接验证。

---

## Web 前端（Vue3 + Vite PWA）

只读查询前端，消费上面的 API，提供「候选列表 / 复盘统计 / 规则释义 / 个股复盘」四页，支持 PWA 安装到手机桌面。**生产环境由本项目的 Pages Functions 同源提供 `/api/*`**，无需跨域。

### 目录与依赖

| 文件 | 作用 |
|------|------|
| `web/package.json` | `vue` / `vue-router` 运行时；`vite` / `@vitejs/plugin-vue` / `vite-plugin-pwa` / `vue-tsc` 开发依赖 |
| `web/vite.config.ts` | Vite + Vue 插件 + PWA；`server.proxy` 把 `/api` 代理到 `wrangler dev`（:8787），免跨域 |
| `web/src/api/client.ts` | 统一 fetch 封装，**读业务码判定**（200=成功，1000x=业务错误，非 200=传输异常） |
| `web/src/api/types.ts` | 与 Worker `types.ts` 对齐的前端镜像类型 |
| `web/src/views/` | `RunsView`（候选列表）/ `AllStocksView`（全部标的汇总）/ `StatsView`（复盘统计）/ `RulesView`（规则释义）/ `StockView`（个股复盘） |
| `web/functions/` | Pages Functions：把 `/api/*`、`/health` 转发给共享 Hono app（同源部署 API） |
| `web/wrangler.toml` | Pages 项目配置：`pages_build_output_dir` + D1 绑定（与 worker 同一个库） |
| `web/public/_routes.json` | 限定 Functions 只接管 `/api/*` 与 `/health`，其余走静态资源 |
| `web/scripts/deploy.mjs` | 一键发布脚本：构建（注入 `VITE_API_BASE`）+ wrangler 推送 Pages，复用 worker 的 wrangler |
| `web/src/constants/glossary.ts` | 规则 / 档位 / N 日周期 / 字段释义的**唯一事实来源**，四个页面统一引用 |
| `web/src/utils/date.ts` | 日期工具（dayjs + `Asia/Shanghai`），如「近一月」区间计算 |

### 页面与口径

| 页面 | 路由 | 主要能力 |
|------|------|----------|
| 候选列表 | `/` | 锚定日下拉（倒序）、档位过滤 + 关键词搜索、分页；量比 / 换手率 / 流通市值 / 总市值等列；进详情返回时恢复列表状态 |
| 全部标的 | `/stocks` | 按个股汇总历史入选：入选次数 + 各档数量（重点 / 次级 / 条件 / 排除）+ 首次 / 最近入选日；**列头可排序**（数量列按多→少、时间列按近→远），默认最近入选倒序；关键词搜索 |
| 复盘统计 | `/stats` | **默认最近一月**（可切近三月 / 全部）；各档命中率（每格**上行胜率、下行平均收益**，避免表过宽）；平均收益走势（N1–N10 全量，**可勾选 / 取消周期**）；锚定日明细（**倒序**）；统计口径 |
| 规则释义 | `/rules` | R01 / R07 / R05 门槛、四档划分（重点 / 次级 / 条件 / 排除）、判定标记位、**N1–N10 全量周期一览**、字段释义、统计口径 |
| 个股复盘 | `/stock/:code` | 档案 / 备注、各周期复盘汇总（逐 N 样本 · 均值 · 最佳 · 最差）、每期入选的 N 列全量表现 |

> 口径说明集中在 `web/src/constants/glossary.ts`，四个页面统一引用——改一处即全站生效，避免「有的页面只写到 N5」这类不一致。

### 本地开发

```bash
cd web
npm install
npm run dev          # 默认 :5173，/api 自动代理到本地 Worker（需另开终端跑 worker 的 npm run dev）
```

> 前端 `npm run dev` 与 Worker `npm run dev` 两个终端并行：前端拿 `/api/*`，Vite 代理到 Worker 的 :8787。

### 一键发布（Cloudflare Pages）

前端内置发布脚本 `web/scripts/deploy.mjs`（跨平台，`npm run deploy`）：先注入 `VITE_API_BASE` 构建，再用 wrangler 推送到 Cloudflare Pages。wrangler 直接**复用 `worker/node_modules` 里已装的那份**，前端无需再单独安装。

脚本以 `web/` 为工作目录执行，wrangler 会自动发现同级的 `web/functions/` 与 `web/wrangler.toml` —— **一次发布同时上线前端与 API**。

**首次准备（各一次）**

| 步骤 | 命令 / 操作 | 说明 |
|------|-------------|------|
| 1 | 复制 `web/deploy.config.example.json` → `web/deploy.config.json` | 保持 `apiBase: ""`（同源模式）；该文件已被 `.gitignore` 忽略 |
| 2 | `cd web && npx wrangler pages project create candidate-pool-web --production-branch main` | 仅当 Pages 项目尚不存在时执行一次 |

**之后每次发布**

```bash
cd web
npm run deploy                                    # 读 deploy.config.json（默认同源）
npm run deploy -- --api https://api.example.com   # 改调外部 Worker（跨源）
```

| 配置项 | 优先级 | 默认 | 说明 |
|--------|--------|------|------|
| API 地址 | `--api` > `VITE_API_BASE` > `deploy.config.json:apiBase` | `""`（同源） | **空 = 同源 `/api`**；填绝对地址 = 跨源调用外部 Worker |
| Pages 项目名 | `--project` > `PAGES_PROJECT` > `deploy.config.json:projectName` | `candidate-pool-web` | |
| 分支 | `--branch` > `PAGES_BRANCH` > `deploy.config.json:branch` | `main` | 与项目 production branch 一致即为**生产发布** |

发布后：

| 地址 | 期望 |
|------|------|
| `https://candidate-pool-web.pages.dev/` | 前端页面 |
| `https://candidate-pool-web.pages.dev/health` | `{"code":200,"message":"success","data":{"ok":true,...}}` |
| `https://candidate-pool-web.pages.dev/api/runs?limit=3` | 最近 3 个批次 |

脚本在构建前有守卫：`apiBase` 仍是占位符、或选了同源模式但缺 `functions/` 目录时**直接退出（码 1）**，不会误发布。

> 手动方式（不用脚本）：
> ```bash
> cd web     # 必须是 web/：wrangler pages deploy 只读当前目录的 wrangler.toml，且不支持 --config
> VITE_API_BASE= npm run build    # 产物 dist/，同源模式
> npx wrangler pages deploy dist --project-name candidate-pool-web --branch main
> ```

## 发布流程（版本 + Changelog + 类型门禁 + 提交校验 + npm 发布 + Release）

统一在**仓库根目录**执行 `npm run release`，一条命令串起全流程。**发布前请先 `npm install` / `npm run setup`**（会自动 `prepare → husky` 安装 Git 钩子）。

| 阶段 | 做什么 | 触发 / 执行 |
|------|--------|-------------|
| ① 类型门禁 | `npm run typecheck`（= `worker` + `web` 的 `tsc --noEmit` / `vue-tsc --noEmit`） | release 脚本自动跑，失败即中止 |
| ② 未提交检测 | `git status --porcelain`，有改动先让你填提交信息并二次确认 | release 脚本交互 |
| ③ 选版本 | ↑/↓ 选 patch / minor / major，只显示「当前版本 + 三档新版本号」（CHANGELOG 由 changelogen 在选定后生成，不在选择界面刷屏） | release 脚本交互 |
| ④ 版本 + Changelog | `changelogen --<type> --bump` 写版本号 + 增量中文 `CHANGELOG.md` | release 脚本 |
| ⑤ 版本同步 | 把新版本号同步进 `worker/`、`web/` 的 `package.json`，避免漂移 | release 脚本 |
| ⑥ Release 说明预览 | 与 CI 同一个脚本，为空当场告警（否则 CI 会安静地建出空 Release） | release 脚本 |
| ⑦ 提交 + 打 tag + 推送 | `chore(release): vX.Y.Z` 提交、`git tag vX.Y.Z`、`push` + `push --tags` | release 脚本 |
| ⑧ npm 发布 + 建 Release | 版本校验 → 离线自测 → 打包体检 → `npm publish --provenance` → GitHub Release | **GitHub Actions**（tag 触发，见 `.github/workflows/release.yml`） |

> **部署不在其中**（`npm run deploy` 单独执行）：tag 推上去就不可回滚，而部署失败发生在其后，会留下「版本已发布、站点还是旧的」的中间态。理由见 [docs/npm-publish/03-计划.md](docs/npm-publish/03-计划.md) §5。

> 约定式提交（commitlint）通过 husky 的 `commit-msg` 钩子**对所有提交强制校验**——包括上面的 ② 与 ⑦ 提交，不符合 `feat/fix/...` 规范会被拒绝。类型门禁通过 husky 的 `pre-commit` 钩子执行（仅当三个包的 `node_modules` 都已安装时，否则跳过并提示）。

```bash
# 日常：本地提交会自动过 commitlint + typecheck 钩子
git commit -m "feat(api): 新增 N2/N7/N9 涨幅口径"

# 发布（交互式选版本 → changelog → 打 tag → CI 发布 npm 与 GitHub Release）
npm run release
```

> 版本号以根 `package.json` 为准（当前 `1.1.0`），后续每次发布在此基础上递增；`worker` / `web` 与之保持同步。

---

## 免责声明

本报告由程序基于公开市场数据**自动生成**，仅用于短线交易候选池的量化初筛与观察评级，**不构成任何投资建议或买卖邀约**。所有判定均基于历史/收盘数据，存在前视偏差与数据缺口（如 R05 分时不可得）。市场有风险，决策需独立判断并自担风险。
