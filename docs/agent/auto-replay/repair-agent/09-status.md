# repair-agent 当前状态

- 日期：2026-09-23
- 当前阶段：阶段 8/9，切片实现与发布门禁收口
- 阶段状态：IN_PROGRESS
- 当前门禁：AR-VS-00 R1/R2 已 VERIFIED；AR-VS-08 已在 legacy 主入口内接入 shadow 候选审查旁路并完成 031 三表真实写读，当前为 READY_FOR_REVIEW（shadow plumbing scope）；统一路由、source ordering、live 幂等与动态策略加载等 P1 仍使 enforce/canary 与 R3/发布门禁 BLOCKED
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
- AR-VS-08：Policy→Pre-send→Send→review_pending 编排适配层、031 增量迁移、Memory/PostgreSQL repository 和 legacy 主入口内的 shadow 候选审查旁路已接入；legacy 仍保持单次发送，新策略尚未接管 primary route。
- AR-VS-09：配置化 canary、stop condition、kill switch 回滚和交接门禁已实现。
- 自动回复单测：117/117 通过；API typecheck/build、runtime 主入口回归、031 迁移、PostgreSQL buyer-push 写读与重启回读均通过。

## 真实测试（2026-09-23）

- `npm run db:migrate`：031 迁移成功；已确认 `public.auto_reply_conversation_state`、`public.auto_reply_review_records`、`public.auto_reply_review_events` 存在。
- `npm --workspace apps/api run test:auto-reply:e2e`：4/4 通过，覆盖模拟买家 WebSocket push、Agent 工具循环、模拟出站和 MemoryStore 落库。
- `npm --workspace apps/api run test:auto-reply:postgres`：通过；覆盖 PostgreSQL inbound/outbound/run 落库及 runtime 重启后的 run/message 回读。
- `npm --workspace apps/api run test:auto-reply:buyer-push:postgres`：通过；`buyerPush=true`、`modelCalls=2`、`outboundSimulated=true`、`outboundPersisted=true`、`runPersistedAfterRestart=true`、`aiOutboundCountAfterRestart=1`。
- AR-VS-08 shadow 主入口回归：`auto-reply-repair-runtime.test.ts` 2/2 通过；验证 `primaryAction`、`policyDecisionId`、`stateVersion=1`、`review_pending`、PRE_SEND/OUTCOME 幂等和 state_id/CAS 参数。
- PostgreSQL buyer-push smoke 额外断言：`runtime.autoReplyRepair.listReviews()` 重启前后均返回 PRE_SEND + OUTCOME，Outcome `resolution_status=review_pending`，shadow evidence types 为空，避免伪造真实 sender 成功。
- PostgreSQL 真实测试使用 `simulate` 发送模式，已断言未调用 `/r/MessageSend/sendByReceiverScope`；不代表真实闲鱼外部发送通过。

## 尚未关闭

- legacy `messages.messages`、`messages.auto_reply_runs` 和 `messages.auto_reply_run_events` 已完成真实 PostgreSQL 回读；AR-VS-08 shadow runtime 已在主入口读写 `auto_reply_conversation_state`、`auto_reply_review_records`、`auto_reply_review_events`，但只生成 `review_pending` 快照，尚未启用 enforce 或跨进程 Outcome Review worker。
- AR-VS-00 R3 仍为 `BLOCKED_BY_EVIDENCE`：敏感全链路红队、指标阈值告警 Owner、canary 实测、kill switch 和迁移回滚演练需在目标环境补证据。
- Activity 兼容读模型已补 transport/resolution/legacy 投影；仍需把新字段写入真实 `AutoReplyService`/ReviewRecord，并补真实账号 scope、脱敏日志、备份/恢复和 reconcile 证据。

## 当前风险

- AR-RA-001、AR-RA-002、AR-RA-003、AR-RA-004、AR-RA-005、AR-RA-006、AR-RA-016、AR-RA-017、AR-RA-018、AR-RA-019、AR-RA-020、AR-RA-021、AR-RA-022、AR-RA-023：保持 OPEN/IMPLEMENTED_PENDING_EVIDENCE，原因是统一路由、真实 source ordering、Outcome Review worker、live sender 幂等/outbox、动态 PolicyConfig 与生产运营证据尚未完成。
- AR-RA-010、AR-RA-014：VERIFIED；AR-RA-011、AR-RA-012、AR-RA-013：实现级证据已补，待新编排真实接入、独立 R3 与红队回读后关闭。
- AR-RA-015：READY_FOR_REVIEW；031 三表已由 repair repository/runtime 在主入口写入，重启后可回读；Outcome Review worker 的更新型操作仍未持久化。
- 旧目录中的历史运行设计仍可能被误当作修复 canonical，继续通过兼容映射和评审日志防漂移。

## 下一步

1. 完成 AR-VS-08 两轮独立复审，关闭主入口接入遗留问题并更新风险状态。
2. 将 `primaryAction`、`resolutionStatus`、`nextAction` 和 review 结果接入 Activity API 兼容读模型并做 PostgreSQL 回读。
3. 实现跨进程 Outcome Review worker 的 claim/complete/retry/dead-letter/close/reopen 持久化，再执行敏感脱敏红队、canary、kill switch、回滚、lease 抢占和 reconcile 演练。
4. 以证据关闭 AR-VS-00 R3、AR-VS-08/09 发布门禁；在此之前不得将本切片标记为整体发布通过。
