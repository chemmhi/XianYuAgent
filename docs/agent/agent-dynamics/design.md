# Agent 动态复杂模块设计

- 设计日期：2026-09-21
- 设计状态：PASS（进入纵向切片实现）
- 目标路由：`/agent-dynamics`
- 设计输入：`artifacts/auto-reply-agent-ui.html`、`docs/03-frontend-design.md`、`docs/02-data-api.md`、`docs/agent/auto-reply/design.md`

## 1. 用户行为与验收结果

管理员在一级导航“订单管理”和“设置”之间打开“Agent 动态”，查看买家消息进入后的自动回复运行状态、链路健康、异常聚合和可追溯运行记录；点击记录后打开详情抽屉，查看受控的买家输入、最终回复、阶段时间线和发送/落库结果。

验收标准：

1. 正式前端 `/agent-dynamics` 按原型结构渲染，桌面 1440×900、移动 390×844 均可用；
2. 页面只消费 `/api/v1/auto-reply/activity/summary`、`/api/v1/auto-reply/runs`、`/api/v1/auto-reply/runs/{id}`；不直接访问数据库、闲鱼协议或 Workspace Run；
3. 真实自动回复执行后，运行记录和阶段事件写入 PostgreSQL，页面刷新后可读到同一条运行；
4. 失败、转人工、处理中、空数据、接口错误和未授权均有明确状态；
5. 日志/事件只保留脱敏摘要、digest、状态和必要正文预览，不记录 Cookie、Token、Prompt、Chain-of-Thought 或模型密钥。

## 2. 范围与非目标

### 本次范围

- 新增一级导航与正式路由 `/agent-dynamics`；
- Agent 动态页面：KPI、五阶段流水线、事件流、链路健康、状态分布、异常摘要、运行记录表、详情抽屉；
- 运行列表筛选（状态、阶段、关键词、时间范围、账号）与分页；
- 运行详情时间线与“打开在线聊天”导航；
- `auto_reply_run_events` 迁移、Memory/PostgreSQL Store、查询服务和 REST API；
- 真实 PostgreSQL + Chrome/CDP 端到端验证、固定视口截图与差异记录。

### 非目标

- 不修改 Agent 意图识别、工具调用、发送策略和模型提示词；
- 不把 Workspace Run 复用成买家侧运行记录；
- 不新增独立消息队列、指标仓库或新的实时 WebSocket 协议；首版用真实 API 的 5 秒轮询，并展示最近刷新时间；
- 不在首版实现异常“标记已处理”写操作；详情抽屉只提供可追溯查看和跳转聊天。

## 3. 模块边界与依赖

### 后端

- `auto-reply-activity` 查询模块：只读聚合 KPI、运行列表、详情和异常；
- `messages.auto_reply_runs`：运行事实的唯一来源；
- `messages.auto_reply_run_events`：阶段事件事实的唯一来源；
- `messages.messages` / `messages.conversations`：买家输入、出站回复、买家与商品展示字段；
- `accounts.accounts` / `products.products`：账号和商品展示字段；
- `auth`：服务端 Session 与账号 scope 校验；
- `store`：PostgreSQL 与 Memory 的统一数据访问边界。

依赖方向：`HTTP route -> AutoReplyActivityService -> Store -> PostgreSQL/Memory`。路由层只做参数解析、鉴权和 envelope，不写 SQL、不编排业务状态。

### 前端

- `features/agent-dynamics/api.ts`：REST adapter；
- `features/agent-dynamics/controller.ts`：查询参数、刷新、抽屉、loading/error/empty 状态；
- `features/agent-dynamics/types.ts`：API/ViewModel 类型；
- `features/agent-dynamics/components/AgentDynamicsPage.tsx`：页面容器；
- `features/agent-dynamics/components/AgentDynamicsViews.tsx`：KPI、pipeline、health、table、drawer 视图；
- `features/agent-dynamics/components/agent-dynamics.css`：原型 token 和响应式规则。

页面不保存业务事实，只保存筛选、当前页、选中 runId、刷新状态和错误信息。

## 4. 数据模型与状态

### 4.1 运行状态映射

| 持久化状态 | 原型阶段 | UI 执行状态 |
| --- | --- | --- |
| `received` | 网关接收 | 处理中 |
| `classified` | 意图识别 | 处理中 |
| `context_loaded` | 上下文读取 | 处理中 |
| `generated` | 回复生成 | 处理中 |
| `simulated` / `persisted` | 提交并落库 | 自动回复 |
| `handoff` | 上下文不足/人工介入 | 转人工 |
| `failed` | 回复生成失败/发送失败 | 执行失败 |
| `skipped` | 未满足自动回复条件 | 已跳过 |

`AutoReplyDecision` 与现有实现保持兼容：`replied | handoff | skipped | failed`。

### 4.2 新增表：`messages.auto_reply_run_events`

字段：`id uuid PK`、`run_id uuid FK`、`admin_id uuid FK`、`account_id uuid FK`、`sequence integer`、`event_type text`、`stage text`、`status text`、`occurred_at timestamptz`、`duration_ms integer nullable`、`metadata_redacted_json jsonb`、`trace_id text`。

约束与索引：`unique(run_id, sequence)`；索引 `(account_id, occurred_at desc)`、`(run_id, sequence)`、`(admin_id, occurred_at desc)`；删除策略 `ON DELETE RESTRICT`。元数据只能写脱敏摘要和 digest。

事件写入：`createAutoReplyRun` 写入 `run.received`；每次 `updateAutoReplyRun` 状态发生变化时追加一条事件；重复状态更新不追加重复事件。Memory Store 使用同样的事件语义。

迁移策略：新增编号 024，先建表和索引，再由代码写入新事件；旧运行没有历史事件时，详情查询按 `createdAt/updatedAt` 生成最小兼容时间线，不回填敏感正文。回滚为删除 024 表及代码引用，不修改 021 既有字段。

## 5. API 契约

统一使用现有 `{data, meta}` 成功 envelope、Session Cookie、CSRF 仅用于写请求；查询请求始终使用服务端 admin/account scope，不信任前端传入的管理员标识。

### `GET /api/v1/auto-reply/activity/summary`

Query：`accountId?`、`range=24h|7d`、`asOf?`。

返回：`gateway`、`kpis`、`pipeline`、`health[]`、`statusDistribution[]`、`exceptions[]`、`asOf`、`refreshIntervalMs=5000`。

### `GET /api/v1/auto-reply/runs`

Query：`accountId?`、`range`、`status?`、`stage?`、`keyword?`、`page?`、`pageSize?`。

返回：`{ items, total, page, pageSize, totalPages }`。每条包含 `runId`、`createdAt`、`buyer`（展示名/头像/会话引用）、`product`、`intent`、`stage`、`decision`、`senderOutcome`、`persisted`、`durationMs`、`failureCode`、`inboundPreview`。

### `GET /api/v1/auto-reply/runs/{runId}`

返回：运行摘要、买家/商品、受控输入预览、最终回复预览（若有）、发送/落库结果、阶段 `timeline[]`、在线聊天跳转信息。不存在返回 `404 NOT_FOUND`，无账号 scope 返回 `403 FORBIDDEN`。

错误码复用：`VALIDATION_FAILED`、`NOT_FOUND`、`FORBIDDEN`、`RETRYABLE_TIMEOUT`。

## 6. 前端状态矩阵

| 状态 | 页面行为 |
| --- | --- |
| 首次加载 | 骨架屏；保留原型布局占位 |
| 成功 | 显示真实 KPI、列表、更新时间 |
| 空数据 | 保留标题与筛选，显示“暂无运行记录” |
| 接口失败 | 顶部错误条 + 重试按钮；不渲染假数据 |
| 未授权 | 由 AuthGate 重新登录 |
| 抽屉加载 | 抽屉显示 loading；列表不清空 |
| 抽屉失败 | 抽屉显示错误与重试 |
| 轮询刷新 | 顶部显示“实时刷新 · 最近 X 秒”或“刷新失败” |
| 移动端 | 隐藏外层 sidebar，pipeline 纵向，table 横向滚动，抽屉改为底部 sheet |

## 7. 测试与证据

- 单元：状态映射、筛选参数、聚合百分比、duration 计算、空/失败 view model；
- 集成：PostgreSQL 迁移、运行事件写入、列表分页、详情账号隔离；
- 真实 E2E：真实浏览器 `/agent-dynamics` → API → PostgreSQL `auto_reply_runs/events` → 页面可见同一 run；
- 视觉：原型基线与实现固定截图 `1440×900`、`390×844`，并记录逐项偏差；
- 回滚：代码提交可回退；迁移 024 可逆；页面无写副作用，不需要数据补偿。

## 8. 设计门禁结论

阶段 0-4 设计输入、模块边界、API、数据约束、状态矩阵、测试和回滚均已明确；无未标记的 P0/P1 设计歧义。进入阶段 5 纵向切片实现。
