# AR-VS-07：发送后 Outcome Review

## 状态

- 状态：IN_PROGRESS
- 代码：`apps/api/src/auto-reply-outcome-review.ts`
- 测试：`apps/api/scripts/auto-reply-outcome-review.test.ts`

## 固定边界

- 发送/落库成功只能形成传输证据，不能单独形成 resolved。
- 领域事实、买家明确确认、人工覆盖按策略优先级决定 resolved；否定、重复追问和事实回退可在窗口内 reopen。
- worker claim 使用 `resolutionStatus=review_pending`、状态版本 CAS、lease owner/claim key；过期可重抢，不能覆盖活跃 claim。
- 无证据时窗口内回到 `review_pending` 并退避，窗口结束为 `unknown`；超过尝试次数进入 `review_failed`/dead letter。
- 只有 `resolved` 且重开窗口结束后才能 `closed`。

## 验收证据

- 覆盖 claim 抢占、事实解决、无证据退避/unknown、CAS 冲突、死信、重开和关闭门禁。
- `npm --workspace apps/api exec -- node --import tsx --test scripts/auto-reply-outcome-review.test.ts`
- `npm --workspace apps/api run build`

## 回滚

停止 Outcome Review worker，保留 senderOutcome 与原始事件；resolution 投影退回 `review_pending`，不删除历史证据。
