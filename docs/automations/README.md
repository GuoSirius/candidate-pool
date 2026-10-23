# 本地定时任务（WorkBuddy Automations）便携重建与对齐文档

> 本文件是本项目全部 A 股本地定时任务的**单一真值源（portable reference）**。
> 它们配置在本机 WorkBuddy 应用数据里，**不随 git 走**；换设备 / 重装后，对 AI 说一句
> **「按 docs/automations/README.md 重建所有定时任务」**，即可逐条照本文件用 `automation_update` 重建。
>
> ⚠️ **对齐铁律**：本机自动化 prompt 的任何调整 / 优化，都**必须**同步改回本文件并提交，始终保持「本文件 ↔ 本机自动化 ↔ 实际行为」三者一致。改完自动化记得回来更新本文档；反之亦然。

## 总览

| 任务 | 自动化 ID | 调度（RRULE） | 人类可读 | 状态 | 产物 |
|---|---|---|---|---|---|
| 盘前基线预计算 | `1e86f8e2-3865-47d3-b03d-8da929bc1dde` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=3;BYMINUTE=0` | 工作日 03:00 | ACTIVE | `eod/data/preopen-baseline-*.json`（不入库） |
| 盘前选股 preopen（手动触发） | `ff63044e-ff4e-4bd0-8f12-6b90c3a10f5a` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=25` | 工作日 09:25 | **PAUSED** | `eod/data/preopen-<日>.json` + html |
| 盘前回填 preopen:backfill（手动触发） | `79f60ba3-646d-48e9-8694-a65e95606184` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=15;BYMINUTE=30` | 工作日 15:30 | **PAUSED** | 回填进 `eod/data/preopen-<日>.json` close 段 |
| 尾盘选股-观察模式(1430) | `f46d3c1c-a803-4e43-a2a7-7db8ede8b5ba` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=30` | 工作日 14:30 | ACTIVE | `eod/data/eod-<交易日>-obs.json` + html |
| 尾盘选股-正式口径(1450) | `6cda9d58-4ba9-4c1d-ac2c-476c2459d879` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=50` | 工作日 14:50 | ACTIVE | `eod/data/eod-<交易日>.json` + html |
| 尾盘选股（手动触发） | `2b6b4b02-247a-433c-9b66-1c7cb45b780e` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=11;BYMINUTE=30` | 工作日 11:30 | ACTIVE | 同 `--intraday` 产物 |
| 早盘机会（10:30） | `437fc164-152b-431c-b5bf-8a7a211f8f47` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=10;BYMINUTE=30` | 工作日 10:30 | ACTIVE | 同 `--intraday` 产物 |
| A股次日候选池初筛 | `automation-1786328116138` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=16;BYMINUTE=0` | 工作日 16:00 | ACTIVE | `reports/stock_list_<锚定日>.html` + snapshot |

**cwds 统一为**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`（新设备改成你的实际仓库路径）。

### ⚓ 提交约定（铁律）

**所有定时任务执行后，都必须把产物改动提交并推送到仓库**（`git add` → `git commit` → `git push`）。
这是本文件与 [`docs/ops/01-方案.md`](../../docs/ops/01-方案.md) 共同遵守的硬规则：缺提交的定时任务会累积未入库产物，
且与 GitHub Actions 分支互相覆盖时丢失数据。

- **本地自动化（本机 WorkBuddy）**：**所有任务**的提交都由下方各节 Prompt 里的「git 推送块」显式负责（`git add` → `git commit` → `git push`）。脚本内部**不再写 git**——原先盘前选股 / 回填在 `preopen_screener.js` / `preopen_backfill.js` 内自动 commit，已于 2026-10-23 移除，统一收归 Prompt，避免重复提交。
- **GitHub Actions（云端）**：4 个定时 workflow 末尾均含 commit 步骤——`daily-screen` / `tail-screen` / `tail-observe` 提交到 `daily-artifacts` 分支，`refresh-industry-map` 提交到 `main`。
- **例外（不提交）**：① 盘前基线预计算产物为 `.gitignore` 忽略的派生缓存，故意不入库；② 附录 A1/A2 的 cwds 不在本仓库，不提交本仓库。

**两个 PAUSED 任务（盘前选股 / 盘前回填）**：调度不生效，仅用于在 WorkBuddy 自动化面板**手动触发**；recurring 类型必须带 rrule，故填了名义时间但不运行。

---

## 1. 盘前基线预计算 (preopen baseline)

- **ID**：`1e86f8e2-3865-47d3-b03d-8da929bc1dde`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=3;BYMINUTE=0`（工作日 03:00）
- **cwds**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`
- **状态**：ACTIVE
- **产物**：`eod/data/preopen-baseline-YYYYMMDD.json`（派生缓存，已被 .gitignore 忽略，不入库）
- **推送**：失败时经项目 notify 配置告警；成功静默

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
在候选池仓库运行盘前基线预计算：执行命令 `node eod/preopen_screener.js --baseline`（cwd 固定为 D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool）。

该命令会：抓取全市场前一日（lastClosedTradingDay，锚定日）的日 K 线，计算「昨日涨幅 + 昨日成交量 + 趋势(MA5/10/20/60 多头/N日新高/斜率)」基线指标，写入 eod/data/preopen-baseline-YYYYMMDD.json 缓存文件（文件名中的日期 = 锚定交易日，与次日 09:25 盘前全市场选股读取的是同一个文件，幂等覆盖、不会错乱）。

重要约束（无需联网提交、无需 git 操作）：
- 基线文件是派生缓存，已被仓库 .gitignore 忽略，不入库、不推送。不要执行任何 git add/commit/push。
- 本任务设计为「交易日收盘后」运行：非交易日运行会重算最近一个已收盘交易日的基线（无害，只是重复写同一文件）。

执行后用 Bash 确认 eod/data/preopen-baseline-*.json 的最近修改时间已更新（例如 `ls -la eod/data/preopen-baseline-*.json`）。
若命令非零退出、或网络抓取失败、或缓存文件未生成，请记录明确错误日志并告警（微信/邮件，复用项目 notify 配置），切勿静默忽略。
~~~

---

## 2. 盘前选股 preopen（手动触发）

- **ID**：`ff63044e-ff4e-4bd0-8f12-6b90c3a10f5a`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=25`（名义 09:25，**PAUSED 仅手动触发**）
- **cwds**：`D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool`
- **状态**：PAUSED
- **产物**：`eod/data/preopen-<当日>.json` + `eod/reports/preopen-<当日>.html`
- **推送**：脚本自身会推送通知与 git 溯源，无需额外提交

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
在仓库 D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool 运行盘前选股：npm run preopen（等价 node eod/preopen_screener.js，默认全市场 universe 口径）。09:20-09:35 交易窗口内运行有效，窗口外需补跑时加 --force（node eod/preopen_screener.js --force）。完成后汇总：候选数量、TOP5 名称与总分、贴线样本（nearMiss）条数；若被时段守卫跳过或零候选，说明原因。

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

## 3. 盘前回填 preopen:backfill（手动触发）

- **ID**：`79f60ba3-646d-48e9-8694-a65e95606184`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=15;BYMINUTE=30`（名义 15:30，**PAUSED 仅手动触发**）
- **cwds**：`D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool`
- **状态**：PAUSED
- **产物**：回填进 `eod/data/preopen-<当日>.json` 的 close 段（不产生新文件）
- **推送**：无

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
在仓库 D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool 运行盘前收盘回填：npm run preopen:backfill（等价 node eod/preopen_backfill.js）。收盘后 15:00-23:59 内执行有效；功能是对当日盘前候选（eod/data/preopen-<当日>.json 的 records）回填收盘价、当日涨跌幅、是否涨停并按 hitDayChgMin=2% 标记命中，结果合并进同一归档的 close 段。完成后汇总：回填总数、命中数、命中率；若当日无盘前归档则说明。

生成成功后，把更新后的归档提交并推送到 GitHub 仓库 candidate-pool（脚本不自动提交，必须显式执行）：

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
- **产物**：`eod/data/eod-<交易日>-obs.json` + `eod/reports/eod-<交易日>-obs.html`
- **推送**：本机照常推送微信 / 邮件（不静默）

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
运行 A 股尾盘选股（观察模式预览）。在当前工作目录（candidate-pool 项目根）执行：node eod/tail_screener.js

说明：
- 该时刻处于 14:30–14:50 之间，脚本自动进入「观察模式」（尾盘段=最近 20 分钟滚动窗口，与正式口径等长；结果仅供参考预览），产物写入 eod/data/eod-<交易日>-obs.json（原始快照另存 eod/data/raw/，不入库）与 eod/reports/ 同名 html，并通过 notify.js 推送微信/邮件。
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
1. 用 node 读取当日存档：观察模式为 eod/data/eod-<交易日>-obs.json（<交易日> 取今天；若今天文件不存在，则取 eod/data/eod-*-obs.json 中修改时间最新的一份）。
2. 跑下面这段 node 把 records 按 total 降序打印成 Markdown 表格（把命令里的文件路径换成上面那份）：
   ```
   node -e "const fs=require('fs');const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,'utf8'));const rs=Object.values(d.records||{}).sort((a,b)=>b.total-a.total);console.log('## 尾盘观察入选（'+d.tradeDate+'，共'+rs.length+'只）');console.log('|代码|名称|行业|涨跌幅%|尾盘段%|量比|总分|标记|');console.log('|---|---|---|---|---|---|---|---|');for(const r of rs){const t=r.tail||{};const tags=[];if(r.bestInGroup)tags.push('组内最优');if((t.upRatio??1)<0.55)tags.push('拉升不连贯');tags.push('组内 '+(r.groupRank??'?')+'/'+(r.groupSize??'?'));console.log('|'+r.code+'|'+r.name+'|'+(r.sector||'')+'|'+r.chgPct.toFixed(2)+'|'+(t.segPct!=null?t.segPct.toFixed(2):'')+'|'+r.volRatio.toFixed(2)+'|'+r.total.toFixed(1)+'|'+tags.join('、')+'|');}"
   ```
3. 涨跌幅% = chgPct；尾盘段% = tail.segPct；量比 = volRatio；总分 = total（保留 1 位）。涨跌幅与尾盘段按红涨绿跌语义展示数值即可，无需颜色。
4. 若 records 为空，直接说「今日（<交易日>）无尾盘观察候选」即可，不要编造。

完成后向用户报告：观察产物路径、候选数量、上面这张入选票表格，以及 git push 结果。
~~~

### git 推送块（本任务）

```bash
git add eod/data eod/reports
git commit -m "chore: 尾盘观察 $(date +%F)"
git push
```

---

## 5. 尾盘选股-正式口径(1450)

- **ID**：`6cda9d58-4ba9-4c1d-ac2c-476c2459d879`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=50`（工作日 14:50）
- **cwds**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`
- **状态**：ACTIVE
- **产物**：`eod/data/eod-<交易日>.json` + `eod/reports/eod-<交易日>.html`
- **推送**：**本机静默**（`--no-notify`）；微信 / 邮件由 GitHub Actions 的 `tail-screen.yml`（14:40 触发、程序内等到 14:50）负责，避免重复推送

### Prompt（原样复制进 WorkBuddy 自动化）

~~~text
运行 A 股尾盘选股（正式固定口径）。在当前工作目录（candidate-pool 项目根）执行：node eod/tail_screener.js --no-notify

说明：
- 推送策略：**本机静默**。同一 14:50 口径还由 GitHub Actions 的 tail-screen.yml（14:40 触发、程序内等到 14:50）运行并负责推送微信/邮件；本机再推一次会重复，故加 --no-notify。
- 该时刻已过 14:50，脚本自动按「固定口径 14:50」取数（同日多次运行结果一致、幂等覆盖），产物写入 eod/data/eod-<交易日>.json 与 eod/reports/eod-<交易日>.html，并照常同步 Cloudflare D1（--no-notify 不影响入库与本地留档）。
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
1. 用 node 读取当日存档：正式口径为 eod/data/eod-<交易日>.json（<交易日> 取今天；若今天文件不存在，则取 eod/data/eod-*.json 中修改时间最新、且文件名不含 -obs / -intraday 的一份）。
2. 跑下面这段 node 把 records 按 total 降序打印成 Markdown 表格（把命令里的文件路径换成上面那份）：
   ```
   node -e "const fs=require('fs');const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,'utf8'));const rs=Object.values(d.records||{}).sort((a,b)=>b.total-a.total);console.log('## 尾盘正式入选（'+d.tradeDate+'，共'+rs.length+'只）');console.log('|代码|名称|行业|涨跌幅%|尾盘段%|量比|总分|标记|');console.log('|---|---|---|---|---|---|---|---|');for(const r of rs){const t=r.tail||{};const tags=[];if(r.bestInGroup)tags.push('组内最优');if((t.upRatio??1)<0.55)tags.push('拉升不连贯');tags.push('组内 '+(r.groupRank??'?')+'/'+(r.groupSize??'?'));console.log('|'+r.code+'|'+r.name+'|'+(r.sector||'')+'|'+r.chgPct.toFixed(2)+'|'+(t.segPct!=null?t.segPct.toFixed(2):'')+'|'+r.volRatio.toFixed(2)+'|'+r.total.toFixed(1)+'|'+tags.join('、')+'|');}"
   ```
3. 涨跌幅% = chgPct；尾盘段% = tail.segPct；量比 = volRatio；总分 = total（保留 1 位）。涨跌幅与尾盘段按红涨绿跌语义展示数值即可，无需颜色。
4. 若 records 为空，直接说「今日（<交易日>）无尾盘正式候选」即可，不要编造。

完成后向用户报告：正式产物路径、候选数量、上面这张入选票表格，以及 git push 结果。
~~~

### git 推送块（本任务）

```bash
git add eod/data eod/reports
git commit -m "chore: 尾盘选股 $(date +%F)"
git push
```

---

## 6. 尾盘选股（手动触发）& 7. 早盘机会（10:30）

> 这两个任务 prompt 完全相同，仅调度时间与用途不同：10:30 是早盘异动观察，11:30 是午前手动兜底（对应 `npm run tail:intraday`）。均为本机实时盘中筛，产物 `-intraday` 系列。

- **尾盘选股（手动触发）ID**：`2b6b4b02-247a-433c-9b66-1c7cb45b780e`，调度 `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=11;BYMINUTE=30`
- **早盘机会（10:30）ID**：`437fc164-152b-431c-b5bf-8a7a211f8f47`，调度 `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=10;BYMINUTE=30`
- **cwds**：`D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool`
- **状态**：均 ACTIVE
- **推送**：脚本强制 `--no-notify`（不推送微信/邮件）；`--intraday` 产物**不写入 D1**；git 提交由下方「git 推送块」负责

### Prompt（原样复制进 WorkBuddy 自动化，两任务共用）

~~~text
在 candidate-pool 项目目录（D:/workspace/workbuddy/2026-08-10-08-26-02/candidate-pool）下，执行尾盘选股命令：运行 `npm run tail:intraday`（等价于 `node eod/tail_screener.js --intraday`）。等待命令执行完成，捕获并打印关键输出（候选股列表、报告路径、任何报错），用简洁中文向用户汇报结果。若命令执行失败，给出根因与可执行建议，不要隐瞒错误。

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
   该命令默认锚定"最近一个已收盘交易日"（判据：交易日 hour < 15 视为未收盘），做实时初筛（R01 量能验证突破 + R07 板块内补涨 + R05 尾盘异动核验），输出单文件、资源全内联、支持中英切换的 HTML。
   默认按锚定日输出：reports/stock_list_<锚定日>.html 与 data/snapshot-<锚定日>.json（覆盖式，每天一份）。
2. 生成成功后，将更新提交并推送到远程：
   git add reports/stock_list_*.html data/snapshot-*.json
   git commit -m "chore: 每日实时初筛 $(date +%F)"
   git push
   推送依赖本机已缓存的 Git 凭据（GitHub），无需交互。
3. 完成后向用户报告：生成的报告路径、硬触发数量（R01/R07/R05）、重点关注/次级关注数量，以及 git push 结果。本机已静默，不需要报告微信/邮件推送结果。若某步失败，如实转述异常，不要编造数据。
4. 你把整理出来的数据中R01 量能验证突破、R07 板块内补涨、R05 尾盘异动核验、重点关注、次级关注、条件观察这几类的股票名称、代码一起给我列出来，方便我查看。

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
git commit -m "chore: 每日实时初筛 $(date +%F)"
git push
```

---

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
4）若当天（运行当日）尚未发布新纪要，则分析最近一篇并明确说明"今日尚未更新，以下为最近一期"。
5）根据最新消息筛选、推荐几个A股相关概念股，每个热点列举一些，列举最相关的或者近期走势好的，热度最高的排第一，依次类推
6）列表最新三条链接也发送给我，方便阅读详情

不要推送、不要发布任何内容，仅把分析结果作为本次任务的输出。
~~~

### A2. A股每日市场情绪日报（23:30，PAUSED）

- **ID**：`automation-1786325369523`
- **调度**：`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=23;BYMINUTE=30`
- **cwds**：`D:\workspace\workbuddy\2026-08-10-08-24-44`（独立项目：龙虎榜+题材+行业轮动日报，Python 实现）
- **推送**：`--notify`（依赖该项目 notify_config.json）

~~~text
生成最近交易日的 A 股「龙虎榜 + 题材热点 + 行业轮动」市场情绪日报，并在生成后推送微信/邮件。

执行步骤：
1. 用虚拟环境解释器运行 D:\workspace\workbuddy\2026-08-10-08-24-44\run_daily.py --notify（默认取最近交易日，周末自动回退到周五；--notify 会在报告生成后按 notify_config.json 推送）。
   命令示例：
   C:/Users/Admin/.workbuddy/binaries/python/envs/default/Scripts/python.exe D:/workspace/workbuddy/2026-08-10-08-24-44/run_daily.py --notify
2. 脚本自动完成：刷新/复用参考库、抓取龙虎榜与同花顺题材、抓取全市场行情序列、北交所补齐、计算行业板块、渲染单文件 HTML，最后推送。
3. 完成后向用户报告：生成的 HTML 文件路径（output/A股市场情绪日报_YYYY-MM-DD.html）、关键概览（上榜家数、净买入合计、最热题材、领涨行业、全市场涨跌家数），以及微信/邮件推送结果。若 notify_config.json 未配置则跳过推送并提示用户如何配置。

注意事项：
- 推送依赖本地 notify_config.json（Server酱/PushPlus 的 key + 163 邮箱授权码），缺配置时不影响报告生成。
- 依赖本地网络（通达信 TCP、东方财富、同花顺、新浪、腾讯）与虚拟环境（含 requests、mootdx）。某步失败脚本仍尽量产出报告，请如实转述异常。
~~~

> 「知了窝」两个同步自动化属于 zhiliaowo-proxy 项目，记录在该项目自己的文档里，此处不收录。

---

## 便携重建流程（换设备时）

1. 拉取本仓库，对 AI 说：**「按 docs/automations/README.md 重建所有定时任务」**。
2. AI 逐条用 `automation_update`（mode=create）照各节 Prompt、rrule、cwds 创建；总览表中的 ID 会变（本机 ID 仅供参考对齐，重建后以新 ID 为准）。
3. 把各节 cwds 里的旧路径替换为新设备的仓库实际路径。
4. 两个 PAUSED 任务创建后同样设为 PAUSED（scheduleType=recurring + status=PAUSED）。
5. 重建完成后用本文件逐字校验各 prompt。

## 对齐约定（务必遵守）

- **改自动化 → 改本文档**：本机自动化 prompt 一旦调整（措辞、参数、新增步骤、git 提交信息、调度时间、cwds、状态），必须同步更新本文件对应小节与总览表，并 `git commit` + `git push`，commit 信息带 `chore(automations): `。
- **改本文档 → 改自动化**：若先在文档里优化，也要用 `automation_update` 把 prompt 同步回本机对应自动化。
- **校验**：每隔一段时间对比本文件 prompt 与 `automation_update` 拉到的本机 prompt 是否逐字一致；三者（本文档 / 本机 prompt / 实际行为）必须一致。
- **新增 / 删除任务**：同步增删本文件对应小节与总览表。
