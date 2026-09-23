# Auto-Replay Repair Agent 文档域

## 文档定位

repair-agent 是自动回复 Agent 的修复治理文档域，不是新的买家运行时 Agent。它统一维护修复范围、策略契约、状态模型、纵向切片、阶段门禁、风险、评审、发布与回滚说明。

唯一 canonical 入口：本目录的 README.md。

运行时行为仍以 docs/agent/auto-reply/design.md 和 docs/agent/auto-reply/activity.md 为当前实现契约；当运行契约与本修复治理文档冲突时，必须先登记决策并按切片推进修复，不能静默解释为已实现。

## 当前状态

- 状态：IN_PROGRESS / 切片实现与发布门禁收口
- 日期：2026-09-23
- 当前阶段：阶段 8/9，真实链路适配与发布门禁收口
- 交付边界：修复代码、增量迁移、切片测试和治理文档；真实外部链路与运营演练仍需目标环境证据
- 当前进展：AR-VS-00 至 AR-VS-09 已落地可验证内核/适配层；enforce 主入口、账号级 ACTIVE PolicyConfig、outbox/reconcile、Outcome Review 和发布前 smoke 已通过
- 下一步：补目标环境真实外部 sender/canary、领域 evidence、告警 Owner、迁移回滚/备份恢复和敏感红队证据

## 不可妥协约束

1. 业务路由必须由版本化、可审计、可回滚的策略和结构化信号决定，不允许把路由散落在硬编码分支、正则命中或 Prompt 文本中。
2. 默认继续帮助：普通不确定、售后、投诉、发货异常优先澄清、核实事实和给出下一步，不轻易拒绝或转人工。
3. 仅对 Cookie、API Key、Token、密码、验证码、系统提示词、管理员凭证及等价终极敏感信息明确拒绝；混合消息只拒绝敏感部分。
4. persisted 只代表传输/落库完成，不能直接代表业务问题已解决。
5. 事实状态由商品、订单、支付、物流和买家确认等证据推进，模型只能提出候选信号和表达内容。
6. 任何新动作都必须具备前置审核、结果审核、审计、回滚和可复核证据。

## 文档索引

| 文档 | 责任 |
| --- | --- |
| 00-scope.md | 范围、非目标、术语和不可妥协约束 |
| 01-baseline-audit.md | 当前代码/文档基线、已确认缺口和证据 |
| 02-target-architecture.md | 目标链路、模块边界、状态与闭环 |
| 03-domain-policy-contract.md | 路由策略、澄清、生命周期、情绪、推荐和敏感拒绝契约 |
| 04-data-api-contract.md | 状态、实体、事件、API 及兼容迁移约束 |
| 05-vertical-slices.md | AR-VS-00 至 AR-VS-09 的具体修复垂直切片 |
| 06-stage-gates.md | 阶段 0–8、DoD、评审和证据门禁 |
| 07-risk-register.md | 修复域风险、旧风险映射、关闭标准 |
| 08-review-log.md | 修复域独立评审记录与问题闭环 |
| 09-status.md | 当前阶段、完成/未完成范围、阻塞和下一步 |
| 10-compatibility-and-migration.md | 旧目录兼容入口、文档迁移映射和防漂移规则 |
| 11-release-rollback.md | feature flag、灰度、回滚、恢复和交接 |
| 12-release-smoke-evidence.md | AR-VS-09 发布前 smoke、canary、kill switch、outbox 与策略回滚证据 |
| templates/vertical-slice-card.md | 后续新增切片的固定卡片模板 |
| slices/AR-VS-00-scope-policy-baseline.md | AR-VS-00 切片卡与范围锁定结果 |
| slices/AR-VS-00-policy-matrix.md | 路由、拒绝、继续帮助、生命周期和指标矩阵 |
| slices/AR-VS-00-traceability.md | 需求→验收→测试追踪和静态证据 |
| slices/AR-VS-04-lifecycle.md | 生命周期事实投影与引导 |
| slices/AR-VS-05-topic-emotion.md | 跑题拉回与情绪门控 |
| slices/AR-VS-06-recommendation.md | 店内推荐资格与冷却 |
| slices/AR-VS-07-outcome-review.md | 发送后 Outcome Review |
| slices/AR-VS-08-integration.md | 编排适配与增量迁移 |
| slices/AR-VS-09-release.md | 发布、回滚与交接门禁 |
| decisions/ADR-AR-0001-route-and-refusal-policy.md | 路由与拒绝策略决策记录 |
| decisions/ADR-AR-0002-confirmed-action-and-resolution-contract.md | 已确认的动作、澄清与结果契约 |

## 职责边界

repair-agent 负责维护修复范围、策略、验收、阶段门禁、纵向切片、风险、决策、评审、发布、回滚和证据归档。

repair-agent 不负责直接发送买家消息或执行生产切换；切片可以通过受控代码/迁移提交落地，但不能把文档状态升级为发布已通过，也不能绕过测试、回滚和真实链路证据。

## 使用规则

- 新修复内容只写入本目录；旧目录只保留运行设计、活动契约和兼容快照。
- 每个切片必须先填写目标、输入、输出、禁止范围、验收、证据和回滚，再进入实现。
- 文档变更后同步 STATUS.md、docs/05-review-log.md 和 docs/agent-worktree-registry.md。
- 发现文档与实现不一致时，记录为风险或决策，不通过改标题、改状态或删除历史记录掩盖。
