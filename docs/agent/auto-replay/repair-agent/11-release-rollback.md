# 发布、回滚与交接

## 发布通道

simulate → shadow → canary → controlled live

每一级都必须有停止条件、指标窗口、审计和回滚动作；未完成 Outcome Review、unknown/reconcile、澄清恢复和人工接管验证，不得开放 controlled live。

## 回滚原则

- 策略版本可回退到上一版本；
- 新字段兼容读写，旧 run 不强行迁移为 resolved；
- 发现误答、误推荐、误推进或敏感信息风险时，优先关闭对应 action flag，不删除历史审计；
- handoff 白名单、敏感 fail-closed、clarify/no-auto-handoff 和 Outcome Review reopen 必须各自具备可回退的策略 flag；
- review worker 停止后保留发送结果，resolution 回到 pending/unknown；
- Outcome Review 回滚必须执行 reconcile：保留原始 review 事件、拒绝陈旧写入、恢复 review_pending/unknown，并记录策略版本；
- 应用回滚、策略回滚、数据库迁移回滚和外部发送恢复必须分别记录。

## 发布前检查

- 无未接受 P0/P1；
- 迁移 apply/rollback、旧数据读取、重启复读通过；
- 真实入口→API→数据库→Agent Dynamics 回读通过；
- 发送幂等、unknown、review lease、超时、重试和人工覆盖通过；
- handoff reasonCode、敏感全链路脱敏、澄清不回复、resolved/closed 证据优先级和 reopenWindow 配置通过；
- 桌面/移动关键状态视觉证据齐全；
- 告警、runbook、备份、恢复和停止条件已演练；
- STATUS、review log、risk register、API/设计文档同步。

## 交接产物

- 发布版本、策略版本、迁移版本和提交哈希；
- 验证命令、真实环境、数据集和证据路径；
- 运行指标、告警阈值、回滚负责人和人工接管入口；
- 未完成风险、阻塞条件和下一阶段唯一目标。
