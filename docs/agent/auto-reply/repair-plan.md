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

## 13. 阶段门禁与纵向切片

本修复遵循复杂全栈交付流程，阶段严格串行，切片小步纵向交付。每个切片都必须同时明确数据库、后端、API、前端可见结果、测试、文档、回滚和证据，不允许先堆完整后统一验证。

### 13.1 阶段状态

阶段状态只允许：

~~~text
PENDING → IN_PROGRESS → PASS
                       ├→ FAIL
                       └→ BLOCKED
~~~

只有当前阶段所有适用门禁和必需评审均为 PASS，才能进入下一阶段。FAIL 必须修复后重新验证；BLOCKED 必须记录阻塞原因、影响范围、替代证据和解除条件。

### 13.2 阶段映射

| 阶段 | 本修复产物 | 进入条件 | 通过门禁 |
| --- | --- | --- | --- |
| 0 | AR-VS-00 范围与策略锁定 | 当前问题、非目标和用户约束已确认 | 业务规则、敏感边界、验收指标无歧义 |
| 1 | AR-VS-01 架构与模块边界 | 目标链路和领域状态已冻结 | 模块职责、数据所有权、同步/异步边界清晰 |
| 2 | AR-VS-01 数据/API 契约 | 状态和策略模型已评审 | 迁移、API、错误码、幂等、并发、脱敏、审计明确 |
| 3 | AR-VS-07 管理端可观测面 | 状态/API 字段可消费 | Agent Dynamics 状态、错误、加载、空态和权限状态齐全 |
| 4 | AR-VS-02 至 AR-VS-08 切片编排 | 依赖图和 DoD 已确认 | 每个切片有输入、输出、非目标、证据和回滚 |
| 5 / 5.5 | AR-VS-02 至 AR-VS-07 单切片实现与提交 | 前置阶段 PASS | 单测/集成/E2E/评审/提交门禁通过 |
| 6 | AR-VS-08 集成与真实链路 | 关键切片均 PASS | 真实入口到持久化与状态回读通过 |
| 7 | AR-VS-08 安全、性能、可观测性、发布准备 | 阶段 6 PASS | 无未接受 P0/P1，告警、恢复、回滚可演练 |
| 8 | AR-VS-09 发布、回滚与交接 | 阶段 7 PASS | 灰度、回滚、数据兼容、交接文档和发布后冒烟通过 |

### 13.3 统一切片 DoD

所有切片必须满足：

- 目标用户行为、输入、输出、禁止范围和假设已写入切片卡；
- 前后端、数据库、消息、第三方适配和管理端展示边界明确；
- 正常、失败、未登录、无权限、空数据、重复请求和关键并发有测试；
- 迁移、配置、日志、指标、事件和回滚说明同步；
- 适用的类型检查、构建、单元、集成、E2E 和视觉检查真实执行；
- 至少两轮独立评审；默认包含业务/验收、架构/数据流，关键切片增加质量/安全/运维；
- 评审问题按 OPEN → FIXING → READY_FOR_REVIEW → VERIFIED → CLOSED 闭环；
- P0/P1/P2 问题全部关闭后，才能将切片标记为 PASS；
- 证据归档到对应切片目录或交付报告，提交哈希、验证命令和评审轮次可追溯。

### 13.4 纵向切片总表

| 切片 | 用户行为 | 数据/API | 后端/策略 | 前端/观测 | 依赖 | 退出结果 |
| --- | --- | --- | --- | --- | --- | --- |
| AR-VS-00 | 明确什么可以自动推进、什么只能拒绝 | 策略版本、验收指标、风险编号 | 敏感信息拒绝矩阵、低 handoff 规则 | 运行详情字段草案 | 无 | PASS 后冻结范围 |
| AR-VS-01 | 系统能持久化并恢复买家目标与阶段 | ConversationState、Objective、Policy API、迁移 | StateReducer、PolicyEngine 接口 | Agent Dynamics 状态投影契约 | VS-00 | PASS 后允许代码切片 |
| AR-VS-02 | 买家说不清时收到澄清并可继续原目标 | clarify、awaiting_user、目标关联、幂等 | 澄清计划、恢复、轮数预算 | 澄清/等待状态和事件 | VS-01 | E2E 闭环通过 |
| AR-VS-03 | 回复发送前先验证目标和事实 | ReviewRecord、fact refs、review events | Pre-send Review、有限修订 | Review 事件和失败原因 | VS-01 | 误答阻断回归通过 |
| AR-VS-04 | 按订单阶段引导下单、付款、发货、收货、评价 | 订单阶段投影、ActionPlan | 阶段策略和成功标准 | 活动详情显示目标/下一步 | VS-01, VS-03 | 交易阶段 E2E 通过 |
| AR-VS-05 | 跑题能拉回，负面情绪不被强推 | topic/emotion snapshot、事件 | TopicPolicy、EmotionPolicy | 状态徽标、事件时间线 | VS-01, VS-02 | 跑题/情绪回归通过 |
| AR-VS-06 | 合适时推荐相关店内商品 | recommendation state、候选/曝光记录 | Eligibility、排序、冷却 | 推荐理由和候选证据 | VS-03, VS-05 | 推荐门控 E2E 通过 |
| AR-VS-07 | 发送后可知道是送达、待确认还是已解决 | resolution status、review worker、指标 API | Outcome Review、follow-up、人工覆盖 | resolution 面板、KPI 拆分 | VS-02, VS-03, VS-04 | 解决率和重开率可回读 |
| AR-VS-08 | 从真实入口验证完整链路并可回滚 | PostgreSQL/Redis/事件/配置复读 | Worker、lease、重试、告警、灰度 | 真实浏览器状态与截图 | VS-02 至 VS-07 | 阶段 6–7 PASS |
| AR-VS-09 | 发布、回滚、交接可重复执行 | 迁移顺序、备份、兼容读写 | canary、reconcile、runbook | 发布后状态复核 | VS-08 | 阶段 8 PASS |

## 14. 具体修复垂直切片

### AR-VS-00：范围、策略与基线锁定

**目标**：把“禁止硬编码路由”和“仅终极敏感信息明确拒绝”固化为可验收策略。

**输入**：

- 当前 repair-plan；
- 现有 auto-reply 设计、风险登记、状态模型；
- 用户确认的两项约束。

**输出**：

- 敏感信息拒绝矩阵；
- 普通售后/投诉/不确定问题的继续帮助矩阵；
- 生命周期函数、目标动作和指标定义；
- 需求 → 验收 → 测试追踪表；
- 风险编号和决策记录。

**禁止范围**：

- 不修改业务代码；
- 不开放 live；
- 不把当前 Prompt 文案当作已经实现的行为。

**验收与证据**：

- 业务评审确认“拒绝、澄清、继续帮助、升级”的边界；
- 架构评审确认策略不落到散落分支；
- 质量评审确认指标可通过事件和数据库回读；
- 证据：决策记录、矩阵、追踪表、风险更新。

**回滚**：文档回退到上一版策略，代码不受影响。

### AR-VS-01：ConversationState、Objective 与 Policy Kernel

**目标**：建立跨消息状态和版本化策略的最小可运行内核。

**数据库**：

- 新增 Agent 专属 conversation state 表；
- 新增 objective、state version、policy version、last message ref；
- 增加唯一约束、乐观锁和审计字段；
- 保留旧 auto_reply_runs 兼容读写。

**后端/API**：

- 新增 canonical types；
- 新增 StateReducer、PolicyEngine、ActionPlan 接口；
- 新增内部读取/更新服务，禁止路由层自行写状态；
- 统一返回错误、冲突和重试语义。

**前端/观测**：

- Agent Dynamics raw DTO 和 canonical VM 增加 state/objective 字段契约；
- 先支持只读展示，不改变现有 UI 交互。

**测试**：

- 状态创建、更新、乐观锁冲突、重复消息、跨账号拒绝；
- 迁移重复执行和旧数据复读；
- 策略版本加载、非法配置和回滚。

**非目标**：不实现澄清、生命周期引导和推荐动作。

**回滚**：兼容字段可停止写入，保留旧 run 读路径；迁移提供向前/向后兼容读取。

**评审**：业务/验收 + 架构/数据流 + 质量/安全/运维。

### AR-VS-02：澄清与 awaiting_user 闭环

**目标**：买家信息不足时，Agent 先追问最小问题，并在下一条消息到达后恢复原目标。

**数据库/API**：

- 增加 pendingQuestions、expectedAnswerType、sourceMessageId、clarificationRound；
- 增加 clarify、awaiting_user、reclassified 事件；
- 下一条 inbound 通过 conversation state version 关联原 objective。

**后端/策略**：

- SignalExtractor 输出 ambiguity 和 missingInformation；
- PolicyEngine 选择 ask_clarifying；
- 一次最多一个关键问题；
- 澄清超时保持 awaiting_user，不自动 resolved；
- 超过轮数优先给可选项或有限帮助，不默认 handoff。

**前端/观测**：

- Agent Dynamics 显示“澄清中/等待买家”；
- 详情展示待补充信息和当前目标；
- 加载、空、失败、冲突和无权限状态齐全。

**测试**：

- 模糊问题、买家补充、目标恢复、明确新目标切换；
- 重复消息、并发回复、澄清超时、跨账号和跨商品隔离；
- 真实 E2E：买家消息 → 澄清 → 买家补充 → 继续原目标。

**非目标**：不在本切片实现评价请求和商品推荐。

**回滚**：关闭 clarify feature flag，回到安全的普通回答；保留 awaiting_user 历史事件。

**评审**：业务/验收 + 架构/数据流 + 质量/安全/运维；增加对话体验复核。

### AR-VS-03：发送前 Pre-send Review

**目标**：在发送前确认候选回复覆盖目标、引用事实并符合允许动作。

**数据库/API**：

- 增加 ReviewRecord 或等价事件结构；
- 保存 goalCoverage、factRefs、policyVersion、reviewDecision、issues；
- 公开详情接口展示审核结果，但不暴露敏感 Prompt。

**后端/策略**：

- deterministic validator 优先；
- 检查关键事实、新鲜度、账号/买家/商品范围、情绪门控和推荐资格；
- 审核失败可 revise 一次、clarify 或继续提供安全帮助；
- 仅终极敏感信息走明确拒绝。

**前端/观测**：

- Agent Dynamics 展示 review.started、review.completed、review.failed；
- 失败原因按结构化 reason code 显示。

**测试**：

- 无事实支持的价格、库存、发货、订单断言；
- 事实冲突和过期；
- 目标未覆盖、错误商品、错误账号；
- 普通不确定问题进入 clarify 而非 handoff；
- 敏感信息只拒绝敏感部分。

**非目标**：不判断发送后买家是否已解决问题。

**回滚**：关闭 pre-send review 强化开关时，保留最低安全拦截，不回退到直接发送未校验内容。

**评审**：业务/验收 + 架构/数据流 + 质量/安全/运维。

### AR-VS-04：生命周期引导

**目标**：在不修改订单的前提下，基于订单事实引导买家推进下一阶段。

**数据库/API**：

- 订单阶段投影和 ActionPlan 输出；
- run 记录 observedStage、targetStage、nextAction 和 successCriteria；
- activity API 返回阶段变化原因和事实引用。

**后端/策略**：

- 未下单：回答商品问题并在购买意向明确时引导下单；
- 已下单未付款：引导付款；
- 已付款待发货：解释发货事实和下一步；
- 已发货待收货：引导收货/验收；
- 已收货且问题解决：礼貌请求评价；
- 不把文案建议当作阶段已完成，必须等待订单事实或买家确认。

**前端/观测**：

- 展示当前阶段、目标阶段、下一动作；
- 目标阶段未达成时不得显示为已完成。

**测试**：

- 五个主要阶段的状态映射；
- 阶段回退、订单事实变化、多订单歧义；
- 评价请求受售后和情绪门控；
- 真实 E2E：订单事实变化 → 状态投影 → 引导文案 → 状态回读。

**非目标**：不执行付款、发货、改价、退款等写操作。

**回滚**：关闭阶段引导动作，保留事实回答和澄清。

**评审**：业务/验收 + 架构/数据流；涉及订单状态时增加安全/运维复核。

### AR-VS-05：跑题拉回与情绪门控

**目标**：处理跑题、新目标和情绪变化，避免强行拉回、强推或错误推荐。

**数据库/API**：

- 保存 topicRelation、emotionSnapshot、intensity、confidence、signals；
- 增加 topic.redirected、emotion.observed 事件；
- 支持新目标创建与旧目标暂停。

**后端/策略**：

- adjacent：简答后回主目标；
- off_topic：接住一句、说明主线、提出一个选择；
- 连续两次跑题或明确新目标：切换目标；
- confused：只问一个问题；
- frustrated/angry/urgent：先确认事实和安抚，禁推荐/评价；
- 情绪只影响语气和升级阈值，不放宽事实校验。

**前端/观测**：

- 详情展示话题关系和情绪摘要；
- 不展示未经脱敏的原始敏感情绪推断正文。

**测试**：

- 跑题拉回、连续跑题、新目标切换；
- 正常、犹豫、困惑、焦虑、愤怒；
- 负面情绪下不推荐、不催评价；
- 并发消息和人工接管竞态。

**非目标**：不构建独立情绪分析页面。

**回滚**：关闭情绪驱动动作，保留中性话术和事实引导。

**评审**：业务/验收 + 架构/数据流 + 质量/安全；增加对话体验复核。

### AR-VS-06：店内推荐

**目标**：仅在相关、合适、事实新鲜和情绪允许时推荐店内其他商品。

**数据库/API**：

- 推荐资格、候选、理由、事实引用、曝光和冷却记录；
- 增加 recommendation.offered 事件；
- 候选必须绑定当前 accountId。

**后端/策略**：

- 将 cross_product 拆为 alternative_search 与高风险售后/投诉；
- 只允许推荐当前账号的可见、可售、相关商品；
- 模型只在 PolicyEngine 提供的候选中排序；
- 同一会话设置冷却；
- 无合格候选时追问偏好，不凭空推荐。

**前端/观测**：

- Agent Dynamics 显示推荐理由、候选数量和事实引用；
- 不新增独立 /review 页面。

**测试**：

- 明确询问替代商品；
- 商品不适配但买家接受替代方案；
- 售后/投诉/负面情绪/澄清等待期间禁止推荐；
- 跨账号商品隔离、库存变化、重复推荐冷却；
- E2E 验证推荐只来自真实候选。

**非目标**：不执行商品修改、下单或营销自动化写操作。

**回滚**：关闭 recommendationAllowed 策略，只保留回答和澄清。

**评审**：业务/验收 + 架构/数据流 + 质量/安全/运维；增加推荐体验复核。

### AR-VS-07：发送后 Outcome Review

**目标**：区分消息已发送、买家已看到、业务已推进和问题已解决。

**数据库/API**：

- 增加 resolutionStatus、reviewAttempt、reviewSource、reviewedAt、evidenceDigest、nextAction；
- 新增 review worker 的 lease、幂等键、重试和人工覆盖；
- 指标 API 拆分 transportCompletionRate、goalProgressRate、resolutionRate、clarificationRate、reopenRate。

**后端/策略**：

- 观察发送结果、后续买家消息和最新订单/商品事实；
- 买家明确确认或领域事实满足成功标准时，才允许 resolved；
- 重复追问、否定、事实变化进入 needs_followup 或 unresolved；
- 无后续消息保持 review_pending 或 awaiting_user；
- 审核失败不篡改原发送结果；
- 用户明确要求人工才触发人工队列，普通不确定优先继续澄清。

**前端/观测**：

- 详情展示 transport、resolution、nextAction 三层状态；
- KPI 不再把 persisted 直接作为业务完成；
- 展示 review 失败、待跟进和人工覆盖。

**测试**：

- persisted → review_pending → reviewing → resolved/needs_followup；
- 买家确认、重复追问、否定、无后续消息、事实变化；
- 审核超时、重复任务、进程重启、人工覆盖；
- 真实 E2E：发送后注入 follow-up，状态和指标回读正确。

**非目标**：不在本切片引入自动退款、订单修改或真实平台写操作。

**回滚**：停止 review worker 后保留发送结果；resolutionStatus 回到 pending，不删除历史事件。

**评审**：业务/验收 + 架构/数据流 + 质量/安全/运维；增加真实数据库和恢复评审。

### AR-VS-08：真实链路集成与发布准备

**目标**：验证完整链路从真实入口到数据库、事件、管理端和回滚。

**范围**：

- PostgreSQL 迁移、旧数据兼容、重启复读；
- API 鉴权、账号 scope、错误、幂等、并发；
- Worker lease、重试、超时、断线和恢复；
- Chrome/CDP 真实管理端回读；
- simulate → shadow → canary 的发布门禁；
- 日志、指标、告警、runbook、备份与回滚。

**测试与证据**：

- 真实入口 → API → 测试数据库 → Agent Dynamics；
- 关键正向、失败、无权限、空态、重复请求和网络失败；
- 固定桌面/移动 viewport 截图及偏差记录；
- 迁移回滚和旧数据读取；
- 不能用页面打开、HTTP 200 或 mock 代替真实跨层验收。

**回滚**：关闭 feature flags，回到上一策略版本；应用版本回退优先，保留兼容读路径和历史审计。

**评审**：业务/验收 + 架构/数据流 + 质量/安全/运维 + 前端视觉。

### AR-VS-09：发布、回滚与交接

**目标**：形成可重复的发布、恢复、回滚和交接证据。

**输出**：

- 发布清单和环境变量说明；
- 迁移顺序、备份、恢复和兼容策略；
- canary 观察指标和停止条件；
- 误答、误推荐、误推进、发送 unknown、审核失败的 runbook；
- 版本、提交、验证命令、评审轮次和剩余风险。

**通过条件**：

- 无未接受 P0/P1；
- 所有适用测试、E2E、视觉、迁移、回滚和告警演练 PASS；
- 评审问题已完成修复 → 重新验证 → 复审；
- STATUS、review log、risk register 和设计/API/迁移文档同步。

## 15. 当前交付边界

本次只更新本文档和索引，不修改业务代码、数据库迁移或发送行为。当前文档切片进入 READY_FOR_REVIEW；审核通过后，严格按 AR-VS-00 → AR-VS-09 串行推进，不允许跨阶段或把多个未验证切片合并实现。
