# 领域策略与路由契约

## 用户裁决

2026-09-22 用户确认以下五项策略：

1. 使用 canonical ActionKind、明确优先级和互斥规则；
2. clarify → awaiting_user，不因买家不回复自动 handoff；
3. handoff 只允许白名单原因并要求证据；
4. 保留“等价秘密”边界，并定义其可执行范围；
5. resolved/closed 按领域事实优先、买家确认增强、人工覆盖兜底、后续否定可重开执行。

## 决策输入

PolicyEngine 的输入必须来自结构化对象：signals、conversationState、verifiedFacts、policyConfig、accountScope。不得把原始 Prompt、正则命中或模型自由文本作为唯一路由依据。

## Canonical ActionKind

每个 ActionPlan 必须且只能有一个 primaryAction：

| ActionKind | 用途 | 互斥/前置 |
| --- | --- | --- |
| ANSWER_FACT | 基于已核实事实回答 | 必须有足够事实；可带安全局部拒绝 |
| GUIDE_NEXT_STEP | 推进下单、付款、发货、收货或评价前一步 | 必须有当前生命周期事实 |
| CLARIFY | 只问一个最小必要问题 | 缺少关键事实时优先于回答、引导和推荐 |
| ACKNOWLEDGE_CONTINUE | 承接情绪并继续当前目标 | 不得单独改变生命周期或解决状态 |
| REDIRECT | 处理未形成新目标的跑题 | 仅在没有可执行新目标时使用 |
| SWITCH_GOAL | 创建或切换到明确的新目标 | 明确新目标优先于旧目标，但先执行安全检查 |
| RECOMMEND | 推荐符合资格的店内商品 | 仅在当前目标稳定、情绪正常且无澄清等待时允许 |
| WAIT_FOR_USER | 已等待补充，不发送重复问题 | 只能进入 awaiting_user，不得自动 handoff |
| HANDOFF | 进入人工处理队列 | 仅允许白名单 handoffReasonCode |
| REFUSE_SENSITIVE | 纯敏感请求的明确拒绝 | 只在没有可安全继续的业务部分时作为主动作 |

安全处理不是第二个业务路由。safetyHandling 只能是 NONE、PARTIAL_REFUSAL 或 FULL_REFUSAL，并可叠加在安全的 primaryAction 上。

## ActionPlan 契约

ActionPlan 至少包含：actionPlanId、primaryAction、primaryGoal、requiredFacts、successCriteria、allowedTools、questionBudget、recommendationAllowed、handoffAllowed、nextState、safetyHandling、policyDecisionId、policyVersion、reasonCodes 和 evidenceRefs。

禁止持久化 fallbackAction。发送前审核失败时必须生成新的 ActionPlan，并通过 supersedesActionPlanId 关联被替代版本。

## 优先级与互斥规则

1. 先执行敏感出站检查；敏感处理只能拒绝敏感片段，不得吞掉安全业务目标。
2. 明确人工请求可选择 HANDOFF，但仍需记录 USER_REQUESTED_HUMAN。
3. 缺少关键事实时，CLARIFY 优先于 ANSWER_FACT、GUIDE_NEXT_STEP 和 RECOMMEND。
4. 明确的新目标使用 SWITCH_GOAL；没有新目标时，继续当前目标或 REDIRECT。
5. 情绪明显负面时使用 ACKNOWLEDGE_CONTINUE，同时关闭推荐和评价请求。
6. GUIDE_NEXT_STEP 优先于 RECOMMEND；推荐永远不能覆盖未解决目标、澄清等待或售后门控。
7. HANDOFF 不得与 CLARIFY、RECOMMEND 或 WAIT_FOR_USER 同时作为主动作。

## 路由规则

- 事实充分：选择 ANSWER_FACT 或 GUIDE_NEXT_STEP；
- 信息不足：选择 CLARIFY，发送后状态为 awaiting_user；
- 无回复：选择 WAIT_FOR_USER，不自动 handoff；
- 邻近话题：优先处理当前安全问题，再使用 REDIRECT 回到主目标；
- 明确新目标：使用 SWITCH_GOAL，必要时先澄清；
- 售后、投诉、发货异常：优先 ACKNOWLEDGE_CONTINUE、CLARIFY 或 GUIDE_NEXT_STEP；
- 低置信度本身不是 handoff 理由。

## handoff 白名单与证据门槛

只有以下 handoffReasonCode 合法：

| reasonCode | 最低证据 | 不得替代为 |
| --- | --- | --- |
| USER_REQUESTED_HUMAN | 明确要求人工的 sourceMessageId | 情绪负面、低置信度 |
| REQUIRED_PERMISSION_MISSING | 工具返回权限拒绝码，且无只读替代路径 | 普通事实缺失 |
| VERIFIED_FACT_UNAVAILABLE | 关键事实标记 factCritical=true，至少两次有界读取失败或权威源明确 unavailable | 模型不知道、超时一次 |
| POLICY_ESCALATION_REQUIRED | 当前 policyVersion 中显式列出的 ruleId 和升级条件 | Prompt 文案、任意高风险标签 |
| SECURITY_INCIDENT_REVIEW | 出站敏感拦截事件或安全事件 ID | 普通敏感请求 |

以下原因禁止触发 handoff：LOW_CONFIDENCE、ORDINARY_AFTER_SALES、COMPLAINT、CROSS_PRODUCT、NO_BUYER_REPLY、MODEL_ERROR。

## 澄清契约

- 每个 outbound turn 最多一个问题；questionBudget.maxQuestionsPerTurn=1；
- 每个 active goal 默认最多 2 轮澄清，实际值由 policyConfig.clarification.maxRounds 提供；
- pendingQuestions、expectedAnswerType、sourceMessageId、questionFingerprint、clarificationRound、awaitingUserSince、awaitingUserTtl 必须持久化；
- 相同 questionFingerprint 不得重复发送，除非出现新的事实证据；
- 买家不回复时保持 awaiting_user，到 TTL 后转 unresolved，不得自动 handoff；
- 买家返回后先重新归因；明确新目标使用 SWITCH_GOAL，否则恢复原目标；
- 澄清未完成时不能标记 resolved，不能推荐或催评价。

## 等价秘密边界

“等价秘密”是任何能够直接授予访问权、签名权、绕过验证或冒充身份的秘密材料，包括 session cookie、Bearer/Refresh Token、私钥、签名密钥、Webhook Secret、恢复码、一次性验证码和管理员凭证。普通订单号、商品 ID、公开用户名和公开商品信息不属于等价秘密。

- 纯敏感请求：primaryAction=REFUSE_SENSITIVE、safetyHandling=FULL_REFUSAL；
- 混合业务 + 敏感请求：安全业务部分继续 ANSWER_FACT 或 CLARIFY，safetyHandling=PARTIAL_REFUSAL；
- 输出、日志、trace、metrics、备份、导出和重试正文均不得包含敏感原文；
- 分类不确定或出站拦截异常时 fail-closed；Prompt Injection 本身不是拒绝理由。

## 解决与关闭契约

persisted 不等于 resolved。resolved 必须至少有一项主要证据：

1. 领域事实满足当前 successCriteria；
2. 买家明确确认问题已解决；
3. 人工覆盖，并记录 actor、reasonCode、evidenceRefs。

判定优先级为“领域事实优先 → 买家确认增强 → 人工覆盖兜底”。人工覆盖不得覆盖相冲突的已核实领域事实；冲突时记录 overrideRejected。

reopenWindow 必须由 policyConfig.resolution.reopenWindow 提供，禁止在代码中隐含固定值；未配置时只能保持 review_pending，不能自动 closed。窗口内出现否定、重复追问或事实回退时，resolved → needs_followup 并生成新 ActionPlan；窗口结束后新消息默认创建新目标，不自动篡改历史结论。closed 只能在 resolved 且重开窗口结束后生成。
