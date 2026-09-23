# 发布、回滚与交接

## 发布通道

simulate → canary → controlled live

每一级都必须有停止条件、指标窗口、审计和回滚动作；未完成 Outcome Review、unknown/reconcile、澄清恢复和人工接管验证，不得开放 controlled live。

## 回滚原则

- 策略版本可回退到上一版本；
- 新字段兼容读写，旧 run 不强行迁移为 resolved；
- 发现误答、误推荐、误推进或敏感信息风险时，优先关闭 `killSwitchRegistryRef` 指向的对应 action flag，不删除历史审计；
- handoff 白名单、敏感 fail-closed、clarify/no-auto-handoff 和 Outcome Review reopen 必须在受控 kill-switch registry 中各自登记 `flagKey`、scope、failClosedAction、owner、version`，由 PolicyConfig 引用，不得在代码中散落硬编码开关；
- review worker 停止后保留发送结果，resolution 回到 pending/unknown；
- Outcome Review 回滚必须执行 reconcile：保留原始 review 事件、拒绝陈旧写入、恢复 review_pending/unknown，并记录策略版本；
- 应用回滚、策略回滚、数据库迁移回滚和外部发送恢复必须分别记录。

## 发布前检查

- 无未接受实现级 P0/P1；目标环境发布前置风险（真实 live/canary、告警 Owner、迁移回滚/备份恢复和红队证据）仍保持 BLOCKED_BY_EVIDENCE；
- 迁移 apply/rollback、旧数据读取、重启复读通过；
- 真实入口→API→数据库→Agent Dynamics 回读通过；
- 买家 WebSocket push→Agent→模拟出站→legacy PostgreSQL 回读已通过；AR-VS-08 enforce 主入口额外验证 031–035 state/review/event/outbox/policy registry 写入、回读、回滚和重启复读，但该证据仍不等同于真实账号 canary 发布通过；
- 发送幂等、unknown、review lease、超时、重试和人工覆盖通过；
- handoff reasonCode、敏感全链路脱敏、澄清不回复、resolved/closed 证据优先级和 `reopenWindowSeconds` 配置通过；
- 桌面/移动关键状态视觉证据齐全；
- 告警、runbook、备份、恢复和停止条件已演练；
- STATUS、review log、risk register、API/设计文档同步。

## 发布前实现级 Smoke

在不连接真实闲鱼账号的隔离环境执行：

```powershell
npm --workspace apps/api run test:auto-reply:release:smoke
```

该 smoke 必须同时证明：required checks 全通过时 `READY`；canary stop condition 命中时 `BLOCKED`；stop metric 缺失时 fail-closed；kill switch 回滚到 `previousPolicyVersion`；sender outbox 以同一 `requestId` 幂等重放并通过 `recoverRun` 补齐本地 outbound message。该命令不能替代真实外部发送、生产 canary、线上告警或 migration rollback 演练。

## AR-VS-08 enforce 回滚演练说明

- 关闭方式：保持 `AUTO_REPLY_REPAIR_MODE=enforce`，通过 PolicyConfig kill switch 或将 `AUTO_REPLY_SEND_MODE` 切换为 `simulate` 停止外部发送；不恢复旧主链路。
- 失败隔离：`repair.failed` 只追加脱敏 run event；不得触发第二次发送。
- 数据处理：不删除 `auto_reply_conversation_state`、`auto_reply_review_records`、`auto_reply_review_events`；回滚后禁止将 `review_pending` 直接改写为 `resolved`，后续由 review worker/reconcile 处理。
- 当前已补：Outcome Review worker、外部 sender reconcile、outbox requestId 幂等和策略 kill switch smoke；仍未完成真实外部账号发送、目标环境 canary、线上告警 Owner、备份恢复和 migration rollback，因此发布门禁仍需目标环境证据。

## 交接产物

- 发布版本、策略版本、迁移版本和提交哈希；
- 验证命令、真实环境、数据集和证据路径；
- 运行指标、告警阈值、回滚负责人和人工接管入口；
- 未完成风险、阻塞条件和下一阶段唯一目标。
