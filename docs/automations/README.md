# 本地定时任务（WorkBuddy Automations）便携重建与对齐文档

> 本文件是本项目全部 A 股本地定时任务的**单一真值源（portable reference）**。
> 它们配置在本机 WorkBuddy 应用数据里，**不随 git 走**；换设备 / 重装后，对 AI 说一句
> **「按 docs/automations/README.md 重建所有定时任务」**，即可逐条照本文件用 `automation_update` 重建。
>
> ⚠️ **对齐铁律**：本机自动化 prompt 的任何调整 / 优化，都**必须**同步改回本文件并提交，始终保持「本文件 ↔ 本机自动化 ↔ 实际行为」三者一致。改完自动化记得回来更新本文档；反之亦然。

## 总览

| 任务 | 自动化 ID | 调度（RRULE） | 人类可读 | 状态 | 产物 |
|---|---|---|---|---|---|
| 盘前基线预计算 (preopen baseline) | `1e86f8e2-3865-47d3-b03d-8da929bc1dde` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=3;BYMINUTE=0` | 工作日 03:00 | ACTIVE | `eod/data/preopen/preopen-baseline-*.json`（不入库） |
| pulse 消息脉搏 · 一键报告 | `6d84d676-9d4c-4880-a205-b99383cfb74f` | `FREQ=DAILY;BYHOUR=8;BYMINUTE=0` | 每日 08:00 | PAUSED | `pulse/reports/latest.html`（不入库） |
| 盘前纪要每日早间分析（附录 A1） | `automation-1784254142442` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=30` | 工作日 08:30 | ACTIVE | 仅对话输出（cwd 不在本仓库） |
| pulse watch · 常驻监听启动 | `87f8f966-f5f4-41d6-a5b7-04a6c45059ea` | `FREQ=DAILY;BYHOUR=8;BYMINUTE=30` | 每日 08:30 | PAUSED | `pulse/data/watch-console.log` + 归档（不入库） |
| 盘前选股 preopen（手动触发） | `ff63044e-ff4e-4bd0-8f12-6b90c3a10f5a` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=25` | 工作日 09:25 | ACTIVE | `eod/data/preopen/preopen-<日>.json` + html |
| 早盘机会（10:30） | `437fc164-152b-431c-b5bf-8a7a211f8f47` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=10;BYMINUTE=30` | 工作日 10:30 | ACTIVE | 同 `--intraday` 产物 |
| 午盘机会（11:30） | `2b6b4b02-247a-433c-9b66-1c7cb45b780e` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=11;BYMINUTE=30` | 工作日 11:30 | ACTIVE | 同 `--intraday` 产物 |
| 尾盘选股-观察模式(1430) | `f46d3c1c-a803-4e43-a2a7-7db8ede8b5ba` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=30` | 工作日 14:30 | ACTIVE | `eod/data/eod/eod-<交易日>-obs.json` + html |
| 尾盘选股-正式口径(1450) | `6cda9d58-4ba9-4c1d-ac2c-476c2459d879` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=50` | 工作日 14:50 | ACTIVE | `eod/data/eod/eod-<交易日>.json` + html |
| A股次日候选池初筛 | `automation-1786328116138` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=16;BYMINUTE=0` | 工作日 16:00 | ACTIVE | `reports/stock_list_<锚定日>.html` + snapshot |
| 盘前回填 preopen:backfill（18:00） | `79f60ba3-646d-48e9-8694-a65e95606184` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=18;BYMINUTE=0` | 工作日 18:00 | ACTIVE | 回填进 `eod/data/preopen/preopen-<日>.json` close 段 |
| 游资席位扫描（18:20） | `dbff7b4b-0912-41e1-86be-0d6f2e8be67e` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=18;BYMINUTE=20` | 工作日 18:20 | ACTIVE | `eod/data/hotmoney/hotmoney-<日>.json` + `eod/reports/hotmoney/hotmoney-<日>.html` |
| 次日回填 nextday_backfill（18:30） | `08b2baac-9293-4d2e-86a2-a2c1ab565d36` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=18;BYMINUTE=30` | 工作日 18:30 | ACTIVE | 四类归档 verdicts 段 + `eod/data/perf-weekly.json` + 最新报告重渲染 |
| 观察池回流 pool_reflow（18:40） | `650d6943-9903-44f9-85be-c4e5c46cb066` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=18;BYMINUTE=40` | 工作日 18:40 | **PAUSED** | `eod/reports/pool_reflow/pool_reflow-<日>.html`（dry-run diff，**不写**观察池） |
| 报告归档发布 deploy（19:00） | `64e24925-5a1f-4426-af26-f7caf36f3af6` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=19;BYMINUTE=0` | 工作日 19:00 | ACTIVE | `web/public/archive/`（gitignore）+ Cloudflare Pages 线上归档发布（不入库、无本地 HTML 报告） |
| 周六胜率回归简报（10:00） | `6b3d2cf6-942c-44e9-86d8-9e39fbe3f5b5` | `FREQ=WEEKLY;BYDAY=SA;BYHOUR=10;BYMINUTE=0` | 周六 10:00 | ACTIVE | `eod/reports/weekly/winrate-<日>.html`（纯只读，不推送） |
| A股每日市场情绪日报（23:30） | `automation-1786325369523` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=23;BYMINUTE=30` | 工作日 23:30 | PAUSED | 仅对话输出；B2 联动 regime 未实现 |

**cwds 统一为**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`（新设备改成你的实际仓库路径）。

> ⚠️ **补登记（2026-11-09）**：最后一行「A股每日市场情绪日报」本机一直存在，此前漏登记进本真值源；
> 其 prompt 的逐字原文与 cwds 尚未按本文件模板校对（重建时请用 `automation_update mode=view` 取原文）。
> 详见 [`docs/system-plan-2026-11-09.md`](../system-plan-2026-11-09.md) 的 B2 节。

### ⚓ 提交约定（铁律）

**所有定时任务执行后，都必须把产物改动提交并推送到仓库**（`git add` → `git commit` → `git push`）。
这是本文件与 [`docs/ops/01-方案.md`](../../docs/ops/01-方案.md) 共同遵守的硬规则：缺提交的定时任务会累积未入库产物，
且与 GitHub Actions 分支互相覆盖时丢失数据。

- **本地自动化（本机 WorkBuddy）**：**所有任务**的提交都由下方各节 Prompt 里的「git 推送块」显式负责（`git add` → `git commit` → `git push`）。脚本内部**不再写 git**——原先盘前选股 / 回填在 `preopen_screener.js` / `preopen_backfill.js` 内自动 commit，已于 2026-10-23 移除，统一收归 Prompt，避免重复提交。
- **GitHub Actions（云端）**：4 个定时 workflow 末尾均含 commit 步骤——`daily-screen` / `tail-screen` / `tail-observe` 提交到 `daily-artifacts` 分支，`refresh-industry-map` 提交到 `main`。
- **例外（不提交）**：① 盘前基线预计算产物为 `.gitignore` 忽略的派生缓存，故意不入库；② 附录 A1 的 cwds 不在本仓库，不提交本仓库；③ pulse 两条任务的产物（`pulse/data/`、`pulse/reports/`）已被 `.gitignore` 忽略，prompt 未含 git 推送块，不入库；④ **第 13/14 节（pool_reflow / weekly_winrate）**：用户 2026-11-09 拍板「不推送」，两条 prompt 均**不含 git 推送块**，报告落盘后不自动提交 —— 这是有意例外，避免 ACTIVE 的周六任务自动写远端。如需入库，人工 `git add eod/reports/pool_reflow eod/reports/weekly` 后提交；⑤ **第 15 节（报告归档发布 deploy）**：产物 `web/public/archive/`、`web/dist/` 均被 `.gitignore` 忽略，任务只负责把归档发到 Cloudflare Pages，prompt **不含 git 推送块、不含 present_files**，源码改动由其他任务提交。

#### 统一提交信息格式（规范 · 中文描述 + 时间）

各任务运行后由 Prompt 内的「git 推送块」生成的提交信息，统一为「任务中文名 + 日期」：

```
chore: <任务中文名> $(date +%F)
```

要求**全部任务一致**：统一 `chore:` 前缀 + 中文任务名 + `$(date +%F)`（展开为 `YYYY-MM-DD`）日期；**禁止**再出现英文 slug（如 `preopen` / `tail-obs`）或 `obs run` / `add ... artifacts` 这类散装格式。

| 任务（本文件小节） | 提交信息（完整） |
|---|---|
| 2. 盘前选股 preopen | `chore: 盘前选股 $(date +%F)` |
| 3. 盘前回填 preopen:backfill | `chore: 盘前回填 $(date +%F)` |
| 4. 尾盘观察(1430) | `chore: 尾盘观察 $(date +%F)` |
| 5. 尾盘正式(1450) | `chore: 尾盘选股 $(date +%F)` |
| 6/7. 午盘 / 早盘机会（--intraday） | `chore: 盘中机会 $(date +%F)` |
| 8. A股次日候选池初筛 | `chore: 每日实时初筛 $(date +%F)` |

> 另有**本文件自身改动**的提交（改自动化 ↔ 改文档同步）用 `chore(automations): <简述>`，与上述任务运行提交各司其职，互不打扰。

**盘前选股 / 盘前回填**：日常以 WorkBuddy 自动化面板**手动触发**为主（名义 rrule 仅占位，不依赖其自动运行）；状态随本机对齐为 ACTIVE。

### 📑 任务内预览报告（所有产出 HTML 的任务 · 铁律）

凡是运行后产出 HTML 报告的任务，Prompt 必须包含一步：**调用 `present_files` 工具打开当日报告**（传绝对路径），让报告直接在任务对话的预览面板里展示——用户不需要去翻 `eod/reports/` 目录，也不用再开口要链接。要求：

- 报告文件存在 → `present_files(<报告绝对路径>)`，一句话说明报告内容要点；
- 文件不存在 → **如实说明**（时段跳过 / 当日无候选 / 回填失败），把脚本日志尾部的关键错误贴出来，**不要编造路径**。

各任务的报告路径以小节内 Prompt 里写死的为准（盘前/回填 `eod/reports/preopen/preopen-<日>.html`、尾盘观察 `eod-<日>-obs.html`、尾盘正式 `eod-<日>.html`、盘中 `eod-<日>-intraday.html`、次日初筛 `reports/stock_list_<日>.html`）。

> **同步状态（2026-11-06）**：本约定为本日新增，下文各任务 Prompt 模板均已含预览步骤；本机 7 条记录（2/3/4/5/6/7/8 小节）的线上 prompt 已于同日用 `automation_update` 逐条同步完成。

---

## 1. 盘前基线预计算 (preopen baseline)

- **ID**：`1e86f8e2-3865-47d3-b03d-8da929bc1dde`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=3;BYMINUTE=0`（工作日 03:00）
- **cwds**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`
- **状态**：ACTIVE
- **产物**：`eod/data/preopen/preopen-baseline-YYYYMMDD.json`（派生缓存，已被 .gitignore 忽略，不入库）
- **推送**：失败时经项目 notify 配置告警；成功静默

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
在候选池仓库运行盘前基线预计算：执行命令 `node eod/preopen_screener.js --baseline`（cwd 固定为 D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool）。

该命令会：抓取全市场前一日（lastClosedTradingDay，锚定日）的日 K 线，计算「昨日涨幅 + 昨日成交量 + 趋势(MA5/10/20/60 多头/N日新高/斜率)」基线指标，写入 eod/data/preopen/preopen-baseline-YYYYMMDD.json 缓存文件（文件名中的日期 = 锚定交易日，与次日 09:25 盘前全市场选股读取的是同一个文件，幂等覆盖、不会错乱）。

重要约束（无需联网提交、无需 git 操作）：
- 基线文件是派生缓存，已被仓库 .gitignore 忽略，不入库、不推送。不要执行任何 git add/commit/push。
- 本任务设计为「交易日收盘后」运行：非交易日运行会重算最近一个已收盘交易日的基线（无害，只是重复写同一文件）。

执行后用 Bash 确认 eod/data/preopen/preopen-baseline-*.json 的最近修改时间已更新（例如 `ls -la eod/data/preopen/preopen-baseline-*.json`）。
若命令非零退出、或网络抓取失败、或缓存文件未生成，请记录明确错误日志并告警（微信/邮件，复用项目 notify 配置），切勿静默忽略。
~~~

---

## 2. 盘前选股 preopen（手动触发）

- **ID**：`ff63044e-ff4e-4bd0-8f12-6b90c3a10f5a`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=25`（名义 09:25，日常以手动触发为主，名义 rrule 仅占位）
- **cwds**：`D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool`
- **状态**：ACTIVE
- **产物**：`eod/data/preopen/preopen-<当日>.json` + `eod/reports/preopen/preopen-<当日>.html`
- **推送**：脚本自身会推送通知与 git 溯源，无需额外提交

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
在仓库 D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool 运行盘前选股：npm run preopen（等价 node eod/preopen_screener.js，默认全市场 universe 口径）。09:20-09:35 交易窗口内运行有效，窗口外需补跑时加 --force（node eod/preopen_screener.js --force）。完成后汇总：候选数量、TOP5 名称与总分、贴线样本（nearMiss）条数；若被时段守卫跳过或零候选，说明原因。

生成成功后，必须调用 present_files 工具打开当日报告 D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool\eod\reports\preopen-<当日>.html（YYYY-MM-DD 替换 <当日>），让报告直接在任务预览面板展示；文件不存在则如实说明原因，不要编造路径。

生成成功后，把产物提交并推送到 GitHub 仓库 candidate-pool（脚本不自动提交，必须显式执行）：

```bash
git add eod/data eod/reports
git commit -m "chore: 盘前选股 $(date +%F)"
git push
```
~~~

### git 推送块（本任务）

```bash
git add eod/data eod/reports
git commit -m "chore: 盘前选股 $(date +%F)"
git push
```


---

## 3. 盘前回填 preopen:backfill（18:00）

- **ID**：`79f60ba3-646d-48e9-8694-a65e95606184`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=18;BYMINUTE=0`（工作日 18:00——龙虎榜约 17:00 后才出齐，故从 15:30 推迟到 18:00，收盘行情不受影响）
- **cwds**：`D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool`
- **状态**：ACTIVE
- **产物**：回填进 `eod/data/preopen/preopen-<当日>.json` 的 close 段（昨收%/今开%/今收%/买入收益%/今日主力净流入/市值流通/量比/换手/涨停/连板/买入机会/命中/龙虎榜上榜含游资标注），并**重渲染** `eod/reports/preopen/preopen-<当日>.html` 的「收盘回填（开盘买入当日验证）」段（含逐票表 + 汇总 callout + 与候选明细同款 标签/行业 筛选）

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
在仓库 D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool 运行盘前收盘回填：npm run preopen:backfill（等价 node eod/preopen_backfill.js）。收盘后 15:00-23:59 内执行有效（定时 18:00，等龙虎榜出齐）；功能是对当日盘前候选（eod/data/preopen/preopen-<当日>.json 的 records）回填收盘价、当日涨跌幅、是否涨停、是否盘中开板、换手率、量比、市值/流通、今日主力净流入、连板数、龙虎榜上榜（含知名游资席位标注），并按 hitDayChgMin=2% 标记命中，结果合并进同一归档的 close 段；随后脚本会**自动重渲染** eod/reports/preopen/preopen-<当日>.html 的「收盘回填（开盘买入当日验证）」段（逐票：昨收%/今开%/今收%/买入收益%/今日净流入/市值流通/量比/换手%/涨停/可买/命中/连板/上榜 + 汇总 callout + 标签/行业筛选）。东财接口失败时相关列自动留空，属正常降级，不算失败。

买入机会四态判定（脚本已在 HTML 内算好，无需你重算）：
- 非涨停 → 开盘可买
- 涨停且盘中最低价 < 涨停价（开板）→ 开板可买
- 一字涨停但换手率 ≥ sealedTurnoverMin(1.5%)（放量）→ 放量可买
- 一字缩量涨停 → 很难买入

完成后在对话里向用户汇总（不要只给路径）：回填总数、命中数、命中率、上榜只数，并贴出 HTML 中那张「收盘回填」逐票表的精简版（代码/名称/今开%/今收%/买入收益%/买入机会/连板/上榜/命中）。随后必须调用 present_files 工具打开重渲染后的报告 D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool\eod\reports\preopen-<当日>.html（YYYY-MM-DD 替换 <当日>），让完整报告（含收盘回填段、轨道过滤、nearMiss 折叠表）直接在任务预览面板展示。若当日无盘前归档或文件不存在则说明原因，不要编造路径。

生成成功后，把更新后的归档与重渲染的 html 一并提交并推送到 GitHub 仓库 candidate-pool（脚本不自动提交，必须显式执行）：

```bash
git add eod/data eod/reports
git commit -m "chore: 盘前回填 $(date +%F)"
git push
```
~~~

### git 推送块（本任务）

```bash
git add eod/data eod/reports
git commit -m "chore: 盘前回填 $(date +%F)"
git push
```


---

## 4. 尾盘选股-观察模式(1430)

- **ID**：`f46d3c1c-a803-4e43-a2a7-7db8ede8b5ba`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=30`（工作日 14:30）
- **cwds**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`
- **状态**：ACTIVE
- **产物**：`eod/data/eod/eod-<交易日>-obs.json` + `eod/reports/eod/eod-<交易日>-obs.html`
- **推送**：本机照常推送微信 / 邮件（不静默）

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
运行 A 股尾盘选股（观察模式预览）。在当前工作目录（candidate-pool 项目根）执行：node eod/tail_screener.js

说明：
- 该时刻处于 14:30–14:50 之间，脚本自动进入「观察模式」（尾盘段=最近 20 分钟滚动窗口，与正式口径等长；结果仅供参考预览），产物写入 eod/data/eod/eod-<交易日>-obs.json（原始快照另存 eod/data/eod/raw/，不入库）与 eod/reports/ 同名 html，并通过 notify.js 推送微信/邮件。
- 脚本输出「非交易日 / 未到尾盘观察时点」属正常跳过，不要告警，直接结束即可。
  例外：若提示的是「未到尾盘观察时点 14:30（还差 N 分钟）」且 N ≤ 2，说明本机触发比观察起点早了分秒级，请等待 N 分钟零 10 秒后重跑一次该命令即可（不要重跑超过一次）。
- 若脚本异常退出（非跳过原因），将 stderr 里的错误摘要简洁反馈给用户；脚本自身在配置了 notify_config.json 时会主动发失败告警，无需重复推送。
- 生成成功后，将当日尾盘观察产物提交并推送到 GitHub 仓库 candidate-pool：
  ```
  git add eod/data eod/reports
  git commit -m "chore: 尾盘观察 $(date +%F)"
  git push
  ```
  推送依赖本机已缓存的 Git 凭据（GitHub），无需交互；若失败如实反馈，不要编造。

生成并入库后，把当日入选票在对话里以表格列出（不要只给 report 页面路径，让用户不用去开网页）：
1. 用 node 读取当日存档：观察模式为 eod/data/eod/eod-<交易日>-obs.json（<交易日> 取今天；若今天文件不存在，则取 eod/data/eod/eod-*-obs.json 中修改时间最新的一份）。
2. 跑下面这段 node 把 records 按 total 降序打印成 Markdown 表格（把命令里的文件路径换成上面那份）：
   ```
   node -e "const fs=require('fs');const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,'utf8'));const rs=Object.values(d.records||{}).sort((a,b)=>b.total-a.total);console.log('## 尾盘观察入选（'+d.tradeDate+'，共'+rs.length+'只）');console.log('|代码|名称|行业|涨跌幅%|尾盘段%|量比|总分|标记|');console.log('|---|---|---|---|---|---|---|---|');for(const r of rs){const t=r.tail||{};const tags=[];if(r.bestInGroup)tags.push('组内最优');if((t.upRatio??1)<0.55)tags.push('拉升不连贯');tags.push('组内 '+(r.groupRank??'?')+'/'+(r.groupSize??'?'));console.log('|'+r.code+'|'+r.name+'|'+(r.sector||'')+'|'+r.chgPct.toFixed(2)+'|'+(t.segPct!=null?t.segPct.toFixed(2):'')+'|'+r.volRatio.toFixed(2)+'|'+r.total.toFixed(1)+'|'+tags.join('、')+'|');}"
   ```
3. 涨跌幅% = chgPct；尾盘段% = tail.segPct；量比 = volRatio；总分 = total（保留 1 位）。涨跌幅与尾盘段按红涨绿跌语义展示数值即可，无需颜色。
4. 若 records 为空，直接说「今日（<交易日>）无尾盘观察候选」即可，不要编造。

完成后向用户报告：观察产物路径、候选数量、上面这张入选票表格，以及 git push 结果。最后必须调用 present_files 工具打开观察报告 D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool\eod\reports\eod-<交易日>-obs.html（YYYY-MM-DD 替换 <交易日>），让报告直接在任务预览面板展示；文件不存在则如实说明，不要编造路径。
~~~

### git 推送块（本任务）

```bash
git add eod/data eod/reports
git commit -m "chore(eod): tail-obs $(date +%F)"
git push
```

---

## 5. 尾盘选股-正式口径(1450)

- **ID**：`6cda9d58-4ba9-4c1d-ac2c-476c2459d879`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=50`（工作日 14:50）
- **cwds**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`
- **状态**：ACTIVE
- **产物**：`eod/data/eod/eod-<交易日>.json` + `eod/reports/eod/eod-<交易日>.html`
- **推送**：**本机静默**（`--no-notify`）；微信 / 邮件由 GitHub Actions 的 `tail-screen.yml`（14:40 触发、程序内等到 14:50）负责，避免重复推送

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
运行 A 股尾盘选股（正式固定口径）。在当前工作目录（candidate-pool 项目根）执行：node eod/tail_screener.js --no-notify

说明：
- 推送策略：**本机静默**。同一 14:50 口径还由 GitHub Actions 的 tail-screen.yml（14:40 触发、程序内等到 14:50）运行并负责推送微信/邮件；本机再推一次会重复，故加 --no-notify。
- 该时刻已过 14:50，脚本自动按「固定口径 14:50」取数（同日多次运行结果一致、幂等覆盖），产物写入 eod/data/eod/eod-<交易日>.json 与 eod/reports/eod/eod-<交易日>.html，并照常同步 Cloudflare D1（--no-notify 不影响入库与本地留档）。
- 脚本输出「非交易日 / 超出补跑宽限期」属正常跳过，不要告警，直接结束即可。
- 因本机已静默，失败时不会有微信/邮件告警：若脚本异常退出（非跳过原因），请把 stderr 里的错误摘要简洁反馈给用户，明确说明「本机这一侧未成功」，不要重复补发推送。
- 生成成功后，将当日尾盘正式产物提交并推送到 GitHub 仓库 candidate-pool：
  ```
  git add eod/data eod/reports
  git commit -m "chore: 尾盘选股 $(date +%F)"
  git push
  ```
  推送依赖本机已缓存的 Git 凭据（GitHub），无需交互；若失败如实反馈，不要编造。

生成并入库后，把当日入选票在对话里以表格列出（不要只给 report 页面路径，让用户不用去开网页）：
1. 用 node 读取当日存档：正式口径为 eod/data/eod/eod-<交易日>.json（<交易日> 取今天；若今天文件不存在，则取 eod/data/eod/eod-*.json 中修改时间最新、且文件名不含 -obs / -intraday 的一份）。
2. 跑下面这段 node 把 records 按 total 降序打印成 Markdown 表格（把命令里的文件路径换成上面那份）：
   ```
   node -e "const fs=require('fs');const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,'utf8'));const rs=Object.values(d.records||{}).sort((a,b)=>b.total-a.total);console.log('## 尾盘正式入选（'+d.tradeDate+'，共'+rs.length+'只）');console.log('|代码|名称|行业|涨跌幅%|尾盘段%|量比|总分|标记|');console.log('|---|---|---|---|---|---|---|---|');for(const r of rs){const t=r.tail||{};const tags=[];if(r.bestInGroup)tags.push('组内最优');if((t.upRatio??1)<0.55)tags.push('拉升不连贯');tags.push('组内 '+(r.groupRank??'?')+'/'+(r.groupSize??'?'));console.log('|'+r.code+'|'+r.name+'|'+(r.sector||'')+'|'+r.chgPct.toFixed(2)+'|'+(t.segPct!=null?t.segPct.toFixed(2):'')+'|'+r.volRatio.toFixed(2)+'|'+r.total.toFixed(1)+'|'+tags.join('、')+'|');}"
   ```
3. 涨跌幅% = chgPct；尾盘段% = tail.segPct；量比 = volRatio；总分 = total（保留 1 位）。涨跌幅与尾盘段按红涨绿跌语义展示数值即可，无需颜色。
4. 若 records 为空，直接说「今日（<交易日>）无尾盘正式候选」即可，不要编造。

完成后向用户报告：正式产物路径、候选数量、上面这张入选票表格，以及 git push 结果。最后必须调用 present_files 工具打开正式报告 D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool\eod\reports\eod-<交易日>.html（YYYY-MM-DD 替换 <交易日>），让报告直接在任务预览面板展示；文件不存在则如实说明，不要编造路径。
~~~

### git 推送块（本任务）

```bash
git add eod/data eod/reports
git commit -m "chore(eod): tail $(date +%F)"
git push
```

---

## 6. 午盘机会（11:30）& 7. 早盘机会（10:30）

> 这两个任务 prompt 完全相同，仅调度时间与用途不同：10:30 是早盘异动观察，11:30 是午前手动兜底（对应 `npm run tail:intraday`）。均为本机实时盘中筛，产物 `-intraday` 系列。

- **午盘机会（11:30）ID**：`2b6b4b02-247a-433c-9b66-1c7cb45b780e`，调度 `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=11;BYMINUTE=30`
- **早盘机会（10:30）ID**：`437fc164-152b-431c-b5bf-8a7a211f8f47`，调度 `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=10;BYMINUTE=30`
- **cwds**：`D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool`
- **状态**：均 ACTIVE
- **推送**：脚本强制 `--no-notify`（不推送微信/邮件）；`--intraday` 产物**不写入 D1**；git 提交由下方「git 推送块」负责

### Prompt（原样复制进 WorkBuddy 自动化，两任务共用）

~~~text
在 candidate-pool 项目目录（D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool）下，执行尾盘选股命令：运行 `npm run tail:intraday`（等价于 `node eod/tail_screener.js --intraday`）。等待命令执行完成，捕获并打印关键输出（候选股列表、报告路径、任何报错），用简洁中文向用户汇报结果。若命令执行失败，给出根因与可执行建议，不要隐瞒错误。

生成成功后，必须调用 present_files 工具打开盘中报告（eod/reports/eod/ 下当天修改时间最新的 eod-<交易日>-intraday.html，用绝对路径），让报告直接在任务预览面板展示；文件不存在则如实说明，不要编造路径。

生成成功后，把盘中候选提交并推送到 GitHub 仓库 candidate-pool（脚本不自动提交，必须显式执行；`--intraday` 盘中模式强制 `--no-notify` 且不写 D1，仅入库本仓库 git）：

```bash
git add eod/data eod/reports
git commit -m "chore: 盘中机会 $(date +%F)"
git push
```
~~~

### git 推送块（本任务）

```bash
git add eod/data eod/reports
git commit -m "chore: 盘中机会 $(date +%F)"
git push
```


---

## 8. A股次日候选池初筛

- **ID**：`automation-1786328116138`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=16;BYMINUTE=0`（工作日 16:00）
- **cwds**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`
- **状态**：ACTIVE
- **产物**：`reports/stock_list_<锚定日>.html` + `data/snapshot-<锚定日>.json`
- **推送**：**本机静默**（`--no-notify`）；微信 / 邮件由 GitHub Actions 的 `daily-screen.yml`（15:30）负责，避免重复推送

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
每日收盘后自动生成 A股「次日候选池」初筛报告（实时数据），按当日日期留档并提交推送到 GitHub 仓库 candidate-pool。

执行步骤：
1. 进入仓库目录（cwds 已设为 candidate-pool）。运行：
   node gen_candidates.js --no-notify
   推送策略：**本机静默**——同一份结果还由 GitHub Actions 的 daily-screen.yml 在 15:30 运行并负责推送微信/邮件；本机再推一次会重复，故加 --no-notify（仅跳过推送，不影响报告生成、快照留档与 git 提交）。
   数据源为腾讯公开行情接口（qt.gtimg.cn / web.ifzq.gtimg.cn），直连、不依赖任何本机技能或 CLI，与 GitHub Actions 上的运行完全同源。
   该命令默认锚定「行情日 marketDate」（全市场报价时间戳众数，数据驱动；快照失败兜底日历口径）：开盘前运行→上一交易日，盘中→当日实时，收盘后→当日收盘（2026-11-11 统一口径，见 docs/pattern/01-方案.md §4.1），做实时初筛（R01 量能验证突破 + R07 板块内补涨 + R05 尾盘异动核验），输出单文件、资源全内联、支持中英切换的 HTML。
   默认按锚定日输出：reports/stock_list_<锚定日>.html 与 data/snapshot-<锚定日>.json（覆盖式，每天一份）。
2. 生成成功后，将更新提交并推送到远程：
   git add reports/stock_list_*.html data/snapshot-*.json
   git commit -m "chore: 每日实时初筛 $(date +%F)"
   git push
   推送依赖本机已缓存的 Git 凭据（GitHub），无需交互。
3. 完成后向用户报告：生成的报告路径、硬触发数量（R01/R07/R05）、重点关注/次级关注数量，以及 git push 结果。本机已静默，不需要报告微信/邮件推送结果。若某步失败，如实转述异常，不要编造数据。
4. 你把整理出来的数据中R01 量能验证突破、R07 板块内补涨、R05 尾盘异动核验、重点关注、次级关注、条件观察这几类的股票名称、代码一起给我列出来，方便我查看。
5. 生成成功后，必须调用 present_files 工具打开当日初筛报告 D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool\reports\stock_list_<锚定日>.html（YYYY-MM-DD 替换 <锚定日>），让报告直接在任务预览面板展示；文件不存在则如实说明，不要编造路径。

注意事项：
- 仅在工作日收盘后运行（调度已设为周一至周五 16:00）。
- 报告为观察评级，不构成投资建议（免责声明已内嵌 HTML）。
- 若腾讯接口临时不可用（WAF 拦截 / 超时）或分时数据未回溯至锚定日，脚本会标注数据缺口，切勿以替代指标补齐信号。
- 依赖 Node 运行时；若本机环境不可用，报告生成会失败，请提示用户。
- 本机跑的是「无推送」模式，失败时不会自动发微信/邮件：务必把失败原因清楚反馈给用户（GitHub 侧 15:30 那次若成功仍会正常推送）。
~~~

### git 推送块（本任务）

```bash
git add reports/stock_list_*.html data/snapshot-*.json
git commit -m "chore(screen): daily $(date +%F)"
git push
```

---

## 9. pulse watch · 常驻监听启动（08:30，PAUSED）

- **ID**：`87f8f966-f5f4-41d6-a5b7-04a6c45059ea`
- **调度**：`FREQ=DAILY;BYHOUR=8;BYMINUTE=30`（每日 08:30）
- **cwds**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`
- **状态**：PAUSED
- **产物**：`pulse/data/watch-console.log` + `pulse/data/`、`pulse/reports/` 归档（均被 `.gitignore` 忽略，不入库）
- **推送**：无（prompt 未含 git 推送块，本地留存）

> **Windows 计划任务停用记录（2026-11-09）**：原开机自启的 Windows 计划任务 `pulse-watch`
>（登录触发，延迟 30s）已 `Disable-ScheduledTask` 禁用，运行中的 watch 进程已终止。
> 此后完全手动：最小化窗口跑 `npm run pulse:watch`，停止用 taskkill 对应 node PID。
> 如需恢复开机自启：`Enable-ScheduledTask -TaskName 'pulse-watch'`。（原 scheduled-tasks.md 记录并入此处）

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
启动 pulse 常驻监听（仓库 D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool）。步骤：1) 先查重：powershell 执行 Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'pulse.watch' }，若已有进程在跑，报告 PID 并结束（绝不重复启动第二个）。2) 不存在则后台启动：cmd //c start "pulse-watch" /min cmd /c "cd /d D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool && npm run pulse:watch >> pulse\data\watch-console.log 2>&1"（最小化窗口独立运行，退出本会话不影响）。3) 等 15 秒后查看 pulse/data/watch-console.log 末尾，确认出现「[watch] 启动」字样；每轮完成会有「轮次完成」日志，异动时会弹 Windows Toast。4) 汇报：PID、日志路径、归档目录 pulse/data 与 pulse/reports。附带停止方法：taskkill /PID <pid> /F 或关闭那个最小化窗口。
~~~

---

## 10. pulse 消息脉搏 · 一键报告（08:00，PAUSED）

- **ID**：`6d84d676-9d4c-4880-a205-b99383cfb74f`
- **调度**：`FREQ=DAILY;BYHOUR=8;BYMINUTE=0`（每日 08:00）
- **cwds**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`
- **状态**：PAUSED
- **产物**：`pulse/reports/latest.html` + 快照归档（被 `.gitignore` 忽略，不入库）
- **推送**：无（prompt 未含 git 推送块，本地留存）

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
在仓库 D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool 执行 `npm run pulse`（pulse 消息脉搏单次全流程：采集 6 源快讯/板块资金流/公告 → 交叉分析 → 归档快照与 HTML 报告）。成功后向用户简要汇报：1) 信源状态一行；2) 热点板块 top5（名称+热度分+验证级别+涨跌幅+领涨股）；3) 用 present_files 打开 pulse/reports/latest.html 给用户看。若失败，汇报失败的信源与错误信息（脚本自身会输出各源 OK/FAIL）。
~~~

---

## 11. 游资席位扫描（18:20）

> 详设与口径见 `docs/hotmoney-scan.md`。排在 18:00 盘前回填之后；17:30 后跑统计当天榜单，
> 更早（含手动补跑）自动回退上一交易日。首跑已回补近 10 个交易日日档（2026-11-09）。

### Prompt（原样复制进 WorkBuddy 自动化）

```text
运行 A 股游资席位扫描流水线（仓库 GuoSirius/candidate-pool，工作目录 D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool）：

1. 执行 `node eod/hotmoney_scan.js`，统计最近一个交易日的龙虎榜知名游资席位买卖并归档（17:30 后运行会统计当天；脚本缺档自动回补近 10 个交易日窗口）。日志自动落 `eod/logs/hotmoney-<日期>.log`。
2. 若脚本退出码非 0 或输出含「失败」，读取日志尾部排查原因并告知用户，不要盲目重试超过 2 次（东财可能临时封 IP，次日自动恢复）。
3. 成功后把归档与报告提交推送：`git add eod/data/hotmoney/hotmoney-*.json eod/data/hotmoney/hotmoney-seats-snapshot.json eod/data/hotmoney/hotmoney-watchlist.json eod/reports/hotmoney/hotmoney-*.html && git commit -m "chore: 游资席位扫描归档 <交易日>" && git push origin main`（push 失败多为代理抖动，重试一次）。
4. 用一句话向用户汇报：锚定日、榜单票数、游资命中票数、席位变更条数，并给出报告路径 eod/reports/hotmoney/hotmoney-<交易日>.html。
```

### git 推送块（本任务）

提交范围固定为 hotmoney 归档（日档/快照/观察名单）+ 报告（见上方 Prompt 第 3 步），不 add 其它改动。

## 12. 次日回填 nextday_backfill（18:30，ACTIVE）

> 批次 A3（2026-11-09 方案）。排在 18:00 盘前回填、18:20 游资扫描之后：统一给尾盘（含 -obs）/ 盘前 / 次日选股 / 游资四类归档补 T+1/T+3 表现（verdicts 段，K 线走腾讯 fqkline），并滚动聚合 `eod/data/perf-weekly.json`（周六胜率简报的数据源）。幂等：t3 已齐的记录跳过。2026-11-09 已转 ACTIVE（试跑通过）。

### Prompt（原样复制进 WorkBuddy 自动化）

```text
在仓库 D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool 执行 `node eod/nextday_backfill.js`（统一次日回填：给尾盘/盘前/次日选股/游资四类归档补 T+1/T+3 表现 verdicts 段，并更新 eod/data/perf-weekly.json 胜率聚合）。脚本幂等，重复运行安全。成功后：1) 向用户简要汇报各管道（tail/preopen/nextday/hotmoney）的 T1/T3 命中率与均值（一行每管道），不展开明细；2) 从输出中提取「[HTML] 本次改动清单」的文件路径，用 present_files 把这些 HTML 逐个展示给用户点开查看（输出里若显示「跳过」的管道不用展示，并说明跳过原因）；3) 必须把更新后的归档与聚合一并提交并推送（脚本不自动提交，必须显式执行）：git add eod/data eod/reports data && git commit -m "chore: 次日回填 $(date +%F)" && git push。若失败，汇报错误信息与日志（eod/logs/nextday-*.log）。若失败，汇报错误信息与日志（eod/logs/nextday-*.log）。
```

### git 推送块（本任务）

提交范围：`eod/data`（四类归档 + perf-weekly.json）+ `eod/reports`（本任务重渲染的最新报告）+ `data`（snapshot verdicts）。

## 13. 观察池回流 pool_reflow（18:40，PAUSED）

> 批次 C2（2026-11-09 落地，方案见 [`docs/system-plan-2026-11-09.md`](../system-plan-2026-11-09.md) C2 节）。排在 18:30 nextday_backfill 之后。
> **用户拍板**：允许扩 `meta`，但数据必须及时/可靠/稳定/不丢失；**默认不设上限、只出 diff、不推送**；本任务 PAUSED。
> 数据安全契约（只追加、存量票零改动、写前备份 + 双重校验、非法代码丢弃）见 `eod/pool_reflow.js` 文件头。
> **prompt 严禁加 `--apply`**：写回只能由人工审核 diff 后手动执行，绝不自动化。

- **ID**：`650d6943-9903-44f9-85be-c4e5c46cb066`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=18;BYMINUTE=40`（工作日 18:40）
- **cwds**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`
- **状态**：**PAUSED**
- **产物**：`eod/reports/pool_reflow/pool_reflow-<日>.html`（可审核的 diff 报告，2026-11-11 由 `.md` 统一为单文件 HTML）
- **推送 / git**：无（不推送微信邮件、不自动 git，见「提交约定」例外 ④）
- **自测**：`npm run pool:selftest`

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
在 candidate-pool 仓库运行观察池回流的 dry-run，并汇报可审核的 diff。

执行 `node eod/pool_reflow.js --days 5`，然后读取生成的 `eod/reports/pool_reflow/pool_reflow-<当日>.html`，用简洁中文汇报：回看交易日范围、四个来源（尾盘TopN·T+1命中 / R01触发 / 一线游资 / 盘前超预期）各自的状态与命中条数、拟新增只数、命中但已在池的只数、保持不动只数、删除只数（必须为 0）。拟新增票用表格列出代码 / 名称 / 来源 / 最近触发日；超过 20 只时只列前 20 只并说明总数。报告是单文件 HTML，读取时按纯文本提取表格内容即可，不要按 Markdown 语法解析。

严格约束：
- 默认 dry-run，**绝对不要加 --apply**，不要写 candidates.json，不要修改任何归档或配置。
- 不要推送微信 / 邮件，不要执行 git commit / push，不要调整任何权重或阈值。
- 报告生成后用 present_files 打开该 HTML 报告（传绝对路径）；文件不存在则如实说明原因，不要编造路径。
- 若命令非零退出，贴出 stderr 错误摘要，不要重试超过一次。
~~~

## 14. 周六胜率回归简报 weekly_winrate（10:00，ACTIVE）

> 批次 D2（2026-11-09 落地）。数据来自 `eod/data/perf-weekly.json`（18:30 回填聚合）+ 四类归档逐票 verdicts。
> **硬门禁**：已回填交易日 < 20 时只报样本量，不输出任何胜率与回归结论。
> **用户拍板**：不推送（不发微信/邮件）、不自动调权重、ACTIVE；脚本纯只读，不改归档/配置/观察池。

- **ID**：`6b3d2cf6-942c-44e9-86d8-9e39fbe3f5b5`
- **调度**：`FREQ=WEEKLY;BYDAY=SA;BYHOUR=10;BYMINUTE=0`（周六 10:00）
- **cwds**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`
- **状态**：ACTIVE
- **产物**：`eod/reports/weekly/winrate-<日>.html`（管道 / 分项 / 游资三维度，2026-11-11 由 `.md` 统一为单文件 HTML）
- **推送 / git**：无（不推送通知、不自动 git，见「提交约定」例外 ④）
- **自测**：`npm run weekly:selftest`

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
在 candidate-pool 仓库生成周六胜率回归简报。

执行 `node eod/weekly_winrate.js`，然后读取生成的 `eod/reports/weekly/winrate-<当日>.html`，向用户汇报：
- 先说明已回填交易日数与门禁（20 个交易日）。若脚本判定样本不足，只汇报各管道的样本量，并明确「本期不输出胜率与回归结论」，**不要自行补算任何命中率或结论**。
- 样本达标时，按「管道 / 分项 / 游资」三个维度各用一段话概括关键数值，不展开全部表格。报告是单文件 HTML，读取时按纯文本提取表格内容即可，不要按 Markdown 语法解析。
- 最后用 present_files 打开该 HTML 报告（传绝对路径）；文件不存在则如实说明原因，不要编造路径。

严格约束：
- 纯只读：不要修改任何归档、配置、观察池；不要调整权重或阈值；不要推送微信 / 邮件；不要执行 git commit / push。
- 若命令非零退出，贴出 stderr 错误摘要，不要重试超过一次。
~~~

## 15. 报告归档发布 deploy（19:00，ACTIVE）

> **2026-11-12 调度变更**：用户反馈 GitHub Actions cron 排队延迟严重，把「每日报告归档发布」的**主通道从云端迁到本机**。
> `.github/workflows/deploy-archive.yml` 的 **19:30 主触发已停用**（注释保留，取消注释即可恢复），**21:05 兜底保留**：
> 它有幂等指纹去重，本机 19:00 成功后会自动跳过，仅在本机失败时补位，不构成重复发布。
> 其余 workflow（daily-screen / tail-* / 月更）职责是「生成报告或刷新数据」，不是「发布报告」，且已与本机分工消重，**全部保留**。
> 详见 [`docs/ops/01-方案.md`](../ops/01-方案.md) §9、[`DEPLOY.md`](../../DEPLOY.md) §5。

- **ID**：`64e24925-5a1f-4426-af26-f7caf36f3af6`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=19;BYMINUTE=0`（工作日 19:00）
- **cwds**：`D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool`
- **状态**：ACTIVE
- **产物**：`web/public/archive/index.json` + 归档副本（gitignore，不入库）；线上 `https://candidate-pool-web.pages.dev/reports/archive`
- **推送 / git**：无（不推送微信邮件、不自动 git，见「提交约定」例外 ⑤）
- **前置条件（本机凭据，一次性）**：`web/scripts/deploy.mjs` 按「`web/deploy.env.json`（方案 A，gitignore 不入库）> 进程环境变量（CI）> wrangler OAuth（方案 B）」自动取凭据；文件缺失或仍是 `REPLACE_ME` 即自动回退 OAuth。2026-11-12 方案 B 已由用户执行并验证成功（`guoplc@163.com`，权限含 `pages (write)`），本机主通道当前可用；方案 A 只需把 API Token 填进 `web/deploy.env.json`（Account ID 已预填），步骤见 [`DEPLOY.md`](../../DEPLOY.md) §5「本机发布凭据」。体检：`cd web && node scripts/deploy.mjs --check-creds`。

### Prompt（原样复制进 WorkBuddy 自动化）

```text
在 candidate-pool 仓库执行「当日报告归档发布」（本机主通道，工作日 19:00）。工作目录固定 D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool（cwds 已设）。GitHub Actions 的 19:30 主触发已停用，21:05 仅作幂等兜底。

1. 归档扫描（只读、约 1 秒）：`cd web && node scripts/build-archive.mjs`，扫描 reports/、data/、eod/reports/、eod/data/ 等 7 类产物，生成 web/public/archive/index.json（已被 .gitignore 忽略，不入库）。
2. 幂等判断：用 node 读取本地 index.json 的 fingerprint，并请求 https://candidate-pool-web.pages.dev/archive/index.json?ts=<当前毫秒时间戳>（带 cache-control: no-cache，20 秒超时）取线上 fingerprint。两者一致 → 直接汇报「线上已最新，无需发布」并结束，不再部署；线上不可读或指纹不一致 → 继续第 3 步。
3. 凭据体检（不部署、不打印明文）：`cd web && node scripts/deploy.mjs --check-creds`。发布脚本自动按「web/deploy.env.json 的 API Token（方案 A，不入库）> 进程环境变量（CI）> wrangler OAuth 登录态（方案 B）」取凭据；文件缺失或仍是 REPLACE_ME 占位符即回退 OAuth，属正常状态，不要告警。若确认两条通道都不可用（可用 `cd worker && ./node_modules/.bin/wrangler whoami` 复核 OAuth），不要盲目重试、不要尝试交互式 wrangler login（需浏览器），直接如实报错，并提示用户二选一：① 把 Cloudflare 上权限为 Account → Cloudflare Pages → Edit 的 API Token 填进 web/deploy.env.json（Account ID 已预填）；② 本机执行 `cd worker && npx wrangler login`。同时说明 GitHub Actions 21:05 兜底会自动补位，当晚不会断档。
4. 发布：在 web/ 目录下执行 `npm run deploy`（等价根目录 `npm run deploy`）：vue-tsc 类型检查 → vite build（含归档）→ wrangler pages deploy dist --project-name candidate-pool-web --branch main。复用 worker/node_modules 里的本地 wrangler，不要安装任何依赖。若报 403 / permission denied，说明令牌缺 Pages:Edit 权限，如实反馈并停止，重试不超过一次。
5. 验证：带时间戳参数请求 https://candidate-pool-web.pages.dev/archive/index.json，核对 fingerprint 与本地一致（CDN 可能缓存）；汇报归档报告份数、数据份数、页面地址 https://candidate-pool-web.pages.dev/reports/archive。
6. 严格约束：本任务只发布，不执行任何 git add / commit / push（web/public/archive/ 与 web/dist/ 均被 .gitignore 忽略）；不修改任何报告、归档、配置、阈值；不推送微信 / 邮件；本任务无本地 HTML 产物，无需调用 present_files。失败时把错误摘要如实反馈，不要编造路径或结果。
```

## 附录：A 股工作流相关、但 cwd 不在本仓库的自动化

> 换设备重建时一并照抄即可；它们的 cwds 指向其他工作区，需按新设备实际路径调整。

### A1. 盘前纪要每日早间分析（8:30，ACTIVE）

- **ID**：`automation-1784254142442`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=30`
- **cwds**：`C:\Users\Admin\WorkBuddy\2026-07-17-10-08-07`（仅作会话工作目录，任务本身是网页分析）
- **推送**：无（结果仅对话输出）

~~~text
访问 https://www.jiuyangongshe.com/u/4df747be1bf143a998171ef03559b517 ，这是韭研公社用户「盘前纪要」的主页，该用户每天发布 A 股盘前纪要。请按以下步骤分析其最新消息：

1）打开主页，找到列表最上方、日期最新的一篇「盘前纪要」文章（注意区分原发/转发/短文等分类，取最新一篇原发盘前纪要）；
2）点开该文章详情页，通读全文，重点提取并分析：
   - 昨日热点板块及对应代表个股
   - 盘前重大事件 / 新题材 / 行业或政策催化
   - 中报业绩预告相关个股
   - 其他对当天看盘有参考价值的信息（涨价、订单、IPO、地缘等）
3）用简体中文输出一份结构化摘要：先给一句话总览，再用要点列表列出核心题材与代表标的，最后补充 1–2 条值得关注的边际变化。语言精炼、对交易有实际参考意义。
4）若当天（运行当日）尚未发布新纪要，则分析最近一篇并明确说明“今日尚未更新，以下为最近一期”。
5）根据最新消息筛选、推荐几个A股相关概念股，每个热点列举一些，列举最相关的或者近期走势好的，热度最高的排第一，依次类推
6）列表最新三条链接也发送给我，方便阅读详情

不要推送、不要发布任何内容，仅把分析结果作为本次任务的输出。
~~~

> 「知了窝」两个同步自动化属于 zhiliaowo-proxy 项目，记录在该项目自己的文档里，此处不收录。

---

## 便携重建流程（换设备时）

1. 拉取本仓库，对 AI 说：**「按 docs/automations/README.md 重建所有定时任务」**。
2. AI 逐条用 `automation_update`（mode=create）照各节 Prompt、rrule、cwds 创建；总览表中的 ID 会变（本机 ID 仅供参考对齐，重建后以新 ID 为准）。
3. 把各节 cwds 里的旧路径替换为新设备的仓库实际路径。
4. 盘前选股 / 盘前回填两个手动兜底任务创建后状态设为 ACTIVE（与当前本机一致；scheduleType=recurring + status=ACTIVE，名义 rrule 仅占位，日常手动触发）。
5. 第 13 节 `pool_reflow` 必须建为 **PAUSED**、第 14 节 `weekly_winrate` 建为 **ACTIVE**；两条 prompt 均**不含 git 推送块**，第 13 节**不得出现 `--apply`**。
6. 第 15 节 `报告归档发布 deploy` 建为 **ACTIVE**（工作日 19:00），prompt 不含 git 推送块 / present_files；重建前先确认本机 Cloudflare Pages 发布凭据可用，否则暂时恢复 `deploy-archive.yml` 的 19:30 主触发。
7. 重建完成后用本文件逐字校验各 prompt。

## 对齐约定（务必遵守）

- **改自动化 → 改本文档**：本机自动化 prompt 一旦调整（措辞、参数、新增步骤、git 提交信息、调度时间、cwds、状态），必须同步更新本文件对应小节与总览表，并 `git commit` + `git push`，commit 信息带 `chore(automations): `。
- **改本文档 → 改自动化**：若先在文档里优化，也要用 `automation_update` 把 prompt 同步回本机对应自动化。
- **校验**：每隔一段时间对比本文件 prompt 与 `automation_update` 拉到的本机 prompt 是否逐字一致；三者（本文档 / 本机 prompt / 实际行为）必须一致。
- **新增 / 删除任务**：同步增删本文件对应小节与总览表。
- **C2/D2 红线（2026-11-09 用户拍板）**：第 13 节 prompt 不得含 `--apply` / git 推送块，状态保持 PAUSED；第 14 节不得含 `notify` / git 推送块，不自动调权重。任何放宽都必须先经用户明确确认，并同步改 `docs/system-plan-2026-11-09.md` 与代码配置。
