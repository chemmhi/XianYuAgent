# XianyuSellerAgent 产品需求文档

- **文档版本**：v0.1
- **日期**：2026-09-18
- **产品阶段**：核心业务迁移与 Agent 接入前的需求冻结
- **参考项目**：`F:\ChenHai\Project\xianyu-auto-reply`
- **当前工作目录**：`F:\ChenHai\Project\XianYuAgent`
- **高保真原型目录**：`F:\ChenHai\Project\XianYuAgent\SellerAgent`
- **本阶段约束**：只定义产品和接口需求，不接入真实后端，不修改高保真页面

> 本文档在当前项目根目录 `docs` 下维护。`SellerAgent` 仅作为高保真视觉和交互参考目录，不作为本项目的业务代码工作目录。

## 1. 产品概述

XianyuSellerAgent 是面向闲鱼数字商品卖家的轻量化运营控制台。产品以账号、商品、卡券、订单和买家消息为业务基础，以 Workspace 为 Agent 入口，通过统一 Manifest、Policy Gateway、Confirmation Card 和 Outbox 机制，把自然语言任务安全地转换为可审计的业务动作。

产品不直接复制 `xianyu-auto-reply` 的完整后台。旧项目仅作为闲鱼协议、字段语义、错误行为和测试样例的参考；当前项目通过自有 `xianyu` 平台适配器直接对接闲鱼，并向当前前端提供稳定、面向领域的接口契约。页面只依赖当前项目的领域模型，不直接依赖旧项目数据库字段。

### 1.1 产品目标

1. 完成账号、商品、卡券、订单、聊天五类核心能力迁移。
2. 保持当前高保真控制台的视觉、信息架构和操作密度。
3. 让 Workspace 能通过自然语言发起查询、生成、上传、发布和发货任务。
4. 让 Agent 可替换，Pi 只是一个可插拔运行时，不成为业务代码依赖。
5. 所有业务写动作先经过 Policy Gateway；仅当策略要求人工确认时展示 Confirmation Card，确认后进入 Outbox。无需确认的低风险写动作在策略通过后直接进入执行阶段。
6. 账号 Cookie、Token、密码和 API Key 等系统凭证继续由后端管理；管理员可在管理界面直接查看、编辑和操作。系统凭证不得暴露给闲鱼买家；卡券正文、夸克链接和提取码属于受控业务数据，按交付范围进入管理、Workspace、订单和聊天流程。

### 1.2 非目标

- 本阶段不重建 `xianyu-auto-reply` 的全部运营后台、推广、分销、广告和管理员功能。
- 本阶段不将 Pi 的 API 直接暴露给业务页面。
- 本阶段不允许 Agent 绕过后端直接调用闲鱼接口。
- 本阶段不改动已完成的高保真页面结构和视觉方案。
- 本阶段不实现通用 Marketplace；Pi Skill 按 Pi 原生机制安装、启用和使用，不强制纳入当前项目的业务 Manifest。

## 2. 管理员与权限

### 2.1 角色

当前版本仅支持一个角色：**管理员**。

| 角色 | 主要权限 |
| --- | --- |
| 管理员 | 访问全部业务模块，管理账号、商品、卡券、订单、聊天、Workspace、全局设置、外部服务、Agent 策略和高风险确认 |

本阶段不拆分其他后台角色；后续如有权限隔离需求，再基于管理员能力新增角色和权限范围。

### 2.2 权限原则

- 页面权限与动作权限分离。能查看订单不代表能发货，能查看账号不代表能重新授权。
- 账号级数据必须按管理员的账号范围和授权范围过滤。
- 高风险动作至少需要 `capability + account_scope + permission + policy` 同时通过。
- 账号 Cookie、Token、登录密码和 API Key 仍属于系统凭证，管理员可查看、编辑和操作；系统凭证不得进入闲鱼买家可见的消息、订单交付内容或外部买家可见响应。卡券正文、夸克链接和提取码属于受控业务数据，可通过受控领域接口进入卡券管理、Workspace、订单和聊天交付流程；业务上不额外要求管理员侧脱敏、二次确认或超时隐藏。
- `system_only` 仅允许后端 Runtime / Executor 读取；`operator_only` 允许管理员和受授权 Agent 读取，但不得交付给买家；`buyer_deliverable` 允许管理员、Workspace 和受授权 Agent 读取，并可在订单策略通过后交付给买家。

## 3. 一级页面需求

| 页面 | 主要职责 | 关键输出 |
| --- | --- | --- |
| 仪表盘 | 看数据、看异常、进入待处理任务 | KPI、趋势、异常队列、快捷任务 |
| Workspace | 用自然语言发起任务、确认和跟踪执行 | 会话、Run、Step、确认卡、执行结果 |
| 账号管理 | 账号登录、状态、切换和授权 | 账号列表、登录状态、授权流程、账号策略 |
| 在线聊天 | 买家消息、自动回复、人工接管 | 会话列表、消息流、回复、买家订单上下文 |
| 商品管理 | 商品内容、图片、交付和发布 | 商品列表、详情、素材、规格、发布状态 |
| 卡券管理 | 卡券生成、库存、绑定和交付 | 卡券批次、库存、绑定关系、交付引用 |
| 订单管理 | 订单状态、发货、售后和异常 | 订单列表、详情、发货动作、失败重试 |
| 设置 | Agent、策略、权限和外部服务配置 | Agent 配置、自动回复、凭证、系统服务 |

## 4. 核心业务流程

### 4.1 添加并启用闲鱼账号

1. 管理员进入账号管理，点击“添加账号”。
2. 选择二维码登录、密码登录或管理员导入已有 Cookie。
3. 后端创建登录会话并返回二维码或登录进度。
4. 前端轮询登录状态，展示等待扫码、已扫码、登录成功、过期和失败状态。
5. 登录成功后创建账号记录；管理员可在账号管理中查看、编辑和操作该账号凭证，买家侧不可见。
6. 管理员选择是否启用消息监听、自动回复、自动发货和自动擦亮。
7. 系统将该账号加入当前工作上下文，并刷新仪表盘数据。

### 4.2 商品上传与发布

1. 管理员在商品管理创建草稿，或在 Workspace 中说“上传一个商品”。
2. 选择目标账号，填写标题、描述、价格、库存、地址、分类和交付方式。
3. 上传图片或视频，后端返回素材引用和解析状态。
4. 读取或推荐闲鱼平台分类和属性。
5. 配置规格、SKU、多数量发货和卡券关联。
6. 保存为草稿并执行本地校验。
7. Agent 或管理员发起发布动作时，后端生成发布预览和 Confirmation Card。
8. 管理员确认后进入 Outbox，调用商品发布能力。
9. 前端订阅发布进度，展示成功、部分成功、失败和可重试状态。

### 4.3 卡券生成与绑定

1. 管理员进入卡券管理，选择商品和卡券类型。
2. 输入批次名称、数量、内容来源、交付范围和可选延迟。
3. 生成卡券批次，卡券正文写入受控卡券数据或外部交付数据，并关联 `deliveryScope` 和 `contentRef`。
4. 卡券管理页面通过受控领域接口直接展示批次号、库存、状态、绑定商品、卡券正文和交付信息；管理员可以直接查看、复制、编辑和使用卡券内容。前端不直接访问 CredentialStore 底层实现或平台原始接口。
5. 管理员可以批量绑定商品、解除绑定、补充库存或作废批次。
6. 订单交付时由后端按幂等键扣减库存并生成交付记录。

### 4.4 订单处理与发货

1. 订单管理查询订单列表并按账号、状态、商品、买家和时间筛选。
2. 打开订单详情，查看支付状态、交付状态、聊天上下文和失败原因。
3. 对已付款订单执行自动发货、手动发货、免物流发货或只发卡券。
4. 发货动作必须校验商品、账号、卡券库存和交付策略。
5. 失败时保留失败原因、Trace ID、幂等键和可重试状态。
6. 退款、售后、关闭订单等动作进入高风险确认流程。

### 4.5 在线聊天与人工接管

1. 管理员选择账号后加载会话列表。
2. 通过 WebSocket 接收新消息、会话变化和账号连接状态。
3. 打开会话后加载历史消息、买家订单和商品上下文。
4. Agent 可生成建议回复，但不得默认代替人工发送高风险内容。
5. 管理员可以发送文本、图片、快捷短语和人工回复。
6. 发生退款、投诉、跨商品索取、凭证请求或 Prompt Injection 时，自动标记为待人工处理。
7. 聊天页面需要区分“AI 已回复”“人工已回复”“等待人工”“发送失败”。

## 5. 页面详细需求

### 5.1 仪表盘

**P0 功能**

- 今日订单金额、订单数、自动处理成功率、待人工处理、可售卡券库存。
- 订单金额趋势、自动处理趋势、发货失败趋势。
- 当前账号健康度：登录、IM 连接、自动回复、自动发货、凭证状态。
- 异常队列：登录失效、发货失败、库存不足、缺少凭证、待确认动作。
- 最近处理记录，可跳转到订单、聊天、商品或 Workspace。

**P1 功能**

- 按时间、账号、商品筛选。

### 5.2 Workspace

**P0 功能**

- 左侧上方显示会话列表，支持新建、搜索、切换和归档。
- 左侧下方显示当前上下文，包括账号、商品、订单、可用能力和凭证引用。
- 右侧显示管理员消息、Agent 回复、执行计划、步骤状态和工具调用摘要。
- 支持查询账号、商品、卡券、订单和聊天信息。
- 支持生成卡密、上传商品、上传图片、发布商品和查询订单。
- 写动作必须先经过 Policy Gateway。`requiresConfirmation=true` 时生成 Confirmation Card，管理员确认后才执行；`requiresConfirmation=false` 时跳过等待确认，策略通过后直接进入执行阶段。
- 支持取消 Run、重试失败 Step、查看 Audit 和打开业务详情页。

**P0 Run 状态**

`queued -> running -> waiting_confirmation -> executing -> succeeded`

无确认路径：

- `queued -> running -> executing -> succeeded`
- `queued -> running -> executing -> partially_succeeded`

异常分支：

- `queued -> cancelled`
- `running -> waiting_confirmation | executing | failed | cancelling`
- `waiting_confirmation -> executing | expired | cancelled`
- `executing -> succeeded | partially_succeeded | retrying | failed | cancelling`
- `retrying -> executing | partially_succeeded | failed`
- `partially_succeeded -> retrying | succeeded | failed`
- `cancelling -> cancelled | partially_succeeded | failed`
- Confirmation Card 超过 `expiresAt` 未确认时，Confirmation 状态变为 `expired`，Run 终止为 `expired`，不得自动执行。
- 取消请求进入 `cancelling`。尚未投递外部动作时进入 `cancelled`；已投递但结果未知时必须先查询幂等键对应的外部状态，不能简单重放。
- 重试只重试失败或结果未知的 Step，已成功 Step 不得重复执行；继续使用原幂等键。
- `partially_succeeded` 恢复时保留已成功 Step 的输出，仅对可重试 Step 重新投递；全部补偿成功后转为 `succeeded`，不可恢复时保持 `partially_succeeded` 并生成待人工处理项。
- 同一幂等键重复确认时，返回原执行结果，不重复调用外部接口。

**状态定义**

- `RunStatus`：`queued`、`running`、`waiting_confirmation`、`executing`、`retrying`、`cancelling`、`succeeded`、`partially_succeeded`、`failed`、`cancelled`、`expired`。
- `StepStatus`：`pending`、`running`、`waiting_confirmation`、`executing`、`retrying`、`succeeded`、`partially_succeeded`、`failed`、`skipped`、`cancelled`。
- `OutboxStatus`：`pending`、`running`、`retrying`、`succeeded`、`failed`、`dead_letter`、`cancelling`、`cancelled`。
- Outbox 进入 `dead_letter` 后不得自动重放；只有管理员发起恢复或重试，且仍使用原业务幂等键并先执行外部状态查询。

**Confirmation Card 必须包含**

- 动作名称、风险等级、目标账号、目标对象。
- 修改前 / 修改后或执行前 / 执行后摘要。
- 影响范围、权限来源、Policy Ref、Audit Ref、Idempotency Key。
- 需要管理员确认的按钮和取消按钮。
- 可根据任务需要通过受控领域接口展示卡券正文、夸克链接和提取码，供管理员直接查看、确认、复制或交付；系统凭证允许管理员查看、编辑和操作，但不得展示或返回给闲鱼买家可见链路。

### 5.3 账号管理

**P0 功能**

- 账号列表、分页、搜索、状态筛选和当前账号切换。
- 添加账号：二维码登录、密码登录、管理员导入 Cookie。
- 查看账号在线状态、登录时间、IM 连接、自动回复、自动发货和凭证健康度。
- 启用 / 停用账号，更新备注和登录信息。
- 更新自动确认、回复延迟、消息过期时间、定时补发货和自动擦亮。
- 账号登录续期、清理 Token 缓存和重新授权。

**P1 功能**

- 批量启停账号。
- 批量导入导出账号。
- 账号登录日志和失败原因。
- 账号级发货拦截规则配置。

### 5.4 在线聊天

**P0 功能**

- 账号 Tab 和账号连接状态。
- 会话列表、买家搜索、未读数、最后消息和更新时间。
- 历史消息分页加载。
- 发送文本消息、发送图片消息、撤回消息。
- 展示买家订单、当前商品、买家备注和官方黑名单状态。
- AI 建议回复、人工接管、风险标记和处理结果。
- WebSocket 连接、断线重连和连接状态提示。

**P1 功能**

- 快捷短语。
- 买家订单聚合。
- 买家头像批量查询。
- 官方黑名单查询和变更。

### 5.5 商品管理

**P0 功能**

- 商品分页列表，支持账号、状态、标题和商品 ID 筛选。
- 从指定账号分页拉取商品或全量同步商品。
- 商品详情：标题、描述、价格、库存、图片、视频、分类、属性、规格、SKU。
- 编辑商品内容、价格、库存、多规格和多数量发货。
- 图片和视频上传、预览、排序和删除。
- 商品默认回复和商品 AI Prompt 配置。
- 草稿、在售、下架、缺货、发布中、发布失败状态。
- 商品发布单件和批量发布。

**P1 功能**

- 分类推荐。
- 发布素材库。
- 发布日志和批次进度。
- 商品自动擦亮。
- 批量下架和批量删除。

### 5.6 卡券管理

**P0 功能**

- 卡券批次列表、详情、状态、库存和绑定商品。
- 创建卡券批次，支持文本、数据、图片和 API 类型。
- 上传卡券图片和素材。
- 批量保存、批量删除、批量绑定和批量解除绑定。
- 商品与卡券多对多关联。
- 交付范围必须区分 `buyer_deliverable`、`system_only` 和 `operator_only`。
- 卡券管理页面直接展示完整卡券正文、批次摘要、库存、状态、绑定商品和交付信息；管理员可以直接查看、复制、编辑、绑定和执行交付。

**P1 功能**

- 多规格卡券。
- 分销卡券和对接配置。
- 卡券库存预警。
- 卡券交付记录和消耗流水。

### 5.7 订单管理

**P0 功能**

- 订单分页、筛选、搜索和详情。
- 支付状态、订单状态、发货状态、买家、商品、账号、下单时间。
- 拉取闲鱼订单、刷新订单详情。
- 手动发货、免物流发货、只发卡券。
- 失败原因、交付消息状态、重试发货。
- 订单取消、关闭、退款中的状态展示。
- 与聊天会话互相跳转。

**P1 功能**

- 评价、自动求小红花。
- 批量订单处理。
- 补发货批次和处理日志。
- 售后和退款策略。

### 5.8 设置

设置页拆分为以下子模块：

1. **Agent**：默认 Agent、Model Provider、模型、上下文长度、超时和流式输出。
2. **自动回复策略**：回复延迟、重复消息等待时间、已下单买家是否禁止 AI 回复、人工介入后重新计时。
3. **自动发货策略**：支付后发货、凭证缺失、订单关闭、只发卡券、免物流和失败重试。
4. **Policy Gateway**：高风险动作、确认等级、权限范围、黑名单和拦截原因。
5. **CredentialStore**：系统凭证引用、用途范围、轮换、过期和审计，直接存储在项目数据库中，由管理员统一管理。
6. **外部服务**：闲鱼后端、AI Provider、图片上传、通知服务和代理配置。
7. **Runtime / Outbox**：队列深度、Worker 状态、重试、幂等键和服务健康度。
8. **账号与权限**：管理员资料、密码、角色、账号额度和管理员会话管理。

## 6. 接口需求

### 6.1 统一接口原则

- API 前缀统一为 `/api/v1`。
- 旧项目仅作为协议、字段和测试参考；当前项目通过自有 `xianyu` 平台适配器直接接入闲鱼，页面不直接消费平台原始字段。
- 读写接口均先经过当前项目领域服务；写接口额外经过 Policy Gateway。
- 业务成功和业务失败建议统一使用 HTTP 200 + `success` 字段，保持与参考项目 `ApiResponse` 兼容。
- 推荐响应结构：

```text
{
  success: boolean,
  message: string | null,
  data: object | array | null,
  requestId: string,
  traceId: string | null
}
```

- 列表接口统一支持 `page`、`pageSize`、`keyword`、`accountId`、`status`、`sortBy`、`sortOrder`。
- 所有写接口支持 `idempotencyKey`，服务端必须保证重复请求不会重复扣库存、重复发货或重复发布。

### 6.2 参考项目接口映射

| 当前页面 | 参考接口 | 迁移说明 |
| --- | --- | --- |
| 认证 | `POST /api/v1/auth/login`、`GET /api/v1/auth/verify`、`POST /api/v1/auth/logout`、`POST /api/v1/auth/refresh` | 复用登录和 Token 生命周期 |
| 仪表盘 | `GET /api/v1/admin/stats`、`GET /api/v1/admin/stats/today`、`GET /api/v1/cookies/stats`、`GET /api/v1/cookies/stats/order-trend` | 聚合为 `DashboardSnapshot` |
| 账号 | `GET /api/v1/cookies/details/paginated`、`POST /api/v1/cookies`、`PUT /api/v1/cookies/{id}/status` | 账号状态和策略通过适配器归一化 |
| 账号授权 | `POST /api/v1/qr-login/generate`、`GET /api/v1/qr-login/status/{sessionId}`、`POST /api/v1/password-login` | 登录过程由会话状态机承接 |
| 在线聊天 | `GET /api/v1/chat-new/accounts`、`GET /api/v1/chat-new/conversations/{accountId}`、`GET /api/v1/chat-new/messages/{accountId}/{cid}`、`POST /api/v1/chat-new/send-message/{accountId}` | HTTP 负责查询与写入，WebSocket 负责实时事件 |
| 聊天图片 | `POST /api/v1/chat-new/send-image/{accountId}` | 图片先上传再发送，返回消息结果 |
| 商品 | `GET /api/v1/items/paginated`、`POST /api/v1/items/get-all-from-account`、`GET /api/v1/items/{cookieId}/{itemId}/seller-detail`、`PUT /api/v1/items/{cookieId}/{itemId}/seller-edit` | 旧字段映射为 `Product` 契约 |
| 商品发布 | `POST /api/v1/product-publish/materials`、`GET /api/v1/product-publish/materials`、`POST /api/v1/product-publish/publish/single`、`POST /api/v1/product-publish/publish/batch` | 发布动作必须经过确认卡和 Outbox |
| 商品素材 | `POST /api/v1/product-publish/upload/images`、`POST /api/v1/product-publish/upload/videos`、`POST /api/v1/upload/upload-image` | 返回 `assetId` 和访问地址，不返回本地路径 |
| 卡券 | `GET/POST /api/v1/cards`、`GET /api/v1/cards/{id}`、`GET /api/v1/cards/{id}/content`、`PUT /api/v1/cards/{id}`、`POST /api/v1/cards/batch-bind` | 卡券正文通过受控领域接口返回明文；接口校验权限、账号范围、deliveryScope 和用途，并记录访问审计 |
| 订单 | `GET /api/v1/orders`、`GET /api/v1/orders/{orderNo}`、`POST /api/v1/orders/fetch-xianyu` | 订单查询和同步可直接复用 |
| 订单发货 | `POST /api/v1/orders/manual-delivery`、`POST /api/v1/orders/no-logistics-delivery`、`POST /api/v1/orders/cancel` | 外部写动作走 Gateway + Outbox |
| AI 设置 | `GET/PUT /api/v1/ai-reply-settings`、`POST /api/v1/ai-reply-settings/models` | 映射为 Agent Provider 配置 |
| 系统设置 | `GET/PUT /api/v1/system-settings`、`GET /api/v1/system-control/status` | 高风险的服务控制独立权限 |

### 6.3 当前项目新增 Agent 接口

参考项目没有统一的自然语言任务接口，当前项目新增独立 Agent API。该 API 的 Manifest 只描述当前后端提供的业务能力，不约束 Pi 原生 Skill：

```text
GET  /api/v1/agent/manifest
GET  /api/v1/agent/sessions
POST /api/v1/agent/sessions
GET  /api/v1/agent/sessions/{sessionId}
POST /api/v1/agent/runs
GET  /api/v1/agent/runs/{runId}
GET  /api/v1/agent/runs/{runId}/confirmation
POST /api/v1/agent/runs/{runId}/confirm
POST /api/v1/agent/runs/{runId}/cancel
POST /api/v1/agent/runs/{runId}/retry
WS   /api/v1/agent/runs/{runId}/events
```

`POST /agent/runs` 请求至少包含：

- `sessionId`
- `input`
- `accountId` 或当前上下文
- `requestedCapabilities`，可选
- `clientRequestId`
- `idempotencyKey`

`GET /agent/manifest` 返回每项后端业务能力的：

- `capabilityId`
- `accessMode`: `read` 或 `write`
- `version`
- `description`
- `inputSchema`
- `outputSchema`
- `riskLevel`
- `requiresConfirmation`
- `requiredPermissions`
- `supportsStreaming`
- `idempotencyStrategy`

## 7. Agent 与 Pi 接入要求

### 7.1 可替换运行时接口

业务层只依赖抽象接口，不依赖 Pi 包名或 Pi 内部对象：

- `AgentRuntime.createSession()`
- `AgentRuntime.run()`
- `AgentRuntime.stream()`
- `AgentRuntime.cancel()`
- `AgentRuntime.resume()`
- `AgentRuntime.installSkill()`
- `AgentRuntime.listSkills()`

Pi 作为第一种 Runtime Adapter；后续可以替换为其他 Node Agent、远程 Agent 或测试 Runtime。

### 7.2 闸门职责

Pi 或其他 Agent 负责理解意图、选择后端业务能力或调用 Pi 原生 Skill。Pi 原生 Skill 不自动访问当前项目数据库；需要业务数据时，可以通过后端 Manifest 提供的查询能力获取。后端 Agent Gateway 按读写类型处理业务能力：

1. `read` 能力：Agent 可以直接通过 Manifest 调用领域查询能力获取业务数据，不进入 Confirmation Card 和 Outbox；读取卡券正文必须使用受控内容能力，并按 `deliveryScope` 校验用途。
2. `write` 能力：新增、修改、删除、发布、发货、发送消息等写操作进入 Policy Gateway；外部写动作最终只能由 Gateway 投递到 Outbox。
3. Skill 只能调用明确提供的领域 API 或 Manifest 能力，不得导入、调用或绕过 `xianyuApi`、闲鱼原始平台接口或 CredentialStore 底层接口。
4. 写操作校验管理员身份、账号和资源权限，并按策略决定是否需要 Confirmation Card；无需确认的写操作也必须记录 Audit、Trace、ToolCall 并进入幂等执行链路。
5. 写操作生成幂等键，进入 Outbox，并记录 Audit、Trace、ToolCall、SkillResult 和最终结果；重复请求不得重复扣库存、发货、发布或发送消息。
6. Pi 原生 Skill 仍使用 Pi 自身的安装和运行机制，但其业务访问必须通过当前项目提供的领域边界；不因为使用了后端查询能力而被重新注册或改写。
### 7.3 Pi 原生 Skill

Skill 属于 Pi Runtime 的扩展能力，直接使用 Pi 原生的安装、加载、配置和调用机制，不要求在当前项目的业务 Manifest 中重复注册。

- Pi 负责 Skill 的安装、启用、禁用、版本和运行生命周期。
- XianYuAgent 负责启动和配置 Pi Runtime，不改写 Skill 的原生能力定义。
- Skill 不自动访问当前项目数据库；需要业务数据时，可以由 Pi Agent 通过后端 Manifest 的 `read` 能力获取，或由 Skill 调用明确提供的领域 API。任何闲鱼或交付写动作仍必须经过 Policy Gateway、Audit、Idempotency 和 Outbox，Skill 不得直接调用底层 `xianyuApi` 或原始平台接口。
- 夸克网盘 Skill 可以直接使用其原生网盘能力完成上传、生成分享链接、获取提取码和生成交付文本。
- Pi Skill 与当前项目业务能力解耦，未来替换 Pi 时再单独实现对应 Runtime Adapter。

后端 `Manifest` 只描述 XianYuAgent 自身提供的账号、商品、卡券、订单和聊天能力；Pi 原生 Skill 不受该 Manifest 的注册约束。
## 8. 数据与领域契约

### 8.1 核心实体

- `Account`：账号标识、备注、启用状态、登录状态、连接状态、策略摘要、凭证引用。
- `Product`：商品标识、账号、标题、描述、价格、库存、图片、视频、规格、交付配置、发布状态。
- `CouponBatch`：批次、商品绑定、类型、数量、可用库存、状态、凭证范围、创建时间。
- `Order`：订单号、账号、商品、买家、金额、支付状态、发货状态、失败原因、聊天上下文。
- `Conversation`：账号、买家、会话 ID、未读数、最后消息、托管状态。
- `Message`：会话、发送方、消息类型、内容引用、发送状态、时间。
- `AgentSession`：会话标题、当前上下文、最近 Run、归档状态。
- `AgentRun`：输入、状态、Step、Confirmation Card、结果、错误和审计引用。
- `CapabilityManifest`：后端业务能力定义、读写类型、权限、Schema、风险和版本。
- `AuditEvent`：操作者、动作、目标、策略、幂等键、结果和 Trace ID。

### 8.2 重要关系

- 一个管理员可管理多个闲鱼账号。
- 一个账号拥有多个商品、会话和订单。
- 一个商品可以绑定多个卡券批次，一个卡券批次可以被多个商品引用，但同一交付动作只能消耗一个明确的有效来源。
- 一个订单关联一个账号、一个商品和零个或多个聊天会话。
- 一个 Agent Run 可以通过 Manifest 直接读取多个实体；新增、修改、删除、发布、发货和发送消息等写操作必须拆成可审计 Step。

## 9. 非功能需求

### 9.1 安全

- Cookie、Token、API Key 和密码等系统凭证必须由后端统一管理，并允许管理员直接查看、编辑和操作；卡券正文和外部交付凭证通过受控领域接口按业务需要提供给管理员、Workspace 和 Agent 使用。
- 卡券正文、夸克链接和提取码可以在前端、Workspace、订单和聊天交付流程中直接展示、复制和使用；不额外增加脱敏、二次确认或超时隐藏，但受控接口必须校验权限、deliveryScope、用途和账号范围，并记录访问审计。
- 系统凭证不得出现在闲鱼买家可见的消息、订单交付内容或外部买家可见响应中；卡券正文、夸克链接和提取码可以返回给授权调用方并用于交付。
- WebSocket 必须校验管理员登录 Token、账号归属和会话权限。

### 9.2 一致性与可靠性

- 商品发布、卡券扣减、订单发货、消息发送必须支持幂等。
- 外部接口超时、限流和登录失效要转换为可理解的业务错误。
- Outbox 支持 pending、running、succeeded、failed、dead-letter 状态。
- 所有异步操作都必须提供进度查询或事件推送。

### 9.3 前端体验

- 保持当前高保真原型的页面结构、深色侧边栏、卡片密度和表格信息层级。
- 页面必须有加载、空数据、错误、权限不足、登录失效和部分成功状态。
- 高风险按钮在提交后进入 disabled 状态，直到得到结果或超时。
- 如果后续使用 Ant Design，只替换交互实现和基础组件，不改变当前高保真布局。

## 10. 验收标准

### 10.1 业务验收

- 能添加账号并看到登录状态、启用状态和当前上下文。
- 能查询商品、编辑商品、上传图片并保存草稿。
- 能生成卡券批次、直接查看卡券正文、查看库存、绑定商品、复制卡券内容并完成交付。
- 能查询订单、查看详情、执行人工发货并看到失败原因。
- 能连接聊天账号、加载会话、接收实时消息、发送文本和图片。
- 能在 Workspace 发起查询和写任务，并在确认卡片后看到执行结果。

### 10.2 Agent 验收

- Agent 通过后端 Manifest 直接调用 `read` 能力获取业务数据；调用 `write` 能力时进入审计和闸门流程；调用 Pi 原生 Skill 时遵循 Pi 自身的 Skill 机制。
- Agent 可以通过受控领域能力读取授权范围内的卡券正文、夸克链接和提取码，但无法直接访问闲鱼 Cookie、Token、API Key、密码和 CredentialStore 底层接口。
- Agent 只能调用领域 API / Manifest；闲鱼和交付写动作必须经过 Policy Gateway、Audit、Idempotency 和 Outbox，不得直接调用底层 `xianyuApi` 或原始平台接口。
- 发布商品、发货、发送消息、修改账号策略等外部写动作必须经过闸门。
- 重复确认同一幂等键不会重复执行。
- Run 的每个 Step 都可追踪到 ToolCall、Audit 和最终结果。

### 10.3 工程验收

- 页面层不直接 import 旧项目 API wrapper。
- `mockApi` 和 `liveApi` 使用同一套领域契约。
- 参考项目字段变化只影响适配层，不影响页面组件。
- 具备账号切换、商品发布确认、订单发货失败重试、聊天发送和 Agent 确认卡的集成测试。
- 不修改当前高保真页面，后续开发以现有页面为验收基线。

## 11. 实施顺序

### 阶段一：领域基础迁移

1. 管理员认证与会话。
2. 账号列表、账号状态和授权流程。
3. 商品列表、详情、图片上传和草稿保存。
4. 卡券批次、库存和商品绑定。
5. 订单列表、详情和发货状态。
6. 聊天账号、会话、历史消息和 WebSocket。

### 阶段二：核心写动作

1. 商品编辑和发布。
2. 卡券生成和交付引用。
3. 订单手动发货、免物流发货和失败重试。
4. 聊天文本和图片发送。
5. 账号策略保存和登录续期。

### 阶段三：Agent 闸门

1. Manifest 生成和能力注册。
2. Agent Session、Run、Step、Event 数据模型。
3. Policy Gateway 和 Confirmation Card。
4. Outbox、Audit、Idempotency。
5. Pi Runtime Adapter。
6. Workspace 接入查询、上传、生成、发布和发货任务。

### 阶段四：Skill 与扩展

1. 接入 Pi 原生 Skill 安装、启用、禁用和版本管理。
2. 接入夸克网盘原生 Skill 完成交付。
3. Dashboard Plugin。
4. 通知、外部服务和更多业务 Skill。

## 12. 当前决策

- 以当前高保真页面为交互验收基线，不在本轮 PRD 阶段修改页面。
- 以 `xianyu-auto-reply` 为能力来源，不复制其全部业务和数据库结构。
- 前端通过稳定领域契约访问后端，旧接口由适配层隔离。
- Pi 是可替换的 Runtime Adapter，业务代码只依赖 AgentRuntime 抽象；Pi Skill 使用 Pi 原生机制，不与当前业务数据库和领域模型耦合。
- Agent 的读取能力可以通过 Manifest 或受控领域 API 直接调用；卡券正文、夸克链接和提取码按授权直接展示、复制和读取。所有业务写动作必须经过 Policy Gateway、审计、幂等处理；需要确认的动作进入 Confirmation Card，其余低风险动作直接进入 Outbox 执行。
- 第一阶段优先迁移账号、商品、卡券、订单和聊天基础能力，然后再接入 Agent。









