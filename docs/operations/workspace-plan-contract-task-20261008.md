# Workspace Plan Mode 通用合同（2026-10-08）

> SUPERSEDED on 2026-10-08 by [plan-io-alignment-20261008.md](plan-io-alignment-20261008.md). This archival note is retained for history; implementation and review MUST follow the versioned tool-metadata contract, path grammar, confirmation-phase facts, and IAB acceptance gates in the superseding document.

## 设计目标

- Plan Mode 默认由模型自主生成工具顺序，不内置任何单一业务任务的固定步骤。
- Runtime 只负责通用边界：可用工具、工具动作、步骤顺序、确认门禁、失败重规划和持久化恢复。
- 业务方如需更严格的目标证明，可通过 `WorkspacePlanPolicy` 注入，并使用 `key + version` 持久化策略身份。
- 未注入业务策略时，不执行业务样例级的参数、文件名、商品标题或结果谓词校验。

## 通用运行规则

- 模型计划最多 8 步；空计划交由模型直接回答。
- `workspace_prepare_write` 默认需要用户确认，读取和查询工具默认不需要确认。
- 未注册工具或动作 fail-closed，不执行未知调用。
- 持久化计划恢复时保留旧 `goalPredicateId` / `facts` 字段；若旧计划依赖缺失策略，完成状态保持阻塞，不静默宣称完成。
- 计划完成必须满足：计划状态为 `completed`、所有步骤为 `succeeded`、无当前步骤、无未完成或待确认步骤。
- 计划内同一响应的尾部工具调用不会在完成步骤后继续执行；通用模型计划仍可在后续轮次自主继续。

## 可插拔策略

`WorkspacePlanPolicy` 支持以下扩展点：

- `selectPlan`：按任务和可用工具选择额外计划；
- `validateCall`：在通用校验通过后增加业务校验；
- `goalStatus`：在通用完成条件通过后增加目标谓词校验。

策略必须提供稳定的 `key` 和正整数 `version`。恢复运行时若策略身份不匹配，Runtime 直接阻塞并要求重新连接，避免策略丢失后误收口。

## 验证

- API TypeScript 检查通过。
- 通用 Plan/Runtime 定向回归覆盖：计划完成状态、确认尾调用、重规划、恢复、重放、未知工具/动作和策略附加校验。
