# 发布、回滚与交接

## 发布通道

simulate → shadow → canary → controlled live

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

- 无未接受 P0/P1；
- 迁移 apply/rollback、旧数据读取、重启复读通过；
- 真实入口→API→数据库→Agent Dynamics 回读通过；
- 买家 WebSocket push→Agent→模拟出站→legacy PostgreSQL 回读已通过；AR-VS-08 shadow 主入口已额外验证 031 state/review/event 三表写入与重启回读，但该证据仍不等同于 enforce/canary 发布通过；
- 发送幂等、unknown、review lease、超时、重试和人工覆盖通过；
- handoff reasonCode、敏感全链路脱敏、澄清不回复、resolved/closed 证据优先级和 `reopenWindowSeconds` 配置通过；
- 桌面/移动关键状态视觉证据齐全；
- 告警、runbook、备份、恢复和停止条件已演练；
- STATUS、review log、risk register、API/设计文档同步。

## AR-VS-08 shadow 回滚演练说明

- 关闭方式：将 `AUTO_REPLY_REPAIR_MODE` 设为 `off` 并重启 API；legacy `AutoReplyService` 保持原发送与 legacy run/message 持久化，repair 三表保留历史记录供审计。
- 失败隔离：`repair.shadow_failed` 只追加脱敏 run event；不得把 shadow 异常转换为 legacy 失败或触发第二次发送。
- 数据处理：不删除 `auto_reply_conversation_state`、`auto_reply_review_records`、`auto_reply_review_events`；回滚后禁止将 `review_pending` 直接改写为 `resolved`，后续由 review worker/reconcile 处理。
- 当前未完成：尚未演练跨进程 review worker claim/complete/retry/dead-letter/close/reopen、外部发送 reconcile 和 migration rollback；在这些证据补齐前保持发布门禁 BLOCKED。

## 交接产物

- 发布版本、策略版本、迁移版本和提交哈希；
- 验证命令、真实环境、数据集和证据路径；
- 运行指标、告警阈值、回滚负责人和人工接管入口；
- 未完成风险、阻塞条件和下一阶段唯一目标。
