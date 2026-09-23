# repair-agent 当前状态

- 日期：2026-09-23
- 当前阶段：阶段 8/9，切片实现与发布门禁收口
- 阶段状态：IN_PROGRESS
- 当前门禁：AR-VS-08 enforce 主入口、统一 primary route、账号级 ACTIVE PolicyConfig、Outcome Review、Activity 回读和 sender outbox/reconcile 均已完成切片级验证；当前为 READY_FOR_RELEASE_CANDIDATE。生产 live/canary、真实领域 evidence、线上告警 Owner、迁移回滚与备份恢复仍为目标环境发布前置，不能据此宣称生产已上线
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
- AR-VS-08：Policy→Pre-send→Send→review_pending→Outcome Review 编排、031/032/033 增量迁移、Memory/PostgreSQL repository、默认 worker 生命周期、Activity review 读模型、sender outbox/reconcile、enforce PostgreSQL 完整链路和统一 primary route 已接入；legacy 仅保留 shadow/off 兼容路径，不参与 enforce primary route。
- AR-VS-09：配置化 canary、stop condition、缺失指标 fail-closed、kill switch 回滚、outbox 幂等恢复和交接门禁已实现，并有发布前 smoke 证据。
- AR-RA-023：账号级 ACTIVE PolicyConfig 注册表、hash/account scope 校验、CAS 发布与历史回滚已实现；enforce 缺失 ACTIVE 时 fail-closed。
- 自动回复单测：141/141 通过；API typecheck/build、E2E、PostgreSQL 主链路、PolicyConfig registry smoke 和 release smoke 均通过。

## 真实测试（2026-09-23）

- `npm run db:migrate`：031–035 迁移成功；已确认 repair state/review/event、outbox 和账号级 policy registry 表存在。
- `npm --workspace apps/api run test:auto-reply:e2e`：4/4 通过，覆盖模拟买家 WebSocket push、Agent 工具循环、模拟出站和 MemoryStore 落库。
- `npm --workspace apps/api run test:auto-reply:postgres`：通过；覆盖 PostgreSQL inbound/outbound/run 落库及 runtime 重启后的 run/message 回读。
- `npm --workspace apps/api run test:auto-reply:buyer-push:postgres`：通过；`buyerPush=true`、`modelCalls=2`、`outboundSimulated=true`、`outboundPersisted=true`、`runPersistedAfterRestart=true`、`aiOutboundCountAfterRestart=1`。
- `npm --workspace apps/api run test:auto-reply:vs08:postgres`：通过；`vs08EnforcePostgres=true`、`runStatus=persisted`、`safeBusinessAnswerPersisted=true`、`policyHashAudited=true`、`outcomeReview=closed`、`activityAfterRestart=true`。
- `npm --workspace apps/api run test:auto-reply:policy-registry:postgres`：通过；`arRa023Postgres=true`、`hashVerified=true`、`casVerified=true`。
- `npm --workspace apps/api run test:auto-reply:release:smoke`：通过；canary stop、missing metric fail-closed、kill-switch rollback、outbox idempotency/recovery 均为 `true`。
- enforce route 独立回归：141/141；legacy classifier/hardSafety 在 enforce 下不会覆盖 PolicyEngine primaryAction。
- AR-VS-08 shadow 主入口回归：`auto-reply-repair-runtime.test.ts` 2/2 通过；验证 `primaryAction`、`policyDecisionId`、`stateVersion=1`、`review_pending`、PRE_SEND/OUTCOME 幂等和 state_id/CAS 参数。
- PostgreSQL buyer-push smoke 额外断言：`runtime.autoReplyRepair.listReviews()` 重启前后均返回 PRE_SEND + OUTCOME，Outcome `resolution_status=review_pending`，shadow evidence types 为空，避免伪造真实 sender 成功。
- PostgreSQL 真实测试使用 `simulate` 发送模式，已断言未调用 `/r/MessageSend/sendByReceiverScope`；不代表真实闲鱼外部发送通过。

## 合并后主线重测（2026-09-23）

- 合并基线：`main@b3fc206`；文档证据更新：`539566c`。
- 工程级回归：`npm run typecheck`、`npm test`、`npm run build`、`npm run compose:config`、`git diff --check` 均通过。
- PostgreSQL/API 专项：Products、Orders、Coupons、自动回复、AR-VS-08、Policy Registry、Outcome Review、Activity Review、Agent Dynamics 全部通过，包含适用的迁移、持久化、重启复读和跨层断言。
- Chrome/CDP 本地安全套件：基础账号、Dashboard、Products、Coupons、Messages、Orders、Settings、Agent Dynamics、Workspace、Workspace Pi、Settings OpenAI、Product Automation live 均通过。
- Dashboard fullchain：`BLOCKED_BY_EVIDENCE`；需要 `E2E_DATABASE_URL` 或显式 `ALLOW_SHARED_E2E=1`，并需要目标环境真实闲鱼账号授权；当前不以受控 fixture 结果替代 fullchain 通过。
- Product Automation strict visual diff：仍有 12 组像素差异，视觉门禁保持开放，不标记为 `PASS`。
- 真实闲鱼 live sender/canary：本轮未验证；合并后重测不代表生产已上线。

## 尚未关闭

- legacy `messages.messages`、`messages.auto_reply_runs` 和 `messages.auto_reply_run_events` 已完成真实 PostgreSQL 回读；AR-VS-08 runtime 已在主入口读写 `auto_reply_conversation_state`、`auto_reply_review_records`、`auto_reply_review_events`，Activity 已回读 review 状态与动作；enforce PostgreSQL smoke、账号级 ACTIVE PolicyConfig 注册表/回滚 smoke 和 release smoke 均已通过，真实外部 sender/canary 仍是发布前置。
- AR-VS-00 R3 仍为 `BLOCKED_BY_EVIDENCE`：敏感全链路红队、指标阈值告警 Owner、canary 实测、kill switch 和迁移回滚演练需在目标环境补证据。
- Activity 兼容读模型已补 transport/resolution/legacy 投影并完成 PostgreSQL 回读；仍需补真实账号 scope、脱敏日志、备份/恢复、live sender outbox/reconcile 和领域解决证据。
- 合并后主线的 Dashboard fullchain 仍受目标环境数据库/真实闲鱼授权阻断；Product Automation strict visual diff 的 12 组像素差异仍待修复或经独立评审确认。

## 当前风险

- AR-RA-001、AR-RA-002、AR-RA-003、AR-RA-004、AR-RA-005、AR-RA-006、AR-RA-016、AR-RA-017：保持 OPEN/发布前置，原因是目标环境真实领域 evidence、生产运营证据、红队与迁移回滚尚未完成。
- AR-RA-021、AR-RA-023：已达到 `VERIFIED_FOR_ENFORCE`；统一 enforce 路由、hash/account scope 校验、CAS 发布/回滚和缺失策略 fail-closed 均有定向回归与 PostgreSQL smoke 证据。
- AR-RA-018、AR-RA-019、AR-RA-020、AR-RA-022、AR-RA-024：VERIFIED；对应主入口接入、Outcome Review lifecycle、source ordering、outbox/replay 和 sender reconcile 已有实现与 PostgreSQL/定向回归证据；真实外部发送仍需发布前演练。
- AR-RA-010、AR-RA-014：VERIFIED；AR-RA-011、AR-RA-012、AR-RA-013：实现级证据已补，待新编排真实接入、独立 R3 与红队回读后关闭。
- AR-RA-015：VERIFIED_FOR_ENFORCE；031 三表已由 repair repository/runtime 在主入口写入，重启后可回读；Activity 和 worker 更新型操作已有 PostgreSQL/定向回归证据，真实账号 scope 与发布演练仍属于目标环境前置。
- 旧目录中的历史运行设计仍可能被误当作修复 canonical，继续通过兼容映射和评审日志防漂移。

## 下一步

1. 在目标环境补 Dashboard fullchain 所需的 `E2E_DATABASE_URL`/真实闲鱼授权，以及真实领域 evidence、指标阈值告警 Owner、live sender canary、kill switch 和迁移回滚/备份恢复演练。
2. 处理 Product Automation strict visual diff 的 12 组像素差异，并保留修复或独立豁免的可回读证据。
3. 用真实闲鱼账号验证外部发送 known_success/known_failure/unknown、reconcile 与停止阈值；未取得目标环境证据前保持发布门禁 `BLOCKED_BY_EVIDENCE`。
4. 完成 AR-VS-00 R3 与 AR-VS-08/09 发布前独立复审，并同步提交哈希、部署和回滚记录；在此之前不得宣称生产已上线。
