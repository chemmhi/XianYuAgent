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

每个 run 必须记录 actionPlanId、唯一 primaryAction、safetyHandling、policyDecisionId、policyVersion、reasonCodes、stateBeforeDigest、stateAfterDigest、signalDigest、factDigest、goalCoverage、successCriteria、factRefs 和 supersedesActionPlanId。

PolicyDecisionTrace 至少包含：policyDecisionId、policyVersion、ruleId、precedenceRule、actionKind、reasonCodes、signalDigest、factDigest、accountScope、stateVersionBefore、stateVersionAfter、actionPlanId、createdAt。PolicyConfig 必须可按版本持久化、读取、比较和回滚。

## ReviewRecord

至少包含：reviewId、reviewType、decision、resolutionStatus、reasonCodes、evidenceRefs、evidenceTypes、evidenceWindowStart、evidenceWindowEnd、reviewerSource、attempt、claimKey、leaseOwner、leaseExpiresAt、idempotencyKey、reviewedAt、nextReviewAt、nextAction、overrideBy、overrideRejected、expectedStateVersion、supersedesReviewId。

resolutionStatus 枚举：review_pending、reviewing、resolved、needs_followup、unresolved、unknown、review_failed、closed。

goalStatus 表示当前目标是否继续推进；resolutionStatus 表示该目标对应业务问题的审核结果，二者不得互相替代。

证据优先级：领域事实满足成功标准 > 买家明确确认 > 有审计的人工覆盖。发送成功、买家已读和模型自评不能单独成为 resolved 证据。重开窗口必须由 policyConfig.resolution.reopenWindow 提供；未配置时不能自动 closed。

原始敏感 Prompt、Cookie、API Key、Token、密码、验证码、系统提示词、管理员凭证及等价秘密不得进入可见审计正文、日志、trace、metrics、备份、导出或重试 payload。

## 事件

goal.updated、journey.stage_changed、topic.redirected、emotion.observed、clarification.requested、clarification.awaiting_user、clarification.expired、recommendation.offered、review.started、review.completed、resolution.updated、resolution.reopened、handoff.requested、stale_replay_ignored。

事件必须带 accountId、conversationId、runId、stateVersion、policyVersion、occurredAt、idempotencyKey 和脱敏证据摘要，支持幂等写入和回放。

## 查询契约

现有 Agent Dynamics API 继续作为读取面：

- 摘要返回 transport completion、goal progress、resolution、clarification、reopen、review reject 和 handoff 拆分指标；
- 列表返回 transportStatus、resolutionStatus、activeGoal、observedStage、targetStage、actionKind 和 nextAction；
- 详情返回状态迁移、PolicyDecisionTrace、审核决定、结构化原因、事实引用、重开窗口和人工覆盖结果；
- 不返回敏感原文；所有接口继续要求账号 scope、权限校验、稳定分页、空态/失败态和脱敏。

## 兼容与迁移

- 旧 persisted 只映射为 transportStatus=persisted；缺少新字段时 actionKind=UNKNOWN_LEGACY、resolutionStatus=review_pending 或 unknown；
- 旧 handoff 仅在兼容读取和展示时映射为 HANDOFF + LEGACY_UNCLASSIFIED，不能参与新路由、不能计入合法白名单 handoff 统计，也不能作为新证据；
- 新字段采用兼容读写，迁移可重复执行，旧数据不强行回写为 resolved；
- 状态更新使用 CAS，重复消息、重复 review、worker 重试必须幂等；
- 发送未知、审核失败、人工覆盖、重开和陈旧回放都保留历史事件，不删除或覆盖原发送结果。
