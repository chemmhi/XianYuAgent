# AR-VS-00 需求—验收—测试追踪

## 需求追踪

| 需求编号 | 需求 | 验收标准 | 后续测试切片 | 当前证据 |
| --- | --- | --- | --- | --- |
| R-AR00-01 | 路由不得硬编码 | 路由可追溯到 signals、facts、policyVersion 和 ActionPlan | AR-VS-01、AR-VS-02、AR-VS-04、AR-VS-06 | 目标架构与策略矩阵 |
| R-AR00-02 | 普通问题默认继续帮助 | 普通售后/投诉/异常优先澄清或给下一步，不默认 handoff | AR-VS-02、AR-VS-04、AR-VS-05 | 继续帮助矩阵、ADR |
| R-AR00-03 | 终极敏感信息明确拒绝 | Cookie/API Key/Token/密码/验证码/系统提示词/管理员凭证只拒绝敏感部分 | AR-VS-03、AR-VS-08 | 敏感拒绝矩阵 |
| R-AR00-04 | 发送和解决分离 | persisted 不等于 resolved；无证据只能 pending/unknown | AR-VS-03、AR-VS-07 | 双层状态定义 |
| R-AR00-05 | 生命周期按事实推进 | targetStage 与 observedStage 分离，阶段成功标准可回读 | AR-VS-01、AR-VS-04、AR-VS-07 | 生命周期口径表 |
| R-AR00-06 | 情绪和推荐受门控 | 负面情绪、售后未解决、等待澄清期间不推荐/不催评价 | AR-VS-05、AR-VS-06 | 情绪与推荐规则 |

## 验收场景

### AC-AR00-001 路由可追溯

- Given：同一业务问题存在多个可能动作；
- When：PolicyEngine 选择动作；
- Then：结果必须包含 signals、facts、policyVersion、successCriteria 和 nextState 摘要，不能只记录一个字符串 intent。

### AC-AR00-002 普通售后不默认 handoff

- Given：买家描述发货异常但未要求人工；
- When：事实足够或可通过一个问题补齐；
- Then：选择 continue_help 或 clarify，不直接 handoff。

### AC-AR00-003 敏感部分明确拒绝

- Given：消息同时包含业务问题和 API Key 请求；
- When：生成候选动作；
- Then：只拒绝 API Key 部分，安全业务问题仍可回答或澄清。

### AC-AR00-004 persisted 不等于 resolved

- Given：消息发送成功但买家没有后续确认；
- When：记录运行结果；
- Then：transportStatus 为 persisted，resolutionStatus 只能为 review_pending、awaiting_user 或 unknown。

### AC-AR00-005 负面情绪抑制推荐

- Given：买家处于投诉或愤怒状态；
- When：策略评估推荐资格；
- Then：recommendationAllowed 必须为 false。

## 当前静态证据

- apps/api/src/auto-reply-output.ts 目前只接受 reply/handoff 两种 decision；
- apps/api/src/auto-reply-agent.ts 目前把事实不足映射到 handoff，并在模型协议中限制为 reply/handoff；
- apps/api/src/domain.ts 目前的运行状态只有 received、classified、context_loaded、generated、simulated、persisted、handoff、skipped、failed；
- apps/api/src/domain.ts 当前有 senderOutcome，但没有 resolutionStatus、review lease 或 outcome evidence。

## 不能在本切片宣称完成的事项

- 未实现 PolicyEngine、ConversationState、clarify、Outcome Review 或新指标 API；
- 未完成真实模型、数据库、浏览器和外部买家链路验证；
- 未关闭 AR-RA-001 至 AR-RA-008 风险；
- 未通过三轮独立评审。
