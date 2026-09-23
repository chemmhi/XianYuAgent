# AR-VS-05：跑题拉回与情绪门控

## 状态

- 切片：AR-VS-05
- 实现状态：`READY_FOR_REVIEW`
- 实现范围：纯策略模块与单元回归，不接入 AutoReplyService、持久化或发送链路
- 日期：2026-09-22

## 目标与边界

- 邻近话题先回答安全事实，再通过 `REDIRECT_TO_CURRENT` 回到当前目标。
- 未形成新目标的跑题使用 `REDIRECT`；连续跑题且存在候选目标时使用 `SWITCH_GOAL`。
- 明确新目标但事实不足时只进入 `CLARIFY`，且最多允许一个问题；事实充分时切换目标。
- 困惑、焦虑、挫败、愤怒和紧急情绪由结构化信号驱动承接语气；负面情绪门控推荐和评价请求。
- 情绪只影响语气和动作门控，不替代事实校验，也不触发 `HANDOFF` 或 `REFUSE_SENSITIVE`。

## 输入与输出

- 输入：版本化 `TopicEmotionPolicy`、结构化 topic snapshot、emotion snapshot、账号/会话范围、可选 `ConversationState`。
- 输出：唯一 `ActionKind`、确定性 rule/gate 命中、目标转换、推荐/评价门控、脱敏事件、状态 patch 和克隆后的状态。
- 规则选择按 `priority → specificity → requiredEvidenceCount → ruleId` 决定；零候选或无 gate 命中直接失败，不使用隐含默认路由。

## 安全与审计

- 事件仅保存标签、强度、置信度、版本和摘要 digest，不保存买家原文。
- AR-VS-05 规则不得声明 `HANDOFF` 或 `REFUSE_SENSITIVE`，人工接管和终极敏感拒绝由 canonical PolicyEngine 负责。
- 账号/会话范围不匹配、策略 hash 失效、输入信号不完整时 fail-closed。

## 验收证据

- `apps/api/src/auto-reply-topic-emotion.ts`
- `apps/api/scripts/auto-reply-topic-emotion.test.ts`
- `npm --workspace apps/api run build`
- `node --import tsx --test scripts/auto-reply-topic-emotion.test.ts`
- `npm --workspace apps/api run test:auto-reply:unit`
- `git diff --check`

## 回滚

- 关闭 AR-VS-05 情绪/话题动作开关，保留中性事实回答和既有澄清路径。
- 不删除事件、不回写旧状态；由于本切片未新增迁移，回滚只需停止消费该模块输出。

## 后续接入

- AR-VS-04/06 接入决策输出中的 `recommendationAllowed` 与 `reviewRequestAllowed` 门控。
- AR-VS-08 再补真实 StateReducer、Activity API、指标、并发和人工接管竞态验证。
