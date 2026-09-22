# 目标架构与闭环

## 目标链路

Inbound Message → SignalExtractor → StateReducer → PolicyEngine → ActionPlan → Fact Tools → ResponseComposer → Pre-send Review → Send/Persist → Outcome Review → StateReducer → Next Action / Awaiting User / Resolved

原有 Intent → Plan → Act → Observe → Respond 保留为主链路；新增节点的职责是让 Observe 产出可验证结果，而不是把发送成功当作完成。

## 模块职责

### SignalExtractor

输出候选 intent、goal、buyerJourneyStage、emotion、topicRelation、ambiguity、missingInformation、confidence，附来源和版本。不得直接决定 handoff、生命周期完成或推荐资格。

### StateReducer

依据上一版状态、最新消息和领域事实生成下一版状态。使用版本号和乐观锁，记录 stateBeforeDigest、stateAfterDigest、evidenceRefs、policyVersion 和迁移原因。

### PolicyEngine

根据结构化信号、领域事实、当前状态和版本化策略生成唯一 ActionPlan。路由集中于此，禁止在分类器、Prompt 或发送层重复实现业务分支。

### ResponseComposer

只负责把 ActionPlan 与 verifiedFacts 组织成自然语言。模型不得自行改变权限、生命周期阶段、推荐资格或解决状态。

### Pre-send Review

发送前检查目标覆盖、事实存在性/新鲜度、账号/商品范围、允许动作、情绪门控、推荐资格和敏感出站边界。失败后最多一次有限修订；仍失败时优先澄清或继续提供安全帮助。

### Outcome Review

发送后异步检查外部发送结果、买家后续消息、订单/商品事实、重复追问、否定和明确确认。结果只能来自证据或人工覆盖，不能由 persisted 推断。

## 状态模型

### 传输状态

generated → sending → persisted | known_failure | unknown

### 业务解决状态

review_pending → reviewing → resolved / needs_followup / unresolved / review_failed

### 澄清状态

classified(ambiguous) → clarification_planned → clarification_sent → awaiting_user → reclassify → continue_goal / switch_goal / handoff

### 买家生命周期

discovery → evaluation → comparison → purchase_ready → order_support → after_sales → closed

生命周期阶段由订单/商品事实投影，模型只提供候选意图和表达内容。

## 运行结果

一次运行必须至少区分 transportStatus、resolutionStatus、goalProgress 和 nextAction。Agent Dynamics 继续复用既有查询入口，但新增目标、阶段、动作、情绪摘要、审核结果、证据引用和下一步字段。指标拆分为 transportCompletionRate、goalProgressRate、resolutionRate、clarificationRate、reopenRate 和 reviewRejectRate。
