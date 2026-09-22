# AR-VS-00 需求—验收—测试追踪

## 需求追踪

| 需求编号 | 需求 | 验收标准 | 后续测试切片 | 当前证据 |
| --- | --- | --- | --- | --- |
| R-AR00-01 | 路由不得硬编码 | 路由可追溯到 signals、facts、policyVersion、ruleId、policyDecisionId 和唯一 ActionPlan | AR-VS-01、AR-VS-02、AR-VS-04、AR-VS-06 | 02/03/04、策略矩阵 |
| R-AR00-02 | 普通问题默认继续帮助 | 普通售后/投诉/异常优先澄清或给下一步，不默认 handoff | AR-VS-02、AR-VS-04、AR-VS-05 | 矩阵、ADR、handoff 白名单 |
| R-AR00-03 | 终极敏感信息明确拒绝 | 等价秘密定义、混合消息局部拒绝、fail-closed 和全链路脱敏可验收 | AR-VS-03、AR-VS-08 | 03/04、策略矩阵 |
| R-AR00-04 | 发送和解决分离 | persisted 不等于 resolved；无证据只能 pending/awaiting/unknown | AR-VS-03、AR-VS-07 | 双层状态、ReviewRecord |
| R-AR00-05 | 生命周期按事实推进 | canonical observedStage/targetStage、成功标准、CAS 和迁移不变量可回读 | AR-VS-01、AR-VS-04、AR-VS-07 | 02/04、生命周期表 |
| R-AR00-06 | 情绪和推荐受门控 | 负面情绪、售后未解决、等待澄清期间不推荐/不催评价 | AR-VS-05、AR-VS-06 | 情绪和推荐规则 |
| R-AR00-07 | 澄清不自动升级人工 | 不回复保持 awaiting_user，重复问题去重，TTL 后不自动 handoff，明确新目标可切换 | AR-VS-02 | 澄清不变量、状态模型 |
| R-AR00-08 | handoff 可枚举且可证明 | 仅白名单 reasonCode，满足证据门槛，禁止低置信度等替代理由 | AR-VS-01、AR-VS-03、AR-VS-08 | handoff 白名单 |
| R-AR00-09 | resolved/closed 可审计 | 领域事实优先、买家确认增强、人工覆盖兜底；reopenWindowSeconds 由 policyConfig.resolution.reopenWindowSeconds 提供，否定证据可重开 | AR-VS-07、AR-VS-08 | ReviewRecord、解决契约 |

## 验收场景

### AC-AR00-001 路由可追溯

- Given：同一业务问题存在多个可能动作；
- When：PolicyEngine 选择动作；
- Then：结果必须包含 signals、facts、policyVersion、ruleId、policyDecisionId、successCriteria 和 nextState 摘要，且只有一个 primaryAction。

### AC-AR00-002 普通售后不默认 handoff

- Given：买家描述发货异常但未要求人工；
- When：事实足够或可通过一个问题补齐；
- Then：选择 ACKNOWLEDGE_CONTINUE、CLARIFY 或 GUIDE_NEXT_STEP，不直接 HANDOFF。

### AC-AR00-003 澄清不回复不自动 handoff

- Given：买家未回复澄清问题；
- When：awaitingUserTtl 到期；
- Then：保持 awaiting_user；最后一轮问题仍可等待买家补充；TTL 到期且关键事实仍缺失时发出 clarification.exhausted 并转 unresolved，不产生 HANDOFF；相同 questionFingerprint 不重复发送。

### AC-AR00-004 敏感部分明确拒绝

- Given：消息同时包含业务问题和 API Key 请求；
- When：生成候选动作；
- Then：安全业务仍可 ANSWER_FACT 或 CLARIFY，safetyHandling=PARTIAL_REFUSAL，输出和审计不含敏感原文。

### AC-AR00-005 persisted 不等于 resolved

- Given：消息发送成功但买家没有后续确认；
- When：记录运行结果；
- Then：transportStatus=persisted，resolutionStatus 只能为 review_pending、awaiting_user 或 unknown。

### AC-AR00-006 resolved/closed 证据优先级

- Given：领域事实满足 successCriteria、买家确认和人工覆盖存在冲突；
- When：Outcome Review 判定；
- Then：领域事实优先；冲突人工覆盖记录 overrideRejected；在 policyConfig.resolution.reopenWindowSeconds 配置的窗口内，带 canonical evidenceType 和 sourceEventId 的否定证据使 resolved 重开为 needs_followup；窗口结束后只有 resolved 才能 closed，未配置时不得自动 closed。

### AC-AR00-007 handoff 白名单

- Given：只有低置信度、普通投诉或买家不回复；
- When：PolicyEngine 评估；
- Then：不得输出 HANDOFF；只有白名单 reasonCode 和最低证据满足时才允许。

## 当前静态证据

- apps/api/src/auto-reply-output.ts 目前只接受 reply/handoff 两种 decision；
- apps/api/src/auto-reply-agent.ts 目前把事实不足映射到 handoff，并在模型协议中限制为 reply/handoff；
- apps/api/src/domain.ts 目前的运行状态只有 received、classified、context_loaded、generated、simulated、persisted、handoff、skipped、failed；
- apps/api/src/domain.ts 当前有 senderOutcome，但没有 resolutionStatus、review lease 或 outcome evidence。

## 不能在本切片宣称完成的事项

- 五项策略裁决已确认并完成文档契约修订，但尚未实现 PolicyEngine、ConversationState、clarify、Outcome Review 或新指标 API；
- 未完成真实模型、数据库、浏览器和外部买家链路验证；
- AR-RA-001 至 AR-RA-016 仍需按修复、复验、独立复审闭环；
- AR-VS-00 三轮复审需在文档修订、测试依赖和安全/发布证据补齐后重新执行。
