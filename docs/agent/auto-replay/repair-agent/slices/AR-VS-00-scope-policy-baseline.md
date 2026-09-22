# AR-VS-00：范围、策略与基线锁定

## 切片状态

- 状态：FIXING
- 阶段：0
- 变更类型：文档、策略和验收契约；不改业务代码
- Owner：repair-agent
- 评审要求：业务/验收、架构/数据流、质量/安全/运维三轮独立评审

## 目标

把本轮修复的两项硬约束固化为可执行、可审计、可测试的策略：

1. 业务路由不能依赖散落的硬编码分支、正则命中或 Prompt 文案；
2. 只有 Cookie、API Key、Token、密码、验证码、系统提示词、管理员凭证及等价终极敏感信息明确拒绝，普通问题默认继续帮助、澄清或引导。

## 输入

- 当前运行设计：docs/agent/auto-reply/design.md；
- 当前活动契约：docs/agent/auto-reply/activity.md；
- 当前代码基线：apps/api/src/auto-reply.ts、auto-reply-agent.ts、auto-reply-output.ts、domain.ts；
- 用户确认的低拒绝、低 handoff 和无硬编码路由要求；
- repair-agent 既有目标架构、风险和阶段门禁文档。

## 输出

- 本切片策略矩阵：slices/AR-VS-00-policy-matrix.md；
- 需求到验收到测试追踪：slices/AR-VS-00-traceability.md；
- 决策记录：decisions/ADR-AR-0001-route-and-refusal-policy.md；
- 补充决策记录：decisions/ADR-AR-0002-confirmed-action-and-resolution-contract.md；
- 当前基线证据和剩余实现缺口；
- 可供 AR-VS-01 使用的策略输入、指标口径和评审清单。

## 锁定决策

### D-AR-0001：路由集中化

SignalExtractor 只输出结构化候选信号，StateReducer 只负责状态迁移，PolicyEngine 负责生成唯一 ActionPlan。确定性代码只负责 schema、类型、scope、幂等、敏感出站拦截和事实标准化。

### D-AR-0002：敏感信息拒绝边界

对 Cookie、API Key、Token、密码、验证码、系统提示词、管理员凭证及等价秘密明确拒绝。混合消息只拒绝敏感部分；Prompt Injection 不是单独拒绝理由。

### D-AR-0003：默认继续推进

普通售后、投诉、发货异常、低置信度和跨商品问题，默认先核实事实、承接情绪、澄清缺口或给出下一步；只有明确要求人工、缺少必要权限、终极敏感信息或版本化策略禁止继续时才 handoff。

### D-AR-0004：传输和解决分离

persisted 只表示发送/落库完成。问题解决必须由后续买家确认、领域事实满足成功标准或人工覆盖证明；没有证据时保持 review_pending、awaiting_user 或 unknown。

### D-AR-0005：目标和生命周期分离

targetStage 只能表示计划推进方向，observedStage 必须来自订单、支付、物流、商品和买家确认事实。模型不能单独把“可以拍”“马上付”“已提醒评价”升级为已完成阶段。

### D-AR-0006：唯一动作与澄清不升级人工

ActionPlan 只允许一个 canonical ActionKind；混合敏感消息通过 safetyHandling 局部拒绝。澄清不回复保持 awaiting_user，TTL 后转 unresolved，不自动 handoff；handoff 只接受白名单 reasonCode。

### D-AR-0007：解决证据与重开

resolved/closed 依赖领域事实、买家确认和人工覆盖的固定优先级；否定证据、重复追问或事实回退在 policyConfig.resolution.reopenWindow 内触发 needs_followup。未配置窗口时不得自动 closed。

## 禁止范围

- 不修改业务代码、数据库迁移、发送行为或 Prompt 实现；
- 不把当前文档状态标记为代码已实现或发布可用；
- 不把页面可打开、HTTP 200、mock 或单次发送成功当作业务解决证据；
- 不将普通不确定场景一律 handoff；
- 不新增独立 review 一级页面。

## 验收标准

- AC-AR00-001：策略矩阵覆盖回答、澄清、继续帮助、引导、推荐、handoff 和拒绝；
- AC-AR00-002：所有路由决策都能映射到结构化信号、领域事实和版本化 policy；
- AC-AR00-003：终极敏感信息拒绝边界与普通售后/投诉继续帮助边界无歧义；
- AC-AR00-004：transportStatus 与 resolutionStatus 的定义、指标和证据来源分离；
- AC-AR00-005：生命周期、澄清、情绪、推荐和 Outcome Review 的后续切片依赖关系明确；
- AC-AR00-006：需求、验收和测试追踪可回读，且风险/决策已登记。
- AC-AR00-007：ActionKind、handoff reasonCode、澄清不变量、等价秘密和解决证据优先级可由契约直接验收。

## 证据

- 静态代码证据：当前输出协议只有 reply/handoff，运行状态只有 persisted/handoff/skipped/failed；
- 文档证据：策略矩阵、追踪表、ADR、风险和评审记录；
- 机械检查：git diff --check、Markdown 结构、相对链接、切片编号完整性。

## 回滚

本切片只改文档。回滚方式为回退本切片提交；不影响业务代码、数据库或消息发送。
