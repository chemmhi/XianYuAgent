# Workspace 复合任务事件与上下文复盘（2026-10-07）

## 范围与证据

- 生产服务器 `/home/ubuntu/xianyu-agent-prod` 的 Git `b8e6615d`，API/Worker 容器运行。仅使用 SSH 读取容器日志与 `workspace.runs/run_events/messages`，未写生产数据库。
- 目标指令的 09:41 Run `38f9b119-e344-4217-8107-7ca48da95907` 失败；12:04 Run `d2ae7607-bc1a-4b2c-857f-d026c15554e6` 成功。下列计数取自对应 Run 的持久化事件，而非页面截图。
- 成功 Run：1,147 条事件；15 次 `tool.result`，其中 2 次 `status=failed`；另有 1 次 Skill 退出码 1 被错误记为 `status=succeeded`；4 次确认；6 次 `context.compacted`。仅 `tool.call.delta` 就有 516 条，`assistant.delta` 有 432 条。6 条“上下文摘要”消息合计 38,109 字符，单条最大 8,523 字符。
- 失败 Run：2,534 条事件；13 次工具结果、1 次失败；其中 `reasoning.delta` 2,063 条。该 Run 是旧版本行为，不能据此推断当前代码仍写入原生推理增量。
- API 容器标准输出没有这两个 Run 的逐工具结构化日志；`workspace.run_events` 是可复核的持久化执行日志。另见到闲鱼 IM 凭证失效/滑块日志，和本任务无因果证据，未纳入本次修改。

## 已确认的问题

1. 压缩原实现是截取最近 16 条工具/助手正文并拼接，既没有模型语义压缩，也把原始 JSON、Skill 帮助输出和大段结果写入可见“上下文摘要”。确认续跑又同时回放当前 Run 原始工具消息和事件检查点，形成重复上下文；两次 `context.compacted status=retrying` 对应模型 400/413 后的重试。
2. Skill 执行退出码 1 被包装成 `kind=read` 后，运行时只检查顶层 `ok`，于是 `tool.result` 标记成功；后续模型会基于错误结果继续规划。真正的“需要登录”状态也必须和执行失败区分。
3. 成功 Run 有 15 次工具调用，包括多次 `--help`、一次误用 `workspace_read`、一次缺少 `batchId` 的 `coupon_bind`、一次 `paidAutoDelivery=true` 布尔简写造成的无效确认。自动化规则 v1 从“关闭、无卡券”更新为相同状态，v2 才真正开启并绑定卡券。用户为一个目标执行了 4 次确认，其中 1 次可避免。
4. `tool.call.delta` 将参数片段逐条持久化，`tool.call.started/completed` 又保存完整参数；前端把技术事件、原始推理与摘要混入执行轨迹，导致有效结果被淹没，并增加了敏感参数的存储面。

## 修复边界

- `workspace-context.ts`：结构化抽取已验证结果、失败原因与关键标识；兼容识别旧事件中“外层成功、Skill 内层失败”的记录；模型在有界输入上生成短检查点，异常时使用有界降级摘要；初始 Run 生成只含可用工具的结构化短计划。压缩事件只记录前后字符数与方法，不记录正文。
- `workspace.ts`：确认续跑只回放此前对话的用户/最终答复及当前 Run 的事件检查点；旧 Run 没有事件时保留一条有界工具结果，兼容重连。
- `pi-runtime.ts`：正确映射 Skill 非零退出与登录待操作状态；同一 Run 的相同 Skill 参数复用成功结果，跨确认续跑从持久化事件恢复；写命令成功后清除只读查询缓存，失败与待登录结果不复用；新事件只保存参数 SHA-256 指纹及只读标记，不保存完整参数；不再持久化工具参数增量。
- `workspace-commands.ts`：自动化规则拒绝布尔简写及无实际变化的配置，避免空确认与版本递增。
- `messages.ts`：隐藏原始推理、内部压缩正文、合成进度和已复用的工具结果；只展示有用的计划、工具结果和最终答复，并截断过长工具正文。

## 验收与回滚

- 回归覆盖：压缩长度/标识保留、可用工具计划、续跑去重、Skill 失败/登录、同 Run 与跨续跑结果复用、写命令后的只读缓存失效、自动化空变更、前端事件投影及 Chrome/CDP + PostgreSQL Workspace 流程。
- 已执行：API 全量在 `AUTO_REPLY_AGENT_SEND_DELAY_SECONDS=0` 下通过；Web 93 文件 / 376 项通过；Pi Workspace 与确认/取消两条 Chrome/CDP + PostgreSQL E2E、PostgreSQL 确认 smoke、API/Web 类型检查和构建通过。默认 API 组合脚本在已有风险 `S5-RISK-069` 对应的 auto-reply smoke 延迟处挂起，未计作通过。确认/取消 E2E 的旧断言在未修改的 `main` 上同样失败，已改为核对 API `policyRef`，并从新会话验证第二次取消。
- 生产 Run 只读分析不能证明修改后的真实网盘任务已经运行；发布后应新建受控 Run，核对 `context.compacted.beforeChars/afterChars`、`method`、工具结果数、确认数、最终卡券/商品配置及 UI 轨迹，不重放原 Run 的写动作。
- 回滚为应用提交回退并通过 `main` 的 GitHub 部署工作流发布；本切片无迁移，也不清理历史事件。旧事件 `arguments` 仍可被读用于恢复，新事件使用 `argumentFingerprint`。
- 交付：功能提交 `1f918ba` 已以 `--no-ff` 合入 `main`（merge commit `2f5ba65`）；主线 API 定向 59/59、Web 全量 376/376、两端构建和类型检查通过。该合并不代表生产已部署或修改后真实网盘 Run 已复验。
