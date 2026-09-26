# 自动回复 Agent 语义断言文档

- 版本：AR-SEM-2026-09-26
- 覆盖范围：入站消息、策略门控、工具型 Agent、生成、发送、接管并发、结果回读、可观测性与发布回滚。
- 断言总数：112
- 约定：`normal` 正常分支，`boundary` 边界分支，`error` 异常分支，`security` 安全分支，`idempotency` 幂等分支，`concurrency` 并发分支，`observability` 可观测性分支。

## 公开实现面
- `src/auto-reply.ts`：`NoopAutoReplySender`、`ExternalAutoReplySender`、`RuleBasedIntentClassifier`、`TemplateAutoReplyGenerator`、`AutoReplyService`
- `src/auto-reply-agent.ts`：`AUTO_REPLY_TOOL_NAMES`、`AUTO_REPLY_AGENT_TOOLS`、`AUTO_REPLY_WEB_SEARCH_TOOL`、`AutoReplyAgentError`、`AutoReplyAgentHandoffError`、`ToolCallingAutoReplyAgent`
- `src/auto-reply-context-document.ts`：`formatAutoReplyContextDocument`
- `src/auto-reply-multimodal.ts`：`buildAutoReplyModelContent`、`hasSupportedAutoReplyMedia`
- `src/auto-reply-product-search.ts`：`normalizeProductSearchText`、`normalizeProductSearchTerms`、`splitProductSearchTerms`、`productSearchScore`
- `src/auto-reply-policy.ts`：`PolicyConfigValidationError`、`PolicyEngineError`、`computePolicyHash`、`withComputedPolicyHash`、`validatePolicyConfig`、`PolicyEngine`
- `src/auto-reply-state.ts`：`ConversationStateReducerError`、`ConversationStateReducer`
- `src/auto-reply-topic-emotion.ts`：`TopicEmotionPolicyValidationError`、`TopicEmotionEngineError`、`computeTopicEmotionPolicyHash`、`withComputedTopicEmotionPolicyHash`、`validateTopicEmotionPolicy`、`TopicEmotionEngine`
- `src/auto-reply-clarification.ts`：`questionFingerprint`、`ClarificationError`、`ClarificationEngine`
- `src/auto-reply-lifecycle.ts`：`LifecyclePolicyError`、`LifecycleEngine`
- `src/auto-reply-recommendation.ts`：`RecommendationPolicyError`、`RecommendationEngine`
- `src/auto-reply-pre-send-review.ts`：`PreSendReviewError`、`PreSendReviewEngine`
- `src/auto-reply-outcome-review.ts`：`OUTCOME_EVIDENCE_TYPES`、`OutcomeReviewError`、`OutcomeReviewEngine`
- `src/auto-reply-outbox.ts`：`AUTO_REPLY_SEND_OUTBOX_SCOPE`、`ReliableExternalAutoReplySender`
- `src/auto-reply-activity-projection.ts`：`projectAutoReplyRun`
- `src/auto-reply-release.ts`：`ReleasePolicyError`、`ReleaseGateEngine`
- `src/auto-reply-god-view.ts`：`createAutoReplyGodViewSink`、`sanitizeEvent`
- `src/xianyu-im.ts`：`parsePushPayload`、`parsePushPayloadDetailed`、`parseReadReceiptPayload`、`XianyuImClient`、`XianyuImSessionManager`
- `src/inbound-inbox-worker.ts`：`InboundInboxWorker`

## 断言清单

| ID | 阶段 | 节点 | 分支 | 语义断言 | 可执行测试 |
|---|---|---|---|---|---|
| AR-SEM-001 | 入站接入 | gateway → inbox | normal | 合法买家消息经过网关解析后进入本地消息与自动回复入口。 | `semantic inbound gateway covers normal, malformed, system, duplicate, and ordering paths` |
| AR-SEM-002 | 入站接入 | gateway → inbox | boundary | 空正文、超长正文和缺少来源时间不会被当作有效业务事实。 | `semantic inbound gateway covers normal, malformed, system, duplicate, and ordering paths` |
| AR-SEM-003 | 入站接入 | gateway → inbox | error | 损坏的 push payload 被隔离并返回结构化 quarantine reason。 | `semantic inbound gateway covers normal, malformed, system, duplicate, and ordering paths` |
| AR-SEM-004 | 入站接入 | gateway → inbox | security | 卖家身份与买家身份在入库前纠正方向，卖家消息不进入买家 inbox。 | `semantic inbound gateway covers normal, malformed, system, duplicate, and ordering paths` |
| AR-SEM-005 | 入站接入 | gateway → inbox | idempotency | 同一账号和外部消息引用重复到达时只落一条本地消息。 | `semantic inbound gateway covers normal, malformed, system, duplicate, and ordering paths` |
| AR-SEM-006 | 入站接入 | gateway → inbox | concurrency | 同一会话的 inbox claim 按来源序列串行化，租约过期才允许回收。 | `semantic inbound gateway covers normal, malformed, system, duplicate, and ordering paths` |
| AR-SEM-007 | 入站接入 | gateway → inbox | observability | 来源事件 id、来源序列、请求 id 和 trace id 在入站记录中可追踪。 | `semantic inbound gateway covers normal, malformed, system, duplicate, and ordering paths` |
| AR-SEM-008 | 入站接入 | gateway → inbox | error | 未验证平台系统提醒被隔离，不创建自动回复或出站消息。 | `semantic inbound gateway covers normal, malformed, system, duplicate, and ordering paths` |
| AR-SEM-009 | 路由与安全 | classification / allowlist / handoff | normal | 价格、库存、发货和普通问候被稳定映射到对应意图。 | `semantic classification and safety cover commerce, refusal, allowlist, and fail-closed paths` |
| AR-SEM-010 | 路由与安全 | classification / allowlist / handoff | boundary | 文本边界、大小写、空白和未知意图回落到安全的 other/general 路由。 | `semantic classification and safety cover commerce, refusal, allowlist, and fail-closed paths` |
| AR-SEM-011 | 路由与安全 | classification / allowlist / handoff | security | 凭证请求与 prompt injection 进入 handoff 或拒答，不进入普通生成。 | `semantic classification and safety cover commerce, refusal, allowlist, and fail-closed paths` |
| AR-SEM-012 | 路由与安全 | classification / allowlist / handoff | security | allowlist 配置为空表示不限制买家，非空时未匹配买家被跳过。 | `semantic classification and safety cover commerce, refusal, allowlist, and fail-closed paths` |
| AR-SEM-013 | 路由与安全 | classification / allowlist / handoff | error | 自动回复关闭或不支持的消息返回稳定 failure code，不发送消息。 | `semantic classification and safety cover commerce, refusal, allowlist, and fail-closed paths` |
| AR-SEM-014 | 路由与安全 | classification / allowlist / handoff | normal | 策略引擎按优先级、特异性和证据数量确定唯一 primary action。 | `semantic classification and safety cover commerce, refusal, allowlist, and fail-closed paths` |
| AR-SEM-015 | 路由与安全 | classification / allowlist / handoff | security | 纯敏感请求必须选择 REFUSE_SENSITIVE，缺少拒答规则时 fail closed。 | `semantic classification and safety cover commerce, refusal, allowlist, and fail-closed paths` |
| AR-SEM-016 | 路由与安全 | classification / allowlist / handoff | observability | 分类事件记录输入摘要、命中的规则、风险标签和决策。 | `semantic classification and safety cover commerce, refusal, allowlist, and fail-closed paths` |
| AR-SEM-017 | 事实与上下文 | context document / projection / media | normal | 上下文只加载当前账号、会话、商品和订单的最小必要投影。 | `semantic context and media preserve facts, scope, redaction, and multimodal input` |
| AR-SEM-018 | 事实与上下文 | context document / projection / media | security | 模型上下文不包含 accountId、conversationId、原始 attributes 等内部标识。 | `semantic context and media preserve facts, scope, redaction, and multimodal input` |
| AR-SEM-019 | 事实与上下文 | context document / projection / media | boundary | 历史消息按 maxHistory 截断且最新消息优先，待处理买家消息全部可见。 | `semantic context and media preserve facts, scope, redaction, and multimodal input` |
| AR-SEM-020 | 事实与上下文 | context document / projection / media | normal | pending buyer messages 在同一轮生成中逐条展示，不漏掉并发到达的问题。 | `semantic context and media preserve facts, scope, redaction, and multimodal input` |
| AR-SEM-021 | 事实与上下文 | context document / projection / media | normal | 买家图片被转成受限数量的 multimodal parts，商品封面图片不会误传。 | `semantic context and media preserve facts, scope, redaction, and multimodal input` |
| AR-SEM-022 | 事实与上下文 | context document / projection / media | boundary | 非法、过长和非 http(s) 媒体引用被忽略并回退文本。 | `semantic context and media preserve facts, scope, redaction, and multimodal input` |
| AR-SEM-023 | 事实与上下文 | context document / projection / media | security | 模板生成只使用已脱敏的商品和订单字段。 | `semantic context and media preserve facts, scope, redaction, and multimodal input` |
| AR-SEM-024 | 事实与上下文 | context document / projection / media | observability | context digest、事实计数与 pending count 写入 run event。 | `semantic context and media preserve facts, scope, redaction, and multimodal input` |
| AR-SEM-025 | 工具型 Agent | tool loop / search / web search | normal | 商品、订单、买家会话和店铺目录工具都能返回账号范围内事实。 | `semantic agent tools cover tool choice, argument validation, search retry, and handoff` |
| AR-SEM-026 | 工具型 Agent | tool loop / search / web search | boundary | 商品查询支持 UUID、外部数字引用和无关键词的店铺目录请求。 | `semantic agent tools cover tool choice, argument validation, search retry, and handoff` |
| AR-SEM-027 | 工具型 Agent | tool loop / search / web search | normal | 商品精确短语无结果后，Agent 可提供 core terms 触发一次受控重试。 | `semantic agent tools cover tool choice, argument validation, search retry, and handoff` |
| AR-SEM-028 | 工具型 Agent | tool loop / search / web search | security | 工具参数经过 schema 校验，未知工具和越界参数直接拒绝。 | `semantic agent tools cover tool choice, argument validation, search retry, and handoff` |
| AR-SEM-029 | 工具型 Agent | tool loop / search / web search | error | 工具读取异常停止生成，不合成未经事实支持的回复。 | `semantic agent tools cover tool choice, argument validation, search retry, and handoff` |
| AR-SEM-030 | 工具型 Agent | tool loop / search / web search | boundary | 工具循环达到上限时返回稳定 failure，不无限调用模型。 | `semantic agent tools cover tool choice, argument validation, search retry, and handoff` |
| AR-SEM-031 | 工具型 Agent | tool loop / search / web search | security | web_search 仅在本地事实不足且属于通用问题时暴露，且不向 Chat Completions 暴露。 | `semantic agent tools cover tool choice, argument validation, search retry, and handoff` |
| AR-SEM-032 | 工具型 Agent | tool loop / search / web search | normal | 结构化 final output 才能发送，非结构化文本被拒绝或转 handoff。 | `semantic agent tools cover tool choice, argument validation, search retry, and handoff` |
| AR-SEM-033 | 状态与策略 | policy / state reducer | normal | 策略版本、hash、账号范围和 immutable 约束全部验证通过后才可评估。 | `semantic policy and state cover versioning, scope, CAS, duplicate, and stale replay` |
| AR-SEM-034 | 状态与策略 | policy / state reducer | boundary | 策略缺失、过期、hash 不匹配或优先级重复时 fail closed。 | `semantic policy and state cover versioning, scope, CAS, duplicate, and stale replay` |
| AR-SEM-035 | 状态与策略 | policy / state reducer | normal | 状态 reducer 首次创建从 0 版本开始并保留默认 goal/clarification 状态。 | `semantic policy and state cover versioning, scope, CAS, duplicate, and stale replay` |
| AR-SEM-036 | 状态与策略 | policy / state reducer | normal | 合法事件只递增一次 stateVersion 并复制嵌套字段。 | `semantic policy and state cover versioning, scope, CAS, duplicate, and stale replay` |
| AR-SEM-037 | 状态与策略 | policy / state reducer | idempotency | 重复 eventId 或 idempotencyKey 返回 duplicate 且不改变状态版本。 | `semantic policy and state cover versioning, scope, CAS, duplicate, and stale replay` |
| AR-SEM-038 | 状态与策略 | policy / state reducer | boundary | 旧 sourceSequence 或旧 occurredAt 被识别为 stale_replay 并产生审计事件。 | `semantic policy and state cover versioning, scope, CAS, duplicate, and stale replay` |
| AR-SEM-039 | 状态与策略 | policy / state reducer | security | 账号或会话范围不一致时拒绝状态变更。 | `semantic policy and state cover versioning, scope, CAS, duplicate, and stale replay` |
| AR-SEM-040 | 状态与策略 | policy / state reducer | observability | 状态事件保存 sourceEventId、sourceSequence、policyVersion 和处理结果。 | `semantic policy and state cover versioning, scope, CAS, duplicate, and stale replay` |
| AR-SEM-041 | 话题与情绪 | topic/emotion gate | normal | 当前话题和中性情绪继续主目标并保留允许的 action。 | `semantic topic and emotion cover redirect, goal switch, tone, and recommendation gates` |
| AR-SEM-042 | 话题与情绪 | topic/emotion gate | normal | 邻近话题先回答安全事实，再 redirect 回当前目标。 | `semantic topic and emotion cover redirect, goal switch, tone, and recommendation gates` |
| AR-SEM-043 | 话题与情绪 | topic/emotion gate | boundary | 重复跑题且存在候选目标时切换 goal，否则只做温和 redirect。 | `semantic topic and emotion cover redirect, goal switch, tone, and recommendation gates` |
| AR-SEM-044 | 话题与情绪 | topic/emotion gate | normal | 显式新目标且事实齐全时切换目标，事实不足时只问一个问题。 | `semantic topic and emotion cover redirect, goal switch, tone, and recommendation gates` |
| AR-SEM-045 | 话题与情绪 | topic/emotion gate | security | 强负面情绪触发 acknowledge/calm，并关闭推荐与评价请求。 | `semantic topic and emotion cover redirect, goal switch, tone, and recommendation gates` |
| AR-SEM-046 | 话题与情绪 | topic/emotion gate | boundary | confused 情绪只允许 CLARIFY，不能旁路等待用户状态。 | `semantic topic and emotion cover redirect, goal switch, tone, and recommendation gates` |
| AR-SEM-047 | 话题与情绪 | topic/emotion gate | error | 缺少 gate 证据或账号范围不匹配时不使用隐式默认路由。 | `semantic topic and emotion cover redirect, goal switch, tone, and recommendation gates` |
| AR-SEM-048 | 话题与情绪 | topic/emotion gate | observability | topic.redirected、topic.switched、emotion.observed 事件带规则、证据和 digest。 | `semantic topic and emotion cover redirect, goal switch, tone, and recommendation gates` |
| AR-SEM-049 | 澄清与等待 | clarification state | normal | 每轮最多提出一个澄清问题并进入 awaiting_user。 | `semantic clarification covers one-question budget, fingerprint, TTL, resume, and exhaustion` |
| AR-SEM-050 | 澄清与等待 | clarification state | idempotency | 相同问题 fingerprint 且无新事实时不会重复提问。 | `semantic clarification covers one-question budget, fingerprint, TTL, resume, and exhaustion` |
| AR-SEM-051 | 澄清与等待 | clarification state | normal | 出现新事实后允许再次询问同一 fingerprint。 | `semantic clarification covers one-question budget, fingerprint, TTL, resume, and exhaustion` |
| AR-SEM-052 | 澄清与等待 | clarification state | boundary | 达到最大轮次仍保持 awaiting_user，不错误 handoff。 | `semantic clarification covers one-question budget, fingerprint, TTL, resume, and exhaustion` |
| AR-SEM-053 | 澄清与等待 | clarification state | boundary | TTL 未到期继续等待，TTL 到期转 unresolved 并清理 pending question。 | `semantic clarification covers one-question budget, fingerprint, TTL, resume, and exhaustion` |
| AR-SEM-054 | 澄清与等待 | clarification state | normal | 买家补齐事实后恢复原 goal 并重置 clarification 状态。 | `semantic clarification covers one-question budget, fingerprint, TTL, resume, and exhaustion` |
| AR-SEM-055 | 澄清与等待 | clarification state | normal | 显式新目标创建新 goal 和新的 clarification attempt。 | `semantic clarification covers one-question budget, fingerprint, TTL, resume, and exhaustion` |
| AR-SEM-056 | 澄清与等待 | clarification state | error | 澄清策略缺失或非法时 fail closed，不猜测下一步。 | `semantic clarification covers one-question budget, fingerprint, TTL, resume, and exhaustion` |
| AR-SEM-057 | 生命周期与推荐 | lifecycle / recommendation | normal | 未付款、已付款待发货、已收货待评价和售后阶段按事实投影。 | `semantic lifecycle and recommendation cover order stage, ambiguity, freshness, cooldown, and gating` |
| AR-SEM-058 | 生命周期与推荐 | lifecycle / recommendation | normal | 售后规则优先于普通发货规则，nextAction 来自策略而非硬编码。 | `semantic lifecycle and recommendation cover order stage, ambiguity, freshness, cooldown, and gating` |
| AR-SEM-059 | 生命周期与推荐 | lifecycle / recommendation | boundary | 多个订单同时命中时标记 ambiguous 并要求 CLARIFY。 | `semantic lifecycle and recommendation cover order stage, ambiguity, freshness, cooldown, and gating` |
| AR-SEM-060 | 生命周期与推荐 | lifecycle / recommendation | security | 跨账号订单事实被拒绝，不允许猜测或串号。 | `semantic lifecycle and recommendation cover order stage, ambiguity, freshness, cooldown, and gating` |
| AR-SEM-061 | 生命周期与推荐 | lifecycle / recommendation | normal | 推荐只返回同账号、在 freshness window 内且命中偏好的商品。 | `semantic lifecycle and recommendation cover order stage, ambiguity, freshness, cooldown, and gating` |
| AR-SEM-062 | 生命周期与推荐 | lifecycle / recommendation | boundary | 推荐结果遵守 maxItems、库存和冷却窗口。 | `semantic lifecycle and recommendation cover order stage, ambiguity, freshness, cooldown, and gating` |
| AR-SEM-063 | 生命周期与推荐 | lifecycle / recommendation | security | 负面情绪、awaiting_user、needs_followup 等状态阻断推荐。 | `semantic lifecycle and recommendation cover order stage, ambiguity, freshness, cooldown, and gating` |
| AR-SEM-064 | 生命周期与推荐 | lifecycle / recommendation | error | 生命周期或推荐策略缺失时返回显式 policy unavailable。 | `semantic lifecycle and recommendation cover order stage, ambiguity, freshness, cooldown, and gating` |
| AR-SEM-065 | 发送前审核 | pre-send review | normal | 事实支持、目标覆盖和敏感检查通过后才 APPROVE。 | `semantic pre-send review covers evidence, goal coverage, sensitive output, and handoff rules` |
| AR-SEM-066 | 发送前审核 | pre-send review | boundary | 缺少事实或目标覆盖不足时先 REVISE，再按预算转 CLARIFY。 | `semantic pre-send review covers evidence, goal coverage, sensitive output, and handoff rules` |
| AR-SEM-067 | 发送前审核 | pre-send review | security | 跨账号、过期或未来事实在发送前被拒绝。 | `semantic pre-send review covers evidence, goal coverage, sensitive output, and handoff rules` |
| AR-SEM-068 | 发送前审核 | pre-send review | security | 敏感输出未知在修订预算耗尽后 BLOCK_SENSITIVE 并走 REFUSE_SENSITIVE。 | `semantic pre-send review covers evidence, goal coverage, sensitive output, and handoff rules` |
| AR-SEM-069 | 发送前审核 | pre-send review | boundary | handoff 必须使用策略允许的 reason code 和结构化证据。 | `semantic pre-send review covers evidence, goal coverage, sensitive output, and handoff rules` |
| AR-SEM-070 | 发送前审核 | pre-send review | error | pre-send policy 缺失、版本不匹配或 objective 不一致时不创建可发送结果。 | `semantic pre-send review covers evidence, goal coverage, sensitive output, and handoff rules` |
| AR-SEM-071 | 发送前审核 | pre-send review | normal | 审核记录保留 factRefs、decision、reasonCodes 与 reviewer source。 | `semantic pre-send review covers evidence, goal coverage, sensitive output, and handoff rules` |
| AR-SEM-072 | 发送前审核 | pre-send review | idempotency | 相同 run/attempt 的审核请求不会绕过既有 decision。 | `semantic pre-send review covers evidence, goal coverage, sensitive output, and handoff rules` |
| AR-SEM-073 | 发送与出站 | send / outbox / persistence | normal | 短回复正常发送并写入 outbound AI message。 | `semantic sending covers segmentation, simulate/live, retry, outbox, and persistence` |
| AR-SEM-074 | 发送与出站 | send / outbox / persistence | boundary | 超长回复按配置切段，段序和 segmentIndex 连续。 | `semantic sending covers segmentation, simulate/live, retry, outbox, and persistence` |
| AR-SEM-075 | 发送与出站 | send / outbox / persistence | security | 人工回复出现在等待、生成或分段发送期间时取消剩余 AI 发送。 | `semantic sending covers segmentation, simulate/live, retry, outbox, and persistence` |
| AR-SEM-076 | 发送与出站 | send / outbox / persistence | normal | simulate 模式只持久化可追踪的模拟出站，不触达外部平台。 | `semantic sending covers segmentation, simulate/live, retry, outbox, and persistence` |
| AR-SEM-077 | 发送与出站 | send / outbox / persistence | normal | live sender 使用 requestId 派生稳定 external uuid。 | `semantic sending covers segmentation, simulate/live, retry, outbox, and persistence` |
| AR-SEM-078 | 发送与出站 | send / outbox / persistence | idempotency | 相同 requestId 的 outbox replay 不重复调用外部发送器。 | `semantic sending covers segmentation, simulate/live, retry, outbox, and persistence` |
| AR-SEM-079 | 发送与出站 | send / outbox / persistence | error | 已知发送失败与未知发送结果分别映射为稳定 failure code，并进入 outcome review。 | `semantic sending covers segmentation, simulate/live, retry, outbox, and persistence` |
| AR-SEM-080 | 发送与出站 | send / outbox / persistence | observability | persisted run 记录 outboundMessageId、senderOutcome、segmentCount 和 replyDigest。 | `semantic sending covers segmentation, simulate/live, retry, outbox, and persistence` |
| AR-SEM-081 | 接管与并发 | takeover window / active generation | normal | 首次接管窗口聚合窗口内的多条买家消息为一条回复。 | `semantic takeover covers aggregation, refresh, coalescing, retries, and human takeover` |
| AR-SEM-082 | 接管与并发 | takeover window / active generation | boundary | 生成开始后到达的新消息触发一次上下文刷新并重新生成。 | `semantic takeover covers aggregation, refresh, coalescing, retries, and human takeover` |
| AR-SEM-083 | 接管与并发 | takeover window / active generation | concurrency | 活跃生成期间的并发消息只由一个 leader 生成，其余请求 coalesce。 | `semantic takeover covers aggregation, refresh, coalescing, retries, and human takeover` |
| AR-SEM-084 | 接管与并发 | takeover window / active generation | concurrency | 发送阶段到达的新消息不会丢失，并在后续生成中得到覆盖。 | `semantic takeover covers aggregation, refresh, coalescing, retries, and human takeover` |
| AR-SEM-085 | 接管与并发 | takeover window / active generation | error | leader generation 失败时被 coalesce 的消息进入可重试路径。 | `semantic takeover covers aggregation, refresh, coalescing, retries, and human takeover` |
| AR-SEM-086 | 接管与并发 | takeover window / active generation | security | 人工消息在等待或生成期间出现时跳过自动回复并记录原因。 | `semantic takeover covers aggregation, refresh, coalescing, retries, and human takeover` |
| AR-SEM-087 | 接管与并发 | takeover window / active generation | idempotency | service 重建后 takeover 状态仍能保持有效，不需重新等待完整窗口。 | `semantic takeover covers aggregation, refresh, coalescing, retries, and human takeover` |
| AR-SEM-088 | 接管与并发 | takeover window / active generation | observability | takeover window、active generation 和 coalesced reason 写入 run event。 | `semantic takeover covers aggregation, refresh, coalescing, retries, and human takeover` |
| AR-SEM-089 | 结果回读 | outcome review / worker / projection | normal | 领域事实或买家确认可以将 review_pending 解析为 resolved。 | `semantic outcome review covers evidence windows, retries, CAS, reopen, and projection` |
| AR-SEM-090 | 结果回读 | outcome review / worker / projection | boundary | 证据窗口未结束时重试，窗口关闭且无证据时转 unknown。 | `semantic outcome review covers evidence windows, retries, CAS, reopen, and projection` |
| AR-SEM-091 | 结果回读 | outcome review / worker / projection | error | review worker 租约、CAS 或 policy 失败不会覆盖更新后的状态。 | `semantic outcome review covers evidence windows, retries, CAS, reopen, and projection` |
| AR-SEM-092 | 结果回读 | outcome review / worker / projection | normal | 达到最大尝试次数后 dead-letter 为 review_failed。 | `semantic outcome review covers evidence windows, retries, CAS, reopen, and projection` |
| AR-SEM-093 | 结果回读 | outcome review / worker / projection | normal | resolved 只有在 reopen window 关闭后才可 close。 | `semantic outcome review covers evidence windows, retries, CAS, reopen, and projection` |
| AR-SEM-094 | 结果回读 | outcome review / worker / projection | boundary | reopen window 内出现否认、重复问题或事实回归时转 needs_followup。 | `semantic outcome review covers evidence windows, retries, CAS, reopen, and projection` |
| AR-SEM-095 | 结果回读 | outcome review / worker / projection | normal | activity projection 将 transport、resolution、goalProgress 和 nextAction 统一映射。 | `semantic outcome review covers evidence windows, retries, CAS, reopen, and projection` |
| AR-SEM-096 | 结果回读 | outcome review / worker / projection | observability | review record 与活动列表保留可追溯的 policy/action/evidence 引用。 | `semantic outcome review covers evidence windows, retries, CAS, reopen, and projection` |
| AR-SEM-097 | 可观测性与隐私 | god view / activity / trace | security | god view 脱敏 apiKey、Authorization、inline image 和其他 secret key。 | `semantic observability covers redaction, phase ordering, identifiers, and activity scope` |
| AR-SEM-098 | 可观测性与隐私 | god view / activity / trace | normal | god view 保留买家问题、模型输出和工具摘要，便于问题定位。 | `semantic observability covers redaction, phase ordering, identifiers, and activity scope` |
| AR-SEM-099 | 可观测性与隐私 | god view / activity / trace | observability | agent trace 顺序为 started → model.request → model.response → decision。 | `semantic observability covers redaction, phase ordering, identifiers, and activity scope` |
| AR-SEM-100 | 可观测性与隐私 | god view / activity / trace | observability | 所有 agent 事件共享 runId 与 traceId。 | `semantic observability covers redaction, phase ordering, identifiers, and activity scope` |
| AR-SEM-101 | 可观测性与隐私 | god view / activity / trace | boundary | 未启用监控 flag 时不写入 trace 文件。 | `semantic observability covers redaction, phase ordering, identifiers, and activity scope` |
| AR-SEM-102 | 可观测性与隐私 | god view / activity / trace | security | activity list、detail 和 summary 强制账号范围校验。 | `semantic observability covers redaction, phase ordering, identifiers, and activity scope` |
| AR-SEM-103 | 可观测性与隐私 | god view / activity / trace | error | 非法分页、日期范围、状态和关键词参数返回结构化 validation error。 | `semantic observability covers redaction, phase ordering, identifiers, and activity scope` |
| AR-SEM-104 | 可观测性与隐私 | god view / activity / trace | observability | run detail 能关联分类、上下文、生成、发送、持久化和修复事件。 | `semantic observability covers redaction, phase ordering, identifiers, and activity scope` |
| AR-SEM-105 | 发布门禁 | release / rollback | normal | 所有必需 check PASS 且 stop metrics 未触发时 release READY。 | `semantic release gate covers checks, metrics, kill switch, and rollback` |
| AR-SEM-106 | 发布门禁 | release / rollback | boundary | 缺少任何 stop metric 时 fail closed 为 BLOCKED。 | `semantic release gate covers checks, metrics, kill switch, and rollback` |
| AR-SEM-107 | 发布门禁 | release / rollback | error | 失败 check 或 stop condition 命中时阻断发布并保留 evidence refs。 | `semantic release gate covers checks, metrics, kill switch, and rollback` |
| AR-SEM-108 | 发布门禁 | release / rollback | security | kill switch 缺失或 release policy 缺失时不允许放行。 | `semantic release gate covers checks, metrics, kill switch, and rollback` |
| AR-SEM-109 | 发布门禁 | release / rollback | normal | rollback 返回 previousPolicyVersion 并记录 kill switch evidence。 | `semantic release gate covers checks, metrics, kill switch, and rollback` |
| AR-SEM-110 | 发布门禁 | release / rollback | boundary | rollback reason 为空时拒绝回滚请求。 | `semantic release gate covers checks, metrics, kill switch, and rollback` |
| AR-SEM-111 | 发布门禁 | release / rollback | observability | release assessment 输出 failedChecks、stopReasons 和 evidenceRefs。 | `semantic release gate covers checks, metrics, kill switch, and rollback` |
| AR-SEM-112 | 发布门禁 | release / rollback | idempotency | 同一 release assessment 输入产生稳定状态和可审计结果。 | `semantic release gate covers checks, metrics, kill switch, and rollback` |
