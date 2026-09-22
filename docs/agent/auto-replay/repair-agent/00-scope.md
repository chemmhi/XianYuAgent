# 修复范围与约束

## 目标

修复自动回复 Agent 在执行完成后没有确认原始问题是否解决、信息不完整时缺少追问、业务生命周期引导不足、跑题/情绪/推荐缺少统一门控以及业务路由硬编码等问题。

## 范围

- 入站消息信号提取、会话目标和买家生命周期状态；
- Intent → Plan → Act → Observe → Respond 链路的结构化扩展；
- 澄清与 awaiting_user；
- 下单、付款、发货、收货、评价和店内推荐引导；
- 跑题拉回、目标切换和情绪门控；
- 发送前 Pre-send Review 与发送后 Outcome Review；
- Agent Dynamics 的状态、事件、指标和错误可观测性；
- 测试、评审、灰度、回滚与证据闭环。

## 非目标

- 不把 Workspace Agent 改造成买家 Agent；
- 不新增订单、商品、改价、发货、退款或其他写操作工具；
- 不把真实 live 发送作为默认测试路径；
- 不新增独立 /review 一级页面；
- 不以 Prompt 文案替代策略、状态和事实校验；
- 不在本轮文档重组中修改业务代码、数据库迁移或发送行为。

## 核心约束

### 路由

业务路由由 SignalExtractor → StateReducer → PolicyEngine 产生。确定性代码只做 schema、类型、范围、账号 scope、幂等、敏感字段出站拦截和事实标准化。

### 拒绝与人工

普通售后、投诉、发货异常、低置信度和跨商品问题默认继续帮助或澄清；只有终极敏感信息、用户明确要求人工、白名单权限/事实证据或版本化策略明确升级时，才拒绝或 handoff。买家不回复澄清不得自动 handoff。

### 事实

商品、订单、支付、物流和买家确认事实优先于模型判断。targetStage、observedStage、transportStatus、resolutionStatus 必须分离。

### 结果

发送成功、消息落库、买家已读、目标推进和问题解决是不同状态。没有后续证据时，最多保持 review_pending、awaiting_user 或 unknown，不能自动标记 resolved；`reopenWindowSeconds` 必须来自 `policyConfig.resolution`，并使用 UTC server clock。

## 术语

| 术语 | 定义 |
| --- | --- |
| Signal | 从消息、历史和领域事实提取的结构化候选信号 |
| ActionPlan | PolicyEngine 生成的唯一动作计划 |
| Clarify | 用最小必要问题补齐继续处理所需信息 |
| Awaiting user | 已发送澄清，等待买家补充，不等同于已解决 |
| Pre-send Review | 发送前检查目标覆盖、事实、权限、情绪和推荐门控 |
| Outcome Review | 发送后基于后续消息和领域事实判断业务结果 |
| Handoff | 进入人工处理队列，不等同于错误或默认终点 |

## 关联决策

- decisions/ADR-AR-0001-route-and-refusal-policy.md：路由、拒绝和传输/解决分离的高层决策；
- decisions/ADR-AR-0002-confirmed-action-and-resolution-contract.md：用户已确认的 ActionKind、澄清、handoff、等价秘密和 resolved/closed 契约。
