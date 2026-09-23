# 修复域风险登记

## 级别

- P0：数据破坏、越权、核心流程不可用或不可回滚；立即 BLOCKED。
- P1：核心验收失败、关键契约错误或无法复现构建/部署；阶段 FAIL/BLOCKED。
- P2：非核心缺陷、重要可维护性或体验问题；本轮修复后才能关闭。
- P3：低风险改进；可转后续任务，但不能掩盖 P0–P2。

## 当前修复风险

| 编号 | 级别 | 风险 | 当前状态 | 处置 |
| --- | --- | --- | --- | --- |
| AR-RA-001 | P0 | 业务路由继续散落在硬编码分支或 Prompt | IMPLEMENTED_PENDING_EVIDENCE | PolicyEngine、生命周期、话题/推荐/发布模块均由版本化配置驱动；待架构扫描和真实入口回读 |
| AR-RA-002 | P1 | persisted 被误读为 resolved | IMPLEMENTED_PENDING_EVIDENCE | Pre-send/Outcome Review 已分离 transport/resolution；待 Activity API 投影和真实回读 |
| AR-RA-003 | P1 | 信息不足时误答或过早 handoff | IMPLEMENTED_PENDING_EVIDENCE | clarify/awaiting_user、预算、TTL 和恢复已覆盖；待真实编排接入 |
| AR-RA-004 | P1 | 生命周期阶段被模型猜测推进 | IMPLEMENTED_PENDING_EVIDENCE | 事实投影与 observed/target stage 已实现；待订单真实数据回读 |
| AR-RA-005 | P1 | 售后/负面情绪下误推荐或催评价 | IMPLEMENTED_PENDING_EVIDENCE | 情绪和推荐门控已实现；待真实状态投影与指标验证 |
| AR-RA-006 | P1 | Outcome Review 重试导致状态倒退或重复处理 | IMPLEMENTED_PENDING_EVIDENCE | lease、CAS、幂等、退避、死信、reopen 已实现；待跨进程 worker 演练 |
| AR-RA-007 | P2 | 旧文档继续传播默认 handoff 语义 | OPEN | 旧文档加兼容横幅，canonical policy 迁移映射 |
| AR-RA-008 | P2 | 指标把传输完成当成业务成功 | OPEN | KPI 拆分并保留 resolution evidence |
| AR-RA-009 | P1 | AR-VS-00 策略已文档化但尚未通过独立评审和代码回归 | IMPLEMENTED_PENDING_EVIDENCE | R1/R2 VERIFIED；141 项自动回复单测通过；R3 真实环境证据仍开放 |
| AR-RA-010 | P1 | canonical ActionKind、优先级和互斥规则未统一，导致路由不可唯一复现 | VERIFIED | 已补固定 ruleId、候选 tie-break、唯一 primaryAction、互斥矩阵和 PolicyDecisionTrace；AR-VS-01 单测已通过，R1/R2 独立复审确认 |
| AR-RA-011 | P1 | clarify/awaiting_user 的不回复、重复澄清和目标切换闭环缺失 | IMPLEMENTED_PENDING_EVIDENCE | AR-VS-02 11 项定向回归及全套回归通过；待真实编排接入 |
| AR-RA-012 | P1 | handoff 白名单、reason code 和证据阈值过于开放 | IMPLEMENTED_PENDING_EVIDENCE | Pre-send Review 已强制白名单和结构化证据；待真实出站回读 |
| AR-RA-013 | P1 | “等价秘密”及混合消息的部分拒绝和全链路拦截不可执行 | IMPLEMENTED_PENDING_EVIDENCE | Policy/Pre-send 敏感 fail-closed 已覆盖；待红队、日志/备份/重试 payload 扫描 |
| AR-RA-014 | P1 | 状态字段命名与迁移不变量不统一，无法保证生命周期和并发安全 | VERIFIED | 已统一 observedStage/targetStage、stateVersion/CAS、乱序、sourceSequence 和陈旧回放语义；AR-VS-01 状态单测已通过 |
| AR-RA-015 | P1 | PolicyDecisionTrace、Outcome Review 和 ConversationState 持久化契约不完整 | VERIFIED | repair runtime/repository 已接入主入口；031 三表完成 PostgreSQL 写读与重启回读；Activity 已回读 review/action/resolution 字段，policyHash 已进入路由与 review event 审计 payload |
| AR-RA-016 | P1 | 新策略缺少可采信的测试、阈值告警、灰度和回滚演练证据 | OPEN | 141 项单测与 release smoke 已通过；仍需目标环境指标阈值、告警 Owner、canary、kill switch、迁移回滚和 reconcile 演练 |
| AR-RA-018 | P1 | AR-VS-08 主入口接入缺失导致 state/review 不可审计 | VERIFIED | `AUTO_REPLY_REPAIR_MODE=shadow` 已接入 `AutoReplyService`/`app.ts`；`test:auto-reply:vs08:postgres` 验证三表事务写入、`review_pending`、enforce 完整链路和重启 Activity 回读；shadow 不伪造 `SENDER_PERSISTED`，CAS 冲突有限重试 |
| AR-RA-019 | P1 | Outcome Review 仅能创建 review snapshot，缺少跨进程 claim/complete/retry/dead-letter/close/reopen 持久化更新 | VERIFIED | repository/worker/033 迁移已补齐 lease/CAS/幂等更新、retry/dead-letter、close/reopen；默认 worker 生命周期和 PostgreSQL smoke 通过；真实领域 evidence 仍属于发布前置，不再阻断该风险 |
| AR-RA-020 | P1 | 真实 push parser 与 deferred inbox 未完整保留 source event/sequence，乱序/陈旧回放缺少平台序列证据 | VERIFIED | 032 迁移、parser→defer inbox→processInboundInbox 透传和定向回归已补；平台未提供显式序列时继续使用可审计 deterministic fallback，完整链路 smoke 通过 |
| AR-RA-021 | P1 | repair policy 仍位于 legacy classifier/hardSafety/handoff 之后，无法证明统一无硬编码路由与混合敏感消息局部拒绝 | VERIFIED_FOR_ENFORCE | enforce 模式下 PolicyEngine route 先于 legacy handoff gate，legacy classifier 仅提供信号；纯敏感只走 REFUSE_SENSITIVE，混合敏感保留安全业务回答；shadow 保留兼容旁路，不作为生产 enforce 证据 |
| AR-RA-022 | P1 | live sender 与本地落库非 outbox/外部幂等事务，崩溃窗口可能造成重复发送 | VERIFIED | outbox 持久化、requestId 外部幂等、崩溃恢复和 targeted replay 回归已通过；真实外部闲鱼发送/故障演练仍属于 enforce/canary 发布前置 |
| AR-RA-023 | P1 | 默认 PolicyConfig 仍以内置 TypeScript seed 为主，生产规则不可按账号审计加载 | VERIFIED_FOR_ENFORCE | `035_auto_reply_policy_registry.sql` 建立账号级 ACTIVE 注册表；Memory/PostgreSQL 均支持 hash/account scope 校验、单 ACTIVE CAS 发布、历史版本回滚；enforce 主入口优先读取持久化 ACTIVE，缺失时 fail-closed；定向单测与 PostgreSQL smoke 通过。生产 canary/运营演练仍为发布前置 |
| AR-RA-024 | P1 | shadow sender outcome 未回写 repair review，发送失败/unknown 无法进入 reconcile | VERIFIED | `AutoReplyRepairRuntime.reconcileSendOutcome()` 已接入 `known_success`/`known_failure`/`unknown`；runtime 回归和 `test:auto-reply:vs08:postgres` 覆盖幂等回写；真实外部 sender 故障演练仍受 AR-RA-022 发布门禁约束 |

## 旧风险映射

| 旧编号 | 新治理落点 |
| --- | --- |
| AR-ORCH-001 | AR-RA-001、03-domain-policy-contract.md |
| AR-ORCH-002 | AR-RA-003、AR-VS-02 |
| AR-ORCH-003 | AR-RA-004、AR-VS-04 |
| AR-ORCH-004 | AR-RA-005、AR-VS-05/06 |
| AR-ORCH-005 | AR-RA-002、AR-VS-07 |
| AR-SEND-001/002 | AR-VS-08、11-release-rollback.md |
| AR-OBS-002 | AR-RA-002、AR-RA-008 |

## 关闭定义

风险只有在修复提交、受影响门禁和测试重新执行、独立评审复核、文档同步以及回滚路径验证后，才能从 OPEN 变为 VERIFIED/CLOSED。文档重组本身不能关闭业务风险。
| AR-RA-017 | P1 | resolved/closed 证据优先级和 reopenWindowSeconds 尚未完成实现级验证 | IMPLEMENTED_PENDING_EVIDENCE | Outcome Review 已覆盖证据优先级、reopen 和唯一 resolved→closed；待真实 worker 回读 |
