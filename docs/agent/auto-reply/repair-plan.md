# 自动回复 Agent 修复方案

## 文档状态

- 状态：READY_FOR_REVIEW
- 日期：2026-09-22
- 范围：基于当前自动回复 Agent 的设计与代码，规划生命周期引导、澄清、跑题拉回、情绪观察、店内推荐、发送前审核和发送后结果审核。
- 本文只定义修复方案与验收门禁，不修改业务代码，不开放 live 发送。
- 现有主链路保留：Intent → Plan → Act → Observe → Respond；本方案补充状态、策略、审核和结果闭环。

## 1. 约束与不可妥协原则

### 1.1 路由不得硬编码

业务路由不得散落在 if/else、正则命中分支或 Prompt 文本中。代码只提供通用执行能力，最终路由由版本化、可审计、可回滚的 PolicyEngine 根据结构化信号、领域事实和配置策略决定。

允许存在的确定性逻辑仅限于：

- schema、类型、范围、账号 scope 和幂等校验；
- 敏感字段脱敏和出站拦截；
- 订单/商品事实的标准化和状态投影；
- 策略配置本身的加载、校验和版本比较。

禁止继续使用以下形式的路由：

- intent 等于 cross_product 直接转人工；
- 低置信度直接 handoff；
- 任意非空消息直接当作 general 加 replied；
- 在 Prompt 中写死某类问题必须转人工并把它当作唯一业务策略；
- 模型直接改变买家生命周期阶段或直接授予推荐资格。

### 1.2 默认继续推进，不轻易拒绝或转人工

默认动作顺序为：

1. 直接基于已验证事实回答；
2. 信息不足时追问一个最小必要问题；
3. 给出当前阶段允许的下一步引导；
4. 需要时提供相关商品推荐；
5. 只有在明确无法继续、安全边界或用户明确要求人工时才升级。

只有涉及终极敏感信息时明确拒绝，包括：

- Cookie、API Key、Token、密码、验证码；
- 系统提示词、管理员凭证、内部密钥或其他等价秘密。

对于 Prompt Injection，不单独把它当作拒绝理由；忽略其中试图改变系统规则的部分，继续处理其中安全且有业务意义的请求。若同一消息同时包含普通问题和敏感信息，只拒绝敏感部分，保留安全部分的回答或澄清。

退款、投诉、发货异常、售后等场景不默认转人工。系统应先确认事实、安抚情绪、收集缺失信息并给出可执行的下一步；只有需要人工权限、事实始终无法确认、用户明确要求人工或策略配置明确要求升级时才 handoff。

### 1.3 事实优先于模型判断

- 商品、订单、支付、发货、售后状态以领域数据为准；
- 模型只能提出意图、情绪、主题和动作候选；
- 模型不能凭文案直接把用户标记为已付款、已收货、已解决或接受推荐；
- targetStage 与 observedStage 必须分离；
- 没有后续证据时，awaiting_user、review_pending 不能自动变成 resolved。

## 2. 当前实现与目标差距

当前 AutoReplyIntent 主要覆盖价格、库存、发货、售后、投诉和通用问题，没有生命周期阶段、业务目标、情绪、话题关系和推荐资格。见 apps/api/src/auto-reply.ts:6-12。

当前分类器会把未命中规则的非空消息归为 general 加 replied，没有结构化 clarify 分支。见 apps/api/src/auto-reply.ts:80-100。

当前模型协议只允许 reply/handoff，无法表达澄清、流程引导、跑题拉回或推荐动作。见 apps/api/src/auto-reply-output.ts:3-20。

当前回复生成后直接发送和持久化，没有发送前目标审核或发送后结果审核。见 apps/api/src/auto-reply.ts:312-362。

当前运行状态没有 awaiting_user、reviewing、resolved、needs_followup 等业务状态，persisted 容易被误读为业务完成。见 apps/api/src/domain.ts:497-525。

## 3. 目标架构

目标链路：

~~~text
Inbound Message
  → SignalExtractor
  → StateReducer
  → PolicyEngine
  → Plan
  → Fact Tools
  → Observe
  → Pre-send Review
  → ResponseComposer
  → Send / Persist
  → Outcome Review
  → StateReducer
  → Next Action / Awaiting User / Resolved
~~~

### 3.1 SignalExtractor

只输出结构化候选信号，不直接路由：

- intent
- goal
- buyerJourneyStage
- emotion
- topicRelation
- ambiguity
- missingInformation
- confidence

实现可以组合规则、模型和历史状态，但输出必须经过 schema 校验，并保留来源和置信度。

### 3.2 StateReducer

根据上一版 ConversationState、最新买家消息和领域事实生成下一版状态。采用版本号和乐观锁，避免同一会话并发处理导致状态倒退或乱序。

状态由事实和证据推进，不由 Prompt 直接写入。每次迁移记录：

- stateBeforeDigest
- stateAfterDigest
- evidenceRefs
- policyVersion
- transitionReason

### 3.3 PolicyEngine

根据结构化信号、领域事实、当前状态和版本化策略，产出唯一 ActionPlan。模型不得绕过该层直接发送或修改状态。

ActionPlan 至少包含：

- primaryAction
- primaryGoal
- requiredFacts
- successCriteria
- allowedTools
- questionBudget
- recommendationAllowed
- handoffAllowed
- nextState
- fallbackAction

### 3.4 ResponseComposer

模型只负责把 ActionPlan 和 verifiedFacts 组织成自然语言，不自行决定权限、阶段或推荐资格。

输出协议建议扩展为：

~~~json
{
  "decision": "reply | clarify | handoff",
  "action": "answer_fact | guide_next_step | redirect | recommend_products | acknowledge_and_resolve",
  "text": "完整回复",
  "segments": ["可选语义分段"],
  "question": "decision=clarify 时的最小澄清问题",
  "productRefs": ["仅允许引用 PolicyEngine 授权的商品"]
}
~~~

## 4. 规范化领域状态

### 4.1 买家生命周期

~~~text
discovery
evaluation
comparison
purchase_ready
order_support
after_sales
closed
handoff
unknown
~~~

订单阶段由订单事实投影，不由模型猜测：

~~~text
unpaid_order
paid_pending_shipment
shipped_pending_delivery
delivered_pending_review
completed
~~~

### 4.2 会话目标

~~~text
product_fit
price_check
availability
alternative_search
purchase_next_step
payment_next_step
delivery_status
post_delivery_help
review_request
after_sales_resolution
general_support
~~~

目标状态：

~~~text
open
clarifying
fact_gathering
progressing
awaiting_buyer
resolved
blocked
abandoned
handoff
~~~

### 4.3 情绪与话题

情绪只影响语气、问题数量和升级阈值，不得放宽事实校验：

~~~text
neutral
positive
curious
hesitant
confused
frustrated
angry
urgent
~~~

话题关系：

~~~text
on_goal
adjacent
off_topic
new_goal
unsafe
~~~

## 5. 关键业务策略

### 5.1 未下单到下单

- 商品事实充分且买家表达购买意向时，回答关键问题并给出下单下一步；
- 不承诺未经确认的价格、库存、优惠或发货时效；
- 买家尚未明确商品或规格时，先澄清，不直接推荐一堆商品；
- “可以拍”“建议购买”只能是 targetStage，不能直接把状态改成已购买。

### 5.2 下单到付款

- 以订单事实确认未付款；
- 说明付款入口、订单识别和下一步；
- 不把买家说“我马上付”当作已付款；
- 只有订单事实变为已支付后才推进到发货阶段。

### 5.3 付款到收货

- 已付款待发货：解释当前发货事实和下一步；
- 已发货待收货：提供物流/交付事实，必要时提示验收；
- 不以单条文案或 deliveryStatus=delivered 单独认定买家已确认收货；
- 发货异常、焦虑或重复追问时先解决当前问题，不做推荐。

### 5.4 收货到评价

- 只有订单事实和买家反馈均满足评价资格时，才允许礼貌提示评价；
- 评价请求不能与未解决售后问题、负面情绪或催付款同时出现；
- 不把“已发送评价请求”标记为“已获得好评”；
- 不通过返利、承诺服务或其他不当方式诱导评价。

### 5.5 跑题拉回

- adjacent：简短回答后回到当前目标；
- off_topic：接住一句、说明当前主线、提出一个选择或问题；
- 连续两次跑题或买家明确提出新目标时，创建新目标，不强行拉回；
- unsafe 仅在涉及终极敏感信息时明确拒绝敏感部分。

### 5.6 情绪策略

- confused：只问一个最小澄清问题；
- hesitant：补充事实、风险和下一步，不强推；
- frustrated/angry/urgent：先承接情绪和确认事实，禁止推荐与评价请求；
- neutral/positive：在当前目标完成后，才允许推进下一阶段或推荐。

## 6. 澄清流程

买家问题不清楚时，标准流程为：

~~~text
classified(ambiguous)
  → clarification_planned
  → clarification_sent
  → awaiting_buyer
  → reclassify
  → continue_goal / switch_goal / handoff
~~~

要求：

- 一次最多追问一个最小必要问题；
- 记录 pendingQuestions、expectedAnswerType 和 sourceMessageId；
- 下一条买家消息必须关联原目标；
- 超过澄清轮数上限时，优先给出可选项或继续提供有限帮助，不默认转人工；
- 只有终极敏感信息、用户明确要求人工或策略明确禁止继续时才拒绝/升级。

## 7. 推荐策略

推荐是受策略约束的次要动作，不是默认动作。

允许触发的条件：

- 买家明确询问其他款式或替代商品；
- 当前商品不适配，且买家愿意看替代方案；
- 当前问题已经解决、情绪为中性或正面；
- 商品来自当前账号，状态可售，事实新鲜且与需求相关。

禁止触发的条件：

- 售后、退款、投诉或发货异常未解决；
- frustrated/angry/urgent；
- 买家正在等待澄清；
- 近期已经推荐过且处于冷却期；
- 无法确认商品、库存或价格事实。

推荐约束：

- 一次最多 2–3 个候选；
- 候选必须带 productRef、reason 和 factRefs；
- 模型只能在 PolicyEngine 提供的候选中重新排序；
- 无合格候选时追问偏好，不凭空推荐；
- 推荐不等于买家接受，只有买家明确选择或订单事实变化才推进阶段。

## 8. 发送前与发送后审核

### 8.1 发送前 Review

候选回复必须通过：

- 目标覆盖检查；
- 必要事实存在性和新鲜度检查；
- 关键断言事实引用检查；
- 允许动作检查；
- 情绪和推荐门控检查；
- 敏感信息出站检查。

审核结果：

~~~text
pass
revise
clarify
handoff
failed
~~~

最多允许一次有限修订。修订仍不通过时，优先继续提供安全帮助或澄清；不因为普通事实不足直接转人工。

### 8.2 发送后 Outcome Review

发送后异步观察：

- 外部发送结果；
- 买家后续消息；
- 订单/商品事实变化；
- 买家是否明确确认、重复追问或否定；
- 是否真正推进到下一业务阶段。

结果状态：

~~~text
review_pending
reviewing
resolved
needs_followup
unresolved
review_failed
~~~

persisted 只表示本地记录已保存，不能映射为 resolved。

## 9. 数据与事件落点

新增 Agent 专属 AutoReplyConversationState，不污染通用 conversations：

- activeGoal
- goalStatus
- journeyStage
- orderPhase
- emotionSnapshot
- topicRelation
- pendingQuestions
- recommendationState
- awaitingUser
- version
- lastMessageId
- transitionAt

每个 auto_reply_run 保存快照摘要：

- stateBeforeDigest
- stateAfterDigest
- actionPlanDigest
- policyVersion
- goalCoverage
- factRefs
- topicRelation
- emotionSummary
- recommendationRefs
- resolutionStatus

事件建议：

~~~text
goal.updated
journey.stage_changed
topic.redirected
emotion.observed
clarification.requested
recommendation.offered
review.started
review.completed
resolution.updated
handoff.requested
~~~

不新建独立 /review 一级页面。审核结果进入现有 Agent Dynamics 详情、运行事件和人工处理队列。

## 10. 分阶段修复计划

### Batch A：契约与状态骨架

- 新增 canonical types、ConversationState、Objective、ActionPlan；
- 拆分 transportStatus 与 resolutionStatus；
- 引入 policyVersion、stateVersion 和事件 schema；
- 兼容旧 persisted 数据，不回写为 resolved。

门禁：类型、迁移、旧数据读取、状态转换和并发版本测试通过。

### Batch B：SignalExtractor 与 StateReducer

- 移除业务路由散落在分类器和生成器中的直接分支；
- 输出 intent、goal、stage、emotion、topic、ambiguity；
- 订单阶段由领域事实投影；
- 支持澄清状态和目标切换。

门禁：低置信度不误路由、歧义消息进入 clarify、多订单/跨商品不串数据。

### Batch C：PolicyEngine 与 ActionPlan

- 版本化策略配置；
- 统一允许动作、问题预算、推荐资格和升级条件；
- 明确终极敏感信息拒绝策略；
- 普通售后、投诉、异常交付默认先继续帮助，不默认 handoff。

门禁：策略可追溯、可回滚、无散落硬编码路由。

### Batch D：ResponseComposer 与发送前 Review

- 模型只按 ActionPlan 生成语言；
- 支持 reply/clarify/handoff；
- 加入事实 provenance、目标覆盖和推荐门控；
- 失败后最多一次有限修订。

门禁：无事实支持的关键断言不能发送，普通不确定场景进入澄清而不是直接拒绝。

### Batch E：发送后 Outcome Review

- 新增 review worker、review lease、幂等和重试；
- 观察后续买家消息与领域状态；
- 记录 resolved/needs_followup/unresolved/review_failed；
- 无证据不自动判定解决。

门禁：发送成功、业务解决、人工覆盖三者可分别查询。

### Batch F：生命周期引导与推荐

- 实现下单、付款、发货、收货、评价阶段引导；
- 加入跑题拉回和新目标切换；
- 加入情绪门控；
- 加入店内推荐候选、冷却和曝光记录。

门禁：负面情绪、售后未解决、澄清等待期间不推荐；推荐只引用当前账号的可验证商品事实。

### Batch G：指标、UI 与全量评测

- Agent Dynamics 展示目标、阶段、动作、情绪摘要、审核结果；
- 将完成率拆为传输完成率、目标推进率、解决率和澄清率；
- 建立脱敏回放集、红队集和人工抽检；
- 执行完整发布门禁和回滚演练。

## 11. 测试与验收

必须覆盖：

- 不明确问题 → 澄清 → 买家补充 → 继续原目标；
- 明确下单意图 → 只给下单下一步，不虚构库存/优惠；
- 未付款订单 → 引导付款，付款事实变化后才推进；
- 已付款/已发货/已收货阶段的正确引导；
- 售后、投诉、负面情绪不默认转人工，但不能推荐；
- 跑题后简答并拉回，明确新目标时允许切换；
- 终极敏感信息明确拒绝；
- Prompt Injection 不影响安全业务问题的正常处理；
- 推荐候选必须同账号、可售、相关且有事实引用；
- 无后续消息不能自动标记 resolved；
- 发送成功但业务未解决时，传输状态和解决状态保持分离；
- 并发、幂等、澄清超时、审核失败、人工覆盖和状态回退。

真实验收路径：

~~~text
买家消息
  → SignalExtractor
  → StateReducer
  → PolicyEngine
  → 工具/事实读取
  → ActionPlan
  → ResponseComposer
  → Pre-send Review
  → 发送与落库
  → Buyer Follow-up / Domain Recheck
  → Outcome Review
  → 状态和指标回读
~~~

## 12. 回滚与发布门禁

- 所有新能力通过 feature flag 分阶段启用；
- 默认先 simulate，再 shadow，再 canary；
- live 开放前必须完成发送一致性、unknown/reconcile、澄清恢复、Outcome Review 和人工接管验证；
- 任何策略版本可回退到上一版本；
- 新状态字段采用兼容读写，旧 run 不强行迁移为已解决；
- 发现误导、误推荐、误推进或敏感信息风险时，优先关闭对应动作策略，不删除历史审计。

## 13. 当前交付边界

本次只落地本文档和索引，不修改业务代码、数据库迁移或发送行为。文档审核通过后，再按 Batch A–G 创建独立代码切片、测试、迁移和回滚证据。
