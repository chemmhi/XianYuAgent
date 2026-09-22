# 兼容入口与迁移映射

## 新旧职责

docs/agent/auto-replay/repair-agent 负责修复治理 canonical：范围、策略、状态、切片、门禁、风险、评审、发布。

docs/agent/auto-reply 负责运行契约与历史兼容：Intent→Plan→Act→Observe→Respond、工具、活动查询、历史风险快照。

## 文档映射

| 旧文档 | 新 canonical 位置 | 处理 |
| --- | --- | --- |
| repair-plan.md | 00-scope.md、01-baseline-audit.md、02-target-architecture.md、03-domain-policy-contract.md、05-vertical-slices.md | 保留旧快照，当前修复以新文档为准 |
| repair-checklist.md | 06-stage-gates.md、templates/vertical-slice-card.md | 后续新增 checklist 只写新目录 |
| risk-register.md | 07-risk-register.md | 旧风险编号通过映射表保留 |
| modification-plan.md | 05-vertical-slices.md、06-stage-gates.md | 旧批次计划仅作历史记录 |
| design.md | 运行时 source-of-truth | 不迁移；只补 canonical 修复入口 |
| activity.md | 运行时/管理端契约 | 不迁移；由 04-data-api-contract.md 约束新增字段 |

## 防漂移规则

- 新增修复策略、风险、评审和切片只写 auto-replay/repair-agent；
- 旧目录文档只能补兼容横幅、运行契约或历史证据，不能继续扩展新的治理规则；
- 代码/API 变更必须同时更新新目录的 data/API、风险、状态和评审记录；
- 引用旧文档的外部文档保留运行契约链接，同时增加本 canonical 索引链接；
- 发现旧文档与新策略不一致时，按新策略登记迁移风险，不通过删除旧文本解决历史可追溯性问题。
