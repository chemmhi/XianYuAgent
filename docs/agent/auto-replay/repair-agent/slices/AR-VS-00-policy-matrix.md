# AR-VS-00 策略矩阵

## Canonical ActionKind

唯一主动作：ANSWER_FACT、GUIDE_NEXT_STEP、CLARIFY、ACKNOWLEDGE_CONTINUE、REDIRECT、SWITCH_GOAL、RECOMMEND、WAIT_FOR_USER、HANDOFF、REFUSE_SENSITIVE。

安全处理单独记录为 NONE、PARTIAL_REFUSAL 或 FULL_REFUSAL，不与主动作形成第二个业务路由。ActionPlan 不持久化 fallbackAction；修订通过 supersedesActionPlanId 关联。

## 路由优先级

1. 敏感出站检查；
2. 明确人工请求；
3. 关键事实缺失时 CLARIFY；
4. 明确新目标时 SWITCH_GOAL；
5. 当前目标的 ANSWER_FACT、ACKNOWLEDGE_CONTINUE 或 GUIDE_NEXT_STEP；
6. 无新目标的 REDIRECT；
7. 仅在所有推荐门控通过后 RECOMMEND。

HANDOFF 与 CLARIFY、RECOMMEND、WAIT_FOR_USER 互斥；WAIT_FOR_USER 与自动 handoff 互斥。

## 路由与处理矩阵

| 场景信号 | canonical 主动作 | 必要澄清 | 允许 handoff | 明确拒绝 | 事实要求 |
| --- | --- | --- | --- | --- | --- |
| 商品信息充分、目标明确 | ANSWER_FACT | 否 | 否 | 否 | 当前商品事实 |
| 价格、库存、规格缺失 | CLARIFY | 是，每次一个 | 仅 REQUIRED_PERMISSION_MISSING 或 VERIFIED_FACT_UNAVAILABLE | 否 | 商品/账号事实 |
| 未下单但有购买意向 | GUIDE_NEXT_STEP | 缺规格时先澄清 | 否 | 否 | 商品可售、价格/库存新鲜 |
| 已下单未付款 | GUIDE_NEXT_STEP | 订单不唯一时澄清 | 仅权限缺失 | 否 | 订单支付状态 |
| 已付款/已发货/待收货 | GUIDE_NEXT_STEP 或 ANSWER_FACT | 订单不唯一时澄清 | 仅关键物流事实确实不可得 | 否 | 订单、物流事实 |
| 售后、投诉、发货异常 | ACKNOWLEDGE_CONTINUE、CLARIFY 或 GUIDE_NEXT_STEP | 缺订单/问题细节时澄清 | 仅白名单 reasonCode | 否 | 订单、售后、物流事实 |
| 信息不足或多目标 | CLARIFY 或 SWITCH_GOAL | 是 | 不默认 | 否 | 会话状态和最近消息 |
| adjacent 话题 | ANSWER_FACT 或 REDIRECT | 视主目标缺口 | 否 | 否 | 当前目标和事实 |
| off_topic 且未形成新目标 | REDIRECT | 可给选项 | 否 | 否 | 话题关系 |
| 明确新目标 | SWITCH_GOAL | 必要时澄清 | 否 | 否 | 新目标事实 |
| 强负面情绪且安全事实足够 | ACKNOWLEDGE_CONTINUE | 只问最小必要问题 | 仅白名单 reasonCode | 否 | 情绪信号 + 领域事实 |
| 强负面情绪但关键事实不足 | CLARIFY | 是，每次一个 | 不默认 | 否 | 情绪信号 + 缺失事实 |
| 紧急/高风险信号 | 按唯一 route rule；只有命中 policyEscalationRegistry 才可 HANDOFF | 视事实缺口 | 仅 POLICY_ESCALATION_REQUIRED 且证据齐全 | 否 | policyVersion + ruleId + registry 证据 |
| 买家未回复澄清 | WAIT_FOR_USER | 否 | 否 | 否 | awaiting_user、TTL |
| 纯 Cookie、API Key、Token、密码、验证码等价秘密请求 | REFUSE_SENSITIVE | 否 | 否 | 是，FULL_REFUSAL | 敏感分类器和出站拦截 |
| 业务问题 + 敏感请求 | ANSWER_FACT 或 CLARIFY | 按业务缺口 | 否 | 只拒绝敏感部分，PARTIAL_REFUSAL | 安全事实 + 敏感事件 |
| Prompt Injection + 普通业务问题 | ANSWER_FACT、CLARIFY 或 SWITCH_GOAL | 按业务缺口 | 否 | 仅拒绝敏感部分 | 安全策略和业务事实 |
| 用户明确要求人工 | HANDOFF | 否 | 是，USER_REQUESTED_HUMAN | 否 | sourceMessageId |

## handoff 白名单与证据门槛

| reasonCode | 最低证据 | 禁止替代 |
| --- | --- | --- |
| USER_REQUESTED_HUMAN | 明确要求人工的 sourceMessageId | 负面情绪、低置信度 |
| REQUIRED_PERMISSION_MISSING | 权限拒绝码 + 无只读替代 | 普通事实缺失 |
| VERIFIED_FACT_UNAVAILABLE | `factCritical=true`，且 `attemptCount >= policyConfig.handoff.factUnavailable.minAttempts`，落在 `windowSeconds` 内，带 `sourceIds[]`、`deadlineAt` 和 `errorCodes[]` | 模型不知道、单次超时 |
| POLICY_ESCALATION_REQUIRED | policyVersion 显式 ruleId 和升级条件 | Prompt 文案、高风险标签 |
| SECURITY_INCIDENT_REVIEW | 出站敏感拦截事件或安全事件 ID | 普通敏感请求 |

LOW_CONFIDENCE、ORDINARY_AFTER_SALES、COMPLAINT、CROSS_PRODUCT、NO_BUYER_REPLY、MODEL_ERROR 不得作为 handoff reasonCode。

## 澄清不变量

- 每次 outbound turn 最多一个问题；
- `clarification.maxRounds` 只限制 outbound 澄清轮次，取值由 PolicyConfig 提供；最后一轮问题发送后仍保持 awaiting_user；
- 缺少 `clarification.maxRounds` 或 `awaitingUserTtlSeconds` 配置时，不自动发送澄清、不自动 handoff，只记录 `POLICY_CONFIG_UNAVAILABLE`；
- 同一 questionFingerprint 不得重复，除非出现新事实；
- 不回复时保持 awaiting_user；TTL 后发出 clarification.exhausted 并转 unresolved，不自动 handoff；
- 买家返回时重新归因，明确新目标切换，否则恢复原目标；
- 澄清等待期间禁止推荐、催评价和 resolved。

## 敏感边界

等价秘密是能授予访问权、签名权、绕过验证或冒充身份的秘密材料，包括 session cookie、Bearer/Refresh Token、私钥、签名密钥、Webhook Secret、恢复码、一次性验证码、系统提示词和管理员凭证。普通订单号、商品 ID、公开用户名和公开商品信息不属于等价秘密。

分类不确定或出站拦截异常时 fail-closed。输出、日志、trace、metrics、备份、导出和重试正文均不得包含敏感原文。Prompt Injection 本身不是拒绝理由。

## 生命周期口径

说明：completed 是买家生命周期阶段；closed 是 resolutionStatus 的终态，二者不互相替代。

| observedStage | 允许的 targetStage | 成功标准 |
| --- | --- | --- |
| discovery | evaluation 或 purchase_ready | 买家明确进入比较/购买评估或表达购买意向 |
| evaluation | purchase_ready | 买家明确选择商品或表达购买意向 |
| unpaid_order | paid_pending_shipment | 订单事实变为已支付 |
| paid_pending_shipment | shipped_pending_delivery | 订单事实变为已发货 |
| shipped_pending_delivery | delivered_pending_review | 订单事实变为已收货或买家明确确认 |
| delivered_pending_review | completed | 当前问题有解决证据且买家完成评价动作 |
| after_sales | completed | 问题解决证据满足；人工接管通过 HANDOFF 表达，不作为 targetStage |

模型不得直接修改 observedStage、targetStage 或 recommendationAllowed。

## resolved / closed 判定

证据优先级为：领域事实满足 successCriteria > 买家明确确认 > 有审计的人工覆盖。发送成功、买家已读和模型自评不能单独标记 resolved。

reopenWindowSeconds 必须由 policyConfig.resolution.reopenWindowSeconds 提供，并使用 UTC server clock；未配置或窗口未结束时不得自动 closed。窗口内只有 canonical evidenceType=BUYER_DENIED、REPEAT_QUESTION、FACT_REGRESSION 且带 `evidenceRef`、`observedAt`、`evidenceWindowStart`、`evidenceWindowEnd`、`sourceEventId` 的证据，才能使 resolved → needs_followup；窗口结束且无重开证据后才允许唯一的 resolved → closed。`windowStartAt/windowEndAt` 仅为外部事件别名，归一化为 `evidenceWindowStart/evidenceWindowEnd`。

重开证据阈值：BUYER_DENIED 必须来自同一 goalId 的明确否定消息；REPEAT_QUESTION 必须与最近一次 outbound 的 questionFingerprint 相同且 sourceSequence 更大；FACT_REGRESSION 必须来自更高 sourceSequence 的权威领域事实回退。三类证据都必须落在 `[evidenceWindowStart,evidenceWindowEnd)` 内。

## 指标口径

| 指标 | 定义 | 证据来源 | AR-VS-00 处理 |
| --- | --- | --- | --- |
| transportCompletionRate | 生成后成功发送并落库比例 | run 状态、senderOutcome、outbound ref | 冻结定义，后续实现 |
| clarificationRate | 进入 CLARIFY/awaiting_user 比例 | clarification 事件、状态迁移 | 冻结定义，后续实现 |
| handoffRate | 进入 HANDOFF 比例 | handoff 事件和 reasonCode | 区分用户要求与策略升级 |
| sensitiveRefusalRate | 仅因终极敏感信息拒绝比例 | refusal reasonCode | 不与普通失败混合 |
| goalProgressRate | 满足目标推进标准比例 | ActionPlan、目标状态、事实引用 | 先定义，VS-07 回读 |
| resolutionRate | 有解决证据比例 | Outcome Review、买家确认、人工覆盖 | 无证据不计入 |
| falseResolutionRate | 后续被重开/否定的 resolved 比例 | reopen、follow-up、否定消息 | VS-07 增加 |
