# A股次日候选池 · 自动初筛

把 **A股短线交易** 的「标的初筛」流程固化为可定时运行的脚本：以官方综合评分排行（前 12 名）为候选起点，套用 **R01 量能验证突破 + R07 板块内补涨**（并以 **R05 尾盘异动** 核验），输出一份 **单文件、资源全内联、无外链、支持中英切换** 的 HTML 报告，并把实时结果**推送到个人微信 / 163 邮箱**。

> 报告即「观察评级」，不构成任何投资建议。详见文末免责声明。

---

## 目录结构

```
candidate-pool/
├── gen_candidates.js            # 核心脚本（Node >=18，CommonJS）
├── notify.js                    # 结果推送（微信 Server酱/PushPlus + 163 邮箱，零依赖）
├── run_today.cmd                # Windows 一键运行（双击即可）
├── run_today.sh                 # bash 一键运行
├── package.json                 # npm scripts: start / run / live / offline / notify
├── notify_config.example.json   # 推送配置模板（复制为 notify_config.json 后填真实凭据）
├── data/
│   └── snapshot-<锚定日>.json    # 实时抓取的快照（离线模式数据源，按日留档、覆盖式）
├── reports/
│   ├── stock_list_<锚定日>.html  # 实时生成的报告（按日留档、覆盖式，每天一份）
│   └── stock_list_20260727.html  # 示例报告（2026-07-27 收盘后，同源快照离线重建）
└── .github/workflows/
    └── daily-screen.yml         # GitHub Actions 工作流（默认 live，需 self-hosted runner）
```

---

## 环境要求

- **Node.js >= 18**（本地测试用 22）。
- **在线模式** 依赖 `westock-tool` / `westock-data`（腾讯自选股 CLI，随 WorkBuddy 内置）。
  脚本默认调用本机 WorkBuddy 的安装路径，可通过环境变量覆盖：
  ```bash
  export WESTOCK_NODE=/path/to/node
  export WESTOCK_TOOL=/path/to/westock-tool/index.js
  export WESTOCK_DATA=/path/to/westock-data/index.js
  ```
- **离线模式** 不依赖任何外部 CLI，只要装了 Node 即可在任何机器 / CI 上运行。

---

## 用法

### 1. 在线（实时抓取，需 WorkBuddy + westock）—— 默认模式

```bash
node gen_candidates.js                  # 锚定日 = 最近一个已收盘交易日
node gen_candidates.js --date 2026-07-27   # 回填指定日期
node gen_candidates.js --limit 12 --quiet
node gen_candidates.js --no-notify      # 实时运行但跳过微信/邮件推送
```

Windows 直接双击 `run_today.cmd` 亦可。**实时运行会**：
- 写出报告 `reports/stock_list_<锚定日>.html`
- 写出快照 `data/snapshot-<锚定日>.json`（供日后离线复现）
- 把结果摘要推送到 `notify_config.json` 配置的微信 / 邮箱渠道

> 同名文件重复运行时为**覆盖式写入**：每天一份，重复执行不产生多份堆积。

### 2. 离线（从快照重建，无需 westock —— 推荐在 CI / 其他设备查看用）

```bash
node gen_candidates.js --offline --snapshot data/snapshot-2026-07-27.json --out reports/stock_list_20260727.html
# 或
npm run offline
```

### 3. 导出快照（先把某次在线结果存下来，供日后离线复现）

```bash
node gen_candidates.js --date 2026-07-27 --dump data/snapshot-2026-07-27.json
```

> 快照已剥离 `kline/quote/minute` 等大体积原始数据，仅保留判定所需字段（约 19 KB），可安全入库。

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

- 数据来源：腾讯自选股 `westock-data` / `westock-tool`，数据时点为锚定日收盘。
- 候选起点命令 `westock-tool ranking CompScore --limit 12` 返回的是**运行时当日**排行；脚本实际执行时带入 `--date` 锚定日，避免排行与行情口径错配。
- 日线为前复权（`--fq qfq`），截断至锚定日，不使用之后数据。
- 板块涨幅由申万一级 31 个行业指数日线按锚定日收盘对前收重建（官方板块榜接口不支持历史日期）。
- 市值对总市值与流通市值**同时**校验。
- 涨跌分布接口仅提供最新交易日，历史回填时已明确标注「非锚定日历史值」。
- **R05 数据缺口声明**：分时接口（`westock-data minute`）仅保留最近约 5 个交易日，历史锚定日的分时不可得时，明确标注为「数据缺口」而非信号缺失，绝不编造替代指标。

---

## GitHub Actions 配置与使用流程

**默认 `live`（实时抓取），但 live 必须在装有 WorkBuddy 的 self-hosted runner 上运行。**

### 第 1 步：在本机注册 self-hosted runner

1. 进入仓库 `Settings → Actions → Runners → New self-hosted runner`。
2. 选择 Windows，按页面给出的命令下载并配置 runner（会让你 `./config.cmd --url https://github.com/GuoSirius/candidate-pool --token xxx`）。
3. 以**普通用户**身份启动 runner（不要服务方式，以免拿不到 WorkBuddy 的路径/凭据）：`.\run.cmd`。
4. 确认 runner 标签为 `self-hosted`（工作流 `runs-on: self-hosted` 即匹配）。

### 第 2 步：配置仓库 Secrets

仓库 `Settings → Secrets and variables → Actions → New repository secret`，至少填：

| Secret | 说明 |
|--------|------|
| `WESTOCK_NODE` | 本机 Node 路径，如 `C:/Users/Admin/.workbuddy/binaries/node/versions/22.22.2/node.exe` |
| `WESTOCK_TOOL` | `westock-tool/index.js` 路径（WorkBuddy 内置技能目录） |
| `WESTOCK_DATA` | `westock-data/index.js` 路径（WorkBuddy 内置技能目录） |
| `NOTIFY_WX_PROVIDER` | `serverchan` 或 `pushplus`（可选，缺省 serverchan） |
| `NOTIFY_WX_KEY` | Server酱 SendKey（用微信推送时必填） |
| `NOTIFY_WX_TOKEN` | PushPlus token（provider=pushplus 时填） |
| `NOTIFY_MAIL_SENDER` / `NOTIFY_MAIL_AUTH` | 163 邮箱与授权码（用邮件推送时填） |
| `NOTIFY_MAIL_RECEIVER` / `NOTIFY_MAIL_HOST` / `NOTIFY_MAIL_PORT` | 收件人 / SMTP 主机 / 端口（可选，有默认值） |

> 也可不走 Secrets，而是直接在 self-hosted runner 机器上放一份 `notify_config.json`（已被 `.gitignore` 忽略，不会入库）。

### 第 3 步：触发

- **手动**：`Actions → Daily A-Share Screening → Run workflow`，`mode` 默认 `live`。
- **定时**：`cron 35 7 * * 1-5`（北京时间 15:35，周一至周五）。注意 GitHub 托管 Runner 跑不了 live，因此**调度触发走 `offline`**（从已提交快照重建，保证每天有产物写回）；真正实时的 live 需你手动触发（在 self-hosted runner 上）。

### 输出与提交

- 实时运行按锚定日写出 `reports/stock_list_<锚定日>.html` 与 `data/snapshot-<锚定日>.json`，**覆盖式**写回仓库（每天一份）。
- 工作流用 `GITHUB_TOKEN`（`permissions: contents: write`）提交，无需 PAT。

---

## 免责声明

本报告由程序基于公开市场数据**自动生成**，仅用于短线交易候选池的量化初筛与观察评级，**不构成任何投资建议或买卖邀约**。所有判定均基于历史/收盘数据，存在前视偏差与数据缺口（如 R05 分时不可得）。市场有风险，决策需独立判断并自担风险。
