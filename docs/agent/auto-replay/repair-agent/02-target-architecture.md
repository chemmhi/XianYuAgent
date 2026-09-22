# 目标架构与闭环

## 目标链路

Inbound Message → SignalExtractor → StateReducer → PolicyEngine → ActionPlan → Fact Tools → ResponseComposer → Pre-send Review → Send/Persist → Outcome Review → StateReducer → Next Action / Awaiting User / Resolved

原有 Intent → Plan → Act → Observe → Respond 保留为主链路；Observe 必须产出可验证的 Outcome Review，不能把发送成功当作完成。

## 模块职责

### SignalExtractor

输出候选 intent、goal、observedStageCandidate、emotion、topicRelation、ambiguity、missingInformation、confidence，附来源和版本。不得直接决定 handoff、生命周期完成或推荐资格。

### StateReducer

依据上一版状态、最新消息和领域事实生成下一版状态。使用 stateVersion 和 CAS，记录 stateBeforeDigest、stateAfterDigest、evidenceRefs、policyVersion 和迁移原因。乱序或陈旧事件只审计、不回退当前状态。

### PolicyEngine

根据结构化信号、领域事实、当前状态和版本化策略生成唯一 ActionPlan。primaryAction 必须属于 canonical ActionKind；fallbackAction 不持久化，修订通过新 ActionPlan + supersedesActionPlanId 表示。PolicyDecisionTrace 必须可回放。

### ResponseComposer

只负责把 ActionPlan 与 verifiedFacts 组织成自然语言。模型不得自行改变权限、生命周期阶段、推荐资格、handoff reason 或解决状态。

### Pre-send Review

发送前检查目标覆盖、事实存在性/新鲜度、账号/商品范围、允许动作、情绪门控、推荐资格、敏感出站边界和唯一 ActionKind。失败后最多一次有限修订；仍失败时优先澄清或继续安全帮助。

### Outcome Review

发送后异步检查外部发送结果、买家后续消息、订单/商品事实、重复追问、否定和明确确认。结论只能来自证据或人工覆盖；领域事实优先，买家确认增强，人工覆盖兜底；窗口内否定或事实回退触发 reopen。

## 状态模型

### 传输状态

generated → sending → persisted | known_failure | unknown

### 业务解决状态

review_pending → reviewing → resolved / needs_followup / unresolved / unknown / review_failed → closed

closed 只能在 resolved 且 policyConfig.resolution.reopenWindow 配置的重开窗口结束后生成；未配置时不得自动 closed。

### 澄清状态

classified(ambiguous) → clarification_planned → clarification_sent → awaiting_user → reclassify → continue_goal / switch_goal

不回复只保持 awaiting_user，TTL 后转 unresolved，不得自动 handoff；同一问题指纹不得重复澄清。

### 买家生命周期

discovery → evaluation → purchase_ready → unpaid_order → paid_pending_shipment → shipped_pending_delivery → delivered_pending_review → after_sales → completed

生命周期阶段由订单、支付、物流、商品和买家确认事实投影。模型只提供候选信号和表达内容。

## ActionKind 优先级

安全处理先于一切；关键事实缺失时 CLARIFY 优先；明确新目标时 SWITCH_GOAL 优先；负面情绪使用 ACKNOWLEDGE_CONTINUE 并关闭推荐；GUIDE_NEXT_STEP 优先于 RECOMMEND；HANDOFF 仅由白名单 reasonCode 触发；WAIT_FOR_USER 不得与 handoff 并存。

## 运行结果

一次运行必须至少区分 transportStatus、resolutionStatus、goalProgress、actionKind、nextAction 和 policyDecisionId。Agent Dynamics 继续复用既有查询入口，但新增目标、阶段、动作、情绪摘要、审核结果、证据引用、重开窗口和下一步字段。指标拆分为 transportCompletionRate、goalProgressRate、resolutionRate、clarificationRate、reopenRate、reviewRejectRate 和 handoffRate。
