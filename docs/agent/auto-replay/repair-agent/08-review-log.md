# 修复域评审记录

## 2026-09-22：AR-VS-00 范围、策略与基线锁定

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| AR-VS00-R1 | 业务 / 验收 | READY_FOR_REVIEW | slices/AR-VS-00-policy-matrix.md、slices/AR-VS-00-traceability.md：拒绝、继续帮助、澄清、生命周期和指标口径已冻结 |
| AR-VS00-R2 | 架构 / 数据流 | READY_FOR_REVIEW | decisions/ADR-AR-0001-route-and-refusal-policy.md、02-target-architecture.md：路由集中到 PolicyEngine，传输状态与解决状态分离 |
| AR-VS00-R3 | 质量 / 安全 / 运维 | READY_FOR_REVIEW | slices/AR-VS-00-scope-policy-baseline.md：静态代码证据、禁止范围、验收标准和回滚方式已记录；未修改业务代码 |

## 2026-09-22：repair-agent 文档域重组

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| AR-REPAIR-R1 | 业务 / 验收 | READY_FOR_REVIEW | 00-scope.md、03-domain-policy-contract.md：明确无硬编码路由、低拒绝/低 handoff 和终极敏感信息拒绝矩阵 |
| AR-REPAIR-R2 | 架构 / 数据流 | READY_FOR_REVIEW | 02-target-architecture.md、04-data-api-contract.md、05-vertical-slices.md：明确 PolicyEngine、双层状态、Pre-send Review、Outcome Review 与 AR-VS-00 至 AR-VS-09 |
| AR-REPAIR-R3 | 质量 / 安全 / 运维 | READY_FOR_REVIEW | 06-stage-gates.md、07-risk-register.md、11-release-rollback.md：明确三轮评审、风险闭环、灰度与回滚；业务代码未修改 |

## 历史规划评审迁移

| 旧编号 | 新位置 | 说明 |
| --- | --- | --- |
| AR-PLAN-R1 | 00-scope.md、03-domain-policy-contract.md | 业务约束和拒绝矩阵迁移 |
| AR-PLAN-R2 | 02-target-architecture.md、05-vertical-slices.md | 架构与切片迁移 |
| AR-PLAN-R3 | 06-stage-gates.md、09-status.md | 门禁和状态迁移 |

## 复审规则

评审问题必须先修复，再重新执行受影响门禁和测试，最后由独立评审关闭。未关闭的 P0–P2 不得进入下一阶段。

## 2026-09-22：AR-VS-00 三轮独立复审（复审执行）

| 评审编号 | 类型 | 结论 | 关键证据 |
| --- | --- | --- | --- |
| AR-VS00-R1 | 业务 / 验收 | 有条件通过，保持 READY_FOR_REVIEW | `slices/AR-VS-00-policy-matrix.md`、`slices/AR-VS-00-traceability.md`、`decisions/ADR-AR-0001-route-and-refusal-policy.md` |
| AR-VS00-R2 | 架构 / 数据流 | FAIL / 阻断 | `02-target-architecture.md`、`03-domain-policy-contract.md`、`04-data-api-contract.md`、现有 `apps/api/src/*` 基线代码 |
| AR-VS00-R3 | 质量 / 安全 / 运维 | FAIL / BLOCKED_BY_EVIDENCE | `06-stage-gates.md`、`07-risk-register.md`、`11-release-rollback.md`、自动回复测试与发布证据 |

### R1 业务 / 验收阻断项

- canonical `ActionKind`、优先级和互斥规则未冻结；现有 `answer_fact`、`guide_next_step`、`continue_help`、`acknowledge_and_continue` 等命名不一致。
- `clarify → awaiting_user` 的不回复、重复澄清和目标切换规则未闭环。
- handoff 白名单、reason code 和事实/权限证据阈值未枚举。
- “等价秘密”、混合消息的部分拒绝、出站拦截和脱敏验收未具体化。
- `resolved/closed` 的业务证据优先级、否定证据和重开窗口未冻结。

### R2 架构 / 数据流阻断项

- `buyerJourneyStage`、`journeyStage`、`observedStage`、`targetStage`、`orderPhase` 并存，缺少 canonical 字段、映射和迁移不变量。
- PolicyEngine 缺少可持久化的 `PolicyConfig`、规则优先级/冲突处理、`policyDecisionId`、`ruleId`、facts/signals 摘要和 reason codes。
- Outcome Review 缺少 resolutionStatus、证据类型/阈值、claim/lease、幂等、重试/超时、CAS 和旧版本拒绝语义。
- ConversationState 缺少主键/租户唯一约束、stateVersion/CAS、乱序事件、重复消息和陈旧回放处理。
- 现有代码仍存在正则/hardSafety 直连 handoff，模型协议仍只有 `reply/handoff`，与目标架构存在已确认偏离。

### R3 质量 / 安全 / 运维阻断项

- AR-VS-00 仅完成文档，当前没有新策略的实现和回归证据；`npm --workspace apps/api run test:auto-reply:unit` 因缺少 `tsx` 依赖未启动。
- 敏感检测尚无分类器版本、混淆/变体覆盖、fail-closed、红队样本集和日志/trace/metrics/备份/重试链路的完整泄漏验证。
- 指标未定义阈值、时间窗口、样本量、告警路由、Owner、保留期和 runbook。
- 灰度/回滚缺少 feature flag、canary 样本、停止条件、kill switch、迁移回滚命令、外部发送 reconcile、RTO/RPO 和演练证据。
- 旧测试仍把混合敏感消息和模型直接 handoff 当作合法行为，需在后续切片改写。

### 用户必须确认的裁决项

1. canonical `ActionKind` 枚举、优先级和互斥规则；
2. 澄清与 `awaiting_user` 的持续、重试和目标切换策略；
3. handoff 白名单、reason code 和证据阈值；
4. 敏感信息边界是否严格限定为用户列举项，是否保留“等价秘密”；
5. 买家确认、领域事实、人工覆盖对 `resolved/closed` 的判定优先级与重开窗口。

### 总体结论

AR-VS-00 三轮复审已执行，但阶段 0 门禁为 `BLOCKED`，不能标记 `PASS`，不能进入 AR-VS-01。必须先完成上述裁决、修订受影响文档、补齐验证证据，再重新执行受影响的复审轮次。

## 2026-09-22：用户裁决确认与修订启动

| 事项 | 结论 | 证据/后续 |
| --- | --- | --- |
| 五项策略裁决 | DECIDED | 用户确认 canonical ActionKind、澄清 no-auto-handoff、handoff 白名单、等价秘密和 resolved/closed 证据优先级 |
| R1 业务阻断项 | READY_FOR_REVIEW | 已修订 03、策略矩阵、追踪矩阵、ADR-AR-0002；等待重新 R1 |
| R2 架构阻断项 | READY_FOR_REVIEW | 已修订 02、04、05、10；已补 PolicyDecisionTrace、CAS、Outcome Review lease/幂等；等待重新 R2 |
| R3 质量阻断项 | OPEN / BLOCKED_BY_EVIDENCE | 仍需修复测试依赖并补敏感全链路、告警阈值、canary/回滚演练证据；完成后重新 R3 |

本记录不代表 AR-VS-00 已通过；修订期间阶段状态保持 BLOCKED。

## 2026-09-22：AR-VS-00 阻断项第二轮修订与 AR-VS-01 启动

| 复审/事项 | 当前结论 | 证据 |
| --- | --- | --- |
| R1 业务 / 验收 | VERIFIED | 03-domain-policy-contract.md、AR-VS-00 policy matrix、traceability：固定 ruleId/predicate/tie-break、澄清耗尽、handoff 证据、敏感边界和 reopen schema；独立复审确认无 P1 |
| R2 架构 / 数据流 | VERIFIED（切片范围） | 02-target-architecture.md、04-data-api-contract.md、10-compatibility-and-migration.md、AR-VS-01 纯内核：PolicyConfig 输出字段、ReviewRecord 外键/权威源、worker retry/CAS、事件、旧枚举映射和 primaryAction 统一；独立复审确认无 P1 |
| AR-VS-01 代码切片 | PASS（切片级） | apps/api/src/auto-reply-policy.ts、auto-reply-state.ts、domain.ts；`npm --workspace apps/api run build`；`npm --workspace apps/api run test:auto-reply:unit` 57/57 |
| R3 质量 / 安全 / 运维 | BLOCKED_BY_EVIDENCE | 真实持久化、敏感全链路、指标阈值、canary、kill switch、回滚演练尚未完成 |

用户已明确后续人工审核节点默认批准继续；本记录仍保留独立复审与测试证据，不将默认批准等同于技术验证通过。

## 2026-09-22：AR-VS-02 至 AR-VS-09 切片实现复核

| 切片 | 当前结论 | 证据 |
| --- | --- | --- |
| AR-VS-02 | PASS（内核级） | `auto-reply-clarification.ts`、定向澄清回归、全自动回复单测 112/112 |
| AR-VS-03 | PASS（内核级） | `auto-reply-pre-send-review.ts`、12 项定向回归：目标覆盖、事实范围/新鲜度、handoff 证据、敏感 fail-closed |
| AR-VS-04 | PASS（内核级） | `auto-reply-lifecycle.ts`、5 项定向回归：阶段事实投影、订单消歧、跨账号隔离 |
| AR-VS-05 | PASS（内核级） | `auto-reply-topic-emotion.ts`、9 项定向回归：话题拉回、目标切换、情绪/评价/推荐门控 |
| AR-VS-06 | PASS（内核级） | `auto-reply-recommendation.ts`、4 项定向回归：资格、冷却、同账号、新鲜度 |
| AR-VS-07 | PASS（内核级） | `auto-reply-outcome-review.ts`、7 项定向回归：claim/lease、CAS、退避、死信、reopen、closed |
| AR-VS-08 | PASS（适配级） | `auto-reply-repair-orchestrator.ts`、3 项编排回归、031 增量迁移 |
| AR-VS-09 | PASS（门禁级） | `auto-reply-release.ts`、4 项发布/阻断/回滚回归 |

### 仍需独立 R3 / 真实环境复核

- 以上 PASS 仅表示可运行内核/适配层证据，不等同于生产发布通过；真实 PostgreSQL、外部发送、Activity API、跨进程 worker、红队和 canary 证据仍未提交。
- 后续人工审核节点按用户确认默认批准继续，但任何真实环境门禁仍需保留可回读证据和回滚记录。
