# Agent 动态活动契约

> 本文冻结“Agent 动态”Tab 从自动回复运行、事件落库到页面展示的跨层契约。它补充 [`design.md`](./design.md) 的运行设计，不替代自动回复 Agent 的安全预检、工具和发送策略。

## 1. 用户行为与模块边界

“Agent 动态”位于订单管理与设置之间，面向管理员提供以下只读能力：

1. 查看当前账号或管理员可见账号范围内的自动回复吞吐、处理状态、异常和健康摘要；
2. 分页浏览自动回复运行记录，按时间、状态、阶段和关键词过滤；
3. 打开单条运行详情，查看脱敏的运行摘要、买家入站消息、出站消息引用、商品引用和阶段时间线；
4. 从运行详情跳转到正式消息页继续处理，不能在动态页直接发送或修改买家消息。

正式前端路由由 `AgentDynamicsPage` 承载；页面的读接口只有下文三条 `/api/v1/auto-reply/*` 查询 API。页面不得读取数据库、拼装账号范围或把原型 mock 当作生产数据源。

## 2. 数据来源与存储对象

### 2.1 运行主表

运行主表为 `messages.auto_reply_runs`，一条记录代表一个买家入站消息触发的自动回复尝试。唯一性由 `admin_id + inbound_message_id` 保证；同一入站消息重复 push 必须复用已有 run。

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `id` | `uuid` | run 标识 |
| `admin_id` | `uuid` | 创建运行的管理员主体 |
| `account_id` | `uuid` | 闲鱼卖家账号范围 |
| `conversation_id` | `uuid` | 本地会话引用 |
| `inbound_message_id` | `uuid` | 触发 run 的买家入站消息 |
| `intent` | `text` | 脱敏意图标识 |
| `decision` | `text` | `replied | handoff | skipped | failed` |
| `status` | `text` | 当前状态，见 §3 |
| `risk_flags` | `jsonb` | 风险标签数组，默认 `[]` |
| `product_id` | `uuid null` | 当前商品引用 |
| `order_refs` | `jsonb` | 订单引用数组，默认 `[]` |
| `input_digest` | `text` | 入站输入摘要哈希/指纹 |
| `context_digest` | `text null` | 上下文摘要哈希/指纹 |
| `reply_digest` | `text null` | 回复摘要哈希/指纹 |
| `sender_outcome` | `text null` | `simulated | known_success | known_failure | unknown` |
| `outbound_message_id` | `uuid null` | 出站消息引用 |
| `failure_code` | `text null` | 稳定错误码，不保存原始异常堆栈 |
| `created_at` / `updated_at` | `timestamptz` | 运行创建和最近更新时间 |

主表外键默认保留历史记录，不因会话、商品或账号删除而物理删除。实际迁移由 `021_auto_reply_runs.sql` 提供。

### 2.2 活动事件表

阶段迁移事件存储在 `messages.auto_reply_run_events`。一条事件表示 run 的可审计状态快照，不是完整 Prompt/Tool trace。

| 字段 | 类型 | 约束/语义 |
| --- | --- | --- |
| `id` | `uuid` | 主键 |
| `run_id` | `uuid` | FK `messages.auto_reply_runs(id)`，`ON DELETE RESTRICT` |
| `account_id` | `uuid` | FK `accounts.accounts(id)`，用于账号过滤 |
| `sequence` | `integer` | run 内从 1 开始递增；`UNIQUE(run_id, sequence)` |
| `event_type` | `text` | 当前为 `run.created` 或 `run.<status>` |
| `stage` | `text` | 当前阶段，见 §3 |
| `status` | `text` | 事件发生时的 run 状态 |
| `occurred_at` | `timestamptz` | 事件发生时间 |
| `duration_ms` | `integer null` | 阶段耗时；允许暂缺 |
| `trace_id` | `text null` | 可关联 Trace 的标识，不可写入凭证或正文 |
| `payload_json` | `jsonb` | 脱敏摘要，默认 `{}` |

索引：`(account_id, occurred_at desc, id desc)` 支持账号范围时间查询；`(run_id, sequence)` 支持详情时间线读取。

### 2.3 脱敏边界

`payload_json` 只允许保存决策、意图、错误码、摘要哈希、计数和资源 ID 等最小证据。运行阶段可按白名单写入三组结构化摘要：`input`（步骤输入的类型、digest、资源引用和计数）、`output`（状态、决策、结果 digest、结果引用和计数）以及 `error`（错误码和脱敏原因）。禁止写入 Prompt 原文、模型 Chain-of-Thought、Cookie、Token、API Key、完整买家正文或完整订单/商品敏感字段。详情接口如需展示入站/出站正文，必须通过已校验的 `messages` 领域读取并遵守管理员账号 scope；事件 payload 本身不能成为正文旁路。

## 3. 状态机与事件语义

### 3.1 后端原始枚举

| 后端 `status` | 后端 `stage` | 页面阶段 | 说明 |
| --- | --- | --- | --- |
| `received` | `gateway_received` | `gateway` | 网关已接收 |
| `classified` | `intent_recognition` | `intent` | 意图识别完成 |
| `context_loaded` | `context_read` | `context` | 上下文读取完成 |
| `generated` | `reply_generation` | `generation` | 回复已生成或正在结束生成阶段 |
| `simulated` | `sending` | `persistence` | simulate 发送结果已记录 |
| `persisted` | `persisted` | `persistence` | 回复发送结果与运行记录已闭环 |
| `handoff` | `handoff` | `generation` | 安全转人工，未发送 AI 回复 |
| `skipped` | `skipped` | `generation` | 资格检查或策略决定跳过 |
| `failed` | `failed` | `generation` | 运行失败，错误码见 `failureCode` |

后端通过 `autoReplyStageForStatus(status)` 计算列表阶段。`decision` 是最终业务决定，不能与 `status` 混为一谈；例如 `decision=replied` 通常在 `status=persisted` 后出现。

### 3.2 事件写入规则

- 创建 run 时写入一个 `run.created` 事件；事件的 `status/stage` 是创建时快照。
- 更新 run 时，仅在调用方传入 `patch.status` 时追加 `run.<status>` 事件；只更新 digest、sender outcome、引用或错误码不得制造 `run.updated` 事件。
- 调用方应只在状态发生迁移时传入 `patch.status`；当前存储层不主动拒绝“相同状态重复事件”，因此重复迁移应由上层幂等逻辑阻止。
- MemoryStore 在进程内维护 run 级序号；PostgresStore 在插入事件时对 run 行加锁并重新计算序号。
- `duration_ms` 当前为可选字段；列表和摘要的运行耗时优先使用 `updated_at - created_at`，事件时间线不得假设每个事件都有阶段耗时。

### 3.3 一致性风险

当前 Postgres 实现先提交 `auto_reply_runs`，再在独立事务中写入首个/后续事件。若第二个事务失败，可能出现“run 已存在但事件缺失”。发布前必须补齐以下任一方案并加入真实 PostgreSQL 回归：

1. 将 run mutation 与对应状态事件放进同一事务；或
2. 提供可重试的事件补偿/重建机制，并在摘要、详情读取时暴露缺失事件告警。

在该门禁关闭前，页面只能将事件时间线视为“已落库的可审计事件子集”，不能承诺完整重放。

## 4. 查询 API 契约

所有接口都要求管理员 Session；服务端从 Session 注入 `adminId`，客户端提交的 `accountId` 只能缩小范围，不能扩大权限。成功响应使用统一 envelope：

```ts
type SuccessEnvelope<T> = {
  success: true;
  message: null;
  data: T;
  requestId: string;
  traceId: string;
};
```

错误响应沿用 `VALIDATION_FAILED`、`FORBIDDEN`、`NOT_FOUND`、`UNAUTHENTICATED` 等统一错误码。

### 4.1 活动摘要

```http
GET /api/v1/auto-reply/activity/summary
  ?accountId=<uuid>
  &from=<ISO-8601>
  &to=<ISO-8601>
```

查询参数均可省略：默认时间窗为最近 24 小时；最大时间跨度 31 天；`accountId` 省略时聚合管理员当前 active scope 可见的所有账号。返回：

```ts
type AutoReplyActivitySummary = {
  from: string;
  to: string;
  asOf: string;
  inboundCount: number;
  processingCount: number;
  persistedCount: number;
  handoffCount: number;
  failedCount: number;
  skippedCount: number;
  completionRate: number;       // 0..1，终态为 persisted/handoff/skipped/failed
  throughputPerSecond: number;  // run 数 / 查询秒数
  p95DurationMs: number;
  byStatus: Array<{ status: AutoReplyRunStatus; count: number }>;
  byStage: Array<{ stage: AutoReplyRunStage; count: number; averageDurationMs: number }>;
  exceptions: Array<{ code: string; count: number; status: AutoReplyRunStatus }>;
  health: Array<{ component: string; status: string; observedAt: string; details: Record<string, unknown> }>;
};
```

`byStatus` 与 `byStage` 按每个 run 的当前状态/当前阶段统计，不是事件表全量迁移次数；因此它们不能单独用来绘制“每一阶段经过了多少条消息”的漏斗。需要完整 pipeline 计数时，应另行聚合 `auto_reply_run_events`。

Postgres 实现的 `health` 为每个 component 最新的 `observability.health_snapshots`；MemoryStore 目前返回空数组。页面必须能在 health 为空时保持可读，不得把“无数据”误报为 offline。

### 4.2 运行记录列表

```http
GET /api/v1/auto-reply/runs
  ?accountId=<uuid>
  &from=<ISO-8601>
  &to=<ISO-8601>
  &status=<raw-status>
  &stage=<raw-stage>
  &keyword=<text>
  &page=1
  &pageSize=20
```

默认 `page=1`、`pageSize=20`，`pageSize` 最大 100；`keyword` 最大 120 个字符。返回：

```ts
type AutoReplyRunListItem = AutoReplyRunRecord & {
  stage: AutoReplyRunStage;
  durationMs: number;
  buyerDisplayName?: string;
  productTitle?: string;
  inboundMessagePreview?: string;
};

type AutoReplyRunListResult = {
  items: AutoReplyRunListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
```

列表按 `created_at desc, id desc` 排序。后端过滤枚举使用原始 `status` / `stage`，不是页面展示用的 `replied|processing` 或 `gateway|intent|context|generation|persistence` 聚合值。

### 4.3 运行详情

```http
GET /api/v1/auto-reply/runs/{runId}
```

详情读取由 `runId` 对应的 `admin_id` 和 active account scope 授权；`accountId` 查询参数不是授权依据，客户端不能依赖它绕过服务端校验。返回：

```ts
type AutoReplyRunDetailRecord = {
  run: AutoReplyRunListItem;
  events: AutoReplyRunEventRecord[]; // sequence asc
  conversation?: ConversationRecord;
  inboundMessage?: MessageRecord;
  outboundMessages: MessageRecord[];
  product?: ProductRecord;
};
```

不存在、越权或已失去账号 scope 时统一表现为 `404 NOT_FOUND`，避免向无权管理员泄露 run 是否存在。

## 5. 前端 Canonical VM 适配责任

后端 raw DTO 与高保真页面 VM 分层，`apps/web/src/features/agent-dynamics/api.ts` 是唯一 adapter 边界。页面组件不得直接消费后端原始枚举。

### 5.1 映射规则

| 页面 VM | 后端来源/规则 |
| --- | --- |
| `range=24h\|7d` | adapter 计算 `from/to` ISO 时间，不把 `range` 直接传给后端 |
| `stage=gateway\|intent\|context\|generation\|persistence` | 映射 `gateway_received\|intent_recognition\|context_read\|reply_generation\|sending/persisted`；`handoff/skipped/failed` 归入 `generation` 异常展示 |
| `decision` | 直接使用 run `decision`，处理态由 raw `status` 不属于终态时派生为 `processing` |
| `persisted` | 终态集合 `persisted/handoff/skipped/failed` 为 `true`；仍在 `received/classified/context_loaded/generated/simulated` 为 `false` |
| `buyer` | `buyerDisplayName` + `conversation.id`；缺少昵称时显示脱敏占位，不硬编码当前账号 |
| `product` | `productTitle` + `product.id`；无商品引用显示“未关联商品” |
| `senderOutcome` | `senderOutcome` 与 `decision/status` 组合展示；未知发送结果必须保留 `unknown` 提示 |
| `timeline` | `events` 按 `sequence` 升序转换；缺失 duration 不得补造耗时 |

页面状态过滤的 `replied` / `processing` 是聚合语义，而后端列表过滤器只接受 raw enum。adapter 在发送请求前必须显式转换或组合查询；禁止把 `replied`、`processing` 直接作为后端 `status`，否则会收到 `422 VALIDATION_FAILED`。

### 5.2 账号上下文

页面必须复用 `AccountContext` 的 loading、error 和未选择状态：

- `accountsLoading` 时显示页面级 skeleton，不发出 `accountId=undefined` 的“当前账号”请求；
- `accountsError` 显示可重试错误，不伪装为 Agent offline；
- 没有选中账号时，要么明确标记“全部账号”并调用省略 `accountId` 的聚合查询，要么要求管理员先选择账号；不得显示固定的单账号文案。

## 6. 错误、刷新与可观测性

- `401 UNAUTHENTICATED`：回到登录流程；
- `403 FORBIDDEN`：显示账号范围不足，并保留页面结构；
- `404 NOT_FOUND`：详情抽屉显示“运行记录不存在或已不可见”；
- `422 VALIDATION_FAILED`：只提示参数/筛选错误，不重试同一请求；
- 网络、超时或 `503 SERVICE_UNAVAILABLE`：保留上次成功摘要，显示刷新失败和重试入口；
- 每次请求保留 `requestId` / `traceId`，前端错误上报只记录 ID、错误码和页面状态，不上传消息正文、Cookie 或 Token。

页面刷新间隔由前端控制；当前原型默认 5 秒，但接口没有服务端 `refreshIntervalMs` 字段，前端不得把该值假设为后端事实。

## 7. 真实端到端验收门禁

Agent 动态不能以 mock、API 200 或页面能打开作为完成证据。至少保留以下证据链：

```text
闲鱼实时 push（或受控真实 Agent 触发）
  -> BuyerAutoReplyAgentOrchestrator
  -> messages.auto_reply_runs
  -> messages.auto_reply_run_events
  -> 三条查询 API
  -> AgentDynamicsPage raw DTO adapter
  -> 运行列表/摘要/详情抽屉可见
```

验收需覆盖：

1. 至少一条 `persisted`、一条 `handoff`、一条 `failed` 或 `processing` run；
2. PostgreSQL 迁移 `021`、`024` 在隔离数据库真实执行，查询 API 回读与 MemoryStore 结果口径一致；
3. 账号 scope 越权返回 403/不可见 404；
4. 重复 push 只保留一个 run，状态事件 sequence 单调递增；
5. `1440×900` 与 `390×844` 截图保存，连同 loading/empty/error/forbidden 和详情抽屉状态复核；
6. 视觉验收引用 `artifacts/auto-reply-agent-ui.html` 的版本、viewport、token 映射和逐项差异记录。

## 8. 未关闭的契约风险

| 风险 | 当前状态 | 关闭条件 |
| --- | --- | --- |
| raw DTO 与页面 canonical VM 不同层 | 文档已冻结 adapter 责任，前端仍需实现 | adapter 单测 + 真实 API 回读 |
| `range`、聚合 status/stage 直接传后端 | 后端不接受 `range`，status/stage 只接受 raw enum | 请求构造回归覆盖 422 场景 |
| PG run 与首个事件非同一事务 | 存在事件缺失窗口 | 同事务或补偿机制 + 故障回归 |
| `duration_ms` 事件级数据不完整 | 当前允许 null | 明确阶段耗时写入或 UI 保持可选 |
| `byStage` 不是完整漏斗计数 | 当前按 run 最终阶段统计 | 事件表聚合或 UI 明确“当前阶段分布” |
| Memory/PG keyword 过滤字段不完全一致 | Memory 只查 id/intent/failure/inputDigest，PG 还查买家和商品 | 统一查询字段并加契约测试 |
