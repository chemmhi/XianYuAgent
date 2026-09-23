# AR-VS-08：真实链路集成与发布准备

## 状态

- 状态：READY_FOR_REVIEW（legacy 主入口内已接入 shadow 候选审查旁路；enforce/canary 未开启）
- 编排适配：`apps/api/src/auto-reply-repair-orchestrator.ts`
- 主入口接入：`apps/api/src/auto-reply.ts`、`apps/api/src/app.ts`
- 运行时与持久化：`apps/api/src/auto-reply-repair-runtime.ts`、`apps/api/src/auto-reply-repair-repository.ts`
- 迁移：`apps/api/migrations/031_auto_reply_repair_state.sql`、`032_auto_reply_inbound_source_ordering.sql`、`033_auto_reply_review_lifecycle.sql`
- Outcome Review worker：`apps/api/src/auto-reply-outcome-review-worker.ts`
- 测试：`apps/api/scripts/auto-reply-repair-orchestrator.test.ts`、`apps/api/scripts/auto-reply-repair-runtime.test.ts`、`apps/api/scripts/auto-reply-buyer-push-postgres-smoke.mjs`

## 固定边界

- 编排顺序固定为 `PolicyEngine → Pre-send Review → Send/Persist → Outcome Review pending`。
- Pre-send 非 `APPROVE` 时不得调用 sender；发送成功只创建 `review_pending`，不直接标记 resolved。
- 状态、审核和事件表采用增量迁移，旧 `auto_reply_runs` 保留兼容读取。
- 账号 scope、policy version、idempotency key 和 stateVersion 由调用方传入并在模块边界校验。
- `AUTO_REPLY_REPAIR_MODE=shadow` 时，真实 buyer push 仍由 legacy sender 单次发送；repair runtime 只计算策略、写入 state/review/event 并追加脱敏审计事件，不双发、不阻断旧链路。Shadow 不把模拟结果当作 `SENDER_PERSISTED`，Outcome 只保持 `review_pending` 且 evidence 为空。
- `AutoReplyService` 在生成候选回复且通过既有敏感内容检查后调用 repair runtime；repair runtime 异常只记录 `repair.shadow_failed`，不能破坏 legacy 出站。
- 本切片不宣称新策略已接管 primary route；push 与 inbox 仍共享 legacy `AutoReplyService`，repair runtime 只观测候选动作和审核结果。
- `auto_reply_conversation_state`、`auto_reply_review_records`、`auto_reply_review_events` 在 MemoryStore 与 PostgreSQL 均支持创建、幂等写入、重启回读；PostgreSQL 使用事务将 state/review/event 绑定提交，state 更新使用 `(account_id, conversation_id, expectedStateVersion)` CAS，CAS 冲突最多有限重试。
- 入口透传 `sourceEventId/sourceSequence`；未提供真实序列时使用可审计的确定性 fallback，并在 shadow event 中标注 `sourceSequenceFallback`。
- deferred inbox 同步保存 source ordering；Outcome Review 支持 claim/heartbeat/complete/retry/dead-letter/close/reopen 的可调用持久化闭环；sender known_success/known_failure/unknown 会回写 shadow review，但 worker 不在默认 API 启动时自动运行。

## 验收证据

- 通过、事实缺失、敏感出站三条编排链路测试；新增 runtime 主入口回归和 repository UUID/CAS 回归。
- `npm run typecheck:api`：通过。
- `npm --workspace apps/api run test:auto-reply:unit`：116/116 通过。
- `npm --workspace apps/api run build`：通过。
- `npm run migrate`：031 迁移成功。
- `npm --workspace apps/api run test:auto-reply:buyer-push:postgres`：通过；buyer push、legacy 出站、031 三表写入与重启回读均通过；`listReviews()` 按 `PRE_SEND → OUTCOME` 语义顺序读取。

## 未包含

- enforce/canary、跨进程 Outcome Review worker claim/complete/retry/dead-letter、真实闲鱼外部发送端到端回读、Chrome/CDP、kill switch 和迁移回滚演练仍归后续发布门禁。
- 当前 outcome review 在 shadow 接入中只生成 `review_pending` 快照；repository 尚未实现跨进程审核 worker 的 claim/complete/retry/close/reopen 持久化更新。
- 当前切片不宣称统一路由已完成：legacy classifier/hardSafety/handoff 仍先于 repair policy；真实 source event/sequence 尚未完整从 push parser 贯穿 inbox；live sender outbox/idempotency 与动态 PolicyConfig 仍是 enforce 前 P1 门禁。
- 当前切片已补 source ordering、Outcome Review repository/worker 和 sender reconcile；仍不宣称默认后台审核、统一主路由或 live outbox 已完成。

## 回滚

关闭 repair orchestrator feature flag，保留旧发送路径和新表兼容读；迁移只做向前兼容，不删除旧表。
