# Changelog

所有变动按 **Conventional Commits** 约定分类，由 `changelogen` 自动生成。

## v3.5.0

[compare changes](https://github.com/GuoSirius/candidate-pool/compare/v3.4.0...v3.5.0)

### 🚀 新功能 (Features)

- 全部报告表格冻结序号/标的列与表头（vscroll 双轴滚动容器+两级表头补位+hotmoney JS 实测列宽偏移+pulse clip+sticky） ([7a43d84](https://github.com/GuoSirius/candidate-pool/commit/7a43d84))

### 🐛 缺陷修复 (Bug Fixes)

- 运行日志统一归位，杜绝游离日志 ([62bbd15](https://github.com/GuoSirius/candidate-pool/commit/62bbd15))
- 落地 2026-11-10 评审 #1-#6 与 💭 清理（runlog 流级镜像/D1 超时重试/基线缓存原子化/锚定显式过滤/特征前缀和/渲染转义） ([#1](https://github.com/GuoSirius/candidate-pool/issues/1), [#6](https://github.com/GuoSirius/candidate-pool/issues/6))
- 落地评审决策五项（基线缓存键名错位+昨收校验/computeSectors 过滤无chg票/toFullCode 统一收口/hotmoney 龙虎榜并发回补/D1 batch 隐式事务化） ([87ae77e](https://github.com/GuoSirius/candidate-pool/commit/87ae77e))
- 时间锚定口径统一（基线缓存按服务交易日命名/形态选股收盘后可写缓存/上榜未出回退上一交易日+榜单日期标注/口径文档同步） ([a53318f](https://github.com/GuoSirius/candidate-pool/commit/a53318f))
- 冻结列按表精确作用域（freeze2/#matrixTable/vfreeze 拆分 th z4/td z2 修表头遮挡），观察名单等无需横向滚动的表还原不冻结 ([5822831](https://github.com/GuoSirius/candidate-pool/commit/5822831))

### 📚 文档 (Documentation)

- 系统性代码审查报告（05-评审-2026-11-10） ([cb0820e](https://github.com/GuoSirius/candidate-pool/commit/cb0820e))

### 📦 杂项维护 (Chores)

- 盘前选股 2026-11-10 ([aa16817](https://github.com/GuoSirius/candidate-pool/commit/aa16817))
- 形态选股全市场产物 2026-11-09（第15次运行） ([5d85b6a](https://github.com/GuoSirius/candidate-pool/commit/5d85b6a))
- **pattern:** 形态选股全市场报告 2026-11-10（盘中实时锚定） ([cd2dade](https://github.com/GuoSirius/candidate-pool/commit/cd2dade))
- 盘中机会 2026-11-10 ([7c973f3](https://github.com/GuoSirius/candidate-pool/commit/7c973f3))
- 盘中机会 2026-11-10 ([0112dc3](https://github.com/GuoSirius/candidate-pool/commit/0112dc3))
- Rerender_all 重渲染 11-09/11-10 全部报告（冻结列+表头样式全量落盘） ([87ad718](https://github.com/GuoSirius/candidate-pool/commit/87ad718))
- **pattern:** 形态选股全市场报告 2026-11-10（盘中实时锚定） ([fcfe834](https://github.com/GuoSirius/candidate-pool/commit/fcfe834))
- 尾盘观察 2026-11-10 ([f504f1f](https://github.com/GuoSirius/candidate-pool/commit/f504f1f))
- 尾盘选股 2026-11-10 ([9b84c8f](https://github.com/GuoSirius/candidate-pool/commit/9b84c8f))
- **pattern:** 形态选股全市场报告 2026-11-10（收盘固定口径） ([1c392e5](https://github.com/GuoSirius/candidate-pool/commit/1c392e5))
- 每日实时初筛 2026-11-10 ([02e96a9](https://github.com/GuoSirius/candidate-pool/commit/02e96a9))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](https://github.com/siriusSupreme))

## v3.4.0

[compare changes](https://github.com/GuoSirius/candidate-pool/compare/v3.3.0...v3.4.0)

### 🚀 新功能 (Features)

- **eod:** 补齐观察池回流与周六胜率简报（默认 dry-run / 不推送） ([0dbb221](https://github.com/GuoSirius/candidate-pool/commit/0dbb221))
- **pattern:** 新增形态选股引擎骨架（双引擎+四类形态+离线自测） ([236d85b](https://github.com/GuoSirius/candidate-pool/commit/236d85b))
- **pattern:** 全市场两阶段漏斗、可过滤报告与分形态胜率回填 ([5a394a8](https://github.com/GuoSirius/candidate-pool/commit/5a394a8))
- 全报告统一接入 mini K 线（共享模块 + 离线重渲染入口） ([6e8e612](https://github.com/GuoSirius/candidate-pool/commit/6e8e612))
- 有游资过滤的报告补齐层级细分 ([ca1c7f6](https://github.com/GuoSirius/candidate-pool/commit/ca1c7f6))

### 🐛 缺陷修复 (Bug Fixes)

- 报告列位与列头调整（趋势置上榜后、形态列后接连板/上榜、列头统一为上榜） ([54274c2](https://github.com/GuoSirius/candidate-pool/commit/54274c2))
- **pattern:** 形态选股逻辑 Code Review 修复 ([048b2c6](https://github.com/GuoSirius/candidate-pool/commit/048b2c6))
- 统一报告锚定口径并修正交易日历 ([b980d08](https://github.com/GuoSirius/candidate-pool/commit/b980d08))

### ♻️ 代码重构 (Refactors)

- 次日池/游资锚定彻底统一为 marketDate ([5d10ff5](https://github.com/GuoSirius/candidate-pool/commit/5d10ff5))

### 📚 文档 (Documentation)

- 同步 C2/D2 落地状态与两条自动化的真值源登记 ([cb3c9a8](https://github.com/GuoSirius/candidate-pool/commit/cb3c9a8))
- **pattern:** 方案文档与 11-09 全市场首份归档/报告 ([bec6293](https://github.com/GuoSirius/candidate-pool/commit/bec6293))
- 补齐报告口径说明并重生成当日报告 ([8b82068](https://github.com/GuoSirius/candidate-pool/commit/8b82068))
- 报告列位/列头与游资层级过滤说明 ([20cad04](https://github.com/GuoSirius/candidate-pool/commit/20cad04))

### 📦 杂项维护 (Chores)

- 次日回填 --days 40 修正窗口口径，归档统一压缩为单行 ([a292777](https://github.com/GuoSirius/candidate-pool/commit/a292777))
- 首次观察池 diff 与周六胜率简报留痕 ([137a33a](https://github.com/GuoSirius/candidate-pool/commit/137a33a))
- 盘前回填 2026-11-09 ([bed2f17](https://github.com/GuoSirius/candidate-pool/commit/bed2f17))
- 游资席位扫描归档 2026-11-09 ([d46aa2b](https://github.com/GuoSirius/candidate-pool/commit/d46aa2b))
- 次日回填 2026-11-09 ([6f6d054](https://github.com/GuoSirius/candidate-pool/commit/6f6d054))
- **pattern:** 形态选股全市场归档 2026-11-09 ([11100cb](https://github.com/GuoSirius/candidate-pool/commit/11100cb))
- 重生成 11-09 报告（列位/列头更新） ([fead080](https://github.com/GuoSirius/candidate-pool/commit/fead080))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](https://github.com/siriusSupreme))

## v3.3.0

[compare changes](https://github.com/GuoSirius/candidate-pool/compare/v3.2.0...v3.3.0)

### 🚀 新功能 (Features)

- Pulse 消息脉搏模块 v1（6 源采集+交叉验证+html 报告+watch 系统通知） ([4dea5f2](https://github.com/GuoSirius/candidate-pool/commit/4dea5f2))
- Pulse 热点板块补充成分领涨股前5只（报告表格+证据链卡片） ([52e93d9](https://github.com/GuoSirius/candidate-pool/commit/52e93d9))
- Eod 日志统一归位（runlog 自镜像到 logs 目录）+ pulse 领涨股范围对齐资金流榜单规模 ([b824b26](https://github.com/GuoSirius/candidate-pool/commit/b824b26))
- Pulse 评分优化（信源重定权+公告入评分流+时间衰减+噪声板块黑名单+公告双表过滤） ([c743ab7](https://github.com/GuoSirius/candidate-pool/commit/c743ab7))
- Add pulse watch boot script for scheduled-task launch ([ace26ea](https://github.com/GuoSirius/candidate-pool/commit/ace26ea))
- Guard boot-watch against duplicate watch instance ([e8faed0](https://github.com/GuoSirius/candidate-pool/commit/e8faed0))
- Pulse 控制台与通知美化（结构化分块+涨跌箭头+tty 感知着色） ([53ef595](https://github.com/GuoSirius/candidate-pool/commit/53ef595))
- Top_boards/top_stocks 支持 0=不限制（含注释说明） ([8ed1eb2](https://github.com/GuoSirius/candidate-pool/commit/8ed1eb2))
- 报告热点板块榜/个股榜表头点击排序（热度分/验证级别/涨跌幅/主力净流入） ([bfedbf8](https://github.com/GuoSirius/candidate-pool/commit/bfedbf8))
- 盘前/回填报告新增游资过滤 chip（@hotmoney，识别知名席位上榜行） ([4ff010a](https://github.com/GuoSirius/candidate-pool/commit/4ff010a))
- 游资过滤细化到个人（章盟主/赵老哥等按命中动态生成 chip） ([3dbf898](https://github.com/GuoSirius/candidate-pool/commit/3dbf898))
- 游资席位扫描 hotmoney_scan 四件套（名单动态化+席位变更感知+近N日窗口报告） ([b55bff1](https://github.com/GuoSirius/candidate-pool/commit/b55bff1))
- 尾盘报告新增上榜列+上榜/游资过滤；hotmoney 报告各区块加口径说明；fmtAmt/billboardCell 迁入共享 ([ae68f93](https://github.com/GuoSirius/candidate-pool/commit/ae68f93))
- **eod:** 批次a核心——verdict三口径判定+nextday_backfill统一次日回填 ([25782e2](https://github.com/GuoSirius/candidate-pool/commit/25782e2))
- **eod:** 批次a收尾——四管道verdict回填、游资胜率列与名单建议、尾盘/盘前命中率区块 ([710c0da](https://github.com/GuoSirius/candidate-pool/commit/710c0da))
- **eod:** 批次b——regime环境闸四档标签接入四报告，gen_candidates真实宽度，报告html安全压缩 ([f72a87b](https://github.com/GuoSirius/candidate-pool/commit/f72a87b))
- **eod:** 回填后重渲染最新报告并列出改动html清单 ([1e3012d](https://github.com/GuoSirius/candidate-pool/commit/1e3012d))
- **eod:** 尾盘报告候选表加逐票T+1/T+3列 ([17d73b4](https://github.com/GuoSirius/candidate-pool/commit/17d73b4))

### 🐛 缺陷修复 (Bug Fixes)

- Pulse watch 通知语义区分消息热点/行情异动，加冷却防反复弹 ([8a87c28](https://github.com/GuoSirius/candidate-pool/commit/8a87c28))
- Pulse watch 轮次恢复归档日期快照与报告 ([8d6c70e](https://github.com/GuoSirius/candidate-pool/commit/8d6c70e))
- 热点板块/个股展示条数提为配置项（top_boards/top_stocks），与资金流排名分参数解耦 ([f461d6f](https://github.com/GuoSirius/candidate-pool/commit/f461d6f))
- Vite-plugin-pwa 升级 2.0.0 根治 minimatch 漏洞依赖链 ([06b382e](https://github.com/GuoSirius/candidate-pool/commit/06b382e))
- 趋势显示规范化（去 ✓✗ 歧义符号，改文字标记+· 分隔+斜率显式正负号） ([dd38823](https://github.com/GuoSirius/candidate-pool/commit/dd38823))
- 趋势标记改用 gbk 安全的 √×（替代渲染歧义的 ✓✗），恢复紧凑排版 ([69ab91c](https://github.com/GuoSirius/candidate-pool/commit/69ab91c))
- Gitignore 适配流水线子目录（基线缓存出库、raw 新路径、清理失效规则） ([bb24cfb](https://github.com/GuoSirius/candidate-pool/commit/bb24cfb))
- **eod:** 评审阻塞项修复——replay skipStore/segFrom、run_at 取快照时刻、b() 属性编码、盘前周末守卫、--now 校验、过时路径注释 ([0aedc62](https://github.com/GuoSirius/candidate-pool/commit/0aedc62))
- **eod:** 评审二三批修复（详见 docs/code-review/03 对应条目） ([2848b5c](https://github.com/GuoSirius/candidate-pool/commit/2848b5c))
- **eod:** 主板ST涨跌幅5%改10%对齐2026新规 ([06c95e2](https://github.com/GuoSirius/candidate-pool/commit/06c95e2))
- **eod:** 回填无条件重渲染清单+自动化转ACTIVE并递送html ([5ad025c](https://github.com/GuoSirius/candidate-pool/commit/5ad025c))
- 修复回填窗口口径与全市场快照渲染缺陷 ([790ab03](https://github.com/GuoSirius/candidate-pool/commit/790ab03))
- 收敛报告渲染与游资聚合的确定性缺陷 ([d04c28f](https://github.com/GuoSirius/candidate-pool/commit/d04c28f))

### ♻️ 代码重构 (Refactors)

- Eod data/reports 按流水线分子目录（eod ([preopen](https://github.com/GuoSirius/candidate-pool/commit/preopen))

### 📚 文档 (Documentation)

- Pulse 消息脉搏模块实施方案 ([bc57a05](https://github.com/GuoSirius/candidate-pool/commit/bc57a05))
- 同步 pulse watch 事件语义说明 ([6b465a3](https://github.com/GuoSirius/candidate-pool/commit/6b465a3))
- 修正 store.updateLatest 注释 ([1591b95](https://github.com/GuoSirius/candidate-pool/commit/1591b95))
- 新增项目定时任务清单（workbuddy 任务 + 远程兜底 + 日志归位说明） ([9cb95a3](https://github.com/GuoSirius/candidate-pool/commit/9cb95a3))
- Deploy 文档 node 版本要求同步为 24+ ([849f66e](https://github.com/GuoSirius/candidate-pool/commit/849f66e))
- Readme node 版本要求同步为 24+ ([7170138](https://github.com/GuoSirius/candidate-pool/commit/7170138))
- Pulse watch 开机启动已禁用，改为手动触发并记录恢复方式 ([972d418](https://github.com/GuoSirius/candidate-pool/commit/972d418))
- 选股体系全量审计（六管道核对+横向缺口+路线图） ([2871000](https://github.com/GuoSirius/candidate-pool/commit/2871000))
- 体系完善实施方案与任务节点（批次A闭环/B环境/C协同/D配置，待审） ([d402863](https://github.com/GuoSirius/candidate-pool/commit/d402863))
- 新增 2026-11-09 代码评审报告 ([c6535a2](https://github.com/GuoSirius/candidate-pool/commit/c6535a2))
- 批次c三任务时刻调整 1830/1840/1850 ([7fffe50](https://github.com/GuoSirius/candidate-pool/commit/7fffe50))
- 文档规整——散落文档归位、审计并入plan、任务清单并入ops ([78289a8](https://github.com/GuoSirius/candidate-pool/commit/78289a8))
- 评审24b标记已处置 ([3825c70](https://github.com/GuoSirius/candidate-pool/commit/3825c70))
- 增量评审——批次A/B新功能性能瓶颈与潜在Bug ([f1c924e](https://github.com/GuoSirius/candidate-pool/commit/f1c924e))
- 同步批次B1落地口径并标注历史文档版本边界 ([299770b](https://github.com/GuoSirius/candidate-pool/commit/299770b))
- 调度全景标注已落地与仅计划，避免误读为已排程 ([c28e7e4](https://github.com/GuoSirius/candidate-pool/commit/c28e7e4))

### 📦 杂项维护 (Chores)

- 尾盘观察 2026-11-05 ([de84eea](https://github.com/GuoSirius/candidate-pool/commit/de84eea))
- 尾盘选股 2026-11-05 ([973f7e5](https://github.com/GuoSirius/candidate-pool/commit/973f7e5))
- 每日实时初筛 2026-11-05 ([bb2bdac](https://github.com/GuoSirius/candidate-pool/commit/bb2bdac))
- 盘前回填 2026-11-05 ([8519032](https://github.com/GuoSirius/candidate-pool/commit/8519032))
- **automations:** 全部产报告任务新增任务内预览步骤(present_files) ([c2b5526](https://github.com/GuoSirius/candidate-pool/commit/c2b5526))
- 盘前选股 2026-11-06 ([9272b20](https://github.com/GuoSirius/candidate-pool/commit/9272b20))
- 盘中机会 2026-11-06 ([35b91e0](https://github.com/GuoSirius/candidate-pool/commit/35b91e0))
- 盘中机会 2026-11-06 ([eaffa1b](https://github.com/GuoSirius/candidate-pool/commit/eaffa1b))
- Pulse 参数调整（回看24h/条数60/冷却20min/保留480天），watch 轮次不归档日期快照 ([8525262](https://github.com/GuoSirius/candidate-pool/commit/8525262))
- **automations:** 本机任务已同步预览步骤 ([72f3026](https://github.com/GuoSirius/candidate-pool/commit/72f3026))
- **automations:** 附录A1引号与线上prompt逐字对齐 ([231bd3a](https://github.com/GuoSirius/candidate-pool/commit/231bd3a))
- **automations:** 收录 pulse 双任务、移除A2、总览按时间正序、preopen状态对齐ACTIVE ([b3c32da](https://github.com/GuoSirius/candidate-pool/commit/b3c32da))
- **automations:** Pulse 一键报告调度改为每日08:00 ([ea1caf6](https://github.com/GuoSirius/candidate-pool/commit/ea1caf6))
- 尾盘观察 2026-11-06 ([7ad94d0](https://github.com/GuoSirius/candidate-pool/commit/7ad94d0))
- 尾盘选股 2026-11-06 ([6b91969](https://github.com/GuoSirius/candidate-pool/commit/6b91969))
- 每日实时初筛 2026-11-06 ([e45599c](https://github.com/GuoSirius/candidate-pool/commit/e45599c))
- Update ([1d58ea0](https://github.com/GuoSirius/candidate-pool/commit/1d58ea0))
- Node 最低版本要求提升至 24（root/web/worker 三包 engines 对齐） ([af00c41](https://github.com/GuoSirius/candidate-pool/commit/af00c41))
- 三包依赖版本统一改 latest（含 typescript 7.0.2 试用，失败回退 6 最新） ([8f8f3ec](https://github.com/GuoSirius/candidate-pool/commit/8f8f3ec))
- Latest 标签改为显式最新版本号（ts 7.0.2 试用；镜像 dist-tag 同步时差导致 latest 解析滞后） ([bc10ad2](https://github.com/GuoSirius/candidate-pool/commit/bc10ad2))
- 盘前回填 2026-11-06 ([95db367](https://github.com/GuoSirius/candidate-pool/commit/95db367))
- 依赖分层定稿（全部 latest；web typescript 回退 6.0.3 适配 vue-tsc） ([ea332e1](https://github.com/GuoSirius/candidate-pool/commit/ea332e1))
- 盘前选股 2026-11-09 ([c3f9ca5](https://github.com/GuoSirius/candidate-pool/commit/c3f9ca5))
- 盘中机会 2026-11-09 ([d5d0cb0](https://github.com/GuoSirius/candidate-pool/commit/d5d0cb0))
- 游资席位扫描首跑归档（2026-10-26 ~ 2026-11-06 十个交易日） ([65f06b6](https://github.com/GuoSirius/candidate-pool/commit/65f06b6))
- 游资席位扫描归档 2026-11-06 ([128763c](https://github.com/GuoSirius/candidate-pool/commit/128763c))
- 盘中机会 2026-11-09 ([43b1a6c](https://github.com/GuoSirius/candidate-pool/commit/43b1a6c))
- 归档文件迁移至 data ([reports 的 eod](https://github.com/GuoSirius/candidate-pool/commit/reports 的 eod))
- 今日报告全部重渲染（新子目录路径，2026-11-09） ([f11acd8](https://github.com/GuoSirius/candidate-pool/commit/f11acd8))
- 重渲染引起的归档落库更新（运行留痕与快照时间戳） ([2308514](https://github.com/GuoSirius/candidate-pool/commit/2308514))
- **pulse:** 报告目录 pulse/report 统一更名为 pulse/reports ([b2beb38](https://github.com/GuoSirius/candidate-pool/commit/b2beb38))
- Raw快照解除git跟踪并补ignore规则；快照归档补verdicts ([19a1ac6](https://github.com/GuoSirius/candidate-pool/commit/19a1ac6))
- 去除gitignore重复raw规则 ([3225009](https://github.com/GuoSirius/candidate-pool/commit/3225009))
- 次日回填 2026-11-09 ([b87ccd4](https://github.com/GuoSirius/candidate-pool/commit/b87ccd4))
- 次日回填 2026-11-09 ([9fe23bf](https://github.com/GuoSirius/candidate-pool/commit/9fe23bf))
- 尾盘观察 2026-11-09 ([b8b06fb](https://github.com/GuoSirius/candidate-pool/commit/b8b06fb))
- 尾盘选股 2026-11-09 ([0952a99](https://github.com/GuoSirius/candidate-pool/commit/0952a99))
- 每日实时初筛 2026-11-09 ([3d655f5](https://github.com/GuoSirius/candidate-pool/commit/3d655f5))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](https://github.com/siriusSupreme))
- Preopen <hotmoney 子目录（git mv 保历史）>
- Hotmoney），同步 Workflows/docs/自动化 <305a5ee>

## v3.2.0

[compare changes](https://github.com/GuoSirius/candidate-pool/compare/v3.1.0...v3.2.0)

### 🚀 新功能 (Features)

- **preopen:** 全量展示解除4处数量限制 + nearMiss折叠表格 + 日志统一eod/logs ([495b6b8](https://github.com/GuoSirius/candidate-pool/commit/495b6b8))
- **preopen:** 趋势放量通道(门槛制独立轨) + 盘前回填双表轨道过滤 ([94767ae](https://github.com/GuoSirius/candidate-pool/commit/94767ae))
- **eod:** 龙虎榜游资席位库扩至18个并修复国泰海通新全名匹配 ([eaa0001](https://github.com/GuoSirius/candidate-pool/commit/eaa0001))
- **preopen:** 上榜游资标注分层 章盟主@一线(1.2亿) 格式 ([54dfb7d](https://github.com/GuoSirius/candidate-pool/commit/54dfb7d))

### 🐛 缺陷修复 (Bug Fixes)

- **preopen:** 趋势放量通道竞价涨幅下限默认改为-3 ([d188f42](https://github.com/GuoSirius/candidate-pool/commit/d188f42))

### ♻️ 代码重构 (Refactors)

- **eod:** 抽取报告共享格式化与涨停板幅度唯一真相源 ([4dc192b](https://github.com/GuoSirius/candidate-pool/commit/4dc192b))

### 📦 杂项维护 (Chores)

- 盘前报告加上榜过滤chip 2026-11-04 ([66b5ce5](https://github.com/GuoSirius/candidate-pool/commit/66b5ce5))
- **preopen:** 重新生成历史盘前报告(全量展示+nearMiss折叠+轨道过滤) ([af6fc09](https://github.com/GuoSirius/candidate-pool/commit/af6fc09))
- 盘前选股 2026-11-05 ([218b493](https://github.com/GuoSirius/candidate-pool/commit/218b493))
- 盘中机会 2026-11-05 ([619f705](https://github.com/GuoSirius/candidate-pool/commit/619f705))
- 盘中机会 2026-11-05 ([a2d632d](https://github.com/GuoSirius/candidate-pool/commit/a2d632d))

### 🎨 代码格式 (Style)

- **preopen:** 上榜游资标注改为 名字(金额)@分层 顺序 ([5e3de4c](https://github.com/GuoSirius/candidate-pool/commit/5e3de4c))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](https://github.com/siriusSupreme))

## v3.1.0

[compare changes](https://github.com/GuoSirius/candidate-pool/compare/v3.0.2...v3.1.0)

### 🚀 新功能 (Features)

- 盘前回填窗口放宽为收盘后 15:00-23:59（跨夜仍走 --date --force） ([5efff8a](https://github.com/GuoSirius/candidate-pool/commit/5efff8a))

### 🐛 缺陷修复 (Bug Fixes)

- **preopen:** 推送提交信息改为 chore 前缀以通过 commitlint ([57d32d2](https://github.com/GuoSirius/candidate-pool/commit/57d32d2))
- 移除 preopen 脚本内部 git 提交，统一收归自动化 prompt ([37d1168](https://github.com/GuoSirius/candidate-pool/commit/37d1168))
- Render all eod candidates by disabling report row cap (maxrows=0) ([a50bac8](https://github.com/GuoSirius/candidate-pool/commit/a50bac8))

### 📦 杂项维护 (Chores)

- **preopen:** 2026-10-22 收盘回填 命中率 56.5% (13/23) ([f6b98f8](https://github.com/GuoSirius/candidate-pool/commit/f6b98f8))
- **preopen:** 2026-10-23 候选 9 只（universe） ([c7f13c1](https://github.com/GuoSirius/candidate-pool/commit/c7f13c1))
- **automations:** 所有定时任务 prompt 显式提示提交 + 同步 GitHub Actions 文档 ([b3b2ad0](https://github.com/GuoSirius/candidate-pool/commit/b3b2ad0))
- 盘中机会 2026-10-23（补提交 intraday 产物） ([06be3bb](https://github.com/GuoSirius/candidate-pool/commit/06be3bb))
- Add 2026-10-23 observe tail screener products ([fe47276](https://github.com/GuoSirius/candidate-pool/commit/fe47276))
- 尾盘选股 2026-10-23 ([4c737ce](https://github.com/GuoSirius/candidate-pool/commit/4c737ce))
- 每日实时初筛 2026-10-23 ([6c35b2a](https://github.com/GuoSirius/candidate-pool/commit/6c35b2a))
- 盘前回填 2026-10-23 ([47c0e05](https://github.com/GuoSirius/candidate-pool/commit/47c0e05))
- 盘前选股 2026-10-26 ([43f91c2](https://github.com/GuoSirius/candidate-pool/commit/43f91c2))
- 盘中机会 2026-10-26 ([169713b](https://github.com/GuoSirius/candidate-pool/commit/169713b))
- 盘中机会 2026-10-26 ([9dd2992](https://github.com/GuoSirius/candidate-pool/commit/9dd2992))
- 盘中机会 2026-10-26 ([e91d9a5](https://github.com/GuoSirius/candidate-pool/commit/e91d9a5))
- **eod:** Obs tail screener 2026-10-26 ([fbcdf8b](https://github.com/GuoSirius/candidate-pool/commit/fbcdf8b))
- 尾盘选股 2026-10-26 ([8ff5713](https://github.com/GuoSirius/candidate-pool/commit/8ff5713))
- 盘前回填 2026-10-26 ([98bd462](https://github.com/GuoSirius/candidate-pool/commit/98bd462))
- 尾盘选股 2026-10-26 ([0cfabfc](https://github.com/GuoSirius/candidate-pool/commit/0cfabfc))
- 每日实时初筛 2026-10-26 ([cc6b6e9](https://github.com/GuoSirius/candidate-pool/commit/cc6b6e9))
- 盘前选股 2026-10-27 ([6602677](https://github.com/GuoSirius/candidate-pool/commit/6602677))
- 盘中机会 2026-10-27 ([a2f6894](https://github.com/GuoSirius/candidate-pool/commit/a2f6894))
- 盘中机会 2026-10-27 ([6a71fba](https://github.com/GuoSirius/candidate-pool/commit/6a71fba))
- Obs eod-2026-10-27 尾盘观察模式产物（3 条候选） ([270ec5d](https://github.com/GuoSirius/candidate-pool/commit/270ec5d))
- 尾盘选股 2026-10-27 ([95d8172](https://github.com/GuoSirius/candidate-pool/commit/95d8172))
- 盘前回填 2026-10-27 ([94ab009](https://github.com/GuoSirius/candidate-pool/commit/94ab009))
- 每日实时初筛 2026-10-27 ([0484972](https://github.com/GuoSirius/candidate-pool/commit/0484972))
- 盘前选股 2026-10-28 ([c9c1620](https://github.com/GuoSirius/candidate-pool/commit/c9c1620))
- 盘中机会 2026-10-28 ([94238ae](https://github.com/GuoSirius/candidate-pool/commit/94238ae))
- 盘中机会 2026-10-28 ([76a9bde](https://github.com/GuoSirius/candidate-pool/commit/76a9bde))
- Add obs artifacts for 2026-10-28 ([c75ee57](https://github.com/GuoSirius/candidate-pool/commit/c75ee57))
- 尾盘选股 2026-10-28 ([caad29d](https://github.com/GuoSirius/candidate-pool/commit/caad29d))
- 盘前回填 2026-10-28 ([12c1a2d](https://github.com/GuoSirius/candidate-pool/commit/12c1a2d))
- 每日实时初筛 2026-10-28 ([1d10a4f](https://github.com/GuoSirius/candidate-pool/commit/1d10a4f))
- 盘前选股 2026-10-29 ([48f26ed](https://github.com/GuoSirius/candidate-pool/commit/48f26ed))
- 盘中机会 2026-10-29 ([29e0d3a](https://github.com/GuoSirius/candidate-pool/commit/29e0d3a))
- 盘中机会 2026-10-29 ([c3b5fbe](https://github.com/GuoSirius/candidate-pool/commit/c3b5fbe))
- Obs 结果 2026-10-29（1 条候选） ([a1c8556](https://github.com/GuoSirius/candidate-pool/commit/a1c8556))
- 尾盘选股 2026-10-29 ([55b131e](https://github.com/GuoSirius/candidate-pool/commit/55b131e))
- 盘前回填 2026-10-29 ([25ed618](https://github.com/GuoSirius/candidate-pool/commit/25ed618))
- 每日实时初筛 2026-10-29 ([c8475ef](https://github.com/GuoSirius/candidate-pool/commit/c8475ef))
- 盘中机会 2026-10-30 ([313dfa0](https://github.com/GuoSirius/candidate-pool/commit/313dfa0))
- 盘中机会 2026-10-30 ([7b064ec](https://github.com/GuoSirius/candidate-pool/commit/7b064ec))
- Obs run 2026-10-30 (1 candidate) ([70a2986](https://github.com/GuoSirius/candidate-pool/commit/70a2986))
- 尾盘选股 2026-10-30 ([8f06ee4](https://github.com/GuoSirius/candidate-pool/commit/8f06ee4))
- 每日实时初筛 2026-10-30 ([3166b3f](https://github.com/GuoSirius/candidate-pool/commit/3166b3f))
- 盘前选股 2026-11-02 ([9bb8c01](https://github.com/GuoSirius/candidate-pool/commit/9bb8c01))
- 盘中机会 2026-11-02 ([eb703e0](https://github.com/GuoSirius/candidate-pool/commit/eb703e0))
- 盘中机会 2026-11-02 ([2660f23](https://github.com/GuoSirius/candidate-pool/commit/2660f23))
- **eod:** Add 2026-11-02 obs screener artifacts ([803ba13](https://github.com/GuoSirius/candidate-pool/commit/803ba13))
- 尾盘选股 2026-11-02 ([b958a76](https://github.com/GuoSirius/candidate-pool/commit/b958a76))
- 盘前回填 2026-11-02 ([e316d3c](https://github.com/GuoSirius/candidate-pool/commit/e316d3c))
- 每日实时初筛 2026-11-02 ([2437079](https://github.com/GuoSirius/candidate-pool/commit/2437079))
- 盘前选股 2026-11-03 ([a57c504](https://github.com/GuoSirius/candidate-pool/commit/a57c504))
- 盘中机会 2026-11-03 ([8ce58a6](https://github.com/GuoSirius/candidate-pool/commit/8ce58a6))
- 盘中机会 2026-11-03 ([300c3bf](https://github.com/GuoSirius/candidate-pool/commit/300c3bf))
- **eod:** Obs run 2026-11-03 (18 candidates) ([a6234b4](https://github.com/GuoSirius/candidate-pool/commit/a6234b4))
- 尾盘选股 2026-11-03 ([8d59a3e](https://github.com/GuoSirius/candidate-pool/commit/8d59a3e))
- 盘前回填 2026-11-03 ([5b1916e](https://github.com/GuoSirius/candidate-pool/commit/5b1916e))
- 每日实时初筛 2026-11-03 ([819447c](https://github.com/GuoSirius/candidate-pool/commit/819447c))
- 盘前选股 2026-11-04 ([5c47e7f](https://github.com/GuoSirius/candidate-pool/commit/5c47e7f))
- 盘中机会 2026-11-04 ([640a570](https://github.com/GuoSirius/candidate-pool/commit/640a570))
- 盘中机会 2026-11-04 ([f7b8881](https://github.com/GuoSirius/candidate-pool/commit/f7b8881))
- **automations:** 同步本机自动化名称与状态到真值源 ([5331ccc](https://github.com/GuoSirius/candidate-pool/commit/5331ccc))
- **eod:** Add 2026-11-04 observe-mode tail screener artifacts ([dda892f](https://github.com/GuoSirius/candidate-pool/commit/dda892f))
- 尾盘选股 2026-11-04 ([344aaa6](https://github.com/GuoSirius/candidate-pool/commit/344aaa6))
- 盘前回填 2026-11-04 ([48d72c8](https://github.com/GuoSirius/candidate-pool/commit/48d72c8))
- 每日实时初筛 2026-11-04 ([b6fc77a](https://github.com/GuoSirius/candidate-pool/commit/b6fc77a))
- 盘前报告收盘回填优化（涨跌幅列+量比+百分比+买入机会四态） 2026-11-04 ([afe26a1](https://github.com/GuoSirius/candidate-pool/commit/afe26a1))
- 统一北京时间与时区+提交信息中文规范 2026-11-04 ([d9af900](https://github.com/GuoSirius/candidate-pool/commit/d9af900))
- 收盘回填恢复今收列+新增买入收益列 2026-11-04 ([27c3270](https://github.com/GuoSirius/candidate-pool/commit/27c3270))
- 历史收盘回填报告批量重渲染（今收+买入收益+量比列） 2026-11-04 ([e5d6244](https://github.com/GuoSirius/candidate-pool/commit/e5d6244))
- 盘前主表新增昨量比/昨换手列+历史归档K线回填 2026-11-04 ([23b9708](https://github.com/GuoSirius/candidate-pool/commit/23b9708))
- 归档JSON统一pretty格式与store落盘一致 2026-11-04 ([9423285](https://github.com/GuoSirius/candidate-pool/commit/9423285))
- 报告列序调整+净流入/市值/连板/龙虎榜列+回填改18点 2026-11-04 ([c5e5d84](https://github.com/GuoSirius/candidate-pool/commit/c5e5d84))
- 主表/尾盘加连板上榜列+几天几板口径 2026-11-04 ([eb62b47](https://github.com/GuoSirius/candidate-pool/commit/eb62b47))
- 分项得分默认收起+尾盘今日报告连板回填 2026-11-04 ([ad6eaee](https://github.com/GuoSirius/candidate-pool/commit/ad6eaee))
- 尾盘连板列移至涨幅后+昨日首板文案+保留首板前缀 2026-11-04 ([0bb47fa](https://github.com/GuoSirius/candidate-pool/commit/0bb47fa))
- 尾盘报告加连板过滤chip 2026-11-04 ([b6f65cf](https://github.com/GuoSirius/candidate-pool/commit/b6f65cf))

### ⚙️ 持续集成 (CI)

- 延迟触发(>15:00)仍产出 HTML/JSON 到 daily-artifacts，但跳过 D1 同步 ([f0bd46f](https://github.com/GuoSirius/candidate-pool/commit/f0bd46f))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](https://github.com/siriusSupreme))

## v3.0.2

[compare changes](https://github.com/GuoSirius/candidate-pool/compare/v3.0.1...v3.0.2)

### 🐛 缺陷修复 (Bug Fixes)

- Code review 必改项修复（正则剥前缀、迁移标记、keep-alive、默认双写、ua与waf防护、engines） ([4955417](https://github.com/GuoSirius/candidate-pool/commit/4955417))

### 📚 文档 (Documentation)

- 目录整理与定时任务真值源重建 ([b3a61ed](https://github.com/GuoSirius/candidate-pool/commit/b3a61ed))
- 收紧文档序号（05-复盘改03、npm-publish 02/03改01/02），同步全部引用 ([1b82665](https://github.com/GuoSirius/candidate-pool/commit/1b82665))

### 📦 杂项维护 (Chores)

- 每日实时初筛 2026-10-22 ([f515912](https://github.com/GuoSirius/candidate-pool/commit/f515912))
- 盘前选股归档 2026-10-22 ([ad3936e](https://github.com/GuoSirius/candidate-pool/commit/ad3936e))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](https://github.com/siriusSupreme))

## v3.0.1

[compare changes](https://github.com/GuoSirius/candidate-pool/compare/v3.0.0...v3.0.1)

### 🚀 新功能 (Features)

- **preopen:** 归档补贴线样本与淘汰统计支撑日后调参 ([c8d206b](https://github.com/GuoSirius/candidate-pool/commit/c8d206b))
- 次日候选快照记录当时规则常量与生成时间 ([3cc1b72](https://github.com/GuoSirius/candidate-pool/commit/3cc1b72))

### 📚 文档 (Documentation)

- **eod:** 尾盘原始存档永久保留策略落注释并补复盘第8.6节 ([6ba4fef](https://github.com/GuoSirius/candidate-pool/commit/6ba4fef))

### 📦 杂项维护 (Chores)

- **eod:** 尾盘口径版本号升到 2 并写明版本切段规则 ([5a6921a](https://github.com/GuoSirius/candidate-pool/commit/5a6921a))
- Obs run 2026-10-22 (0 candidates) ([4d44623](https://github.com/GuoSirius/candidate-pool/commit/4d44623))
- 尾盘选股 2026-10-22 ([2e0e85b](https://github.com/GuoSirius/candidate-pool/commit/2e0e85b))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](https://github.com/siriusSupreme))

## v3.0.0

[compare changes](https://github.com/GuoSirius/candidate-pool/compare/v2.2.0...v3.0.0)

### 🚀 新功能 (Features)

- **preopen:** 盘前选股子系统 P1竞价/P2弱转强/P3趋势 + 溯源推送 ([fe2094b](https://github.com/GuoSirius/candidate-pool/commit/fe2094b))
- **preopen:** 补 --baseline 预计算分支 + 基线缓存 gitignore ([730fcac](https://github.com/GuoSirius/candidate-pool/commit/730fcac))
- **preopen:** 默认全市场模式(--universe)，并修复 --scope watchlist 逃生通道被覆盖的问题 ([96bbf69](https://github.com/GuoSirius/candidate-pool/commit/96bbf69))
- **preopen:** 报告升级对齐尾盘富报告——主题/双语/双视图/双重过滤 ([6a6a9a0](https://github.com/GuoSirius/candidate-pool/commit/6a6a9a0))
- **eod:** 尾盘选股按回溯结论调参并删板块常量打分项 ([4884961](https://github.com/GuoSirius/candidate-pool/commit/4884961))
- 次日候选突破涨幅下限由 3 提至 4 ([54f4446](https://github.com/GuoSirius/candidate-pool/commit/54f4446))
- **eod:** 尾盘报告打分组改 77/23 五列并加强涨幅标记 ([304e076](https://github.com/GuoSirius/candidate-pool/commit/304e076))

### 🐛 缺陷修复 (Bug Fixes)

- **preopen:** 修正 baseline/universe 代码枚举范围 ([3b52ecd](https://github.com/GuoSirius/candidate-pool/commit/3b52ecd))
- **report:** 统一候选表对齐——全表居中，修两级表头三套对齐错位 ([ad5ae49](https://github.com/GuoSirius/candidate-pool/commit/ad5ae49))
- **preopen:** 分项单元格改显实际得分(归一化×权重)，与表头·35/·30及总分一致 ([8a576a8](https://github.com/GuoSirius/candidate-pool/commit/8a576a8))

### 📚 文档 (Documentation)

- 新增参数回溯与优化建议复盘文档 ([d4c353a](https://github.com/GuoSirius/candidate-pool/commit/d4c353a))
- 参数复盘补记已执行调整与前后对照 ([c1b6cea](https://github.com/GuoSirius/candidate-pool/commit/c1b6cea))

### 📦 杂项维护 (Chores)

- Obs run 2026-10-13 (16 candidates) ([ceec5d9](https://github.com/GuoSirius/candidate-pool/commit/ceec5d9))
- 尾盘选股 2026-10-13 ([faa013b](https://github.com/GuoSirius/candidate-pool/commit/faa013b))
- 每日实时初筛 2026-10-13 ([cf511b2](https://github.com/GuoSirius/candidate-pool/commit/cf511b2))
- 尾盘选股观察 2026-10-14 ([3654ac5](https://github.com/GuoSirius/candidate-pool/commit/3654ac5))
- 尾盘选股 2026-10-14 ([baf234e](https://github.com/GuoSirius/candidate-pool/commit/baf234e))
- 每日实时初筛 2026-10-14 ([e423a9a](https://github.com/GuoSirius/candidate-pool/commit/e423a9a))
- **eod:** Add 2026-10-15 obs artifacts ([b14ba14](https://github.com/GuoSirius/candidate-pool/commit/b14ba14))
- 尾盘选股 2026-10-15 ([3348624](https://github.com/GuoSirius/candidate-pool/commit/3348624))
- 每日实时初筛 2026-10-15 ([8469f95](https://github.com/GuoSirius/candidate-pool/commit/8469f95))
- Add 2026-10-16 obs screening artifacts ([46f3b4a](https://github.com/GuoSirius/candidate-pool/commit/46f3b4a))
- 尾盘选股 2026-10-16 ([2859a9a](https://github.com/GuoSirius/candidate-pool/commit/2859a9a))
- 每日实时初筛 2026-10-16 ([fe8d0d4](https://github.com/GuoSirius/candidate-pool/commit/fe8d0d4))
- Eod obs 2026-10-19 观察模式产物（23 条候选，非正式口径） ([de976b4](https://github.com/GuoSirius/candidate-pool/commit/de976b4))
- 尾盘选股 2026-10-19 ([c5dab21](https://github.com/GuoSirius/candidate-pool/commit/c5dab21))
- 每日实时初筛 2026-10-19 ([e57e4ad](https://github.com/GuoSirius/candidate-pool/commit/e57e4ad))
- Obs results for 2026-10-20 (44 candidates) ([8cdbc75](https://github.com/GuoSirius/candidate-pool/commit/8cdbc75))
- 尾盘选股 2026-10-20 ([778be58](https://github.com/GuoSirius/candidate-pool/commit/778be58))
- 每日实时初筛 2026-10-20 ([a2e5189](https://github.com/GuoSirius/candidate-pool/commit/a2e5189))
- Eod obs candidates 2026-10-21 ([581627f](https://github.com/GuoSirius/candidate-pool/commit/581627f))
- 尾盘选股 2026-10-21 ([708281a](https://github.com/GuoSirius/candidate-pool/commit/708281a))
- 每日实时初筛 2026-10-21 ([4cdcb0a](https://github.com/GuoSirius/candidate-pool/commit/4cdcb0a))
- **preopen:** 脚本 preopen:universe 改为 preopen:watchlist（默认已 universe） ([591c921](https://github.com/GuoSirius/candidate-pool/commit/591c921))
- 提交观察池刷新与盘中筛选产出 ([ff8a837](https://github.com/GuoSirius/candidate-pool/commit/ff8a837))
- 更新产出——盘中intraday(11:31) + preopen(事后强制跑) ([25d6bf1](https://github.com/GuoSirius/candidate-pool/commit/25d6bf1))
- 重新生成报告产物(对齐修复后) ([159a13a](https://github.com/GuoSirius/candidate-pool/commit/159a13a))

### ⚙️ 持续集成 (CI)

- 四个定时工作流加调试步骤/强制时区/防重复执行锁 ([9bcff24](https://github.com/GuoSirius/candidate-pool/commit/9bcff24))
- 修复调试步骤(计划cron误当时间戳) + 尾盘任务加延迟护栏 ([c4dda84](https://github.com/GuoSirius/candidate-pool/commit/c4dda84))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](https://github.com/siriusSupreme))

## v2.2.0

[compare changes](https://github.com/GuoSirius/candidate-pool/compare/v2.1.1...v2.2.0)

### 🚀 新功能 (Features)

- **eod:** 尾盘报告过滤新增「只看组内第一」与「组内前三」 ([b07bffa](https://github.com/GuoSirius/candidate-pool/commit/b07bffa))

### 🐛 缺陷修复 (Bug Fixes)

- 修复观察模式整点触发尾盘段退化 0 分钟窗口导致 100% 0 候选 ([7eed01f](https://github.com/GuoSirius/candidate-pool/commit/7eed01f))
- 用新逻辑重跑 2026-10-12 观察模式，纠正 0 候选存档（4 只） ([e4798e1](https://github.com/GuoSirius/candidate-pool/commit/e4798e1))
- **eod:** 原始快照(quotes+minutes)单独存 eod/data/raw 供 --replay 离线重算 ([310e0ac](https://github.com/GuoSirius/candidate-pool/commit/310e0ac))
- **eod:** 观察窗口 observeMinWindow 5→20（与正式口径等长），审计修复 replay 细节 ([8684db9](https://github.com/GuoSirius/candidate-pool/commit/8684db9))

### 📦 杂项维护 (Chores)

- 尾盘观察 2026-10-09 ([4d63d5d](https://github.com/GuoSirius/candidate-pool/commit/4d63d5d))
- 尾盘选股 2026-10-09 ([c16b81d](https://github.com/GuoSirius/candidate-pool/commit/c16b81d))
- **eod:** 用新过滤重建 10-09 三份尾盘报告 ([4511ca4](https://github.com/GuoSirius/candidate-pool/commit/4511ca4))
- 每日实时初筛 2026-10-09 ([482d84c](https://github.com/GuoSirius/candidate-pool/commit/482d84c))
- 尾盘观察 2026-10-12 ([c85600f](https://github.com/GuoSirius/candidate-pool/commit/c85600f))
- 尾盘选股 2026-10-12 ([ccf7d1f](https://github.com/GuoSirius/candidate-pool/commit/ccf7d1f))
- 每日实时初筛 2026-10-12 ([103593f](https://github.com/GuoSirius/candidate-pool/commit/103593f))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](https://github.com/siriusSupreme))

## v2.1.1

[compare changes](https://github.com/GuoSirius/candidate-pool/compare/v2.1.0...v2.1.1)

### 🐛 缺陷修复 (Bug Fixes)

- **eod:** 行业映射新增新浪兜底源与防降级闸，修复 runner 上东财被封月更失败 ([244e879](https://github.com/GuoSirius/candidate-pool/commit/244e879))

### 📦 杂项维护 (Chores)

- 每日实时初筛 2026-09-22 ([7944ff2](https://github.com/GuoSirius/candidate-pool/commit/7944ff2))
- 尾盘观察 2026-09-23 ([901dafc](https://github.com/GuoSirius/candidate-pool/commit/901dafc))
- 尾盘选股 2026-09-23 ([ad60b3a](https://github.com/GuoSirius/candidate-pool/commit/ad60b3a))
- 每日实时初筛 2026-09-23 ([f48a456](https://github.com/GuoSirius/candidate-pool/commit/f48a456))
- 尾盘观察 2026-09-24 ([1f1d604](https://github.com/GuoSirius/candidate-pool/commit/1f1d604))
- 尾盘选股 2026-09-24 ([e1a4bee](https://github.com/GuoSirius/candidate-pool/commit/e1a4bee))
- 每日实时初筛 2026-09-24 ([3d01e09](https://github.com/GuoSirius/candidate-pool/commit/3d01e09))
- 尾盘观察 2026-09-28 ([bc2ad4e](https://github.com/GuoSirius/candidate-pool/commit/bc2ad4e))
- 尾盘选股 2026-09-28 ([c00a7a1](https://github.com/GuoSirius/candidate-pool/commit/c00a7a1))
- 每日实时初筛 2026-09-28 ([08a4291](https://github.com/GuoSirius/candidate-pool/commit/08a4291))
- 尾盘观察 2026-09-29 ([91a952e](https://github.com/GuoSirius/candidate-pool/commit/91a952e))
- 尾盘选股 2026-09-29 ([380e3da](https://github.com/GuoSirius/candidate-pool/commit/380e3da))
- 每日实时初筛 2026-09-29 ([edbfc55](https://github.com/GuoSirius/candidate-pool/commit/edbfc55))
- 尾盘观察 2026-09-30 ([60cd5a3](https://github.com/GuoSirius/candidate-pool/commit/60cd5a3))
- 尾盘选股 2026-09-30 ([02f5fc0](https://github.com/GuoSirius/candidate-pool/commit/02f5fc0))
- 每日实时初筛 2026-09-30 ([05f384f](https://github.com/GuoSirius/candidate-pool/commit/05f384f))
- 尾盘观察 2026-10-08 ([9a41a50](https://github.com/GuoSirius/candidate-pool/commit/9a41a50))
- 尾盘选股 2026-10-08 ([9618588](https://github.com/GuoSirius/candidate-pool/commit/9618588))
- 每日实时初筛 2026-10-08 ([72fdc6e](https://github.com/GuoSirius/candidate-pool/commit/72fdc6e))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](https://github.com/siriusSupreme))

## v2.1.0

[compare changes](https://github.com/GuoSirius/candidate-pool/compare/v2.0.0...v2.1.0)

### 🚀 新功能 (Features)

- 尾盘与候选池报告新增暗黑主题切换（默认暗色） ([a7fcfed](https://github.com/GuoSirius/candidate-pool/commit/a7fcfed))
- 尾盘报告改为单表双视图与行业筛选 ([327a87b](https://github.com/GuoSirius/candidate-pool/commit/327a87b))
- 主报告合并判定矩阵单表与档位筛选 ([9598f02](https://github.com/GuoSirius/candidate-pool/commit/9598f02))
- Tail 尾盘页双列表改为视图切换 ([5abf0dd](https://github.com/GuoSirius/candidate-pool/commit/5abf0dd))
- 新增盘后/盘中报告查看页（下拉选择 + iframe 预览） ([62d68a6](https://github.com/GuoSirius/candidate-pool/commit/62d68a6))
- 尾盘盘中版(intraday)口径入库并全链路可查 ([dab6bc1](https://github.com/GuoSirius/candidate-pool/commit/dab6bc1))
- Tail 行业筛选条两视图常驻并过滤候选表 ([0dce6e9](https://github.com/GuoSirius/candidate-pool/commit/0dce6e9))
- 尾盘报告加价格与总市值列 ([d5ca96f](https://github.com/GuoSirius/candidate-pool/commit/d5ca96f))

### 🐛 缺陷修复 (Bug Fixes)

- Gen_candidates.js html 输出增加转义（安全红线） ([8a2d0e0](https://github.com/GuoSirius/candidate-pool/commit/8a2d0e0))
- Tail 分行业视图空态误显与行业多选筛选 ([c745a80](https://github.com/GuoSirius/candidate-pool/commit/c745a80))

### ♻️ 代码重构 (Refactors)

- 抽出规则引擎纯函数 rules.js 并补 node:test 单测 ([bcda401](https://github.com/GuoSirius/candidate-pool/commit/bcda401))
- Gen_candidates 改用 rules.js 消除规则逻辑双写 ([d23b028](https://github.com/GuoSirius/candidate-pool/commit/d23b028))

### 📚 文档 (Documentation)

- **web:** 补充导航高亮、序号列样式、分页汇总、尾盘阈值同步等硬约定 ([37ff9b0](https://github.com/GuoSirius/candidate-pool/commit/37ff9b0))
- 新增本地定时任务便携重建与对齐文档 ([715e31f](https://github.com/GuoSirius/candidate-pool/commit/715e31f))
- 新增代码审查标准流程与 pr 模板 ([f5c793c](https://github.com/GuoSirius/candidate-pool/commit/f5c793c))

### 📦 杂项维护 (Chores)

- Update gitignore ([b183cc6](https://github.com/GuoSirius/candidate-pool/commit/b183cc6))
- 归档 0922 尾盘异动快照与报告 ([3102bed](https://github.com/GuoSirius/candidate-pool/commit/3102bed))
- 归档 0921 快照重取数据 ([5d63937](https://github.com/GuoSirius/candidate-pool/commit/5d63937))
- 历史报告批量重渲染为新版式 ([3a88595](https://github.com/GuoSirius/candidate-pool/commit/3a88595))
- 归档 0922 盘中运行数据 ([761cfdd](https://github.com/GuoSirius/candidate-pool/commit/761cfdd))
- 尾盘观察 2026-09-22 ([a0fd69f](https://github.com/GuoSirius/candidate-pool/commit/a0fd69f))
- 尾盘选股 2026-09-22 ([e15db04](https://github.com/GuoSirius/candidate-pool/commit/e15db04))

### 🎨 代码格式 (Style)

- 尾盘报告容器加宽至 1280px 消除横向滚动 ([7c02776](https://github.com/GuoSirius/candidate-pool/commit/7c02776))

### ⚙️ 持续集成 (CI)

- **workflow:** 本地准点 dispatch 触发 GitHub Actions，移除 schedule 延迟 ([0c05587](https://github.com/GuoSirius/candidate-pool/commit/0c05587))
- **workflow:** 恢复 GitHub 原生定时并配置 timezone/concurrency/timeout ([deca2f5](https://github.com/GuoSirius/candidate-pool/commit/deca2f5))

### ❤️ Contributors

- 郭之存 ([@siriusSupreme](https://github.com/siriusSupreme))

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
