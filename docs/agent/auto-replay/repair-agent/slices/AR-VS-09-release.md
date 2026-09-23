# AR-VS-09：发布、回滚与交接

## 状态

- 状态：READY_FOR_RELEASE_CANDIDATE（发布前实现级 smoke 已通过；目标环境演练仍为发布前置）
- 发布门禁：`apps/api/src/auto-reply-release.ts`
- 测试：`apps/api/scripts/auto-reply-release.test.ts`、`apps/api/scripts/auto-reply-release-gate-smoke.mjs`

## 发布门禁

- 发布策略必须包含新旧 policy version、canary 比例、观察窗口、kill switch 引用和必需检查项。
- 所有 required checks 必须为 `PASS`；任一配置的 stop condition 命中即阻断发布。
- 误答、误推荐、敏感泄露、review reject rate 和 unknown 增长由配置化指标条件触发停止，不在代码中写死阈值。
- 回滚只切换到 `previousPolicyVersion`，并保留 kill switch、失败检查和证据引用。

## 通过证据

- `npm --workspace apps/api exec -- node --import tsx --test scripts/auto-reply-release.test.ts`
- `npm --workspace apps/api run test:auto-reply:release:smoke`：通过；READY、canary stop、缺失指标 fail-closed、kill-switch rollback、outbox 幂等恢复均已断言
- `npm --workspace apps/api run test:auto-reply:policy-registry:postgres`：通过；账号级 ACTIVE PolicyConfig hash/CAS/rollback 已验证
- `npm --workspace apps/api run build`
- `npm run db:migrate`：031–035 迁移成功；真实 sender、目标环境 canary、告警和 migration rollback/备份恢复证据继续由发布流水线补齐。

## 运行手册

- 误答/误推荐：停用 recommendationAllowed 或切回上一 policy version，保留 review 与事件记录。
- 敏感出站：触发 kill switch，强制 `REFUSE_SENSITIVE`，检查脱敏审计与重试 payload。
- Outcome Review 堵塞：停止 worker，保留 `review_pending`/`review_failed`，不得把 persisted 改写成 resolved。
- 真实链路异常：关闭 repair orchestrator flag，回退旧发送入口，完成恢复后再重新 canary。

## 交接

发布前必须附带：版本、迁移编号、canary 比例、停止阈值、Owner、回滚命令、告警链接、最近一次成功构建和定向回归结果。
