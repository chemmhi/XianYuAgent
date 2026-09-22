# ADR-AR-0002：已确认的动作、澄清与结果契约

- 状态：用户裁决已确认，文档修订中
- 日期：2026-09-22
- 关联切片：AR-VS-00
- 前置决策：ADR-AR-0001-route-and-refusal-policy.md

## 用户裁决

用户确认采用以下五项规则，作为 AR-VS-00 修订基线：

1. 业务路由使用 canonical ActionKind、优先级和互斥规则；
2. 澄清发送后进入 awaiting_user，买家不回复不得自动 handoff；
3. handoff 只允许白名单 reasonCode 和最低证据；
4. 保留等价秘密边界，纯敏感请求拒绝，混合消息只拒绝敏感部分；
5. resolved/closed 按领域事实优先、买家确认增强、人工覆盖兜底，窗口内否定证据可重开。

## 决策一：唯一主动作

ActionPlan 只能有一个 primaryAction，枚举为：

ANSWER_FACT、GUIDE_NEXT_STEP、CLARIFY、ACKNOWLEDGE_CONTINUE、REDIRECT、SWITCH_GOAL、RECOMMEND、WAIT_FOR_USER、HANDOFF、REFUSE_SENSITIVE。

安全处理通过 safetyHandling 表达，不作为第二个业务路由。禁止持久化 fallbackAction，修订通过 supersedesActionPlanId 建立链路。

## 决策二：优先级与互斥

安全检查优先；关键事实缺失时 CLARIFY 优先；明确新目标时 SWITCH_GOAL 优先；负面情绪时使用 ACKNOWLEDGE_CONTINUE 并关闭推荐；GUIDE_NEXT_STEP 优先于 RECOMMEND；HANDOFF 仅接受白名单 reasonCode；WAIT_FOR_USER 与 HANDOFF 互斥。

## 决策三：澄清与 awaiting_user

- 每个 outbound turn 最多一个问题；
- 相同 questionFingerprint 不得重复，除非出现新事实；
- 买家不回复时保持 awaiting_user；
- awaitingUserTtl 到期后转 unresolved，不自动 handoff；
- 买家返回后重新归因；明确新目标切换，否则恢复原目标；
- 澄清未完成时禁止推荐、催评价和 resolved。

## 决策四：handoff 白名单

合法 reasonCode 只有：

- USER_REQUESTED_HUMAN；
- REQUIRED_PERMISSION_MISSING；
- VERIFIED_FACT_UNAVAILABLE；
- POLICY_ESCALATION_REQUIRED；
- SECURITY_INCIDENT_REVIEW。

低置信度、普通售后、投诉、跨商品、模型错误和买家不回复不得作为 handoff 原因。

## 决策五：等价秘密与局部拒绝

等价秘密是能授予访问权、签名权、绕过验证或冒充身份的秘密材料，包括 session cookie、Bearer/Refresh Token、私钥、签名密钥、Webhook Secret、恢复码、一次性验证码和管理员凭证。公开订单号、商品 ID、用户名和商品信息不属于等价秘密。

纯敏感请求使用 REFUSE_SENSITIVE + FULL_REFUSAL；混合消息保留安全业务主动作并使用 PARTIAL_REFUSAL。分类不确定或出站拦截异常时 fail-closed，敏感原文不得进入输出、日志、trace、metrics、备份、导出和重试 payload。

## 决策六：resolved、closed 与 reopen

resolved 的证据优先级为：

1. 领域事实满足 successCriteria；
2. 买家明确确认问题已解决；
3. 有审计的人工覆盖。

人工覆盖不得覆盖冲突的已核实领域事实；冲突时记录 overrideRejected。reopenWindow 必须由 policyConfig.resolution.reopenWindow 提供，禁止在代码中隐含固定值；窗口内否定、重复追问或事实回退使 resolved → needs_followup。未配置窗口时不得自动 closed。

## 实施约束

- 本 ADR 不代表业务代码已实现；
- 必须同步 02-target-architecture、03-domain-policy-contract、04-data-api-contract、AR-VS-00 策略矩阵和追踪矩阵；
- 必须补充 PolicyDecisionTrace、ConversationState CAS、Outcome Review lease/幂等、敏感 fail-closed 和旧 run 兼容读取；
- 修订后重新执行 R1/R2/R3，三轮复审关闭前不得进入 AR-VS-01。
