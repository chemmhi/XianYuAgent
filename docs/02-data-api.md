# XianyuSellerAgent 阶段 2 数据模型与 API 契约

- 文档版本：v0.4
- 日期：2026-09-19
- 状态：PASS（阶段 2 数据模型、API 契约与安全边界已冻结）
- 前置门禁：阶段 1 PASS
- 设计边界：本阶段只冻结数据、API、安全和迁移契约，不创建真实业务后端、数据库实现或前后端联调。
- 本次修订：补充 FirstRun bootstrap 与消息人工接管 / 恢复 AI 的逐字段、幂等、审计和缓存失效契约，供阶段 3 组件设计消费。

## 1. 设计目标

1. 将阶段 1 的模块边界落成唯一数据所有者、实体关系、状态机和命令入口。
2. 为 `apps/web` 正式前端和其他受控调用方提供稳定的领域 API，不暴露闲鱼原始字段、Pi 内部对象或数据库结构；`SellerAgent/` 仅作为视觉参考。
3. 固化鉴权、账号范围、幂等、Outbox、审计和敏感交付边界。
4. 为阶段 5 纵向切片提供可执行的请求、响应、错误和状态契约。

## 2. 数据域与所有权

| 数据域 | 核心实体 | 唯一所有者 | 不变约束 |
| --- | --- | --- | --- |
| 身份 | Admin、Session、AccountScope、AccountLoginSession | auth | 浏览器只持有 HttpOnly Cookie；服务端决定管理员与账号范围 |
| 账号 | Account、AccountConnection | accounts | 一个账号只能绑定一个受控凭证引用；平台状态由 adapter 回写 |
| 凭证 | CredentialRef、CredentialValue | credential-store | 管理员可直接管理；凭证值不得进入买家链路、日志、Trace、Prompt 或 Replay |
| 商品 | Product、ProductSku、AssetRef | products | 商品元数据归商品域；文件生命周期归 storage |
| 卡券 | CouponBatch、CouponItem、CouponAssetRef、CouponBinding | coupons | 库存扣减必须事务化；其他模块只能发起命令 |
| 订单 | Order、DeliveryRecord | orders | 支付、订单、交付、售后状态分离维护 |
| 消息 | Conversation、Message | messages | 消息来源、发送身份、外部结果可追踪 |
| 工作区 | AgentSession、Run、Step、TaskContext | workspace | 状态只能由状态机迁移，前端不能直接改状态 |
| 执行 | Confirmation、IdempotencyRecord、OutboxJob | execution | 高风险写动作可确认、可重试、可审计 |
| 观测 | AuditEvent、TraceSpan、HealthSnapshot | observability | 只追加写入；敏感字段仅保留脱敏摘要 |

## 3. 数据模型

### 3.1 通用字段与迁移规则

所有业务实体默认包含：

- `id`：UUID 主键；
- `createdAt`、`updatedAt`：ISO 8601 UTC，非空；
- `version`：整数，默认 1，用于乐观并发控制；
- `deletedAt`：可空软删除时间，审计记录不得物理删除；
- `createdBy`、`updatedBy`：可空管理员或系统主体 ID；
- 所有外键显式声明 `ON DELETE RESTRICT`，需要级联时由领域服务显式执行。

写请求必须携带 `If-Match-Version` 或等价的 `expectedVersion`；版本不匹配返回 `409 VERSION_CONFLICT`。

### 3.2 实体字段、主外键、唯一索引与生命周期

| 实体 | 必填字段（类型） | 可空 / 默认 | PK / FK / 唯一约束 | 生命周期约束 |
| --- | --- | --- | --- | --- |
| `admins` | `id UUID`、`email string`、`passwordHash string`、`status enum` | `lastLoginAt` 可空；`status=active` | PK `id`；唯一 `lower(email)` | `disabled` 时撤销全部 Session |
| `sessions` | `id UUID`、`adminId UUID`、`issuedAt`、`lastSeenAt`、`expiresAt` | `revokedAt`、`revokeReason` 可空 | PK `id`；FK `adminId -> admins.id`；索引 `(adminId, expiresAt)` | `active -> revoked/expired`，过期或撤销不可恢复 |
| `account_scopes` | `id UUID`、`adminId`、`accountId`、`scope enum`、`status enum` | `expiresAt`、`revokedAt` 可空；`status=active` | PK `id`；FK 管理员/账号；唯一 `(adminId, accountId, scope)` | `active -> revoked/expired`；仅 active 且未过期 scope 可授权请求 |
| `account_login_sessions` | `id UUID`、`loginMethod`、`status`、`startedAt` | `accountId` 可空；`provisionalAccountRef`、`qrTokenRef`、`failureCode`、`completedAt` 可空 | PK `id`；成功后回填 FK `accountId -> accounts.id`；索引 `(provisionalAccountRef, status)`、`(accountId, status)` | `created -> waiting -> scanned -> succeeded/expired/failed/cancelled`；成功前允许无正式账号 |
| `accounts` | `id UUID`、`platform enum`、`sellerRef`、`status enum` | `displayName`、`lastConnectedAt` 可空 | PK `id`；唯一 `(platform, sellerRef)` | 停用不删除历史订单与消息 |
| `credential_refs` | `id UUID`、`accountId`、`kind`、`purpose`、`status` | `label`、`lastRotatedAt` 可空 | PK `id`；FK `accountId`；唯一 `(accountId, kind, purpose)` | `active -> disabled/revoked/rotating`；旧值只保留审计摘要 |
| `credential_values` | `credentialRefId`、`ciphertext`、`keyVersion`、`checksum` | `metadataJson` 默认 `{}` | PK/FK `credentialRefId -> credential_refs.id` | 管理员可读写；API 默认不返回明文 |
| `products` | `id UUID`、`accountId`、`title`、`status`、`categoryCode`、`attributesJson`、`defaultReplyTemplate`、`aiPrompt`、`configVersion` | `description`、`priceMinor`、`categoryCode`、`attributesJson`、`defaultReplyTemplate`、`aiPrompt` 可空；`attributesJson={}`、`configVersion=1` | PK `id`；FK `accountId`；唯一 `(accountId, externalProductRef)`（外部引用为空时不生效） | `draft -> ready -> publishing -> published/failed/archived`；配置字段随版本审计 |
| `product_skus` | `id UUID`、`productId`、`skuCode`、`priceMinor`、`status` | `externalSkuRef` 可空 | PK；FK `productId`；唯一 `(productId, skuCode)` | 已售 SKU 不物理删除 |
| `asset_refs` | `id UUID`、`productId`、`storageKey`、`mimeType`、`status` | `checksum` 可空 | PK；FK `productId`；唯一 `(productId, storageKey)` | 删除产品前必须先归档资产 |
| `coupon_batches` | `id UUID`、`accountId`、`purpose`、`deliveryScope`、`status`、`totalCount` | `quarkUrl`、`extractCode` 可空；`status=active` | PK；FK `accountId` | `active -> exhausted/voided`；voided 不再分配 |
| `coupon_items` | `id UUID`、`batchId`、`contentCiphertext`、`status` | `reservedUntil`、`consumedAt` 可空 | PK；FK `batchId`；索引 `(batchId, status)` | `available -> reserved -> consumed`；`reserved -> available` 仅超时释放 |
| `coupon_asset_refs` | `id UUID`、`couponBatchId`、`storageKey`、`mimeType`、`status` | `checksum`、`caption` 可空 | PK；FK `couponBatchId`；唯一 `(couponBatchId, storageKey)` | 素材归档不影响已交付记录 |
| `coupon_bindings` | `id UUID`、`couponBatchId`、`productId`、`priority`、`status` | `expiresAt` 可空；`priority=0` | PK；FK 批次/商品；唯一 `(couponBatchId, productId)` | 解绑只改状态，不删除已产生的交付记录 |
| `orders` | `id UUID`、`orderNo`、`accountId`、`productId`、`paymentStatus`、`orderStatus`、`deliveryStatus`、`afterSalesStatus` | `buyerRef`、`paidAt`、`cancelledAt`、`closedAt`、`refundRequestedAt` 可空 | PK `id`；唯一 `(accountId, orderNo)`；FK 账号/商品 | 支付、订单、交付、售后四个状态机独立迁移，禁止混用单一大枚举 |
| `delivery_records` | `id UUID`、`orderId`、`deliveryType`、`status`、`idempotencyScope`、`attempt` | `couponItemId`、`trackingRef`、`deliveredAt`、`failureCode` 可空；`attempt=1` | PK；FK `orderId`；成功卡券交付时 `couponItemId` 非空且唯一 | `deliveryType=manual|no_logistics|coupon_only|mixed`；只追加结果；重试创建新 attempt |
| `conversations` | `id UUID`、`accountId`、`externalConversationRef`、`status` | `buyerRef` 可空 | PK；FK 账号；唯一 `(accountId, externalConversationRef)` | 关闭后仍可读历史 |
| `messages` | `id UUID`、`conversationId`、`direction`、`bodyType`、`status` | `bodyText`、`assetRef`、`externalMessageRef`、`recalledAt`、`recallReason` 可空 | PK；FK 会话；唯一 `(conversationId, externalMessageRef)`（非空时） | `pending|sent|failed|recalled`；撤回结果写入审计与幂等记录 |
| `agent_sessions` | `id UUID`、`accountId`、`title`、`status`、`lastActiveAt` | `summary`、`archivedAt` 可空；`status=active` | PK；FK `accountId`；索引 `(accountId, status, lastActiveAt)` | `active -> archived`；归档后只读 |
| `runs` | `id UUID`、`accountId`、`route`、`status`、`requestedBy` | `clientRunRef`、`completedAt`、`failureCode` 可空 | PK；FK 账号/管理员；唯一 `(accountId, clientRunRef)`（非空时） | 见 §4 状态机 |
| `steps` | `id UUID`、`runId`、`stepNo`、`kind`、`status`、`attempt` | `parentStepId`、`externalOutcome` 可空；`attempt=1` | PK；FK `runId`；唯一 `(runId, stepNo, attempt)` | 已成功 Step 不得重复执行；重试递增 attempt |
| `task_contexts` | `id UUID`、`runId`、`schemaVersion`、`contextJson` | `redactedSummary` 可空 | PK/FK `runId` | context 只允许 schema 兼容迁移 |
| `confirmations` | `id UUID`、`runId`、`stepId`、`status`、`expiresAt`、`requestedBy` | `confirmedAt`、`confirmedBy`、`reason` 可空 | PK；FK run/step；唯一 active `(stepId, status=active)` | `active -> confirmed/expired/rejected/cancelled` |
| `idempotency_records` | `id UUID`、`scope`、`key`、`requestFingerprint`、`status`、`expiresAt` | `responseEnvelope`、`traceId` 可空 | PK；唯一 `(scope, key)` | 处理中可查询；终态重放原 envelope；过期后清理 |
| `outbox_jobs` | `id UUID`、`aggregateType`、`aggregateId`、`operation`、`status`、`attempt`、`availableAt` | `lockedAt`、`lastErrorCode`、`externalOutcome` 可空 | PK；唯一 `(scope, idempotencyKey)`；索引 `(status, availableAt)` | 见 §4；`dead_letter` 仅管理员恢复 |
| `audit_events` | `id UUID`、`actorType`、`actorId`、`action`、`targetRef`、`requestId`、`traceId`、`payloadDigest` | `accountId`、`reason` 可空 | PK；追加写入 | 不更新、不物理删除 |
| `trace_spans` | `id UUID`、`traceId`、`spanId`、`operation`、`status`、`startedAt`、`endedAt` | `errorCode`、`redactedAttributes` 可空 | PK；唯一 `(traceId, spanId)` | 不保存凭证明文、卡券正文或买家敏感信息 |

### 3.3 关系与基数

```text
Admin 1 --- N Session
Admin 1 --- N AccountScope N --- 1 Account
Account 1 --- N AccountLoginSession
Account 1 --- N CredentialRef 1 --- 1 CredentialValue
Account 1 --- N Product 1 --- N ProductSku
Product 1 --- N AssetRef
CouponBatch 1 --- N CouponItem
CouponBatch 1 --- N CouponAssetRef
CouponBatch N --- N Product (through CouponBinding)
Order 1 --- N DeliveryRecord; successful coupon DeliveryRecord 0..1 --- 1 CouponItem
Account 1 --- N Conversation 1 --- N Message
Account 1 --- N AgentSession
Run 1 --- N Step; Step 1 --- 0..1 active Confirmation
Run 1 --- 1 TaskContext
Run/Step 1 --- N OutboxJob
DomainEvent 1 --- N AuditEvent / TraceSpan
```

`DeliveryRecord.couponItemId` 只有在本次交付成功锁定卡券时才非空；数据库以部分唯一索引保证一个 `CouponItem` 只能成功交付一次。一个 `Run` 可以有多个 Step，一个 Step 可以有多个 attempt 和 OutboxJob，但同一 attempt 的业务幂等键只能产生一个有效执行结果。

## 4. 状态机基线

- `Session`：`active -> revoked | expired`；管理员禁用时批量转 `revoked`。
- `AccountLoginSession`：`created -> waiting -> scanned -> succeeded | expired | failed | cancelled`；二维码/协议轮询不得跨账号读取；`scanned` 只表示外部平台已扫码，不等于登录成功。
- `AccountConnection`：`pending -> connected -> degraded -> disconnected | expired`。
- `RunStatus`：`queued -> running | cancelling | cancelled`；`running -> waiting_confirmation | executing | failed | cancelling`；`waiting_confirmation -> executing | expired | cancelled`；`executing -> succeeded | partially_succeeded | retrying | failed | cancelling`；`retrying -> executing | partially_succeeded | failed`；`partially_succeeded -> retrying | succeeded | failed`；`cancelling -> cancelled | partially_succeeded | failed`；`expired` 为终态。
- `StepStatus`：`pending -> running -> waiting_confirmation | executing`；`waiting_confirmation -> executing | cancelled`；`executing -> succeeded | partially_succeeded | retrying | failed | cancelling`；`retrying -> executing | partially_succeeded | failed`；`cancelling -> cancelled | partially_succeeded | failed`；`skipped` 只能由编排器显式写入。确认超时记录在 `Confirmation.status=expired`，不新增 Step 状态。
- `OutboxStatus`：`pending -> running -> retrying | succeeded | failed | cancelling`；`retrying -> running | dead_letter`；`cancelling -> cancelled | failed`；`dead_letter` 仅管理员恢复。部分成功只存在于 Run/Step，不存在于单个 OutboxJob。
- `externalOutcome`：`known_success | known_failure | unknown`，仅表示外部结果，不是 Outbox 状态。`unknown` 或 `cancelling` 禁止盲目重放，必须先查询外部状态。
- `Order.paymentStatus`：`unpaid -> paid | closed | unknown`；`Order.orderStatus`：`open -> cancelling -> cancelled | completed | closed | failed`；`Order.deliveryStatus`：`pending -> reserving -> delivered | partially_delivered | failed | cancelled`；`Order.afterSalesStatus`：`none -> requested -> refunding -> refunded | rejected | closed`。四者不得合并成单一枚举；退款中的订单禁止再次交付。

## 5. API 统一契约

### 5.1 传输、响应与分页

- 外部管理 API 使用 `/api/v1` + JSON；Pi Runtime 使用独立服务的 HTTP/JSON v1；WebSocket 使用 `/api/v1/.../events`。
- 成功业务结果返回 `200`（创建返回 `201`，异步接受返回 `202`）；认证、权限、校验、资源不存在、冲突和服务不可用使用对应 HTTP 状态码，但始终返回同一 envelope。
- 所有 envelope 包含 `success`、`message`、`data`、`requestId`、`traceId`；错误 envelope 额外包含 `error.code`、`error.retryable`、`error.details`。
- 列表统一返回 `items`、`page`、`pageSize`、`total`、`totalPages`；筛选字段统一为 `keyword`、`accountId`、`status`、`sortBy`、`sortOrder`。
- 时间使用 ISO 8601 UTC；金额使用最小货币单位整数；枚举使用稳定字符串。

```json
{
  "success": true,
  "message": null,
  "data": {},
  "requestId": "req_01...",
  "traceId": "trc_01..."
}
```

```json
{
  "success": false,
  "message": "delivery policy rejected",
  "data": null,
  "requestId": "req_01...",
  "traceId": "trc_01...",
  "error": { "code": "FORBIDDEN", "retryable": false, "details": { "reason": "order_delivery_not_allowed" } }
}
```

最小错误码集合：`UNAUTHENTICATED`、`FORBIDDEN`、`NOT_FOUND`、`VALIDATION_FAILED`、`VERSION_CONFLICT`、`CONFLICT`、`EXTERNAL_TIMEOUT`、`EXTERNAL_UNKNOWN`、`IDEMPOTENCY_CONFLICT`、`IDEMPOTENCY_IN_PROGRESS`、`CSRF_INVALID`、`RATE_LIMITED`、`SERVICE_UNAVAILABLE`。

### 5.2 幂等语义

- 唯一入口是 HTTP Header `Idempotency-Key`；请求体中的 `idempotencyKey` 仅为 Agent/旧客户端兼容字段，若同时存在必须完全一致。
- 作用域固定为 `adminId + accountId + normalizedRoute + Idempotency-Key`；读请求不要求幂等键，所有会改变外部状态、库存、订单或消息的写请求必须要求。
- 服务端保存请求指纹、处理中状态、最终 envelope、`traceId` 和过期时间，默认保留 30 天。
- 同作用域、同 key、同指纹：处理中返回 `202` + 当前状态，终态直接重放原 envelope，不重复扣库存、发货、发布或发消息。
- 同作用域、同 key、不同指纹：返回 `409 IDEMPOTENCY_CONFLICT`，不得覆盖原请求。
- 外部结果为 `unknown`、Outbox 为 `cancelling` 或锁未释放时，重试只能触发状态查询或人工确认，不得盲目重放。
- `dead_letter` 恢复必须创建新 attempt、新审计事件并沿用原业务幂等范围。

### 5.3 P0 API 契约目录

| 能力 | 方法与路径 | 权限域 | 关键约束 |
| --- | --- | --- | --- |
| 当前会话 | `GET /api/v1/auth/session` | `auth` | 返回管理员与账号范围，不返回凭证值 |
| 首次初始化状态 | `GET /api/v1/auth/session` | `auth` | 未登录时返回 `bootstrapRequired`；已完成初始化时为 `false` |
| 登录/注销 | `POST /api/v1/auth/login`、`POST /api/v1/auth/logout` | `auth` | Cookie Session；注销立即失效 |
| 密码登录 | `POST /api/v1/auth/password-login` | `auth` | 登录成功后轮换 Session 与 CSRF token |
| 首次管理员初始化 | `POST /api/v1/auth/bootstrap` | `auth` | 仅当系统尚无管理员时允许；专用幂等键；成功后创建管理员、Session、CSRF 和审计事件 |
| 二维码登录 | `POST /api/v1/auth/qr-sessions`、`GET /api/v1/auth/qr-sessions/{id}` | `auth/accounts` | 状态包含 waiting/succeeded/expired/failed |
| 账号与连接 | `GET /api/v1/accounts`、`GET /api/v1/accounts/{id}`、`POST /api/v1/accounts`、`PATCH /api/v1/accounts/{id}`、`GET /api/v1/accounts/{id}/connection`、`POST /api/v1/accounts/{id}/refresh` | `accounts` | 账号范围过滤；连接状态由 adapter 回写 |
| 账号权限 | `GET/POST/PATCH/DELETE /api/v1/accounts/{id}/scopes` | `auth/accounts` | 只允许管理员修改授权范围并写审计 |
| 账号登录态 | `POST /api/v1/accounts/{id}/login-sessions`、`GET /api/v1/accounts/{id}/login-sessions/{sid}`、`POST /{sid}/cancel` | `accounts` | 轮询受账号范围与幂等约束 |
| CredentialStore | `GET/POST/PATCH /api/v1/credentials...`、`POST /{id}/rotate`、`POST /{id}/revoke`、`POST /{id}/enable`、`POST /{id}/disable` | `credential-store` | 管理员绝对管理权限；所有操作写 AuditEvent |
| 仪表盘 | `GET /api/v1/dashboard/snapshot`、`GET /api/v1/dashboard/order-trend` | `dashboard` | 只读聚合，不拥有业务事实 |
| 商品 | `GET/POST/PATCH /api/v1/products...`、`POST /api/v1/products/sync`、`POST /api/v1/products/pull`、`GET /api/v1/products/{id}/assets`、`POST /api/v1/products/{id}/assets`、`PATCH /api/v1/products/{id}/assets/{assetId}`、`DELETE /api/v1/products/{id}/assets/{assetId}`、`POST /api/v1/products/{id}/publish`、`POST /api/v1/products/bulk-publish` | `products/execution` | 支持指定账号分页拉取与全量同步；发布需要 Confirmation + Outbox；批量操作逐项返回结果 |
| 卡券批次 | `GET/POST /api/v1/coupons/batches`、`GET/PATCH/DELETE /api/v1/coupons/batches/{id}`、`POST /api/v1/coupons/batches/{id}/bind`、`POST /api/v1/coupons/batches/{id}/unbind`、`POST /api/v1/coupons/batches/{id}/items/import`、`POST /api/v1/coupons/batches/{id}/void` | `coupons` | 当前 S4-VS3 列表默认不返回正文，支持 purpose/metadata、单批编辑、批次软删除、绑定/解除绑定和库存导入；`items/bulk-save`、`items/bulk-delete`、`assets` 保留为后续切片契约；绑定校验商品与账号一致 |
| 卡券正文 | `GET /api/v1/coupons/{id}/content` | `coupons/policy` | 管理员可通过受控领域接口直接查看、复制和编辑；买家可见交付仍按 `deliveryScope`、订单支付、商品/账号匹配、策略和 Audit 校验 |
| 订单查询 | `GET /api/v1/orders`、`GET /api/v1/orders/{orderNo}`、`POST /api/v1/orders/refresh` | `orders` | 支持账号、状态、商品、买家、时间过滤 |
| 订单动作 | `POST /api/v1/orders/{orderNo}/delivery-preview`、`/deliver`、`/cancel`、`/retry` | `orders/policy/execution` | 受支付、匹配、deliveryScope、幂等和状态机约束 |
| 会话与消息 | `GET /api/v1/conversations`、`GET /api/v1/conversations/{id}/messages`、`POST /api/v1/conversations/{id}/messages`、`POST /api/v1/conversations/{id}/images`、`POST /api/v1/conversations/{id}/messages/{messageId}/recall` | `messages` | 图片先入 storage；外部发送结果写回 Message；撤回必须幂等并记录平台结果 |
| 消息人工接管 | `POST /api/v1/conversations/{id}/handoff`、`POST /api/v1/conversations/{id}/release` | `messages/policy` | `handoff` 切换为人工处理，`release` 恢复 AI；均校验账号范围、会话版本、幂等键和审计；不得让买家看到内部原因 |
| 实时事件 | `WS /api/v1/conversations/{id}/events`、`WS /api/v1/workspace/runs/{id}/events` | `messages/workspace` | 校验 Session、Origin 和账号范围 |
| AgentSession / Workspace | `GET/POST /api/v1/workspace/agent-sessions`、`GET /api/v1/workspace/agent-sessions/search`、`POST /api/v1/workspace/agent-sessions/{id}/switch`、`POST /api/v1/workspace/agent-sessions/{id}/archive`、`POST /api/v1/workspace/runs`、`GET /api/v1/workspace/runs/{id}`、`GET /api/v1/workspace/runs/{id}/confirmation`、`POST /api/v1/workspace/runs/{id}/confirm`、`POST /api/v1/workspace/runs/{id}/cancel`、`POST /api/v1/workspace/runs/{id}/retry` | `workspace/execution` | 会话归档后只读；仅暴露领域 Manifest，不暴露 Pi 原始 API |
| Runtime / Outbox | `GET /api/v1/execution/outbox`、`GET /api/v1/execution/outbox/{id}`、`POST /api/v1/execution/outbox/{id}/retry`、`POST /api/v1/execution/outbox/{id}/recover` | `execution` | 管理员可审计和恢复 dead_letter，不可跳过状态机 |
| 设置 | `GET/PATCH /api/v1/settings/agent`、`/reply-policy`、`/delivery-policy`、`GET/PATCH /api/v1/settings/policy-gateway`、`GET/PATCH /api/v1/settings/external-services`、`GET/PATCH /api/v1/settings/runtime`、`GET/PATCH /api/v1/settings/outbox`、`GET/PATCH /api/v1/settings/account-scopes` | `settings/policy/execution/auth` | 配置版本化、审计化、可回滚；Policy Gateway、外部服务、Runtime/Outbox 和账号权限均有独立配置面 |

### 5.4 阶段 3 所需的新增细节契约

#### 5.4.1 FirstRun bootstrap

`GET /api/v1/auth/session` 在未登录状态也返回 `bootstrapRequired: boolean`。当且仅当系统不存在管理员记录时为 `true`；已有管理员时为 `false`，不得因为前端路由或本地缓存推断该值。

```ts
type BootstrapAdminInput = {
  email: string;
  password: string;
  displayName: string;
  idempotencyKey: string;
};

type BootstrapAdminOutput = {
  session: SessionVM;
  profile: AdminProfileVM;
  auditRef: string;
};
```

- `POST /api/v1/auth/bootstrap` 只允许在 `bootstrapRequired=true` 时调用；成功后原子创建管理员、Session、CSRF token 和 `auth.bootstrap.completed` 审计事件。
- bootstrap 请求没有 `adminId`，幂等作用域固定为 `bootstrap + normalizedRoute + Idempotency-Key`；同指纹重放原 envelope，不重复创建管理员或 Session；不同指纹返回 `409 IDEMPOTENCY_CONFLICT`。
- 初始化完成后再次调用返回 `409 CONFLICT`，`error.details.reason=bootstrap_already_completed`，不得覆盖现有管理员。
- `FirstRunPage` 只消费 `bootstrapRequired`、`BootstrapAdminInput` 和 `BootstrapAdminOutput`；不得直接访问 `admins` 表或拼装 Session。

#### 5.4.2 消息人工接管

```ts
type HandoffConversationInput = {
  reason: 'buyer_risk' | 'refund' | 'complaint' | 'prompt_injection' | 'credential_request' | 'manual';
  expectedVersion: number;
  idempotencyKey: string;
};

type ReleaseConversationInput = {
  expectedVersion: number;
  idempotencyKey: string;
};

type ConversationHandlingOutput = {
  conversation: ConversationVM;
  handlingMode: 'human' | 'ai';
  auditRef: string;
};
```

- `POST /api/v1/conversations/{id}/handoff` 将 `handlingMode` 切换为 `human`，记录原因和审计引用；`POST /api/v1/conversations/{id}/release` 将其切换为 `ai`，两者均要求管理员 Session、账号 scope、`expectedVersion` 和 `Idempotency-Key`。
- 成功后失效 `conversation:{id}`、`conversation-list:{accountId}`、`unread-count:{accountId}` 和风险待人工队列；版本冲突返回 `409 VERSION_CONFLICT`，同 key 不同指纹返回 `409 IDEMPOTENCY_CONFLICT`。
- 人工接管原因属于运营元数据，不得写入买家可见消息、外部交付文本、Trace、Replay 或 Prompt。

## 6. 访问语义与敏感交付

| `deliveryScope` | 管理员 | Workspace / Agent | 闲鱼买家 |
| --- | --- | --- | --- |
| `system_only` | 可管理 | 仅受控 Runtime/Executor | 禁止 |
| `operator_only` | 可管理 | 仅显式授权能力 | 禁止 |
| `buyer_deliverable` | 可管理 | 受策略与订单条件约束 | 仅在全部条件满足后可见 |

所有 API 先校验服务端 Session，再注入管理员身份与账号范围；前端不能提交更高权限范围。`GET /coupons/{id}/content` 与交付接口分离：批次列表不返回正文，正文读取必须通过 purpose、deliveryScope、账号范围和审计校验。买家交付必须同时满足：`deliveryScope=buyer_deliverable`、订单已支付、商品与账号匹配、策略校验通过、库存成功锁定、AuditEvent 已写入。交付 API 只返回交付结果，不返回凭证、Cookie、Token、内部 Trace、Prompt 或系统路径。

## 7. 鉴权、并发与安全边界

- Cookie：`HttpOnly`、`Secure`、`SameSite=Lax`；所有非 GET 请求使用 `X-CSRF-Token` 双提交校验。
- WebSocket：握手必须携带有效服务端 Session，并校验 Origin allowlist、账号范围和资源归属。
- Session：空闲 30 分钟、绝对 8 小时；登录、密码变更、管理员禁用后轮换或撤销全部 Session。
- 并发：实体更新使用 `version` 乐观锁；库存分配使用行级锁/事务；Outbox 使用租约和重试退避。
- 审计：凭证查看、轮换、撤销、正文读取、交付预览、交付、取消、重试、确认全部写入 AuditEvent。
- 脱敏：错误、日志、Trace、Replay、Prompt、监控标签不得包含凭证明文、卡券正文、夸克提取码或买家敏感内容，仅允许摘要、哈希和资源 ID。

## 8. 迁移、兼容与回滚

1. 阶段 2 先冻结 schema 版本、迁移编号、回滚脚本边界和兼容映射，阶段 5 才实现代码切片。
2. 原型 `localStorage.auth_token` 不迁移到生产数据库；真实登录直接创建服务端 Session。
3. 旧项目字段只能通过 adapter/mapper 转换为当前领域模型，禁止直接复用旧表结构。
4. 不可逆迁移必须先备份、执行向前迁移、验证读写，再开放流量；回滚优先回退应用版本并保留兼容读路径。
5. CredentialStore 管理 API 纳入本阶段；字段加密、备份和轮换演练属于阶段 7 运维验证，不阻塞本阶段契约门禁。

## 9. 阶段 2 评审与裁决

| 评审编号 | 评审重点 | 结论 | 证据 |
| --- | --- | --- | --- |
| S2-R1 | 实体、字段、PK/FK、唯一约束、基数、状态机和生命周期 | PASS | 本文 §2-§4；repo_audit 复核后已修订 |
| S2-R2 | 请求/响应、错误码、幂等、版本、P0 API 覆盖 | PASS | 本文 §5；用户接受 S2-I001、S2-I002 |
| S2-R3 | SameSite、CSRF、Session、账号范围、敏感交付和迁移安全 | PASS | 本文 §6-§8；用户接受 S2-I003、S2-I004、S2-I005 |

阶段 2 人工裁决已关闭：

- S2-I001：`unknown` 仅作为 `externalOutcome`，不新增 Outbox 状态；
- S2-I002：幂等作用域为 `adminId + accountId + route + Idempotency-Key`，默认保留 30 天；
- S2-I003：SameSite=Lax、CSRF 双提交、Origin allowlist、Session 空闲 30 分钟/绝对 8 小时、登录和密码变更后轮换；
- S2-I004：`system_only / operator_only / buyer_deliverable`、卡券正文读取、交付预览和订单交付 API 全部纳入本阶段；
- S2-I005：CredentialStore CRUD、rotate、revoke、enable、disable 纳入本阶段，管理员拥有绝对管理权限，但不得向闲鱼买家暴露。

## 10. P0 覆盖补充映射

为避免“泛化路径”掩盖 P0 缺口，以下能力作为阶段 2 的显式契约：

| 能力 | 数据 / 状态补充 | API 映射 |
| --- | --- | --- |
| 商品同步 | `Product` 保留 `accountId`、`externalProductRef`、`categoryCode`、`attributesJson`、`defaultReplyTemplate`、`aiPrompt`、`configVersion`；同步任务复用 Run/Outbox | `POST /api/v1/products/sync`、`POST /api/v1/products/pull`，支持指定账号、分页游标、全量同步和逐项结果 |
| 商品素材 | `AssetRef` 具备 storageKey、mimeType、checksum、status 生命周期 | `GET/POST/PATCH/DELETE /api/v1/products/{id}/assets...` |
| 商品批量发布 | 每个商品产生独立 Confirmation/Outbox/幂等结果 | `POST /api/v1/products/bulk-publish` |
| 卡券素材 | `CouponAssetRef` 与 CouponBatch 一对多；素材不等于卡券正文，当前 S4-VS3 仅保存图片 URL 列表并提供原图预览 | `POST /api/v1/coupons/batches/{id}/assets`（后续切片） |
| 卡券批量操作 | 当前 S4-VS3 的批量删除作用于批次选择并逐批调用 DELETE；CouponItem 批量保存/删除仍保留后续契约 | `POST /items/bulk-save`、`POST /items/bulk-delete`（后续切片）；`POST /bind`、`POST /unbind` 已实现 |
| 账号/权限 | AccountScope、AccountLoginSession 独立持久化；连接状态与登录会话分离 | `GET/POST/PATCH/DELETE /api/v1/accounts/{id}/scopes`；`POST/GET /api/v1/accounts/{id}/login-sessions`；`POST /login-sessions/{sid}/renew`、`/reauthorize`、`/cleanup` |
| 管理员资料与会话 | Admin 保留邮箱、密码哈希、状态和最近登录；Session 可撤销 | `GET/PATCH /api/v1/auth/profile`、`POST /api/v1/auth/password`、`GET /api/v1/auth/sessions`、`POST /api/v1/auth/sessions/revoke-all` |
| AgentSession | 新增 `AgentSession`：accountId、title、status、summary、lastActiveAt、archivedAt | `GET/POST /api/v1/workspace/agent-sessions`、`GET /search`、`POST /{id}/switch`、`POST /{id}/archive` |
| 消息撤回 | Message `sent -> recalled`；只能由发送者或管理员触发 | `POST /api/v1/conversations/{id}/messages/{messageId}/recall` |
| 订单交付模式 | `deliveryType=manual|no_logistics|coupon_only|mixed`；退款中禁止再次交付 | `/delivery-preview` 与 `/deliver` 必须声明 deliveryType，并按模式返回 trackingRef/couponItemId |
| 设置与运行时 | Policy Gateway、ExternalService、Runtime、Outbox、AccountScope 均为独立配置面并有版本 | `GET/PATCH /api/v1/settings/policy-gateway`、`/external-services`、`/runtime`、`/outbox`、`/account-scopes`；`GET/POST /api/v1/execution/outbox...` |

## 11. Schema 补充与兼容说明

| 补充实体 / 字段 | 约束与默认值 | 兼容说明 |
| --- | --- | --- |
| `agent_sessions` | `id`、`accountId`、`title`、`status=active|archived`、`summary`、`lastActiveAt`、`archivedAt`；`(accountId,status,lastActiveAt)` 索引 | 对应工作区会话列表、新建、搜索、切换、归档；归档后只读 |
| `coupon_asset_refs` | `id`、`couponBatchId`、`storageKey`、`mimeType`、`status`、`checksum`；批次内 `storageKey` 唯一 | 图片/素材与 CouponItem 正文分离，删除素材不影响已交付记录 |
| `account_login_sessions.accountId` | 可空 FK；新账号登录先以 `provisionalAccountRef` 关联，状态支持 `created|waiting|scanned|succeeded|expired|failed|cancelled`；成功后回填 `accountId` | 避免“先建登录会话、成功后建账号”与 FK 冲突；成功后必须在同一事务回填并写审计 |
| `products.categoryCode` | 可空字符串，默认 `null`；`attributesJson` 默认 `{}`；`defaultReplyTemplate`、`aiPrompt` 可空；`configVersion` 默认 1 | 前端展示状态映射：`ready/published -> on_sale`，`archived -> off_shelf`，库存为 0 映射 `out_of_stock`，`failed -> publish_failed` |
| `delivery_records.deliveryType` | 枚举 `manual|no_logistics|coupon_only|mixed`；`coupon_only` 必须锁定 `couponItemId`；`no_logistics` 不生成物流单；`manual` 要求 `trackingRef` 或人工确认 | `/delivery-preview` 返回可选模式和校验结果；`/deliver` 返回 `deliveryType`、`trackingRef`、`couponItemId`、`status` |
| `messages.status` | `pending|sent|failed|recalled`；撤回请求必须带 `Idempotency-Key`，外部结果写 `externalOutcome` | `POST /api/v1/conversations/{id}/messages/{messageId}/recall` 只允许发送者或管理员，平台不支持撤回时返回可审计失败 |
| 管理员资料与权限 | `Admin` 增加 `displayName`、`role`、`quotaJson`；Session 支持列出、撤销单个和撤销全部 | `GET/PATCH /api/v1/auth/profile`、`POST /api/v1/auth/password`、`GET /api/v1/auth/sessions`、`POST /api/v1/auth/sessions/{id}/revoke`、`POST /api/v1/auth/sessions/revoke-all` |

阶段 2 通过后，允许进入阶段 3 前端信息架构与 API 映射设计；仍不得提前创建真实后端实现。
