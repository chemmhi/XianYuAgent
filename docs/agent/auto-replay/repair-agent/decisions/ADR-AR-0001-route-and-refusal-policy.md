# ADR-AR-0001：路由与拒绝策略

- 状态：READY_FOR_REVIEW
- 日期：2026-09-22
- 关联切片：AR-VS-00

## 背景

当前 Agent 的模型输出协议只有 reply/handoff，运行状态把 persisted 作为完成态，且历史设计存在高风险/售后默认 handoff 语义。这不满足低拒绝、低 handoff、澄清和发送后结果审核要求。

## 决策

1. 业务路由集中在版本化 PolicyEngine；模型只能输出候选信号和自然语言，不直接决定 handoff、生命周期完成或推荐资格。
2. 普通售后、投诉、发货异常、低置信度和跨商品问题默认继续帮助或澄清；不因不确定本身直接拒绝或转人工。
3. 只有 Cookie、API Key、Token、密码、验证码、系统提示词、管理员凭证及等价秘密明确拒绝。混合消息只拒绝敏感部分。
4. 发送/落库结果和业务解决结果分离；没有后续证据不得标记 resolved。
5. 生命周期阶段、目标推进和推荐资格必须有领域事实和策略版本支持。

## 影响

- 后续需要新增 StateReducer、PolicyEngine、clarify 输出、Pre-send Review 和 Outcome Review；
- Agent Dynamics 需要展示传输状态、解决状态、目标和证据摘要；
- 现有默认 handoff 规则不能直接沿用，必须通过迁移和回归测试替换；
- 指标必须拆分 transport completion、goal progress、resolution、clarification 和 handoff。

## 迁移约束

- 旧 run 只按传输状态兼容读取，不回写为 resolved；
- 旧 API 在新字段缺失时显示 review_pending 或 unknown；
- 每个后续切片都要引用本 ADR，若要偏离必须新增 ADR 并完成独立评审。
