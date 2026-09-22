# 数据、事件与 API 契约

## ConversationState

新增 Agent 专属 AutoReplyConversationState，不污染通用 conversations：

| 字段 | 约束 |
| --- | --- |
| stateId | 主键 |
| accountId + conversationId | 唯一作用域；同一账号同一会话只有一个当前状态 |
| stateVersion | 单调递增；更新必须带 expected version/CAS |
| activeGoalId、goalStatus | 当前目标生命周期：active/awaiting_user/resolved/needs_followup/unresolved/handoff |
| observedStage、targetStage | canonical 生命周期字段；journeyStage/buyerJourneyStage 仅作迁移别名 |
| emotionSnapshot、topicRelation | 最近一次结构化信号及来源版本 |
| pendingQuestions、clarificationRound | 澄清问题、指纹、轮次、TTL |
| recommendationState | 资格、冷却、最近候选引用 |
| awaitingUser、awaitingUserSince、awaitingUserTtl | 等待补充，不等同于解决 |
| lastMessageId、transitionAt、policyVersion | 幂等、审计和策略版本 |

orderPhase 只属于 verifiedFacts 的外部事实投影，不作为第二套内部生命周期字段。旧字段必须通过显式映射迁移，不能双写出不同语义。

### 并发与乱序

- CAS 失败返回 STATE_VERSION_CONFLICT；读取最新状态后重新 reduce，不允许静默覆盖；
- 重复消息使用 accountId + conversationId + externalMessageId 幂等键；重复 review 使用 reviewIdempotencyKey；
- 乱序事件只写入审计，不回退当前状态；按 occurredAt、source sequence 和 stateVersion 计算是否可应用；
- 陈旧回放不得覆盖新版本状态，必须产生 stale_replay_ignored 事件。

## ActionPlan 与 PolicyDecisionTrace

每个 run 必须记录 actionPlanId、唯一 `primaryAction`、safetyHandling、policyDecisionId、policyVersion、reasonCodes、stateBeforeDigest、stateAfterDigest、signalDigest、factDigest、goalCoverage、successCriteria、factRefs、nextState 和 supersedesActionPlanId。`primaryAction` 是 canonical 路由字段；`actionKind` 仅作为旧读模型兼容别名，不参与新路由。

PolicyDecisionTrace 至少包含：policyDecisionId、policyVersion、ruleId、precedenceRule、primaryAction、safetyHandling、nextState、reasonCodes、signalDigest、factDigest、accountScope、stateVersionBefore、stateVersionAfter、actionPlanId、createdAt。PolicyConfig 必须可按版本持久化、读取、比较和回滚。

### PolicyConfig schema

PolicyConfig 是可持久化、不可原地修改的 canonical 策略对象，至少包含以下字段：

| 字段 | 类型/约束 | 语义 |
| --- | --- | --- |
| configSchemaVersion | 非空字符串 | 配置结构版本；解析器按版本选择 schema，不允许隐式降级 |
| policyVersion | 不可变字符串 | 策略版本主键；同一 account scope 不得重复 |
| policyHash | canonical JSON 的 SHA-256 | 发布前重新计算并比对，内容变化必须生成新版本 |
| status | DRAFT / ACTIVE / RETIRED / ROLLBACK_TARGET | 生命周期；只有 ACTIVE 可被 PolicyEngine 读取 |
| effectiveFrom / effectiveTo | UTC 时间戳；区间左闭右开 | 生效窗口；同一 scope 的 ACTIVE 区间不得重叠 |
| publishedAt / activatedAt | UTC 时间戳 | 发布与切换审计时间 |
| previousPolicyVersion | 可空字符串 | 正常发布或回滚的父版本 |
| immutable | 必须为 true | ACTIVE 后禁止原地编辑，只能发布新版本 |
| actionPriority | ActionKind→正整数 | 值必须全局唯一，否则发布失败 |
| actionMutex | 互斥规则集合 | 明确主动作互斥关系，不允许与 priority 规则冲突 |
| precedenceRules | ruleId、predicate、primaryAction、safetyHandling、nextState、priority、specificity、requiredEvidenceCount、successCriteria、reasonCodes | 候选动作和确定性 tie-break 的唯一来源；字段名必须与 03 保持一致 |
| clarification | maxQuestionsPerTurn=1、maxRounds 为 1–3 整数、awaitingUserTtlSeconds 为正整数 | 澄清预算和等待窗口，无默认硬编码 |
| handoff | allowedReasonCodes、factUnavailable、policyEscalationRegistry | handoff 白名单及结构化证据阈值 |
| resolution | reopenWindowSeconds 为正整数、reopenEvidenceTypes、closeRequiresWindow=true | 重开窗口和唯一关闭前置条件 |
| review | leaseSeconds、maxAttempts 为正整数、backoffSeconds 为正整数序列 | worker claim、重试和退避参数 |
| killSwitchRegistryRef | 可空配置引用 | 仅允许关联已登记的停止开关，不能覆盖审计和脱敏规则 |

`handoff.factUnavailable` 必须包含 `minAttempts`、`windowSeconds`、`deadlineSeconds`、`requiredSourceIds` 和 `requiredErrorCodes`；`policyEscalationRegistry` 必须包含 `registryVersion`、`allowedRuleIds`、`conditions`、`owner`、`effectiveFrom` 和 `effectiveTo`。`killSwitchRegistryRef` 指向的 registry 必须为版本化、可审计配置。

发布校验必须拒绝：缺少必填字段、未知 ActionKind、重复/并列 actionPriority、ruleId 冲突、互斥图自相矛盾、precedenceRules 缺少输出字段、effective 时间重叠、`policyHash` 不匹配、`reopenEvidenceTypes` 含未知枚举、`closeRequiresWindow=false`、或 handoff 证据门槛缺字段。激活和回滚都必须是单次原子指针切换，并记录 `policyVersionBefore/After`；失败时保持原 ACTIVE 版本。缺少 ACTIVE PolicyConfig 时不生成业务 ActionPlan、不发送消息，只记录 `POLICY_CONFIG_UNAVAILABLE`。

## ReviewRecord

至少包含：reviewId、accountId、conversationId、runId、goalId、stateId、reviewType、decision、resolutionStatus、reasonCodes、evidenceRefs、evidenceTypes、evidenceWindowStart、evidenceWindowEnd、reviewerSource、attempt、claimKey、leaseOwner、leaseExpiresAt、idempotencyKey、reviewedAt、nextReviewAt、nextAction、overrideBy、overrideRejected、expectedStateVersion、supersedesReviewId、deadLetteredAt。

resolutionStatus 枚举：review_pending、reviewing、resolved、needs_followup、unresolved、unknown、review_failed、closed。

goalStatus 表示当前目标是否继续推进；resolutionStatus 表示该目标对应业务问题的审核结果，二者不得互相替代。

证据优先级：领域事实满足成功标准 > 买家明确确认 > 有审计的人工覆盖。发送成功、买家已读和模型自评不能单独成为 resolved 证据。重开窗口必须由 `policyConfig.resolution.reopenWindowSeconds` 提供，使用 UTC server clock；未配置或未结束时不能自动 `closed`。canonical evidenceTypes 包括 DOMAIN_FACT_SATISFIED、BUYER_CONFIRMED、HUMAN_OVERRIDE、BUYER_DENIED、REPEAT_QUESTION、FACT_REGRESSION、SENDER_PERSISTED、BUYER_READ、MODEL_SELF_ASSESSMENT。

其中 `SENDER_PERSISTED`、`BUYER_READ` 和 `MODEL_SELF_ASSESSMENT` 是 non-resolving evidence，只能补充审计上下文，不能单独或组合替代领域事实、买家明确确认或人工覆盖。

状态转换必须满足以下唯一性：`review_pending → reviewing → resolved | needs_followup | unresolved | unknown | review_failed`；只有 `resolved → closed` 合法，且仅在重开窗口结束后执行。`review_failed` 只能由人工复核或显式重试任务回到 `review_pending`，不得直接 `closed`；`needs_followup`、`unresolved` 和 `unknown` 必须生成新的 ActionPlan 或等待新证据。ReviewRecord 是审核结果的 authoritative source；run/state 上的 resolutionStatus 只能在同一事务中作为投影更新，并携带同一 `reviewId + expectedStateVersion`，不得各自独立写入。

### Outcome Review worker contract

claim 必须原子执行：仅当 `resolutionStatus=review_pending` 且 `leaseExpiresAt` 为空或早于当前 UTC server clock，并且 `expectedStateVersion` 等于当前 `stateVersion` 时，才能通过条件更新写入 `claimKey`、`leaseOwner`、`leaseExpiresAt=now+leaseSeconds` 和 `attempt=attempt+1`。条件更新返回 0 行即视为抢占失败，不得覆盖已有 claim。续租只能由当前 `leaseOwner + claimKey` 在 lease 过半前完成；过期任务可被新 worker 抢占并生成 `review.claim_expired` 审计事件。

decision 枚举为 `RESOLVED`、`NEEDS_FOLLOWUP`、`UNRESOLVED`、`NO_EVIDENCE`、`RETRY`、`FAILED`；映射为 `resolved`、`needs_followup`、`unresolved`、`review_pending`、`review_pending`、`review_failed`。`NO_EVIDENCE` 在 evidence window 未结束时保持 `review_pending` 并设置 `nextReviewAt`，窗口结束仍无证据时转 `unknown`；不得直接标记 resolved。CAS 冲突必须重新读取当前状态和 evidenceVersion 后按退避重试，不得覆盖新状态；`RETRY` 使用 `backoffSeconds[attempt]` 并回到 `review_pending + nextReviewAt`，超过 `maxAttempts` 后写入 `review_failed`、`deadLetteredAt` 和死信事件。任何完成、失败、重试和死信写入都必须以 `idempotencyKey` 幂等。

原始敏感 Prompt、Cookie、API Key、Token、密码、验证码、系统提示词、管理员凭证及等价秘密不得进入可见审计正文、日志、trace、metrics、备份、导出或重试 payload。

## 事件

goal.updated、journey.stage_changed、topic.redirected、emotion.observed、clarification.requested、clarification.awaiting_user、clarification.expired、clarification.exhausted、recommendation.offered、review.started、review.claim_expired、review.retry_scheduled、review.cas_conflict、review.completed、review.failed、review.dead_lettered、resolution.updated、resolution.reopened、handoff.requested、stale_replay_ignored。

事件必须带 accountId、conversationId、runId、stateVersion、policyVersion、occurredAt、sourceEventId、sourceSequence、idempotencyKey 和脱敏证据摘要，支持幂等写入和回放。`sourceEventId` 在同一 accountId + conversationId 下唯一；`sourceSequence` 为同一账号/会话事件流内单调递增整数，缺失时由事件接收器以事务序列生成并保留 `sourceSequenceGenerated=true`，不能静默设为 0。回放按 sourceSequence 优先、occurredAt 次之，遇到 stateVersion 不匹配必须写入 `stale_replay_ignored`。

## 查询契约

现有 Agent Dynamics API 继续作为读取面：

- 摘要返回 transport completion、goal progress、resolution、clarification、reopen、review reject 和 handoff 拆分指标；
- 列表返回 transportStatus、resolutionStatus、activeGoal、observedStage、targetStage、primaryAction 和 nextAction；旧数据另返回 legacyActionKind、legacyTransportStatus 和 legacyHandoffReason；
- 详情返回状态迁移、PolicyDecisionTrace、审核决定、结构化原因、事实引用、重开窗口和人工覆盖结果；
- 不返回敏感原文；所有接口继续要求账号 scope、权限校验、稳定分页、空态/失败态和脱敏。

## 兼容与迁移

- 旧 persisted 只映射为 transportStatus=persisted；缺少新字段时 actionKind 不填，另存 legacyActionKind=UNKNOWN_LEGACY，resolutionStatus=review_pending 或 unknown；
- 旧 handoff 仅在兼容读取和展示时映射为 HANDOFF + legacyHandoffReason=LEGACY_UNCLASSIFIED，不能参与新路由、不能计入合法白名单 handoff 统计，也不能作为新证据；
- 旧 generated、simulated、skipped、failed 的 run 只在 read model 映射为 legacyTransportStatus=generated|simulated|skipped|failed，resolutionStatus=unknown，不反推新 ActionKind；旧 persisted 且 `senderOutcome=known_success` 时 resolutionStatus=review_pending，`senderOutcome=known_failure|unknown|simulated` 或缺失时为 unknown；旧 handoff 统一映射 `legacyHandoffReason=LEGACY_UNCLASSIFIED`，resolutionStatus=unknown；
- 新字段采用兼容读写，迁移可重复执行，旧数据不强行回写为 resolved；
- 状态更新使用 CAS，重复消息、重复 review、worker 重试必须幂等；
- 发送未知、审核失败、人工覆盖、重开和陈旧回放都保留历史事件，不删除或覆盖原发送结果。
