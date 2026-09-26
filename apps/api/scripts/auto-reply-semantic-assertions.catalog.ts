export type SemanticBranch = 'normal' | 'boundary' | 'error' | 'security' | 'idempotency' | 'concurrency' | 'observability';

export interface SemanticAssertion {
  id: string;
  stage: string;
  node: string;
  branch: SemanticBranch;
  statement: string;
  testFile: string;
  testName: string;
}

export interface PublicSurface {
  module: string;
  symbols: readonly string[];
}

let nextId = 1;
function group(stage: string, node: string, testName: string, rows: readonly [SemanticBranch, string][]): SemanticAssertion[] {
  return rows.map(([branch, statement]) => ({
    id: `AR-SEM-${String(nextId++).padStart(3, '0')}`,
    stage,
    node,
    branch,
    statement,
    testFile: 'apps/api/scripts/auto-reply-semantic-assertions.test.ts',
    testName,
  }));
}

export const AUTO_REPLY_SEMANTIC_ASSERTIONS: readonly SemanticAssertion[] = [
  ...group('入站接入', 'gateway → inbox', 'semantic inbound gateway covers normal, malformed, system, duplicate, and ordering paths', [
    ['normal', '合法买家消息经过网关解析后进入本地消息与自动回复入口。'],
    ['boundary', '空正文、超长正文和缺少来源时间不会被当作有效业务事实。'],
    ['error', '损坏的 push payload 被隔离并返回结构化 quarantine reason。'],
    ['security', '卖家身份与买家身份在入库前纠正方向，卖家消息不进入买家 inbox。'],
    ['idempotency', '同一账号和外部消息引用重复到达时只落一条本地消息。'],
    ['concurrency', '同一会话的 inbox claim 按来源序列串行化，租约过期才允许回收。'],
    ['observability', '来源事件 id、来源序列、请求 id 和 trace id 在入站记录中可追踪。'],
    ['error', '未验证平台系统提醒被隔离，不创建自动回复或出站消息。'],
  ]),
  ...group('路由与安全', 'classification / allowlist / handoff', 'semantic classification and safety cover commerce, refusal, allowlist, and fail-closed paths', [
    ['normal', '价格、库存、发货和普通问候被稳定映射到对应意图。'],
    ['boundary', '文本边界、大小写、空白和未知意图回落到安全的 other/general 路由。'],
    ['security', '凭证请求与 prompt injection 进入 handoff 或拒答，不进入普通生成。'],
    ['security', 'allowlist 配置为空表示不限制买家，非空时未匹配买家被跳过。'],
    ['error', '自动回复关闭或不支持的消息返回稳定 failure code，不发送消息。'],
    ['normal', '策略引擎按优先级、特异性和证据数量确定唯一 primary action。'],
    ['security', '纯敏感请求必须选择 REFUSE_SENSITIVE，缺少拒答规则时 fail closed。'],
    ['observability', '分类事件记录输入摘要、命中的规则、风险标签和决策。'],
  ]),
  ...group('事实与上下文', 'context document / projection / media', 'semantic context and media preserve facts, scope, redaction, and multimodal input', [
    ['normal', '上下文只加载当前账号、会话、商品和订单的最小必要投影。'],
    ['security', '模型上下文不包含 accountId、conversationId、原始 attributes 等内部标识。'],
    ['boundary', '历史消息按 maxHistory 截断且最新消息优先，待处理买家消息全部可见。'],
    ['normal', 'pending buyer messages 在同一轮生成中逐条展示，不漏掉并发到达的问题。'],
    ['normal', '买家图片被转成受限数量的 multimodal parts，商品封面图片不会误传。'],
    ['boundary', '非法、过长和非 http(s) 媒体引用被忽略并回退文本。'],
    ['security', '模板生成只使用已脱敏的商品和订单字段。'],
    ['observability', 'context digest、事实计数与 pending count 写入 run event。'],
  ]),
  ...group('工具型 Agent', 'tool loop / search / web search', 'semantic agent tools cover tool choice, argument validation, search retry, and handoff', [
    ['normal', '商品、订单、买家会话和店铺目录工具都能返回账号范围内事实。'],
    ['boundary', '商品查询支持 UUID、外部数字引用和无关键词的店铺目录请求。'],
    ['normal', '商品精确短语无结果后，Agent 可提供 core terms 触发一次受控重试。'],
    ['security', '工具参数经过 schema 校验，未知工具和越界参数直接拒绝。'],
    ['error', '工具读取异常停止生成，不合成未经事实支持的回复。'],
    ['boundary', '工具循环达到上限时返回稳定 failure，不无限调用模型。'],
    ['security', 'web_search 仅在本地事实不足且属于通用问题时暴露，且不向 Chat Completions 暴露。'],
    ['normal', '结构化 final output 才能发送，非结构化文本被拒绝或转 handoff。'],
  ]),
  ...group('状态与策略', 'policy / state reducer', 'semantic policy and state cover versioning, scope, CAS, duplicate, and stale replay', [
    ['normal', '策略版本、hash、账号范围和 immutable 约束全部验证通过后才可评估。'],
    ['boundary', '策略缺失、过期、hash 不匹配或优先级重复时 fail closed。'],
    ['normal', '状态 reducer 首次创建从 0 版本开始并保留默认 goal/clarification 状态。'],
    ['normal', '合法事件只递增一次 stateVersion 并复制嵌套字段。'],
    ['idempotency', '重复 eventId 或 idempotencyKey 返回 duplicate 且不改变状态版本。'],
    ['boundary', '旧 sourceSequence 或旧 occurredAt 被识别为 stale_replay 并产生审计事件。'],
    ['security', '账号或会话范围不一致时拒绝状态变更。'],
    ['observability', '状态事件保存 sourceEventId、sourceSequence、policyVersion 和处理结果。'],
  ]),
  ...group('话题与情绪', 'topic/emotion gate', 'semantic topic and emotion cover redirect, goal switch, tone, and recommendation gates', [
    ['normal', '当前话题和中性情绪继续主目标并保留允许的 action。'],
    ['normal', '邻近话题先回答安全事实，再 redirect 回当前目标。'],
    ['boundary', '重复跑题且存在候选目标时切换 goal，否则只做温和 redirect。'],
    ['normal', '显式新目标且事实齐全时切换目标，事实不足时只问一个问题。'],
    ['security', '强负面情绪触发 acknowledge/calm，并关闭推荐与评价请求。'],
    ['boundary', 'confused 情绪只允许 CLARIFY，不能旁路等待用户状态。'],
    ['error', '缺少 gate 证据或账号范围不匹配时不使用隐式默认路由。'],
    ['observability', 'topic.redirected、topic.switched、emotion.observed 事件带规则、证据和 digest。'],
  ]),
  ...group('澄清与等待', 'clarification state', 'semantic clarification covers one-question budget, fingerprint, TTL, resume, and exhaustion', [
    ['normal', '每轮最多提出一个澄清问题并进入 awaiting_user。'],
    ['idempotency', '相同问题 fingerprint 且无新事实时不会重复提问。'],
    ['normal', '出现新事实后允许再次询问同一 fingerprint。'],
    ['boundary', '达到最大轮次仍保持 awaiting_user，不错误 handoff。'],
    ['boundary', 'TTL 未到期继续等待，TTL 到期转 unresolved 并清理 pending question。'],
    ['normal', '买家补齐事实后恢复原 goal 并重置 clarification 状态。'],
    ['normal', '显式新目标创建新 goal 和新的 clarification attempt。'],
    ['error', '澄清策略缺失或非法时 fail closed，不猜测下一步。'],
  ]),
  ...group('生命周期与推荐', 'lifecycle / recommendation', 'semantic lifecycle and recommendation cover order stage, ambiguity, freshness, cooldown, and gating', [
    ['normal', '未付款、已付款待发货、已收货待评价和售后阶段按事实投影。'],
    ['normal', '售后规则优先于普通发货规则，nextAction 来自策略而非硬编码。'],
    ['boundary', '多个订单同时命中时标记 ambiguous 并要求 CLARIFY。'],
    ['security', '跨账号订单事实被拒绝，不允许猜测或串号。'],
    ['normal', '推荐只返回同账号、在 freshness window 内且命中偏好的商品。'],
    ['boundary', '推荐结果遵守 maxItems、库存和冷却窗口。'],
    ['security', '负面情绪、awaiting_user、needs_followup 等状态阻断推荐。'],
    ['error', '生命周期或推荐策略缺失时返回显式 policy unavailable。'],
  ]),
  ...group('发送前审核', 'pre-send review', 'semantic pre-send review covers evidence, goal coverage, sensitive output, and handoff rules', [
    ['normal', '事实支持、目标覆盖和敏感检查通过后才 APPROVE。'],
    ['boundary', '缺少事实或目标覆盖不足时先 REVISE，再按预算转 CLARIFY。'],
    ['security', '跨账号、过期或未来事实在发送前被拒绝。'],
    ['security', '敏感输出未知在修订预算耗尽后 BLOCK_SENSITIVE 并走 REFUSE_SENSITIVE。'],
    ['boundary', 'handoff 必须使用策略允许的 reason code 和结构化证据。'],
    ['error', 'pre-send policy 缺失、版本不匹配或 objective 不一致时不创建可发送结果。'],
    ['normal', '审核记录保留 factRefs、decision、reasonCodes 与 reviewer source。'],
    ['idempotency', '相同 run/attempt 的审核请求不会绕过既有 decision。'],
  ]),
  ...group('发送与出站', 'send / outbox / persistence', 'semantic sending covers segmentation, simulate/live, retry, outbox, and persistence', [
    ['normal', '短回复正常发送并写入 outbound AI message。'],
    ['boundary', '超长回复按配置切段，段序和 segmentIndex 连续。'],
    ['security', '人工回复出现在等待、生成或分段发送期间时取消剩余 AI 发送。'],
    ['normal', 'simulate 模式只持久化可追踪的模拟出站，不触达外部平台。'],
    ['normal', 'live sender 使用 requestId 派生稳定 external uuid。'],
    ['idempotency', '相同 requestId 的 outbox replay 不重复调用外部发送器。'],
    ['error', '已知发送失败与未知发送结果分别映射为稳定 failure code，并进入 outcome review。'],
    ['observability', 'persisted run 记录 outboundMessageId、senderOutcome、segmentCount 和 replyDigest。'],
  ]),
  ...group('接管与并发', 'takeover window / active generation', 'semantic takeover covers aggregation, refresh, coalescing, retries, and human takeover', [
    ['normal', '首次接管窗口聚合窗口内的多条买家消息为一条回复。'],
    ['boundary', '生成开始后到达的新消息触发一次上下文刷新并重新生成。'],
    ['concurrency', '活跃生成期间的并发消息只由一个 leader 生成，其余请求 coalesce。'],
    ['concurrency', '发送阶段到达的新消息不会丢失，并在后续生成中得到覆盖。'],
    ['error', 'leader generation 失败时被 coalesce 的消息进入可重试路径。'],
    ['security', '人工消息在等待或生成期间出现时跳过自动回复并记录原因。'],
    ['idempotency', 'service 重建后 takeover 状态仍能保持有效，不需重新等待完整窗口。'],
    ['observability', 'takeover window、active generation 和 coalesced reason 写入 run event。'],
  ]),
  ...group('结果回读', 'outcome review / worker / projection', 'semantic outcome review covers evidence windows, retries, CAS, reopen, and projection', [
    ['normal', '领域事实或买家确认可以将 review_pending 解析为 resolved。'],
    ['boundary', '证据窗口未结束时重试，窗口关闭且无证据时转 unknown。'],
    ['error', 'review worker 租约、CAS 或 policy 失败不会覆盖更新后的状态。'],
    ['normal', '达到最大尝试次数后 dead-letter 为 review_failed。'],
    ['normal', 'resolved 只有在 reopen window 关闭后才可 close。'],
    ['boundary', 'reopen window 内出现否认、重复问题或事实回归时转 needs_followup。'],
    ['normal', 'activity projection 将 transport、resolution、goalProgress 和 nextAction 统一映射。'],
    ['observability', 'review record 与活动列表保留可追溯的 policy/action/evidence 引用。'],
  ]),
  ...group('可观测性与隐私', 'god view / activity / trace', 'semantic observability covers redaction, phase ordering, identifiers, and activity scope', [
    ['security', 'god view 脱敏 apiKey、Authorization、inline image 和其他 secret key。'],
    ['normal', 'god view 保留买家问题、模型输出和工具摘要，便于问题定位。'],
    ['observability', 'agent trace 顺序为 started → model.request → model.response → decision。'],
    ['observability', '所有 agent 事件共享 runId 与 traceId。'],
    ['boundary', '未启用监控 flag 时不写入 trace 文件。'],
    ['security', 'activity list、detail 和 summary 强制账号范围校验。'],
    ['error', '非法分页、日期范围、状态和关键词参数返回结构化 validation error。'],
    ['observability', 'run detail 能关联分类、上下文、生成、发送、持久化和修复事件。'],
  ]),
  ...group('发布门禁', 'release / rollback', 'semantic release gate covers checks, metrics, kill switch, and rollback', [
    ['normal', '所有必需 check PASS 且 stop metrics 未触发时 release READY。'],
    ['boundary', '缺少任何 stop metric 时 fail closed 为 BLOCKED。'],
    ['error', '失败 check 或 stop condition 命中时阻断发布并保留 evidence refs。'],
    ['security', 'kill switch 缺失或 release policy 缺失时不允许放行。'],
    ['normal', 'rollback 返回 previousPolicyVersion 并记录 kill switch evidence。'],
    ['boundary', 'rollback reason 为空时拒绝回滚请求。'],
    ['observability', 'release assessment 输出 failedChecks、stopReasons 和 evidenceRefs。'],
    ['idempotency', '同一 release assessment 输入产生稳定状态和可审计结果。'],
  ]),
] as const;

export const AUTO_REPLY_PUBLIC_SURFACES: readonly PublicSurface[] = [
  { module: 'src/auto-reply.ts', symbols: ['NoopAutoReplySender', 'ExternalAutoReplySender', 'RuleBasedIntentClassifier', 'TemplateAutoReplyGenerator', 'AutoReplyService'] },
  { module: 'src/auto-reply-agent.ts', symbols: ['AUTO_REPLY_TOOL_NAMES', 'AUTO_REPLY_AGENT_TOOLS', 'AUTO_REPLY_WEB_SEARCH_TOOL', 'AutoReplyAgentError', 'AutoReplyAgentHandoffError', 'ToolCallingAutoReplyAgent'] },
  { module: 'src/auto-reply-context-document.ts', symbols: ['formatAutoReplyContextDocument'] },
  { module: 'src/auto-reply-multimodal.ts', symbols: ['buildAutoReplyModelContent', 'hasSupportedAutoReplyMedia'] },
  { module: 'src/auto-reply-product-search.ts', symbols: ['normalizeProductSearchText', 'normalizeProductSearchTerms', 'splitProductSearchTerms', 'productSearchScore'] },
  { module: 'src/auto-reply-policy.ts', symbols: ['PolicyConfigValidationError', 'PolicyEngineError', 'computePolicyHash', 'withComputedPolicyHash', 'validatePolicyConfig', 'PolicyEngine'] },
  { module: 'src/auto-reply-state.ts', symbols: ['ConversationStateReducerError', 'ConversationStateReducer'] },
  { module: 'src/auto-reply-topic-emotion.ts', symbols: ['TopicEmotionPolicyValidationError', 'TopicEmotionEngineError', 'computeTopicEmotionPolicyHash', 'withComputedTopicEmotionPolicyHash', 'validateTopicEmotionPolicy', 'TopicEmotionEngine'] },
  { module: 'src/auto-reply-clarification.ts', symbols: ['questionFingerprint', 'ClarificationError', 'ClarificationEngine'] },
  { module: 'src/auto-reply-lifecycle.ts', symbols: ['LifecyclePolicyError', 'LifecycleEngine'] },
  { module: 'src/auto-reply-recommendation.ts', symbols: ['RecommendationPolicyError', 'RecommendationEngine'] },
  { module: 'src/auto-reply-pre-send-review.ts', symbols: ['PreSendReviewError', 'PreSendReviewEngine'] },
  { module: 'src/auto-reply-outcome-review.ts', symbols: ['OUTCOME_EVIDENCE_TYPES', 'OutcomeReviewError', 'OutcomeReviewEngine'] },
  { module: 'src/auto-reply-outbox.ts', symbols: ['AUTO_REPLY_SEND_OUTBOX_SCOPE', 'ReliableExternalAutoReplySender'] },
  { module: 'src/auto-reply-activity-projection.ts', symbols: ['projectAutoReplyRun'] },
  { module: 'src/auto-reply-release.ts', symbols: ['ReleasePolicyError', 'ReleaseGateEngine'] },
  { module: 'src/auto-reply-god-view.ts', symbols: ['createAutoReplyGodViewSink', 'sanitizeEvent'] },
  { module: 'src/xianyu-im.ts', symbols: ['parsePushPayload', 'parsePushPayloadDetailed', 'parseReadReceiptPayload', 'XianyuImClient', 'XianyuImSessionManager'] },
  { module: 'src/inbound-inbox-worker.ts', symbols: ['InboundInboxWorker'] },
];

export function assertionIds(): string[] {
  return AUTO_REPLY_SEMANTIC_ASSERTIONS.map((item) => item.id);
}
