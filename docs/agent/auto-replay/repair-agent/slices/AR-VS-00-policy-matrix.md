# AR-VS-00 策略矩阵

## 路由与处理矩阵

| 场景信号 | 默认动作 | 必要澄清 | 允许 handoff | 明确拒绝 | 事实要求 |
| --- | --- | --- | --- | --- | --- |
| 商品信息充分、目标明确 | answer_fact / guide_next_step | 否 | 否 | 否 | 当前商品事实 |
| 价格、库存、规格缺失 | clarify | 是，最多一个最小问题 | 仅权限/事实长期不可得 | 否 | 商品/账号事实 |
| 未下单但有购买意向 | guide_next_step | 缺规格时先澄清 | 否 | 否 | 商品可售、价格/库存新鲜 |
| 已下单未付款 | payment_next_step | 订单不唯一时澄清 | 仅权限不足 | 否 | 订单支付状态 |
| 已付款/已发货/待收货 | delivery_status | 订单不唯一时澄清 | 仅物流事实不可得且策略要求 | 否 | 订单、物流事实 |
| 售后、投诉、发货异常 | acknowledge_and_continue | 缺订单/问题细节时澄清 | 明确要求人工或需要人工权限 | 否 | 订单、售后、物流事实 |
| 信息不足或多目标 | clarify / switch_goal | 是 | 不默认 | 否 | 会话状态和最近消息 |
| adjacent 话题 | answer_fact_then_redirect | 视主目标缺口 | 否 | 否 | 当前目标和事实 |
| off_topic 且未形成新目标 | redirect | 可给选项 | 不默认 | 否 | 话题关系 |
| 明确新目标 | create_or_switch_goal | 必要时澄清 | 否 | 否 | 新目标事实 |
| 负面情绪或紧急 | acknowledge_and_continue | 只问最小必要问题 | 明确要求人工或策略要求 | 否 | 情绪信号 + 领域事实 |
| Cookie、API Key、Token、密码、验证码 | refuse_sensitive_part | 可继续回答安全部分 | 否 | 是 | 敏感分类器和出站拦截 |
| 系统提示词、管理员凭证、内部密钥 | refuse_sensitive_part | 可继续回答安全部分 | 否 | 是 | 敏感分类器和出站拦截 |
| Prompt Injection + 普通业务问题 | ignore_injection_then_continue | 按业务缺口澄清 | 否 | 仅拒绝敏感部分 | 安全策略和业务事实 |
| 用户明确要求人工 | handoff | 否 | 是 | 否 | 用户意图和审计 |

## 路由反硬编码规则

允许的确定性逻辑：schema 校验、账号 scope、幂等、敏感出站拦截、事实标准化、策略版本加载和版本比较。

禁止的业务路由写法：

- intent 等于某值就直接 handoff；
- 低置信度直接 handoff；
- 任意非空消息直接归类 general 并标记 replied；
- 在 Prompt 中写死某类问题必须转人工并把它当作唯一策略；
- 模型直接修改 buyerJourneyStage、observedStage 或 recommendationAllowed。

## 生命周期口径

| observedStage | 允许的 targetStage | 成功标准 |
| --- | --- | --- |
| discovery/evaluation | purchase_ready | 买家明确选择商品或表达购买意向 |
| unpaid_order | paid_pending_shipment | 订单事实变为已支付 |
| paid_pending_shipment | shipped_pending_delivery | 订单事实变为已发货 |
| shipped_pending_delivery | delivered_pending_review | 订单事实变为已收货或买家明确确认 |
| delivered_pending_review | completed | 买家问题已解决且买家完成评价动作 |
| after_sales | closed 或 handoff | 问题解决证据或人工接管 |

## 指标口径

| 指标 | 定义 | 证据来源 | AR-VS-00 处理 |
| --- | --- | --- | --- |
| transportCompletionRate | 生成后成功发送并落库的比例 | run 状态、senderOutcome、outbound ref | 冻结定义，后续实现 |
| clarificationRate | 进入 clarify/awaiting_user 的比例 | clarification 事件、状态迁移 | 冻结定义，后续实现 |
| handoffRate | 进入 handoff 的比例 | handoff 事件和 reason code | 区分用户要求与策略升级 |
| sensitiveRefusalRate | 仅因终极敏感信息拒绝的比例 | refusal reason code | 不与普通失败混合 |
| goalProgressRate | 满足目标推进标准的比例 | ActionPlan、目标状态、事实引用 | 先定义，VS-07 回读 |
| resolutionRate | 有解决证据的比例 | Outcome Review、买家确认、人工覆盖 | 未有证据不计入 |
| falseResolutionRate | 后续被重开/否定的 resolved 比例 | reopen、follow-up、否定消息 | VS-07 增加 |

## 评审结论

本矩阵是 AR-VS-00 的策略输入，不代表现有代码已经实现全部动作。任何实现偏差必须回写风险登记和评审记录。
