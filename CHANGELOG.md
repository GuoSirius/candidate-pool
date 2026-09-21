# Changelog

所有变动按 **Conventional Commits** 约定分类，由 `changelogen` 自动生成。

## v2.0.0

[compare changes](https://github.com/GuoSirius/candidate-pool/compare/v1.1.0...v2.0.0)

### 🚀 新功能 (Features)

- 量比(vol_ratio)全链路持久化（快照→D1→API 类型） ([8c5aae9](https://github.com/GuoSirius/candidate-pool/commit/8c5aae9))
- **web:** 候选列表下拉布局 + 详情返回保留状态 + 量比/总市值列 + 规则/字段说明 ([b66716b](https://github.com/GuoSirius/candidate-pool/commit/b66716b))
- **web:** 复盘统计改版(默认近一月/走势图全周期可勾选/命中率合并列/锚定日倒序) + 规则释义完善 + glossary 单一来源 ([9b6b420](https://github.com/GuoSirius/candidate-pool/commit/9b6b420))
- 新增「全部标的」汇总页（入选次数/各档数量/多列排序，默认最近入选倒序）+ /api/stock-rank 聚合接口 ([a8c184e](https://github.com/GuoSirius/candidate-pool/commit/a8c184e))
- **web:** 详情页按来源返回并保持列表状态 + 复盘汇总改回卡片并说明口径 ([ed02ad2](https://github.com/GuoSirius/candidate-pool/commit/ed02ad2))
- **worker:** 新增评论(备注)与分组写入接口，含共享令牌写鉴权 ([dfb3812](https://github.com/GuoSirius/candidate-pool/commit/dfb3812))
- **web:** Api 客户端补写接口与写令牌存储，附带 10005 业务码 ([c7109e0](https://github.com/GuoSirius/candidate-pool/commit/c7109e0))
- **web:** 详情页支持写备注与分组，顶栏新增写权限入口 ([c1153cd](https://github.com/GuoSirius/candidate-pool/commit/c1153cd))
- **web:** 全部标的页新增档位下拉筛选，汇总跟随筛选并保持状态 ([76ac06d](https://github.com/GuoSirius/candidate-pool/commit/76ac06d))
- **worker:** 股票汇总接口补充 n1/n2/n3 平均涨跌幅（改用内存聚合） ([cfb5795](https://github.com/GuoSirius/candidate-pool/commit/cfb5795))
- **web:** 全部入选标的列表展示 n1-n3 平均涨跌幅（可排序、空值排末位） ([3f27cb5](https://github.com/GuoSirius/candidate-pool/commit/3f27cb5))
- **worker:** 时间处理改用 dayjs，与脚本/前端统一时区口径 ([720710a](https://github.com/GuoSirius/candidate-pool/commit/720710a))
- **worker:** 股票汇总补充「最近一次入选」口径的 n1-n3 收益 ([763cdf6](https://github.com/GuoSirius/candidate-pool/commit/763cdf6))
- **web:** 全部标的页 n1-n3 支持最近一次/历史平均口径切换 ([7332891](https://github.com/GuoSirius/candidate-pool/commit/7332891))
- **web:** 明细表支持点列头排序，排序逻辑抽到 utils/sort ([647ae74](https://github.com/GuoSirius/candidate-pool/commit/647ae74))
- **web:** 全部标的页支持分页（默认 20 条，可选至全部），并对齐共用排序 ([3060fa4](https://github.com/GuoSirius/candidate-pool/commit/3060fa4))
- **web:** 数据表首列新增序号（全部标的 / 入选记录 / 复盘统计） ([2ebb11c](https://github.com/GuoSirius/candidate-pool/commit/2ebb11c))
- **web:** 候选池支持按档位排序，首列新增序号 ([de2fe37](https://github.com/GuoSirius/candidate-pool/commit/de2fe37))
- **db:** 入库支持 --both 双写，新增一致性哨兵 ([cfba376](https://github.com/GuoSirius/candidate-pool/commit/cfba376))
- **eod:** 尾盘选股配置层、http 抓取层与交易时段判定 ([7d63351](https://github.com/GuoSirius/candidate-pool/commit/7d63351))
- **eod:** 全市场快照抓取与分时尾盘段计算 ([62c88c2](https://github.com/GuoSirius/candidate-pool/commit/62c88c2))
- **eod:** 初筛过滤、六项打分与行业分组排序 ([6626072](https://github.com/GuoSirius/candidate-pool/commit/6626072))
- **eod:** 幂等落库、双语报告与尾盘选股入口 ([03479be](https://github.com/GuoSirius/candidate-pool/commit/03479be))
- **eod:** 双通道调度——程序内等待与 github actions workflow ([ea72813](https://github.com/GuoSirius/candidate-pool/commit/ea72813))
- **worker:** 新增备注全量列表接口 ([beda89f](https://github.com/GuoSirius/candidate-pool/commit/beda89f))
- **web:** 新增分组与备注总览页 ([a81fdd3](https://github.com/GuoSirius/candidate-pool/commit/a81fdd3))
- **eod:** 尾盘选股脚本与 d1 落库同步 ([794584e](https://github.com/GuoSirius/candidate-pool/commit/794584e))
- **worker:** 尾盘选股查询接口与复盘口径 ([82bd2d9](https://github.com/GuoSirius/candidate-pool/commit/82bd2d9))
- **web:** 尾盘选股页面（概览/历史/复盘/差异） ([e11614e](https://github.com/GuoSirius/candidate-pool/commit/e11614e))
- **db:** Schema.sql 单一真相源与一键结构同步，修复本地远程漏建表 ([9229cc8](https://github.com/GuoSirius/candidate-pool/commit/9229cc8))
- **db:** 结构同步改为声明式差异识别，新增列/索引可自动补齐 ([d7e9651](https://github.com/GuoSirius/candidate-pool/commit/d7e9651))
- **eod:** 新增盘中模式 --intraday，保留时段守卫并补齐时段自测 ([221a8a5](https://github.com/GuoSirius/candidate-pool/commit/221a8a5))
- **paths:** 新增工作目录解析，产物与配置可重定位（默认行为不变） ([50c64f4](https://github.com/GuoSirius/candidate-pool/commit/50c64f4))
- **npm:** 新增 bin 入口与包元数据（files 白名单 / repository / 公开发布配置） ([e8f2a0e](https://github.com/GuoSirius/candidate-pool/commit/e8f2a0e))
- **release:** 新增打包体检脚本（敏感文件守门 + 规则自检 + 体积红线） ([9274050](https://github.com/GuoSirius/candidate-pool/commit/9274050))
- **release:** 新增 tag 触发的云端发布工作流与 release 说明生成 ([ee6f581](https://github.com/GuoSirius/candidate-pool/commit/ee6f581))
- **release:** Release 一条命令集成说明预览并回报三条结果链接 ([e9354ce](https://github.com/GuoSirius/candidate-pool/commit/e9354ce))
- **scaffold:** 新增首次运行脚手架，空目录（npx/装包）可开箱运行 ([fa4240c](https://github.com/GuoSirius/candidate-pool/commit/fa4240c))
- 尾盘六维分项分两组呈现（个股自身 65 / 环境质量 35） ([1fa9f0f](https://github.com/GuoSirius/candidate-pool/commit/1fa9f0f))
- 尾盘候选页补全尾盘段与标记字段，并新增分行业明细列表 ([46c77f1](https://github.com/GuoSirius/candidate-pool/commit/46c77f1))
- **tail:** 新增 --resync，把本地存档重新补发到 D1 ([cf24909](https://github.com/GuoSirius/candidate-pool/commit/cf24909))
- **tail:** 落库目标本地默认双写（本机写本地库+远程，CI 只写远程） ([39d45e6](https://github.com/GuoSirius/candidate-pool/commit/39d45e6))

### ⚡ 性能优化 (Performance)

- **worker:** Stats 日线查询按下界裁剪 ([1010e34](https://github.com/GuoSirius/candidate-pool/commit/1010e34))
- **worker:** 行情类接口加 5 分钟浏览器缓存 ([f906fe1](https://github.com/GuoSirius/candidate-pool/commit/f906fe1))

### 🐛 缺陷修复 (Bug Fixes)

- 发布选择界面不再打印 CHANGELOG，保持版本选择界面简洁 ([e758251](https://github.com/GuoSirius/candidate-pool/commit/e758251))
- **worker:** 修复 /api/stats 500（D1 绑定参数上限 100，price_daily 分块 400→90） ([7d95274](https://github.com/GuoSirius/candidate-pool/commit/7d95274))
- **deps:** Typescript 降至 6.0.3（TS7 不导出 lib/tsc，vue-tsc 无法解析） ([0f00675](https://github.com/GuoSirius/candidate-pool/commit/0f00675))
- **web:** 候选列表消除横向滚动(table-layout:fixed+百分比列宽+市值合并两行) + 修复进详情返回的状态保持(watcher 守卫+数据渲染后再复滚动位置) ([3505ce0](https://github.com/GuoSirius/candidate-pool/commit/3505ce0))
- 交易日推算统一走 dayjs(Asia/Shanghai)，移除裸 new Date() ([8e1974b](https://github.com/GuoSirius/candidate-pool/commit/8e1974b))
- **db:** Price_daily 改为全观察池逐日写入，n 周期口径归正 ([e7a145e](https://github.com/GuoSirius/candidate-pool/commit/e7a145e))
- **worker:** Stock-rank 补齐 ln* 排序键，非法 sort 不再静默回落 ([07d7286](https://github.com/GuoSirius/candidate-pool/commit/07d7286))
- **web:** 移除档位列筛选时多余的蓝色下划线 ([d2a0f93](https://github.com/GuoSirius/candidate-pool/commit/d2a0f93))
- **web:** 移动端卡片紧凑化与全站表格窄屏适配 ([f068b6d](https://github.com/GuoSirius/candidate-pool/commit/f068b6d))
- **web:** 导航高亮收敛为唯一归属，修子路由父子项同时点亮 ([ea73063](https://github.com/GuoSirius/candidate-pool/commit/ea73063))
- **eod:** 盘中模式起点改按已成交分钟回数，修午休跨段导致下午开盘静默零候选 ([b72c343](https://github.com/GuoSirius/candidate-pool/commit/b72c343))
- **changelog:** 删除错误的 repo 配置，修掉 81 个 undefined 死链 ([2024a77](https://github.com/GuoSirius/candidate-pool/commit/2024a77))
- **eod:** 行业映射在工作目录缺失时回退包内种子，避免整池塌成未分类 ([8fbf482](https://github.com/GuoSirius/candidate-pool/commit/8fbf482))
- **release:** 说明预览支持 tag 尚未创建，修正首次发布与提交数误报 ([d4b160a](https://github.com/GuoSirius/candidate-pool/commit/d4b160a))
- **tail:** 尾盘落库两处修正——占位符错位致候选全丢、口径 cut 未翻译 ([6fa1313](https://github.com/GuoSirius/candidate-pool/commit/6fa1313))
- **tail:** 读取侧兼容历史 cut 口径，记录页不再兜底成「观察」 ([3e5c17d](https://github.com/GuoSirius/candidate-pool/commit/3e5c17d))

### ♻️ 代码重构 (Refactors)

- **web:** 抽离应用外壳，导航改为数据驱动并适配移动端 ([65c2b1d](https://github.com/GuoSirius/candidate-pool/commit/65c2b1d))
- **web:** 抽出统一页面标题行，消除五处重复样式 ([6c49d43](https://github.com/GuoSirius/candidate-pool/commit/6c49d43))
- 规则释义集中到 rules 单页,其他视图仅留跳转入口 ([2a48fdd](https://github.com/GuoSirius/candidate-pool/commit/2a48fdd))
- **release:** 部署移出 release，与发版解耦 ([d28a351](https://github.com/GuoSirius/candidate-pool/commit/d28a351))
- 分行业明细改为单表加行业分组行 ([4448c25](https://github.com/GuoSirius/candidate-pool/commit/4448c25))
- **tail:** 观察归档文件名去掉时点后缀，与盘中统一为一天一个文件 ([6e75844](https://github.com/GuoSirius/candidate-pool/commit/6e75844))

### 📚 文档 (Documentation)

- 新增文档中心(目录规划+命名规范)与尾盘选股需求/方案/计划/待确认 ([038c302](https://github.com/GuoSirius/candidate-pool/commit/038c302))
- 新增评论与分组可写能力方案(需求/接口清单/写鉴权/前端交互/边界) ([1a218d1](https://github.com/GuoSirius/candidate-pool/commit/1a218d1))
- 评论与分组方案同步实现状态、10005 业务码与写接口启用步骤 ([6d4b0c9](https://github.com/GuoSirius/candidate-pool/commit/6d4b0c9))
- 更正写接口密钥应配在 Pages 项目，独立 worker 部署为可选入口 ([d1a4ccf](https://github.com/GuoSirius/candidate-pool/commit/d1a4ccf))
- 同步部署形态与写接口说明，移除独立 worker 发布入口 ([869a7f2](https://github.com/GuoSirius/candidate-pool/commit/869a7f2))
- 补充 price_daily 回填实测数据与旧快照缺口说明 ([4f55e71](https://github.com/GuoSirius/candidate-pool/commit/4f55e71))
- 补充本地/线上一致性与 D1 用量限额 ([d2b156a](https://github.com/GuoSirius/candidate-pool/commit/d2b156a))
- 补充表/列/索引一键同步说明与表清单 ([dee2929](https://github.com/GuoSirius/candidate-pool/commit/dee2929))
- 新增独立发布方案对比（三方案），并补工作目录用法说明 ([6d8308c](https://github.com/GuoSirius/candidate-pool/commit/6d8308c))
- 补独立发布实施计划，并在 readme 补装包运行与发布用法 ([3f3e287](https://github.com/GuoSirius/candidate-pool/commit/3f3e287))
- 说明 release 与 release:notes 的区别及一条命令的完整链路 ([33f2cbe](https://github.com/GuoSirius/candidate-pool/commit/33f2cbe))
- 补脚手架用法、向后兼容保票与 npx 不 pin 版本的决定 ([6314b03](https://github.com/GuoSirius/candidate-pool/commit/6314b03))
- 修正过期事实（15:35→15:30、7表9索引→10表12索引）并补全 5 个工作流清单 ([4d16d02](https://github.com/GuoSirius/candidate-pool/commit/4d16d02))
- 新增定时任务拓扑与数据存储两篇（从 README 拆出），并更新文档索引 ([ec66a57](https://github.com/GuoSirius/candidate-pool/commit/ec66a57))
- 新增 api / web / release 三篇并补齐文档索引 ([dee6ed3](https://github.com/GuoSirius/candidate-pool/commit/dee6ed3))
- **readme:** 瘦身成总览加导航（775 到 282 行），存储/API/前端/发布四块移交 docs ([e66a739](https://github.com/GuoSirius/candidate-pool/commit/e66a739))
- **eod:** 新增上线后复盘，四篇设计基线加状态标记并标注 Q2/Q3/Q14 与实际不符 ([14ba007](https://github.com/GuoSirius/candidate-pool/commit/14ba007))

### 📦 杂项维护 (Chores)

- 根目录新增 npm run deploy 一键发布前端 ([981a476](https://github.com/GuoSirius/candidate-pool/commit/981a476))
- 忽略尾盘选股的日度数据与报告产物 ([82b2796](https://github.com/GuoSirius/candidate-pool/commit/82b2796))
- 补 tail 系列 npm 脚本便于快速执行 ([cffcf82](https://github.com/GuoSirius/candidate-pool/commit/cffcf82))
- 每日实时初筛 2026-09-21 ([377cf91](https://github.com/GuoSirius/candidate-pool/commit/377cf91))

### 🎨 代码格式 (Style)

- **web:** 页面铺满(取消 1100px 限宽) + 全站表格列宽/对齐重排(文本左/标签与日期居中/数值右) ([eb1a383](https://github.com/GuoSirius/candidate-pool/commit/eb1a383))
- **web:** 页面加 1440px 最大宽度 + 平均收益走势默认只显示 N1/N2/N3/N5 ([aafb6b4](https://github.com/GuoSirius/candidate-pool/commit/aafb6b4))

### ⚙️ 持续集成 (CI)

- 定时任务对齐并新增观察与行业映射工作流 ([623a0f4](https://github.com/GuoSirius/candidate-pool/commit/623a0f4))
- 每日自动同步结构；worker 缺表缺列返回可操作提示 ([111f7ce](https://github.com/GuoSirius/candidate-pool/commit/111f7ce))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](https://github.com/siriusSupreme))

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
