# 修复域风险登记

## 级别

- P0：数据破坏、越权、核心流程不可用或不可回滚；立即 BLOCKED。
- P1：核心验收失败、关键契约错误或无法复现构建/部署；阶段 FAIL/BLOCKED。
- P2：非核心缺陷、重要可维护性或体验问题；本轮修复后才能关闭。
- P3：低风险改进；可转后续任务，但不能掩盖 P0–P2。

## 当前修复风险

| 编号 | 级别 | 风险 | 当前状态 | 处置 |
| --- | --- | --- | --- | --- |
| AR-RA-001 | P0 | 业务路由继续散落在硬编码分支或 Prompt | OPEN | 统一 PolicyEngine，架构扫描拦截新增直连路由 |
| AR-RA-002 | P1 | persisted 被误读为 resolved | OPEN | 分离 transport/resolution 状态并补 Outcome Review |
| AR-RA-003 | P1 | 信息不足时误答或过早 handoff | OPEN | clarify、awaiting_user、问题预算和恢复事件 |
| AR-RA-004 | P1 | 生命周期阶段被模型猜测推进 | OPEN | 订单/商品事实投影，分离 observed/target stage |
| AR-RA-005 | P1 | 售后/负面情绪下误推荐或催评价 | OPEN | EmotionPolicy、RecommendationEligibility 门控 |
| AR-RA-006 | P1 | Outcome Review 重试导致状态倒退或重复处理 | OPEN | lease、幂等键、乐观锁、回放和人工覆盖 |
| AR-RA-007 | P2 | 旧文档继续传播默认 handoff 语义 | OPEN | 旧文档加兼容横幅，canonical policy 迁移映射 |
| AR-RA-008 | P2 | 指标把传输完成当成业务成功 | OPEN | KPI 拆分并保留 resolution evidence |
| AR-RA-009 | P1 | AR-VS-00 策略已文档化但尚未通过独立评审和代码回归 | OPEN | 完成三轮复审，随后在 AR-VS-01 至 AR-VS-07 中以测试和真实回读验证 |

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
