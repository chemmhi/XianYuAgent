# 数据、事件与 API 契约

## 专属状态实体

新增 Agent 专属 AutoReplyConversationState，不污染通用 conversations：activeGoal、goalStatus、journeyStage、orderPhase、emotionSnapshot、topicRelation、pendingQuestions、recommendationState、awaitingUser、version、lastMessageId、transitionAt。

每个 auto_reply_run 记录 stateBeforeDigest、stateAfterDigest、actionPlanDigest、policyVersion、goalCoverage、factRefs、topicRelation、emotionSummary、recommendationRefs、transportStatus、resolutionStatus。

## ReviewRecord

至少包含 reviewType、decision、reasonCodes、evidenceRefs、reviewerSource、attempt、leaseOwner、reviewedAt、nextAction、overrideBy。reviewType 至少包括 pre_send 与 outcome；原始敏感 Prompt、Cookie、API Key、Token 和密码不得进入可见审计正文。

## 事件

goal.updated、journey.stage_changed、topic.redirected、emotion.observed、clarification.requested、recommendation.offered、review.started、review.completed、resolution.updated、handoff.requested。

事件必须带 accountId、conversationId、runId、stateVersion、policyVersion、occurredAt 和脱敏证据摘要，支持幂等写入和回放。

## 查询契约

现有 Agent Dynamics API 继续作为读取面：摘要返回传输完成、目标推进、解决率、澄清率和审核失败等拆分指标；列表返回 transportStatus、resolutionStatus、activeGoal、journeyStage 和 nextAction；详情返回状态迁移、审核决定、结构化原因、事实引用和人工覆盖，不返回敏感原文。

所有接口继续要求账号 scope、权限校验、稳定分页、空态/失败态和脱敏。

## 兼容与迁移

- 旧 persisted 数据只映射为传输成功；resolution 缺失时显示 review_pending 或 unknown；
- 新字段采用兼容读写，迁移可重复执行，旧数据不强行回写为 resolved；
- 状态更新使用乐观锁，重复消息、重复 review、worker 重试必须幂等；
- 发送未知、审核失败和人工覆盖都保留历史事件，不删除或覆盖原发送结果。
