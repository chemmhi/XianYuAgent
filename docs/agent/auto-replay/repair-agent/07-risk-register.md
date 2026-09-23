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
| AR-RA-009 | P1 | AR-VS-00 策略已文档化但尚未通过独立评审和代码回归 | IMPLEMENTED_PENDING_EVIDENCE | R1/R2 VERIFIED；112 项自动回复单测通过；R3 真实环境证据仍开放 |
| AR-RA-010 | P1 | canonical ActionKind、优先级和互斥规则未统一，导致路由不可唯一复现 | VERIFIED | 已补固定 ruleId、候选 tie-break、唯一 primaryAction、互斥矩阵和 PolicyDecisionTrace；AR-VS-01 单测已通过，R1/R2 独立复审确认 |
| AR-RA-011 | P1 | clarify/awaiting_user 的不回复、重复澄清和目标切换闭环缺失 | IMPLEMENTED_PENDING_EVIDENCE | AR-VS-02 11 项定向回归及全套回归通过；待真实编排接入 |
| AR-RA-012 | P1 | handoff 白名单、reason code 和证据阈值过于开放 | IMPLEMENTED_PENDING_EVIDENCE | Pre-send Review 已强制白名单和结构化证据；待真实出站回读 |
| AR-RA-013 | P1 | “等价秘密”及混合消息的部分拒绝和全链路拦截不可执行 | IMPLEMENTED_PENDING_EVIDENCE | Policy/Pre-send 敏感 fail-closed 已覆盖；待红队、日志/备份/重试 payload 扫描 |
| AR-RA-014 | P1 | 状态字段命名与迁移不变量不统一，无法保证生命周期和并发安全 | VERIFIED | 已统一 observedStage/targetStage、stateVersion/CAS、乱序、sourceSequence 和陈旧回放语义；AR-VS-01 状态单测已通过 |
| AR-RA-015 | P1 | PolicyDecisionTrace、Outcome Review 和 ConversationState 持久化契约不完整 | IMPLEMENTED_PENDING_EVIDENCE | 新增 031 迁移、编排适配和 Outcome Review 内核；待 PostgreSQL 回读与 Activity 投影 |
| AR-RA-016 | P1 | 新策略缺少可采信的测试、阈值告警、灰度和回滚演练证据 | OPEN | 112 项单测已通过；继续执行指标阈值、告警 Owner、canary、kill switch、迁移回滚和 reconcile 演练 |
| AR-RA-018 | P1 | AR-VS-08 031 state/review 表已迁移但未接入 buyer push 主运行链路，真实测试只证明 legacy run/message 持久化 | OPEN | `test:auto-reply:buyer-push:postgres` 已证明买家 push→Agent→模拟出站→legacy PostgreSQL 回读；必须补主入口编排接入和三表真实写读后复审 |

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
