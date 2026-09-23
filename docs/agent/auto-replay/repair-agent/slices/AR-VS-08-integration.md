# AR-VS-08：真实链路集成与发布准备

## 状态

- 状态：READY_FOR_REVIEW（enforce 主入口已接管默认路由；canary/live 仍需目标环境门禁）
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
- `AUTO_REPLY_REPAIR_MODE` 只允许 `enforce`；`off/shadow` 已删除，非修复主链路不能启动。
- `AutoReplyService` 生成候选回复后必须进入 repair runtime 的 Policy→Pre-send 审核；主路由只由 PolicyEngine 决定，旧 classifier/hardSafety 不再覆盖 primaryAction。
- push 与 inbox 共享同一个 enforce repair ingress，统一写入 state/review/event，并由 Outcome Review worker 继续审核结果。
- `auto_reply_conversation_state`、`auto_reply_review_records`、`auto_reply_review_events` 在 MemoryStore 与 PostgreSQL 均支持创建、幂等写入、重启回读；PostgreSQL 使用事务将 state/review/event 绑定提交，state 更新使用 `(account_id, conversation_id, expectedStateVersion)` CAS，CAS 冲突最多有限重试。
- 入口透传 `sourceEventId/sourceSequence`；未提供真实序列时使用可审计的确定性 fallback，并在 repair event 中标注 `sourceSequenceFallback`。
- deferred inbox 同步保存 source ordering；Outcome Review 支持 claim/heartbeat/complete/retry/dead-letter/close/reopen 的持久化闭环；sender known_success/known_failure/unknown 会回写 repair review，worker 在默认开发启动时自动运行。

## 验收证据

- 通过、事实缺失、敏感出站三条编排链路测试；新增 runtime 主入口回归和 repository UUID/CAS 回归。
- `npm run typecheck:api`：通过。
- `npm --workspace apps/api run test:auto-reply:unit`：116/116 通过。
- `npm --workspace apps/api run build`：通过。
- `npm run migrate`：031 迁移成功。
- `npm --workspace apps/api run test:auto-reply:buyer-push:postgres`：通过；buyer push、enforce 出站、031 三表写入与重启回读均通过；`listReviews()` 按 `PRE_SEND → OUTCOME` 语义顺序读取。

## 未包含

- canary/live、真实闲鱼外部发送端到端回读、Chrome/CDP、kill switch 和迁移回滚演练仍归后续发布门禁。
- 统一 repair route、Outcome Review worker、source ordering、sender reconcile 与 outbox 幂等已接入；目标环境仍需真实账号证据与发布门禁。

## 回滚

保持 repair runtime 为 `enforce`，通过 PolicyConfig kill switch 或 `AUTO_REPLY_SEND_MODE=simulate` 停止外部发送；保留新表兼容读，迁移只做向前兼容，不恢复旧主链路。
