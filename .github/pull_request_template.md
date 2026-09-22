## 改动说明
- 关联文档：
- 改动类型：feat / fix / refactor / docs / test / chore
- 影响范围：

## 自测
- [ ] `npm run selftest` 通过（或对应模块自测）
- [ ] `npm run typecheck` 通过（如涉及 `worker/` `web/`）
- [ ] `npm run db:migrate:both` 已执行（如改 `db/schema.sql`）

## 审查清单（对照 `docs/code-review/01-标准与流程.md`）

### 🔴 阻断级（必须改）
- [ ] **时区/时点**：涉及交易日/盘中/周末判定均用 `dayjs.tz`，未用本地时区 `Date`
- [ ] **外部数据渲染**：进 HTML 前已 `escapeHtml`（股票名/原因/动态串）
- [ ] **凭据/SQL**：密钥未提交明文；SQL 全部参数化
- [ ] **复权/单位/排序口径**：行情解析改动已对照 README「接口坑」表核对
- [ ] **关键纯函数**：R01/R07/R05/分类/字段映射/时区推算改动已配或更新自测

### 🟡 建议级（应当改）
- [ ] 阈值进 `G` 常量表，无散落魔法数
- [ ] 静默失败路径有闸门（参照失败率红线模式）
- [ ] 网络重试区分短退避 / WAF 长退避
- [ ] 单文件未超 ~400 行 / 未"一文件多职责"（否则拆）

### 💭 锦上添花
- [ ] 注释讲 why；`docs/*/01-方案.md` 已同步

## Reviewer 结论
- [ ] Approve
- [ ] Request changes（附 🔴🟡💭 + `文件:行号`）
