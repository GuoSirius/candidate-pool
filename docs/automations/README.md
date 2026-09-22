# 本地定时任务（WorkBuddy Automations）便携重建与对齐文档

> 本文件是三个 A 股本地定时任务的**单一真值源（portable reference）**。
> 它们配置在本机 WorkBuddy 应用数据里，**不随 git 走**；换设备 / 重装后需按本文件在 WorkBuddy 自动化里重建。
>
> ⚠️ **对齐铁律**：本机自动化 prompt 的任何调整 / 优化，都**必须**同步改回本文件并提交，始终保持「本文件 ↔ 本机自动化 ↔ 实际行为」三者一致。改完自动化记得回来更本文档；反之亦然。

## 总览

| 任务 | 自动化 ID | 调度（RRULE） | 人类可读 | cwds | 状态 |
|---|---|---|---|---|---|
| 尾盘选股-观察模式(1430) | `f46d3c1c-a803-4e43-a2a7-7db8ede8b5ba` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=30` | 工作日 14:30 | candidate-pool | ACTIVE |
| 尾盘选股-正式口径(1450) | `6cda9d58-4ba9-4c1d-ac2c-476c2459d879` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=14;BYMINUTE=50` | 工作日 14:50 | candidate-pool | ACTIVE |
| A股次日候选池初筛 | `automation-1786328116138` | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=16;BYMINUTE=0` | 工作日 16:00 | candidate-pool | ACTIVE |

**cwds 统一为**：`D:\workspace\workbuddy\2026-08-10-08-26-02\candidate-pool`（新设备改成你的实际仓库路径）。

**通用 git 推送块**（三个任务跑完都会自动提交 + 推送，依赖本机已缓存的 GitHub 凭据，无需交互）：

```bash
git add <对应产物目录>
git commit -m "<chore 信息> $(date +%F)"
git push
```

> 推送失败如实反馈，不要编造；本机凭据走 wincred / cached，无需在 prompt 里写 token。

---

## 1. 尾盘选股-观察模式(1430)

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
- 该时刻处于 14:30–14:50 之间，脚本自动进入「观察模式」（口径随当前时点变化，结果仅供参考预览），产物写入 eod/data/eod-<交易日>-obs.json 与 eod/reports/ 同名 html，并通过 notify.js 推送微信/邮件。
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

## 2. 尾盘选股-正式口径(1450)

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

## 3. A股次日候选池初筛

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

## 对齐约定（务必遵守）

- **改自动化 → 改本文档**：本机自动化 prompt 一旦调整（措辞、参数、新增步骤、git 提交信息、调度时间、cwds），必须同步更新本文件对应段落，并 `git commit` + `git push`，commit 信息带 `chore(automations): `。
- **改本文档 → 改自动化**：若先在文档里优化，也要用 `automation_update` 把 prompt 同步回本机对应自动化。
- **校验**：每隔一段时间对比本文件 prompt 与 `automation_update` 拉到的本机 prompt 是否逐字一致；三者（本文档 / 本机 prompt / 实际行为）必须一致。
- **新增 / 删除任务**：同步增删本文件对应小节与总览表。
