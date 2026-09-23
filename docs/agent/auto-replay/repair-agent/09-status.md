# repair-agent 当前状态

- 日期：2026-09-23
- 当前阶段：阶段 8/9，切片实现与发布门禁收口
- 阶段状态：IN_PROGRESS
- 当前门禁：AR-VS-00 R1/R2 已 VERIFIED；legacy 买家推送持久化已通过，但 AR-VS-08 新编排尚未接入真实入口，R3/发布门禁保持 BLOCKED
- 人工审核策略：后续人工审核节点默认批准继续；该默认不替代自动化测试、真实回读和发布门禁

## 已完成

- AR-VS-00：策略矩阵、敏感边界、handoff 白名单、澄清/解决契约和三轮复审记录已固化；R1/R2 已 VERIFIED。
- AR-VS-01：canonical ActionKind、PolicyConfig、PolicyEngine、ConversationStateReducer、CAS、乱序和陈旧回放已实现。
- AR-VS-02：澄清预算、问题指纹、awaiting_user、TTL exhausted、原目标恢复和显式新目标切换已实现。
- AR-VS-03：Pre-send Review 已实现目标覆盖、事实/范围/新鲜度、动作白名单、handoff 证据和敏感 fail-closed。
- AR-VS-04：生命周期事实投影已实现阶段优先级、订单消歧、跨账号 fail-closed 和配置化 nextAction。
- AR-VS-05：话题拉回、目标切换、情绪门控和评价/推荐抑制已实现，禁止该切片直接 handoff/refuse。
- AR-VS-06：推荐资格、同账号/库存/新鲜度、偏好排序、冷却和最多 1–3 个候选已实现。
- AR-VS-07：Outcome Review claim/lease、证据优先级、退避、死信、CAS、reopen 和 resolved→closed 门禁已实现。
- AR-VS-08：Policy→Pre-send→Send→review_pending 编排适配层和增量 SQL 迁移已实现。
- AR-VS-09：配置化 canary、stop condition、kill switch 回滚和交接门禁已实现。
- 自动回复单测：114/114 通过；API build、切片定向测试和 `git diff --check` 通过。

## 真实测试（2026-09-23）

- `npm run db:migrate`：031 迁移成功；已确认 `public.auto_reply_conversation_state`、`public.auto_reply_review_records`、`public.auto_reply_review_events` 存在。
- `npm --workspace apps/api run test:auto-reply:e2e`：4/4 通过，覆盖模拟买家 WebSocket push、Agent 工具循环、模拟出站和 MemoryStore 落库。
- `npm --workspace apps/api run test:auto-reply:postgres`：通过；覆盖 PostgreSQL inbound/outbound/run 落库及 runtime 重启后的 run/message 回读。
- `npm --workspace apps/api run test:auto-reply:buyer-push:postgres`：通过；`buyerPush=true`、`modelCalls=2`、`outboundSimulated=true`、`outboundPersisted=true`、`runPersistedAfterRestart=true`、`aiOutboundCountAfterRestart=1`。
- PostgreSQL 真实测试使用 `simulate` 发送模式，已断言未调用 `/r/MessageSend/sendByReceiverScope`；不代表真实闲鱼外部发送通过。

## 尚未关闭

- legacy `messages.messages`、`messages.auto_reply_runs` 和 `messages.auto_reply_run_events` 已完成真实 PostgreSQL 回读；但 AR-VS-08 的 `auto_reply_conversation_state`、`auto_reply_review_records`、`auto_reply_review_events` 当前只有迁移，主运行入口尚无读写接入，因此新 state/review 闭环仍为 P1 阻断。
- AR-VS-00 R3 仍为 `BLOCKED_BY_EVIDENCE`：敏感全链路红队、指标阈值告警 Owner、canary 实测、kill switch 和迁移回滚演练需在目标环境补证据。
- Activity 兼容读模型已补 transport/resolution/legacy 投影；仍需把新字段写入真实 `AutoReplyService`/ReviewRecord，并补真实账号 scope、脱敏日志、备份/恢复和 reconcile 证据。

## 当前风险

- AR-RA-001、AR-RA-002、AR-RA-003、AR-RA-004、AR-RA-005、AR-RA-006、AR-RA-016、AR-RA-017、AR-RA-018：保持 OPEN，原因是生产链路与运营证据尚未完成。
- AR-RA-010、AR-RA-014：VERIFIED；AR-RA-011、AR-RA-012、AR-RA-013：实现级证据已补，待新编排真实接入、独立 R3 与红队回读后关闭。
- AR-RA-015：部分验证；031 迁移和 legacy 持久化回读已通过，但新 state/review 表尚未被主运行链路写入。
- 旧目录中的历史运行设计仍可能被误当作修复 canonical，继续通过兼容映射和评审日志防漂移。

## 下一步

1. 将 AR-VS-08 的 Policy/Pre-send/Outcome 编排接入真实 buyer push 主入口，并把 state/review 记录写入 031 三张表。
2. 将 primaryAction、resolutionStatus、nextAction 和 review 结果接入 Activity API 兼容读模型并做 PostgreSQL 回读。
3. 执行敏感脱敏红队、canary、kill switch、回滚、重启恢复、lease 抢占和 reconcile 演练。
4. 以证据关闭 AR-VS-00 R3、AR-VS-08/09 发布门禁，并更新本目录评审日志与风险表。
