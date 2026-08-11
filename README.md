# A股次日候选池 · 自动初筛

把 **A股短线交易** 的「标的初筛」流程固化为可定时运行的脚本：以一份**可编辑的行业观察池**（`candidates.json`，当前 377 只、覆盖 26 个申万一级行业）为候选起点，套用 **R01 量能验证突破 + R07 板块内补涨**（并以 **R05 尾盘异动** 核验），输出一份 **单文件、资源全内联、无外链、支持中英切换** 的 HTML 报告，并把实时结果**推送到个人微信 / 163 邮箱**。

行情数据直连**腾讯公开行情接口**，不依赖任何本机技能、CLI 或账号，装了 Node 就能跑（全量 377 只约 6 秒）。

> 报告即「观察评级」，不构成任何投资建议。详见文末免责声明。

---

## 目录结构

```
candidate-pool/
├── gen_candidates.js            # 核心脚本（Node >=18，CommonJS）
├── build_universe.js            # 观察池构建/刷新（校验代码有效性、剔除 ST、回填名称与市值）
├── candidates.json              # 候选观察池（377 只 / 26 个申万一级行业，可自由增删）
├── notify.js                    # 结果推送（微信 Server酱/PushPlus + 163 邮箱，零依赖）
├── run_today.cmd                # Windows 一键运行（双击即可）
├── run_today.sh                 # bash 一键运行
├── package.json                 # npm scripts: start / run / live / offline / universe / notify
├── notify_config.example.json   # 推送配置模板（复制为 notify_config.json 后填真实凭据）
├── data/
│   └── snapshot-<锚定日>.json    # 实时抓取的快照（离线模式数据源，按日留档、覆盖式）
├── reports/
│   ├── stock_list_<锚定日>.html  # 实时生成的报告（按日留档、覆盖式，每天一份）
│   └── stock_list_20260727.html  # 示例报告（2026-07-27 收盘后，同源快照离线重建）
└── .github/workflows/
    └── daily-screen.yml         # GitHub Actions 工作流（默认 live，托管 Runner 即可，失败自动回退 offline）
```

---

## 环境要求

- **Node.js >= 18**（本地测试用 22）。**零第三方依赖**，`npm install` 都不需要。
- **在线模式** 只要能访问下列腾讯公开接口即可，无需账号、Key 或任何本机技能：
  | 用途 | 接口 |
  |------|------|
  | 报价 / 市值 / 52周高 | `https://qt.gtimg.cn/q=<code>`（支持一次批量查上百只，GBK 编码） |
  | 日 K 线（前复权） | `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=<code>,day,,,260,qfq` |
  | 分时 | `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=<code>` |
- 运行脚本的 Node 路径可用 `CANDIDATE_NODE` 环境变量指定（旧变量名 `WESTOCK_NODE` 仍兼容）。
- **离线模式** 完全不发网络请求，从已提交的快照重建报告，任何机器 / CI 上都能跑。

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
node gen_candidates.js --offline --snapshot data/snapshot-2026-07-27.json --out reports/stock_list_20260727.html
# 或
npm run offline
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
**行情数据无需任何凭据**，这里只配推送相关的：

| Secret | 说明 |
|--------|------|
| `NOTIFY_WX_PROVIDER` | `serverchan` 或 `pushplus`（可选，缺省 serverchan） |
| `NOTIFY_WX_KEY` | Server酱 SendKey（用微信推送时必填） |
| `NOTIFY_WX_TOKEN` | PushPlus token（provider=pushplus 时填） |
| `NOTIFY_MAIL_SENDER` / `NOTIFY_MAIL_AUTH` | 163 邮箱与授权码（用邮件推送时填） |
| `NOTIFY_MAIL_RECEIVER` / `NOTIFY_MAIL_HOST` / `NOTIFY_MAIL_PORT` | 收件人 / SMTP 主机 / 端口（可选，有默认值） |

> 本地运行则不用 Secrets，直接放一份 `notify_config.json` 即可（已被 `.gitignore` 忽略，不会入库）。

### 第 2 步：触发

- **手动**：`Actions → Daily A-Share Screening → Run workflow`。`mode` 默认 `live`，另可填 `date` 回填指定锚定日。
- **定时**：`cron 35 7 * * 1-5`（北京时间 15:35，周一至周五），**走实时抓取**。

### 输出与提交

- 实时运行按锚定日写出 `reports/stock_list_<锚定日>.html` 与 `data/snapshot-<锚定日>.json`，**覆盖式**写回仓库（每天一份）。
- 工作流用 `GITHUB_TOKEN`（`permissions: contents: write`）提交，无需 PAT。

---

## 免责声明

本报告由程序基于公开市场数据**自动生成**，仅用于短线交易候选池的量化初筛与观察评级，**不构成任何投资建议或买卖邀约**。所有判定均基于历史/收盘数据，存在前视偏差与数据缺口（如 R05 分时不可得）。市场有风险，决策需独立判断并自担风险。
