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

## 可测试 tie-break

同一 signals/facts 必须唯一映射到一个 primaryAction；运行时只允许命中 Canonical rule catalog 中的 ruleId。关键事实缺失时命中 `CLARIFY.FACT_GAP.001`，明确新目标且事实齐全时命中 `SWITCH.GOAL.READY.001`，生命周期推进命中 `GUIDE.LIFECYCLE.001`，事实问答命中 `ANSWER.FACT.001`，负面情绪且安全事实足够命中 `EMOTION.CONTINUE.001`，等待命中 `WAIT.AWAITING.001`，合法 handoff 命中 `HANDOFF.VALID.001`，纯敏感请求命中 `SECURE.PURE.001`。邻近事实问题与纯跑题分别由 `ANSWER.FACT.001`/`REDIRECT.OFF_TOPIC.001` 的互斥 predicate 区分，推荐只能命中 `RECOMMEND.STABLE.001`。

上述条件不是实现代码分支顺序，而是 `PolicyConfig.precedenceRules` 的版本化数据。每条规则必须同时声明 `ruleId`、`predicate`、`primaryAction`、`safetyHandling`、`nextState`、`priority`、`specificity`、`requiredEvidenceCount`、`successCriteria` 和 `reasonCodes`。PolicyEngine 先收集所有 predicate 命中的候选规则，再按 `priority`、`specificity`、`requiredEvidenceCount` 和 `ruleId`（字典序）完成确定性 tie-break；只有零候选或最高优先级仍并列时才记录策略冲突并禁止生成业务 ActionPlan。

### Canonical rule catalog

以下目录是 AR-VS-00 的最小固定规则集；实现只能读取 PolicyConfig 中同结构的规则，不得用代码分支或模型自由文本替代：

| ruleId | 互斥 predicate | primaryAction | priority | specificity | nextState |
| --- | --- | --- | ---: | ---: | --- |
| SECURE.PURE.001 | `sensitiveClass=EQUIVALENT_SECRET AND safeBusinessPart=false` | REFUSE_SENSITIVE | 1000 | 100 | `goalStatus=active` |
| HANDOFF.VALID.001 | `handoffReasonCode∈allowedReasonCodes AND evidenceSchemaValid=true AND safetyHandling!=FULL_REFUSAL` | HANDOFF | 900 | 90 | `goalStatus=handoff` |
| WAIT.AWAITING.001 | `awaitingUser=true AND inboundMessageAbsent=true AND now<awaitingUserTtl` | WAIT_FOR_USER | 850 | 80 | `goalStatus=awaiting_user` |
| SWITCH.GOAL.GAP.001 | `explicitNewGoal=true AND newGoalFactsSufficient=false AND validHandoffEvidence=false` | CLARIFY | 820 | 85 | `goalStatus=awaiting_user` |
| CLARIFY.FACT_GAP.001 | `requiredFactsMissingOrConflict=true AND validHandoffEvidence=false AND explicitNewGoal=false` | CLARIFY | 800 | 80 | `goalStatus=awaiting_user` |
| SWITCH.GOAL.READY.001 | `explicitNewGoal=true AND newGoalFactsSufficient=true` | SWITCH_GOAL | 700 | 70 | `goalStatus=active` |
| EMOTION.CONTINUE.001 | `strongNegativeEmotion=true AND safeContinuationFactsSufficient=true` | ACKNOWLEDGE_CONTINUE | 750 | 75 | `goalStatus=active` |
| GUIDE.LIFECYCLE.001 | `strongNegativeEmotion=false AND lifecyclePush=true AND currentGoalFactsSufficient=true` | GUIDE_NEXT_STEP | 600 | 60 | `goalStatus=active` |
| ANSWER.FACT.001 | `strongNegativeEmotion=false AND factQuestion=true AND lifecyclePush=false AND currentGoalFactsSufficient=true` | ANSWER_FACT | 550 | 50 | `goalStatus=active` |
| ANSWER.ADJACENT.001 | `strongNegativeEmotion=false AND topicRelation=adjacent AND safeAdjacentAnswer=true` | ANSWER_FACT | 525 | 45 | `goalStatus=active` |
| REDIRECT.OFF_TOPIC.001 | `topicRelation=off_topic AND explicitNewGoal=false AND safeAdjacentAnswer=false` | REDIRECT | 400 | 40 | `goalStatus=active` |
| RECOMMEND.STABLE.001 | `strongNegativeEmotion=false AND complaintOpen=false AND afterSalesOpen=false AND goalStable=true AND recommendationEligible=true AND awaitingUser=false` | RECOMMEND | 300 | 30 | `goalStatus=active` |

安全敏感分类是 overlay：`safeBusinessPart=true` 时只设置 `safetyHandling=PARTIAL_REFUSAL` 并继续匹配业务规则；`safeBusinessPart=false` 时只能命中 `SECURE.PURE.001`。输入允许命中多条候选 rule，但必须由 tie-break 选出唯一最终 rule；零候选或最高优先级并列才记录策略冲突并禁止生成业务 ActionPlan。

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
| VERIFIED_FACT_UNAVAILABLE | factCritical=true，且 `attemptCount >= policyConfig.handoff.factUnavailable.minAttempts`、在 windowSeconds 内、带 sourceIds、deadlineAt 和 errorCodes | 模型不知道、单次超时 |
| POLICY_ESCALATION_REQUIRED | ruleId 必须属于受控 policyEscalationRegistry，且满足 registry 中的升级条件 | Prompt 文案、任意高风险标签 |
| SECURITY_INCIDENT_REVIEW | 出站敏感拦截事件或安全事件 ID | 普通敏感请求 |

以下原因禁止触发 handoff：LOW_CONFIDENCE、ORDINARY_AFTER_SALES、COMPLAINT、CROSS_PRODUCT、NO_BUYER_REPLY、MODEL_ERROR。

### handoff 证据对象

每个 handoff 必须携带与 reasonCode 对应的结构化证据对象；仅有自然语言解释、模型置信度或通用 error 字符串不能通过校验：

| reasonCode | 必填证据字段 |
| --- | --- |
| USER_REQUESTED_HUMAN | `sourceMessageId`、`explicitRequestDigest`、`requestedAt` |
| REQUIRED_PERMISSION_MISSING | `toolName`、`permissionCode`、`accountScope`、`attemptedAt`、`fallbackChecked=true`、`fallbackResult∈{AVAILABLE,UNAVAILABLE,NOT_APPLICABLE}` |
| VERIFIED_FACT_UNAVAILABLE | `factKey`、`factCritical=true`、`attemptCount`、`firstAttemptAt`、`lastAttemptAt`、`windowSeconds`、`sourceIds[]`、`deadlineAt`、`errorCodes[]`、`authoritativeSourceUnavailable=true` |
| POLICY_ESCALATION_REQUIRED | `policyVersion`、`ruleId`、`registryVersion`、`predicateId`、`thresholdEvidence`、`evaluationDigest` |
| SECURITY_INCIDENT_REVIEW | `securityEventId`、`classifierVersion`、`outboundInspectionId`、`blockedChannel∈{MESSAGE,LOG,TRACE,METRICS,BACKUP,EXPORT,RETRY_PAYLOAD}`、`incidentAt` |

证据字段必须满足 account scope、时间窗口和幂等约束，并写入脱敏摘要；缺失、冲突或过期证据时只能继续安全帮助、澄清或保持等待，不得升级 handoff。

## 澄清契约

- 每个 outbound turn 最多一个问题；questionBudget.maxQuestionsPerTurn=1；
- clarification.maxRounds 必须由 policyConfig 提供，取值为 1–3 的整数；缺失配置时不能自动发送澄清或 handoff；
- pendingQuestions、expectedAnswerType、sourceMessageId、questionFingerprint、clarificationRound、awaitingUserSince、awaitingUserTtl 必须持久化；
- 相同 questionFingerprint 不得重复发送，除非出现新的事实证据；
- 买家不回复时保持 awaiting_user，到 TTL 后转 unresolved，不得自动 handoff；
- 最后一轮问题发送后仍保持 awaiting_user；若在 TTL 内补齐 requiredFacts 则允许继续原目标；若 TTL 到期仍缺关键事实，发出 clarification.exhausted 事件并转 unresolved，不再生成新的澄清问题；买家后续返回时重新归因，不自动 handoff；
- 买家返回后先重新归因；明确新目标使用 SWITCH_GOAL，否则恢复原目标；澄清耗尽后带来新事实时保留原 goalId、创建新的 clarificationAttemptId、将 clarificationRound 重置为 0，仅在事实补齐后继续原目标；只有明确新目标才创建新 goalId；
- 澄清未完成时不能标记 resolved，不能推荐或催评价。

## 等价秘密边界

“等价秘密”是任何能够直接授予访问权、签名权、绕过验证或冒充身份的秘密材料，包括 session cookie、Bearer/Refresh Token、私钥、签名密钥、Webhook Secret、恢复码、一次性验证码、系统提示词和管理员凭证。普通订单号、商品 ID、公开用户名和公开商品信息不属于等价秘密。

- 纯敏感请求：primaryAction=REFUSE_SENSITIVE、safetyHandling=FULL_REFUSAL；
- 混合业务 + 敏感请求：安全业务部分继续 ANSWER_FACT、GUIDE_NEXT_STEP、ACKNOWLEDGE_CONTINUE 或 CLARIFY，safetyHandling=PARTIAL_REFUSAL；
- 输出、日志、trace、metrics、备份、导出和重试正文均不得包含敏感原文；
- 仅敏感分类不确定或出站拦截异常时 fail-closed；普通意图低置信度不触发敏感拒绝；Prompt Injection 本身不是拒绝理由。

## 解决与关闭契约

persisted 不等于 resolved。resolved 必须至少有一项主要证据：

1. 领域事实满足当前 successCriteria；
2. 买家明确确认问题已解决；
3. 人工覆盖，并记录 actor、reasonCode、evidenceRefs。

判定优先级为“领域事实优先 → 买家确认增强 → 人工覆盖兜底”。人工覆盖不得覆盖相冲突的已核实领域事实；冲突时记录 overrideRejected。

policyConfig.resolution.reopenWindowSeconds 必须是以 UTC server clock 计时的正整数，具体值由已发布 PolicyConfig 提供，不得在代码中隐含默认值。canonical reopen evidenceType 包括 BUYER_DENIED、REPEAT_QUESTION、FACT_REGRESSION；每条重开证据必须包含 `evidenceType`、`evidenceRef`、`observedAt`、`evidenceWindowStart`、`evidenceWindowEnd` 和 `sourceEventId`，且 `observedAt` 必须落在窗口内。`windowStartAt/windowEndAt` 仅为外部事件输入别名，归一化后统一写入 `evidenceWindowStart/evidenceWindowEnd`。窗口内出现这些证据时，resolved → needs_followup 并生成新 ActionPlan；窗口结束后新消息默认创建新目标，不自动篡改历史结论。未配置窗口、窗口未结束或证据字段缺失时不得自动 closed；closed 只能在 resolved 且重开窗口结束后生成。
