# A股次日候选池 · 自动初筛

把 **A股短线交易** 的「标的初筛」流程固化为可定时运行的脚本：以官方综合评分排行（前 12 名）为候选起点，套用 **R01 量能验证突破 + R07 板块内补涨**（并以 **R05 尾盘异动** 核验），输出一份 **单文件、资源全内联、无外链、支持中英切换** 的 HTML 报告。

> 报告即「观察评级」，不构成任何投资建议。详见文末免责声明。

---

## 目录结构

```
candidate-pool/
├── gen_candidates.js            # 核心脚本（Node >=18，CommonJS）
├── run_today.cmd                # Windows 一键运行（双击即可）
├── run_today.sh                 # bash 一键运行
├── package.json                 # npm scripts: start / run / offline
├── data/
│   └── snapshot-2026-07-27.json # 在线抓取的快照（离线模式数据源，已提交）
├── reports/
│   ├── stock_list_20260727.html # 示例报告（2026-07-27 收盘后）
│   └── stock_list_latest.html   # CI / 本地最新生成的报告（由工作流写回）
└── .github/workflows/
    └── daily-screen.yml         # GitHub Actions 工作流
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

### 1. 在线（实时抓取，需 WorkBuddy + westock）

```bash
node gen_candidates.js                  # 锚定日 = 最近一个已收盘交易日
node gen_candidates.js --date 2026-07-27   # 回填指定日期
node gen_candidates.js --limit 12 --out reports/foo.html --quiet
```

Windows 直接双击 `run_today.cmd` 亦可。

### 2. 离线（从快照重建，无需 westock —— 推荐在 CI / 其他设备查看用）

```bash
node gen_candidates.js --offline --snapshot data/snapshot-2026-07-27.json --out reports/stock_list_latest.html
# 或
npm run offline
```

### 3. 导出快照（先把某次在线结果存下来，供日后离线复现）

```bash
node gen_candidates.js --date 2026-07-27 --dump data/snapshot-2026-07-27.json
```

> 快照已剥离 `kline/quote/minute` 等大体积原始数据，仅保留判定所需字段（约 19 KB），可安全入库。

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

## GitHub Actions 可行性说明（重要）

**结论：可以自动触发，但分两种模式。**

- **`offline`（默认，GitHub 托管 Runner 即可运行）**：从仓库内已提交的 `data/snapshot-*.json` 重建 HTML 报告并写回 `reports/stock_list_latest.html`。**不调用任何外部接口**，因此能在 `ubuntu-latest` 上稳定跑通，保证「克隆即可查看 / 定时复现」。
- **`live`（实时抓取）**：调用 `westock` 接口获取当日数据。但 `westock-tool` / `westock-data` 是 **WorkBuddy 内置技能，依赖 WorkBuddy 宿主运行时**（非独立 npm 包），**GitHub 托管 Runner 上没有、也跑不起来**。要启用实时自动执行，需要：
  1. 在本机（已安装 WorkBuddy）注册一个 **self-hosted runner**；
  2. 在仓库 `Settings → Secrets` 配置 `WESTOCK_NODE` / `WESTOCK_TOOL` / `WESTOCK_DATA` 三个路径变量；
  3. 手动触发工作流并选择 `mode = live`（或在 `daily-screen.yml` 中将调度默认改为 live）。

工作流：`.github/workflows/daily-screen.yml`，默认在每个交易日 **15:35（北京时间）** 触发 `offline` 任务；也可在 Actions 页面手动选择模式。

---

## 免责声明

本报告由程序基于公开市场数据**自动生成**，仅用于短线交易候选池的量化初筛与观察评级，**不构成任何投资建议或买卖邀约**。所有判定均基于历史/收盘数据，存在前视偏差与数据缺口（如 R05 分时不可得）。市场有风险，决策需独立判断并自担风险。
