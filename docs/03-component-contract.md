# XianyuSellerAgent 阶段 3 前端组件详细契约

- 文档版本：v0.1
- 更新日期：2026-09-19
- 评审状态：阶段 3 门禁重新打开，待独立复审
- 适用范围：组件职责、页面容器、数据流、路由/API 映射、状态边界、移动端对等性
- 关联文档：`docs/03-frontend-design.md`、`docs/02-data-api.md`、`docs/02-database-schema.md`

## 1. 目标与硬约束

本文件把阶段 3 的概念组件树细化为可实现的模块契约。设计完成的判定标准不是“页面能打开”，而是每个功能都有明确的容器、查询、命令、状态边界和展示组件。

必须遵守以下硬约束：

1. 禁止超级组件：一个组件不得同时拥有路由编排、跨域 API、复杂业务状态、表格渲染、弹窗编排和全局反馈。
2. 页面容器只负责组合 controller、ViewModel 和 View；不得直接拼接平台原始字段或直接操作 DOM。
3. View 组件只负责展示和触发 typed callback；不得 fetch、生成幂等键、修改缓存或解释服务端状态机。
4. Controller 负责 query/mutation/realtime 生命周期；不得返回 JSX 或直接持有 DOM 引用。
5. Domain adapter 负责把阶段 2 API DTO 映射为 canonical ViewModel；页面组件不得自行推断 `RunStatus`、订单四态或外部结果。
6. 任何写动作都必须经过 `Command -> Policy/Confirmation -> Idempotency -> API -> Cache/Realtime`，不能由按钮文案触发隐式行为。
7. Desktop 与 Mobile 共享 domain ViewModel、状态和命令，不共享强行缩放的布局；移动端必须为 8 个正式页面提供独立组合。
8. `App.tsx` 只允许保留 AppShell 组合；不得保留页面业务 JSX、全局 click capture 或业务按钮文案分派。

## 2. 目录与分层

目标目录如下；阶段 4 先完成骨架和类型，阶段 5 逐页接入真实 API：

```text
SellerAgent/src/
├─ app/
│  ├─ AppShell.tsx
│  ├─ route-registry.ts
│  ├─ AuthGate.tsx
│  └─ providers/
│     ├─ SessionProvider.tsx
│     ├─ AccountContextProvider.tsx
│     ├─ QueryCacheProvider.tsx
│     ├─ ModalProvider.tsx
│     └─ ToastProvider.tsx
├─ pages/
│  ├─ auth/{LoginPage,FirstRunPage,SessionExpiredPage}.tsx
│  ├─ dashboard/DashboardPage.tsx
│  ├─ workspace/WorkspacePage.tsx
│  ├─ accounts/AccountsPage.tsx
│  ├─ messages/MessagesPage.tsx
│  ├─ products/ProductsPage.tsx
│  ├─ coupons/CouponsPage.tsx
│  ├─ orders/OrdersPage.tsx
│  └─ settings/SettingsPage.tsx
├─ features/
│  └─ <domain>/{components,controller.ts,view-model.ts,types.ts,queries.ts,mutations.ts}
│     domains: dashboard/workspace/accounts/messages/products/coupons/orders/settings/auth
├─ layouts/
│  ├─ {AuthLayout,AppShell,DesktopShell,MobileShell,PageFrame,Sidebar,TopBar,MobileHeader,BottomTabs}.tsx
│  └─ state-boundaries/{Loading,Empty,Error,Forbidden,Disabled,Timeout,Conflict,Reconnect}.tsx
├─ ui/
│  ├─ {Icon,Logo,Button,Badge,StatusPill,RiskTag,KpiCard,DataTable,Drawer,Modal,Toast,Timeline,FormField}.tsx
│  └─ index.ts
├─ domain/
│  ├─ canonical-types.ts
│  ├─ status-machines.ts
│  ├─ capabilities.ts
│  └─ redaction-guards.ts
├─ view-models/{dashboard,workspace,accounts,messages,products,coupons,orders,settings}.ts
├─ controllers/{auth,dashboard,workspace,accounts,messages,products,coupons,orders,settings}.ts
├─ api/
│  ├─ endpoints.ts
│  ├─ client.ts
│  ├─ queryKeys.ts
│  ├─ commands.ts
│  ├─ adapters/{auth,workspace,accounts,messages,products,coupons,orders,settings}.ts
│  └─ ws/{workspace,messages}.ts
└─ state/{sessionStore,accountContextStore,mutationStore}.ts
```

## 3. 组件职责矩阵

| 层级 | 允许承担 | 明确禁止 |
| --- | --- | --- |
| `AppShell` | Provider、路由、布局切换、全局反馈挂载 | 业务字段、页面查询、按钮文案分派 |
| `PageContainer` | 页面 controller 调用、ViewModel 组装、页面级状态边界 | 直接 fetch、跨页面缓存清空、平台字段映射 |
| `Controller` | query、mutation、WebSocket、重试/取消、缓存失效、命令状态 | JSX、DOM 查询、业务文案渲染 |
| `View` | 纯展示、局部交互、typed callback | fetch、生成 Idempotency-Key、修改全局 store |
| `Feature component` | 一个业务子域的一组输入/输出，例如 `DeliveryPreview` | 同时管理多个业务域或多个独立状态机 |
| `StateBoundary` | loading/empty/error/403/timeout/conflict/reconnect 统一展示 | 推断错误原因、发起隐式重试 |
| `Domain adapter` | DTO → canonical ViewModel、状态翻译、敏感字段裁剪 | 访问 React 状态、渲染 UI |
| `UI primitive` | 样式、可访问性、通用交互 | 业务 API、账号/订单/凭证判断 |

### 3.1 超级组件禁止清单

以下形态直接判定为不合格：

- `App` 同时处理路由、业务动作、Modal、Toast 和 DOM click capture；
- `SettingsPage` 同时内嵌六个以上配置域并管理所有保存逻辑；
- `WorkspacePage` 同时负责会话、Run、Step、确认、Outbox 和消息编辑；
- `ProductEditor` 同时负责基础信息、价格库存、SKU、素材、回复策略和发布；
- `FormRows`、`CatalogToolbar` 等通用组件承载校验、API 或业务状态；
- 任何组件通过按钮文本、CSS class 或 DOM 层级推断业务动作；
- Desktop 与 Mobile 各自复制一套业务状态和 API 调用。

## 4. Canonical ViewModel 与状态适配

页面组件只接收以下语义模型，不直接依赖旧 DTO：

```ts
type RunStatus =
  | 'queued' | 'running' | 'waiting_confirmation' | 'executing'
  | 'retrying' | 'cancelling' | 'succeeded' | 'partially_succeeded'
  | 'failed' | 'cancelled' | 'expired';

type OrderViewModel = {
  paymentStatus: 'unpaid' | 'paid' | 'closed' | 'unknown';
  orderStatus: 'open' | 'cancelling' | 'cancelled' | 'completed' | 'closed' | 'failed';
  deliveryStatus: 'pending' | 'reserving' | 'delivered' | 'partially_delivered' | 'failed' | 'cancelled';
  afterSalesStatus: 'none' | 'requested' | 'refunding' | 'refunded' | 'rejected' | 'closed';
  deliveryType?: 'manual' | 'no_logistics' | 'coupon_only' | 'mixed';
};

type MutationViewModel = {
  phase: 'idle' | 'submitting' | 'succeeded' | 'failed' | 'unknown';
  idempotencyKey?: string;
  outboxId?: string;
  externalOutcome?: 'known_success' | 'known_failure' | 'unknown';
};
```

`api/adapters/*` 必须完成旧字段到上述模型的映射。若映射失败，返回 `CONFLICT` 或 `VALIDATION_FAILED`，不得让页面组件自行兜底成“成功”。

### 4.1 Canonical ViewModel inventory

以下 ViewModel 必须在 `view-models/` 中逐一落名并由 adapter 生成：

| Domain | Required ViewModel | 最低字段 |
| --- | --- | --- |
| Dashboard | `DashboardSnapshotVM`、`DashboardTrendVM`、`RiskTodoVM` | KPI、orderCount、orderAmount、autoProcessRate、deliveryFailureRate、深链引用 |
| Workspace | `WorkspaceSessionVM`、`RunVM`、`StepVM`、`ConfirmationVM`、`OutboxResultVM` | sessionId、accountId、RunStatus、StepStatus、policyRef、auditRef、externalOutcome |
| Accounts | `AccountVM`、`AccountConnectionVM`、`LoginSessionVM`、`AccountScopeVM` | accountId、connection、login status、scope、过期时间；不得包含凭证值 |
| Messages | `ConversationVM`、`MessageVM`、`BuyerContextVM`、`RealtimeVM` | conversationId、direction、bodyType、order/product link、risk flags、cursor |
| Products | `ProductVM`、`ProductAssetVM`、`SkuVM`、`PublishResultVM` | productId、accountId、status、version、asset status、逐项发布结果 |
| Coupons | `CouponBatchVM`、`CouponItemVM`、`CouponContentPreviewVM`、`InventoryLockVM` | batchId、status、available count、deliveryScope、redacted content、lock state |
| Orders | `OrderVM`、`DeliveryPreviewVM`、`DeliveryRecordVM`、`AfterSalesVM` | 四套状态、deliveryType、preview state、attempt、externalOutcome |
| Settings/Auth | `SettingsSectionVM`、`CredentialRefVM`、`RuntimeHealthVM`、`AdminProfileVM`、`SessionVM` | section version、secret reference、health、profile、session state |

## 5. 路由、容器、查询和命令契约

| 路由 | PageContainer | Query / Realtime | Commands | 成功后的失效范围 |
| --- | --- | --- | --- | --- |
| `/login` | `LoginPage` | `GET /api/v1/auth/session` | `POST /api/v1/auth/login`、`POST /api/v1/auth/password-login` | Session、账号上下文 |
| `/first-run` | `FirstRunPage` | `GET /api/v1/auth/session` | **未冻结**：阶段 2 尚未定义管理员 bootstrap endpoint；完成前不得实现真实提交 | Session、Profile |
| `/dashboard` | `DashboardPage` | `GET /api/v1/dashboard/snapshot`、`GET /api/v1/dashboard/order-trend` | 无业务写命令 | dashboard query |
| `/workspace` | `WorkspacePage` | Agent sessions、Run、Confirmation、`WS /api/v1/workspace/runs/{id}/events` | session create/switch/archive、run start/confirm/cancel/retry | 当前 session、run、受影响订单/商品/卡券 |
| `/accounts` | `AccountsPage` | accounts、connection、login-session、scopes | account create/update/refresh、login-session cancel/renew/reauthorize/cleanup、scope patch | account context、相关 domain queries |
| `/messages` | `MessagesPage` | conversations、messages、`WS /api/v1/conversations/{id}/events` | send text/image、recall；人工接管 endpoint 尚未在阶段 2 P0 API 冻结 | conversation、order link、unread count |
| `/products` | `ProductsPage` | products、product detail/assets | create/update/sync/pull/assets/publish/bulk-publish | product list/detail、coupon bindings、workspace links |
| `/coupons` | `CouponsPage` | batches、batch detail、content preview | create/update/delete/bind/unbind/items/assets/void | batch inventory、product bindings、order delivery preview |
| `/orders` | `OrdersPage` | orders、order detail、refresh | delivery-preview/deliver/cancel/retry | order、delivery record、conversation、coupon inventory |
| `/settings` | `SettingsPage` | agent/reply-policy/delivery-policy/policy-gateway/external-services/runtime/outbox/account-scopes/profile/sessions | settings PATCH、credential CRUD/rotate/revoke/enable/disable、password/session revoke | only affected settings/domain query |

所有写命令统一由 controller 生成 `Idempotency-Key`，将服务端 envelope 转为 `MutationViewModel`，未知结果必须进入查询或恢复流程。

### 5.2 API contract gaps that block PASS

以下接口必须先在阶段 2 API 契约中补齐或明确复用关系，阶段 3 才能重新通过：

| 能力 | 当前状态 | 阻断原因 |
| --- | --- | --- |
| 首次管理员初始化 | 未定义 endpoint、request、response、审计事件 | `FirstRunPage` 无法拥有可执行 command |
| 消息人工接管 | PRD 有能力描述，但 P0 API 未定义 handoff command | `HandoffRiskPanel` 无法映射到稳定路由 |
| Admin Profile / Password / Session | 阶段 2 已定义 `/api/v1/auth/profile`、`/api/v1/auth/password`、`/api/v1/auth/sessions...` | 必须在 Settings route registry 中单独注册，防止被 `SettingsPanel` 吞并 |
| CredentialStore | 阶段 2 已定义 `/api/v1/credentials...` | 必须冻结 CredentialViewModel 和明文读取的受控 modal 流程 |

### 5.3 Endpoint-to-component catalog

下表是页面 controller 必须消费的最小 endpoint 集；聚合写法只表示同一 bounded context，不能由页面自行拼接平台 URL：

| Controller | Method + canonical path | Request / response | Scope + idempotency |
| --- | --- | --- | --- |
| `useAuthController` | `POST /api/v1/auth/login`、`POST /api/v1/auth/password-login`、`POST /api/v1/auth/logout` | credentials / session envelope | admin session；登录/密码变更后轮换 CSRF |
| `useAuthController` | `GET /api/v1/auth/session`、`GET/PATCH /api/v1/auth/profile`、`POST /api/v1/auth/password`、`GET /api/v1/auth/sessions`、`POST /api/v1/auth/sessions/{id}/revoke`、`POST /api/v1/auth/sessions/revoke-all` | `SessionVM`、`AdminProfileVM` | admin only；写请求带 Idempotency-Key |
| `useDashboardController` | `GET /api/v1/dashboard/snapshot`、`GET /api/v1/dashboard/order-trend` | `DashboardSnapshotVM`、`DashboardTrendVM` | 当前账号范围；只读 |
| `useWorkspaceController` | `GET/POST /api/v1/workspace/agent-sessions`、`GET /api/v1/workspace/agent-sessions/search`、`POST /api/v1/workspace/agent-sessions/{id}/switch`、`POST /api/v1/workspace/agent-sessions/{id}/archive` | `WorkspaceSessionVM` | admin + account scope；写请求幂等 |
| `useWorkspaceController` | `POST /api/v1/workspace/runs`、`GET /api/v1/workspace/runs/{id}`、`GET /api/v1/workspace/runs/{id}/confirmation`、`POST /api/v1/workspace/runs/{id}/confirm|cancel|retry` | `RunVM`、`ConfirmationVM`、`MutationVM` | capability + policy + confirmation；unknown 禁止盲重试 |
| `useAccountsController` | `GET/POST/PATCH /api/v1/accounts...`、`GET /api/v1/accounts/{id}/connection`、`POST /api/v1/accounts/{id}/refresh` | `AccountVM`、`AccountConnectionVM` | account scope；写请求幂等 |
| `useAccountsController` | `GET/POST/PATCH/DELETE /api/v1/accounts/{id}/scopes`、`POST/GET /api/v1/accounts/{id}/login-sessions`、`POST /api/v1/accounts/{id}/login-sessions/{sid}/cancel|renew|reauthorize|cleanup` | `AccountScopeVM`、`LoginSessionVM` | admin only；二维码轮询不得跨账号 |
| `useMessagesController` | `GET /api/v1/conversations`、`GET /api/v1/conversations/{id}/messages`、`POST /api/v1/conversations/{id}/messages`、`POST /api/v1/conversations/{id}/images`、`POST /api/v1/conversations/{id}/messages/{messageId}/recall` | `ConversationVM`、`MessageVM` | account scope；发送/撤回幂等 |
| `useMessagesController` | `WS /api/v1/conversations/{id}/events` | `RealtimeVM` + normalized message event | Session + Origin + account scope；cursor 补偿 |
| `useProductsController` | `GET/POST/PATCH /api/v1/products...`、`POST /api/v1/products/sync`、`POST /api/v1/products/pull` | `ProductVM` | account scope；同步/拉取写请求幂等 |
| `useProductsController` | `GET/POST/PATCH/DELETE /api/v1/products/{id}/assets...`、`POST /api/v1/products/{id}/publish`、`POST /api/v1/products/bulk-publish` | `ProductAssetVM`、`PublishResultVM` | Policy + Confirmation + Outbox；逐项结果 |
| `useCouponsController` | `GET/POST /api/v1/coupons/batches`、`GET/PATCH/DELETE /api/v1/coupons/batches/{id}` | `CouponBatchVM` | account scope；正文不在列表响应 |
| `useCouponsController` | `POST /api/v1/coupons/batches/{id}/bind|unbind|void`、`POST /items/import|bulk-save|bulk-delete`、`POST /assets` | `InventoryLockVM`、逐项结果 | inventory transaction + audit |
| `useCouponsController` | `GET /api/v1/coupons/{id}/content` | `CouponContentPreviewVM` | purpose + deliveryScope + audit；默认脱敏 |
| `useOrdersController` | `GET /api/v1/orders`、`GET /api/v1/orders/{orderNo}`、`POST /api/v1/orders/refresh` | `OrderVM`、`DeliveryRecordVM` | account scope；只读刷新可限次重试 |
| `useOrdersController` | `POST /api/v1/orders/{orderNo}/delivery-preview|deliver|cancel|retry` | `DeliveryPreviewVM`、`MutationVM` | 支付/匹配/库存/Policy/Idempotency/Outbox |
| `useSettingsController` | `GET/PATCH /api/v1/settings/{agent|reply-policy|delivery-policy|policy-gateway|external-services|runtime|outbox|account-scopes}` | `SettingsSectionVM`、config version | section owner；version conflict 不自动覆盖 |
| `useCredentialController` | `GET/POST/PATCH /api/v1/credentials...`、`POST /api/v1/credentials/{id}/rotate|revoke|enable|disable` | `CredentialRefVM`；明文仅受控读取 | admin only；所有操作 AuditEvent + Idempotency-Key |

### 5.4 Command payload / response examples

```ts
type DeliverOrderInput = {
  orderNo: string;
  deliveryType: 'manual' | 'no_logistics' | 'coupon_only' | 'mixed';
  previewRef: string;
  idempotencyKey: string;
};

type DeliverOrderOutput = {
  order: OrderViewModel;
  delivery: DeliveryRecordVM;
  externalOutcome: 'known_success' | 'known_failure' | 'unknown';
  auditRef: string;
  outboxId?: string;
};

type StartRunInput = {
  sessionId: string;
  instruction: string;
  idempotencyKey: string;
};

type StartRunOutput = {
  run: RunVM;
  confirmation?: ConfirmationVM;
  auditRef: string;
};
```

`OrderActionBar` 只能发出 `DeliverOrderInput` / `CancelOrderInput` / `RetryOrderInput`，不能直接调用 API；`WorkspaceComposer` 只能发出 `StartRunInput`，不能修改 `RunVM.status`。

### 5.1 Typed Route Registry

页面组件不得自行读取 `window.location` 或解析 URL 字符串。统一由 `route-registry.ts` 解析以下允许参数：

| Route | 允许参数 | 禁止放入 URL |
| --- | --- | --- |
| `/workspace` | `sessionId`、`runId` | prompt、confirmation payload、凭证、正文 |
| `/accounts` | `accountId`、`view=login-session|scopes` | qr token、cookie、credential value |
| `/messages` | `accountId`、`conversationId` | 买家正文、图片内容、token |
| `/products` | `accountId`、`productId`、`mode=edit|view` | AI prompt 原文、素材签名 URL |
| `/coupons` | `accountId`、`batchId`、`mode=items|content` | 卡券正文、提取码、夸克链接 |
| `/orders` | `accountId`、`orderNo`、四套状态筛选 | 买家敏感备注、交付正文 |
| `/settings/:section` | `agent|reply-policy|delivery-policy|policy-gateway|external-services|runtime|outbox|account-scopes|credentials|profile|sessions` | API Key、Cookie、Session ID |

Controller 接收已解析的 `RouteContext`，View 不感知 query string；敏感内容只能通过受控 API 返回并遵守审计和脱敏规则。

## 6. 页面级详细组件契约

### 6.1 Dashboard

`DashboardPage` 只组合 `DashboardController` 和以下 View：

- `KpiGrid`：订单金额、订单数、自动处理率、待人工数、可售卡券库存；只接受已格式化 KPI。
- `TrendCard`：订单金额、订单数、自动处理率、发货失败趋势；不读取 API。
- `HealthCard`：账号连接、策略、Runtime、凭证边界健康状态。
- `ProductRankCard`：带 `productId/accountId` 深链。
- `RecentActivityTimeline`：带 `orderId/conversationId/runId` typed link。
- `RiskTodoDrawer`：只接收待办列表和 `onOpenTodo`。

### 6.2 Workspace

```text
WorkspacePage
├─ WorkspaceController
├─ SessionToolbar
├─ SessionList
├─ SessionControls
├─ ContextPanel
├─ RunChat
│  ├─ ToolCallSummary
│  ├─ StepTimeline
│  ├─ RunResult
│  └─ BusinessLink
├─ ConfirmationCard
├─ OutboxResult
├─ RunActionBar (cancel/retry/recover)
├─ RealtimeBanner
└─ WorkspaceComposer
```

`RunChat` 只能渲染消息与步骤，不拥有确认、取消、重试或 Outbox 命令；`ConfirmationCard` 只接受 `before/after/risk/policyRef/auditRef` 和 typed callbacks。

### 6.3 Accounts

```text
AccountsPage
├─ AccountsController
├─ AccountToolbar (search/filter/pagination)
├─ AccountKpiGrid
├─ AccountTable
├─ AccountStatusActions
├─ AddAccountDialog
│  └─ LoginMethodPicker (qr/password/cookie-reference)
├─ LoginSessionDrawer
├─ ScopeEditor
├─ AccountPolicyEditor
└─ CredentialLink
```

`CredentialLink` 只能跳转 CredentialStore；不得在账号表内直接显示或编辑凭证值。

### 6.4 Messages

```text
MessagesPage
├─ MessagesController
├─ AccountTabs
├─ ConversationList
├─ ConversationHeader
├─ BuyerContextPanel (buyer/order/product/notes/risk)
├─ MessageTimeline
├─ AiSuggestionPanel
├─ HandoffRiskPanel
├─ AttachmentUpload
├─ MessageComposer
├─ MessageActionMenu (recall)
└─ ConnectionBanner (reconnect/forbidden)
```

`MessageComposer` 只管理草稿和上传回调；发送、重试、撤回由 controller 命令完成。

### 6.5 Products

```text
ProductsPage
├─ ProductsController
├─ ProductToolbar
├─ SyncPullToolbar
├─ ProductTable
├─ BulkActionBar
├─ ProductDrawer
│  ├─ ProductBasicForm
│  ├─ PricingInventoryForm
│  ├─ SkuVariantEditor
│  ├─ ReplyPromptEditor
│  ├─ AssetPanel
│  └─ PublishPreview
└─ PublishConfirmation
```

`ProductDrawer` 只负责布局和 tab；各表单维护自己的 dirty/validation；发布由 `PublishConfirmation` 进入 controller。

### 6.6 Coupons

```text
CouponsPage
├─ CouponsController
├─ BatchToolbar
├─ CouponBatchTable
├─ BatchDrawer
│  ├─ BatchMetadataForm
│  ├─ CouponItemEditor
│  ├─ AssetPanel
│  ├─ BindingPanel
│  └─ ContentPreview (脱敏)
├─ DeliveryActionBar
└─ InventoryLockBanner
```

`ContentPreview` 只展示脱敏内容和用途，不执行发货；`DeliveryActionBar` 只提交受控 delivery command。

### 6.7 Orders

```text
OrdersPage
├─ OrdersController
├─ OrderSyncToolbar
├─ OrderFilters
├─ OrderTable
├─ OrderDetailDrawer
│  ├─ OrderStatusMatrix
│  ├─ DeliveryModeSelector
│  ├─ DeliveryPreview
│  ├─ OrderActionBar
│  └─ ConversationLink
├─ RetryConfirmation
└─ AuditTimeline
```

`OrderStatusMatrix` 只接收四套 canonical 状态；`DeliveryPreview` 与 `OrderActionBar` 分离，避免预览组件触发交付。

### 6.8 Settings 与 Auth

Settings 页面必须逐一落名：`AgentPanel`、`AutoReplyPolicyPanel`、`DeliveryPolicyPanel`、`PolicyGatewayPanel`、`CredentialStorePanel`、`ExternalServicesPanel`、`RuntimeOutboxPanel`、`AccountPermissionPanel`、`AdminProfilePanel`、`SessionManagementPanel`。`SettingsTabs` 只切换 panel，不拥有保存逻辑；`DirtyFormGuard` 负责离开前确认。

Auth 必须拆分为 `AuthGate`、`LoginPage`、`FirstRunPage`、`SessionExpiredPage`，不得继续使用合并三种状态的 `AuthPreview`。

## 7. 数据流与状态归属

### 7.1 读请求

```text
Route
  → PageContainer
  → Controller query key (accountId + route + filters)
  → API client
  → response envelope
  → domain adapter
  → canonical ViewModel
  → StateBoundary
  → View components
```

### 7.2 写请求

```text
View typed callback
  → Controller local validation
  → capability / account scope / policy precheck
  → Confirmation (if high risk)
  → Idempotency-Key
  → /api/v1 command
  → MutationViewModel
  → cache invalidation + AuditRef
  → Outbox / Realtime result
```

### 7.3 WebSocket

`MessagesController` 和 `WorkspaceController` 独立维护连接、游标、重连和 forbidden 状态；页面 View 只接收 `connectionState` 和事件列表。恢复连接后先按 cursor 补事件，再更新 query cache，禁止直接追加重复消息。

### 7.4 状态边界

所有 PageContainer 必须包裹 `LoadingState`、`EmptyState`、`ErrorState`、`ForbiddenState`；写动作必须额外支持 `SubmittingState`、`TimeoutState`、`ConflictState` 和 `UnknownResultRecovery`。这些状态组件不拥有 API 调用。

## 8. 移动端对等性

移动端必须提供完整 8×2 覆盖矩阵。移动页复用同一 controller、ViewModel、命令和状态边界，仅替换布局组件：

| PageKey | Desktop page | Mobile page | Controller / VM | 当前状态 |
| --- | --- | --- | --- | --- |
| dashboard | `DashboardPage` | `MobileDashboardPage` | `useDashboardController` / DashboardVM | 原型已有，需拆分 |
| workspace | `WorkspacePage` | `MobileWorkspacePage` | `useWorkspaceController` / WorkspaceVM | 原型已有，需拆分 |
| accounts | `AccountsPage` | `MobileAccountsPage` | `useAccountsController` / AccountsVM | 原型已有，需拆分 |
| messages | `MessagesPage` | `MobileMessagesPage` | `useMessagesController` / MessagesVM | 原型已有，需拆分 |
| products | `ProductsPage` | `MobileProductsPage` | `useProductsController` / ProductsVM | 当前缺失，阻断 |
| coupons | `CouponsPage` | `MobileCouponsPage` | `useCouponsController` / CouponsVM | 当前缺失，阻断 |
| orders | `OrdersPage` | `MobileOrdersPage` | `useOrdersController` / OrdersVM | 当前缺失，阻断 |
| settings | `SettingsPage` | `MobileSettingsPage` | `useSettingsController` / SettingsVM | 原型已有，需拆分 |

不得把未实现页面回退到 `MobileDashboardView`，也不得复制一套不同的 API 与状态解释。

## 9. 阶段 3 重新通过的 DoD

阶段 3 在以下条件全部满足前保持未通过：

1. 每个正式页面都有 Container、Controller、ViewModel、View 和 StateBoundary 清单。
2. 所有阶段 2 P0 API 都有 route/command/query 映射；缺失接口必须显式登记，不得用静态数组掩盖。
3. `App.tsx` 不再负责业务 click capture；所有动作由 typed callback 或 command id 触发。
4. `SettingsPage`、`WorkspacePage`、`AuthPreview`、`ProductEditor` 等超级组件已拆分并有独立文件边界。
5. `api/contracts.ts` 经 adapter 对齐 canonical RunStatus、Order 四态和 Mutation 状态。
6. Products/Coupons/Orders 的移动端页面不再回退 Dashboard。
7. 至少完成一条纵向设计走查：订单交付预览 → Confirmation → Outbox 结果，能逐节点指出数据来源、状态持有者、失效范围和错误处理。
8. 独立评审确认“无超级组件、无隐式文案分派、无页面直连原始字段”。

在上述 DoD 完成前，阶段 3 只能标记为 `REOPENED / FAIL`，不得进入阶段 4 实施计划的执行门禁。

## 10. 反超级组件审计证据

阶段 3 重新复审必须提供以下可复现证据：

1. `rg` 扫描 `pages/`、`features/`、`components/ui/`：不得出现页面直连 `api.`、`fetch(`、`new WebSocket(`、`document.`。
2. `rg` 扫描：`handlePrototypeClick`、`closest('button')`、按 `textContent`/按钮文案分派动作的结果必须为 0。
3. 组件图中每个节点只有一个 owner；Settings 各 section、Workspace 子块、Orders 四态动作分别有独立 feature owner。
4. Desktop/Mobile 页面覆盖矩阵为 8×2；Products/Coupons/Orders 不得回退 Dashboard。
5. Route → Controller → API contract 表中，每个写动作都列出 Idempotency-Key、权限/账号 scope、成功/失败/unknown/timeout/retry 处理。
6. `src/api/contracts.ts` 与 `docs/02-data-api.md` 的 canonical status、error code 和敏感字段裁剪规则一致。

Controller 统一返回以下形状，页面不得自行拼装状态：

```ts
type CommandSpec = Record<string, { input: unknown; output: unknown }>;
type QueryState<T> = {
  status: 'idle' | 'loading' | 'refreshing' | 'success' | 'empty' | 'error' | 'forbidden' | 'timeout';
  data: T | null;
  errorCode?: string;
};
type ControllerResult<T, C extends CommandSpec> = {
  query: QueryState<T>;
  mutation: { [K in keyof C]: { status: 'idle' | 'submitting' | 'succeeded' | 'failed' | 'unknown' | 'conflict' | 'timeout'; result?: C[K]['output']; errorCode?: string } };
  commands: { [K in keyof C]: (input: C[K]['input']) => Promise<C[K]['output']> };
  realtime?: { status: 'closed' | 'connecting' | 'connected' | 'reconnecting' | 'forbidden' | 'error'; lastEventAt?: string; errorCode?: string };
};
```

### 10.1 Canonical error mapping

Controller 只返回阶段 2 canonical error code；断网属于 transport 状态，不创建新的服务端错误码：

| Error code | UI 处理 | 自动重试 |
| --- | --- | --- |
| `UNAUTHENTICATED` | 交给 `AuthGate`，清理敏感 query | 否 |
| `FORBIDDEN` | `ForbiddenState`，保留上下文 | 否 |
| `NOT_FOUND` | 空结果或资源失效提示 | 否 |
| `VALIDATION_FAILED` | 字段级错误，保留草稿 | 否 |
| `VERSION_CONFLICT` | 刷新并展示差异 | 否 |
| `CONFLICT` | 展示业务冲突和替代动作 | 否 |
| `EXTERNAL_TIMEOUT` | 查询状态 / 恢复入口 | 不盲重试 |
| `EXTERNAL_UNKNOWN` | 只允许状态查询或人工恢复 | 否 |
| `IDEMPOTENCY_CONFLICT` | 展示原请求结果 | 否 |
| `IDEMPOTENCY_IN_PROGRESS` | 显示处理中并轮询 | 仅轮询 |
| `CSRF_INVALID` | 重新获取 CSRF 后由 AuthGate 处理 | 否 |
| `RATE_LIMITED` | 使用 `retry-after` 倒计时 | 按服务端指示 |
| `SERVICE_UNAVAILABLE` | 服务不可用状态 | 读请求限次重试 |
