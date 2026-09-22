# AR-VS-08：真实链路集成与发布准备

## 状态

- 状态：IN_PROGRESS
- 编排适配：`apps/api/src/auto-reply-repair-orchestrator.ts`
- 迁移：`apps/api/migrations/031_auto_reply_repair_state.sql`
- 测试：`apps/api/scripts/auto-reply-repair-orchestrator.test.ts`

## 固定边界

- 编排顺序固定为 `PolicyEngine → Pre-send Review → Send/Persist → Outcome Review pending`。
- Pre-send 非 `APPROVE` 时不得调用 sender；发送成功只创建 `review_pending`，不直接标记 resolved。
- 状态、审核和事件表采用增量迁移，旧 `auto_reply_runs` 保留兼容读取。
- 账号 scope、policy version、idempotency key 和 stateVersion 由调用方传入并在模块边界校验。

## 验收证据

- 通过、事实缺失、敏感出站三条链路测试；迁移包含唯一 scope、claim 索引和事件幂等键。
- `npm --workspace apps/api exec -- node --import tsx --test scripts/auto-reply-repair-orchestrator.test.ts`
- `npm --workspace apps/api run build`

## 未包含

- 真实 PostgreSQL/外部闲鱼发送端到端回读、Chrome/CDP、canary 和 kill switch 演练仍归 AR-VS-09 发布门禁。

## 回滚

关闭 repair orchestrator feature flag，保留旧发送路径和新表兼容读；迁移只做向前兼容，不删除旧表。
