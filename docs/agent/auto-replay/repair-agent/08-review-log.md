# 修复域评审记录

## 2026-09-22：repair-agent 文档域重组

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| AR-REPAIR-R1 | 业务 / 验收 | READY_FOR_REVIEW | 00-scope.md、03-domain-policy-contract.md：明确无硬编码路由、低拒绝/低 handoff 和终极敏感信息拒绝矩阵 |
| AR-REPAIR-R2 | 架构 / 数据流 | READY_FOR_REVIEW | 02-target-architecture.md、04-data-api-contract.md、05-vertical-slices.md：明确 PolicyEngine、双层状态、Pre-send Review、Outcome Review 与 AR-VS-00 至 AR-VS-09 |
| AR-REPAIR-R3 | 质量 / 安全 / 运维 | READY_FOR_REVIEW | 06-stage-gates.md、07-risk-register.md、11-release-rollback.md：明确三轮评审、风险闭环、灰度与回滚；业务代码未修改 |

## 历史规划评审迁移

| 旧编号 | 新位置 | 说明 |
| --- | --- | --- |
| AR-PLAN-R1 | 00-scope.md、03-domain-policy-contract.md | 业务约束和拒绝矩阵迁移 |
| AR-PLAN-R2 | 02-target-architecture.md、05-vertical-slices.md | 架构与切片迁移 |
| AR-PLAN-R3 | 06-stage-gates.md、09-status.md | 门禁和状态迁移 |

## 复审规则

评审问题必须先修复，再重新执行受影响门禁和测试，最后由独立评审关闭。未关闭的 P0–P2 不得进入下一阶段。
