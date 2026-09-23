# AR-VS-09 发布前 Smoke 与回滚演练

## 目的

本演练验证 AR-VS-09 的发布门禁、canary 停止条件、kill switch 策略回滚和 live sender outbox 恢复。演练使用 `MemoryStore` 与确定性外部发送 stub，不连接真实闲鱼账号、不发送真实买家消息，也不覆盖账号级 PolicyConfig 持久化。

## 执行命令

```powershell
npm --workspace apps/api run test:auto-reply:release:smoke
```

该命令先构建 API，再执行 `apps/api/scripts/auto-reply-release-gate-smoke.mjs`。

## 验收断言

| 场景 | 断言 |
| --- | --- |
| 受控 canary | required checks 全部 `PASS`、指标在观察窗口阈值内时，门禁返回 `READY` |
| canary 停止 | `reviewRejectRate` 命中配置化阈值时返回 `BLOCKED` 和对应 `reasonCode` |
| 指标缺失 | stop condition 指标缺失时 fail-closed，返回 `METRIC_UNAVAILABLE:<metric>` |
| kill switch 回滚 | 回滚只切换到 `previousPolicyVersion`，保留 `killSwitchRef` 证据和原因码 |
| sender outbox | 相同 `requestId` 重放只调用一次外部 stub，outbox 为 `succeeded` |
| 崩溃恢复窗口 | `recoverRun` 使用同一外部引用补齐本地 outbound message，重复恢复不产生第二条消息 |

## 当前证据边界

- 2026-09-23 直接执行 `node apps/api/scripts/auto-reply-release-gate-smoke.mjs` 已通过，输出：`releaseGateReady=true`、`canaryStopConditionBlocked=true`、`missingMetricFailClosed=true`、`killSwitchRollback=true`、`outboxIdempotent=true`、`outboxRecovered=true`、`outboxPersisted=true`、`externalAccountRequired=false`。
- 包装命令 `npm --workspace apps/api run test:auto-reply:release:smoke` 已在账号级 PolicyConfig 持久化实现合入后重新执行并通过；API build 与 release-gate smoke 均成功，`MemoryStore`/`PostgresStore` 的 `getActiveAutoReplyRepairPolicy`、`publishAutoReplyRepairPolicy`、`rollbackAutoReplyRepairPolicy` 已可用。对应合并提交为 `b3fc206`。
- 已覆盖：发布门禁核心逻辑、配置化 canary stop condition、缺失指标 fail-closed、kill switch 策略回滚、sender outbox requestId 幂等和本地消息恢复。
- 未覆盖：真实闲鱼账号 live 外发、生产 canary、线上告警系统/Owner、数据库 migration rollback、目标环境备份恢复和真实外部发送故障注入。
- 因此本演练只能把 AR-VS-09 提升到“发布前实现级 smoke 通过”，不能单独宣称生产已上线。

## 回滚操作

1. 先停止 canary，并记录命中指标与 `reasonCode`。
2. 通过 kill switch registry 关闭对应 action flag，保留审计事件。
3. 将 active policy 指针切换到 `previousPolicyVersion`；禁止删除历史 state/review/event/outbox。
4. 对 `processing/unknown` outbox 执行 lease 回收与 targeted replay，确认 requestId 未产生重复外发。
5. 完成目标环境 reconcile、告警确认和复读后，才能重新开启 canary。
