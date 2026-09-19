# XianyuSellerAgent 阶段 3 前端组件详细契约

- 文档版本：v0.1
- 更新日期：2026-09-19
- 评审状态：阶段 3 设计审查中；实现明确后置，不作为当前门禁证据
- 适用范围：组件职责、页面容器、数据流、路由/API 映射、状态边界、移动端对等性
- 关联文档：`docs/03-frontend-design.md`、`docs/02-data-api.md`、`docs/02-database-schema.md`

## 1. 目标与硬约束

本文件把阶段 3 的概念组件树细化为可实现的模块契约。当前阶段只进行设计，不进行具体编码；高保真原型和现有源码都只是参考材料，不作为组件拆分正确性的验收依据。设计完成的判定标准是每个功能都有明确的容器、查询、命令、状态边界、展示组件和禁止依赖。

必须遵守以下硬约束：

1. 禁止超级组件：一个组件不得同时拥有路由编排、跨域 API、复杂业务状态、表格渲染、弹窗编排和全局反馈。
2. 页面容器只负责组合 controller、ViewModel 和 View；不得直接拼接平台原始字段或直接操作 DOM。
3. View 组件只负责展示和触发 typed callback；不得 fetch、生成幂等键、修改缓存或解释服务端状态机。
4. Controller 负责 query/mutation/realtime 生命周期；不得返回 JSX 或直接持有 DOM 引用。
5. Domain adapter 负责把阶段 2 API DTO 映射为 canonical ViewModel；页面组件不得自行推断 `RunStatus`、订单四态或外部结果。
6. 任何写动作都必须经过 `Command -> Policy/Confirmation -> Idempotency -> API -> Cache/Realtime`，不能由按钮文案触发隐式行为。
7. Desktop 与 Mobile 共享 domain ViewModel、状态和命令，不共享强行缩放的布局；移动端必须为 8 个正式页面提供独立组合。
8. 设计蓝图中的 `AppShell` 只允许保留 Provider、路由和布局组合；不得把页面业务、全局反馈或业务动作分派塞进壳层。具体源码拆分留到后续实现阶段。

## 2. 目录与分层

目标目录如下；这是阶段 3 的设计蓝图，不代表当前源码已经创建这些文件，也不要求本阶段编码：

```text
apps/web/src/
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
│     domains: dashboard/workspace/accounts/messages/products/coupons/orders/settings/auth/execution
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
├─ view-models/{dashboard,workspace,accounts,messages,products,coupons,orders,settings,execution}.ts
├─ controllers/{auth,dashboard,workspace,accounts,messages,products,coupons,orders,settings,execution}.ts
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

页面组件只接收以下语义模型，不直接依赖旧 DTO。字段名、枚举和值域在设计阶段冻结；服务端新增字段必须先进入 adapter，不得直接穿透到 View。

```ts
type RunStatus =
  | 'queued' | 'running' | 'waiting_confirmation' | 'executing'
  | 'retrying' | 'cancelling' | 'succeeded' | 'partially_succeeded'
  | 'failed' | 'cancelled' | 'expired';

type StepStatus =
  | 'pending' | 'running' | 'waiting_confirmation' | 'executing'
  | 'retrying' | 'succeeded' | 'partially_succeeded' | 'failed'
  | 'skipped' | 'cancelled';

type ExternalOutcome = 'known_success' | 'known_failure' | 'unknown';

type RecoverOutboxRequest = {
  outboxId: string;
  reason: string;
};

type RunVM = {
  runId: string;
  sessionId: string;
  accountId: string;
  status: RunStatus;
  instructionSummary: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  currentStepId?: string;
  steps: StepVM[];
  confirmation?: ConfirmationVM;
  resultSummary?: string;
  policyRef?: string;
  auditRef?: string;
  externalOutcome?: ExternalOutcome;
  errorCode?: string;
};

type StepVM = {
  stepId: string;
  runId: string;
  sequence: number;
  kind: 'plan' | 'tool_call' | 'policy_check' | 'mutation' | 'observation';
  label: string;
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  inputSummary?: string;
  outputSummary?: string;
  affectedEntityRefs: Array<{ type: string; id: string }>;
  policyRef?: string;
  auditRef?: string;
  externalOutcome?: ExternalOutcome;
  errorCode?: string;
};

type ConfirmationVM = {
  confirmationId: string;
  runId: string;
  actionKind: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  impactSummary: string;
  policyRef: string;
  requiredCapabilities: string[];
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  expiresAt: string;
  auditRef: string;
};

type OrderVM = {
  orderNo: string;
  accountId: string;
  paymentStatus: 'unpaid' | 'paid' | 'closed' | 'unknown';
  orderStatus: 'open' | 'cancelling' | 'cancelled' | 'completed' | 'closed' | 'failed';
  deliveryStatus: 'pending' | 'reserving' | 'delivered' | 'partially_delivered' | 'failed' | 'cancelled';
  afterSalesStatus: 'none' | 'requested' | 'refunding' | 'refunded' | 'rejected' | 'closed';
  deliveryType?: 'manual' | 'no_logistics' | 'coupon_only' | 'mixed';
  configVersion?: number;
  updatedAt: string;
};

type CouponBatchVM = {
  batchId: string;
  accountId: string;
  status: 'draft' | 'active' | 'paused' | 'closed';
  availableCount: number;
  reservedCount: number;
  deliveryScope: 'system_only' | 'operator_only' | 'buyer_deliverable';
  stockAlert: 'normal' | 'low_stock' | 'exhausted';
  version: number;
  updatedAt: string;
};

type MessageVM = {
  messageId: string;
  conversationId: string;
  accountId: string;
  direction: 'inbound' | 'outbound';
  senderRole: 'buyer' | 'admin' | 'agent' | 'system';
  bodyType: 'text' | 'image' | 'file' | 'system';
  bodyText?: string;
  bodyRef?: string;
  redactionState: 'none' | 'masked' | 'restricted';
  status: 'pending' | 'sent' | 'failed' | 'recalled';
  createdAt: string;
  externalOutcome?: ExternalOutcome;
  orderRef?: string;
  productRef?: string;
  riskFlags: string[];
  handlingMode: 'ai' | 'human';
};

type CouponContentPreviewVM = {
  couponId: string;
  batchId: string;
  purpose: 'delivery' | 'preview' | 'audit';
  deliveryScope: 'system_only' | 'operator_only' | 'buyer_deliverable';
  accountIds: string[];
  content: {
    body: string;
    quarkUrl?: string;
    extractionCode?: string;
  };
  access: {
    allowed: boolean;
    purpose: 'delivery' | 'preview' | 'audit';
    denialReason?: 'purpose_not_allowed' | 'scope_mismatch' | 'order_not_eligible' | 'policy_rejected';
    auditRef: string;
  };
  inventoryStatus: 'available' | 'reserved' | 'delivered' | 'void' | 'exhausted';
};

type SettingsSectionVM = {
  sectionKey:
    | 'agent' | 'reply-policy' | 'delivery-policy' | 'policy-gateway'
    | 'external-services' | 'runtime' | 'outbox' | 'account-scopes';
  configVersion: number;
  values: Record<string, unknown>;
  editableFields: string[];
  capability: 'read' | 'write' | 'admin_only';
  updatedAt: string;
  auditRef?: string;
};

type CredentialRefVM = {
  credentialId: string;
  accountId?: string;
  kind: 'cookie' | 'token' | 'password' | 'api_key' | 'other';
  label: string;
  status: 'active' | 'disabled' | 'rotating' | 'revoked';
  maskedPreview: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  canReveal: boolean;
  revealExpiresAt?: string;
  auditRef?: string;
};

type QrLoginSessionVM = {
  qrSessionId: string;
  accountId: string;
  status: 'waiting' | 'succeeded' | 'expired' | 'failed';
  qrImageRef?: string;
  expiresAt: string;
  pollAfterMs: number;
  connection?: AccountConnectionVM;
  errorCode?: string;
  auditRef?: string;
};

type MutationViewModel = {
  phase: 'idle' | 'submitting' | 'succeeded' | 'failed' | 'unknown' | 'conflict' | 'timeout';
  idempotencyKey?: string;
  outboxId?: string;
  externalOutcome?: ExternalOutcome;
  errorCode?: string;
  retryAfterAt?: string;
};
```

敏感字段规则：`CredentialRefVM` 永不包含明文凭证；`CouponContentPreviewVM.content` 可由管理员在受控领域接口中直接查看、复制和编辑，但买家可见链路仍必须满足 `deliveryScope=buyer_deliverable`、订单已支付、商品与账号匹配、策略通过并完成审计；`MessageVM.bodyText` 由 adapter 按买家可见边界裁剪。`externalOutcome = 'unknown'` 只表示外部平台结果未知，不是 Outbox 状态，也不允许页面自动重放写请求。

`api/adapters/*` 必须完成旧字段到上述模型的映射。若映射失败，返回 `CONFLICT` 或 `VALIDATION_FAILED`，不得让页面组件自行兜底成“成功”。

### 4.1 Canonical ViewModel inventory

以下 ViewModel 必须在 `view-models/` 中逐一落名并由 adapter 生成：

| Domain | Required ViewModel | 最低字段 |
| --- | --- | --- |
| Dashboard | `DashboardSnapshotVM`、`DashboardTrendVM`、`RiskTodoVM` | KPI、orderCount、orderAmount、autoProcessRate、deliveryFailureRate、深链引用 |
| Workspace | `WorkspaceSessionVM`、`RunVM`、`StepVM`、`ConfirmationVM`、`OutboxResultVM` | sessionId、accountId、RunStatus、StepStatus、policyRef、auditRef、externalOutcome |
| Accounts | `AccountVM`、`AccountConnectionVM`、`LoginSessionVM`、`QrLoginSessionVM`、`AccountScopeVM` | accountId、connection、login status、QR 状态、scope、过期时间；不得包含凭证值 |
| Messages | `ConversationVM`、`MessageVM`、`BuyerContextVM`、`RealtimeVM` | conversationId、direction、bodyType、order/product link、risk flags、handlingMode、cursor |
| Products | `ProductVM`、`ProductAssetVM`、`SkuVM`、`PublishResultVM` | productId、accountId、status、version、asset status、逐项发布结果 |
| Coupons | `CouponBatchVM`、`CouponItemVM`、`CouponContentPreviewVM`、`InventoryLockVM` | batchId、status、available count、reserved count、deliveryScope、`stockAlert`（批次级派生告警）、controlled content、lock state |
| Orders | `OrderVM`、`DeliveryPreviewVM`、`DeliveryRecordVM`、`AfterSalesVM` | 四套状态、deliveryType、preview state、attempt、externalOutcome |
| Settings/Auth | `SettingsSectionVM`、`CredentialRefVM`、`RuntimeHealthVM`、`AdminProfileVM`、`SessionVM` | section version、secret reference、health、profile、session state |

## 5. 路由、容器、查询和命令契约

| 路由 | PageContainer | Query / Realtime | Commands | 成功后的失效范围 |
| --- | --- | --- | --- | --- |
| `/login` | `LoginPage` | `GET /api/v1/auth/session` | `POST /api/v1/auth/login`、`POST /api/v1/auth/password-login` | Session、账号上下文 |
| `/first-run` | `FirstRunPage` | `GET /api/v1/auth/session`（读取 `bootstrapRequired`） | `POST /api/v1/auth/bootstrap` | Session、Profile、Bootstrap status |
| `/dashboard` | `DashboardPage` | `GET /api/v1/dashboard/snapshot`、`GET /api/v1/dashboard/order-trend` | 无业务写命令 | dashboard query |
| `/workspace` | `WorkspacePage` | Agent sessions、Run、Confirmation、`WS /api/v1/workspace/runs/{id}/events` | session create/switch/archive、run start/confirm/cancel/retry | 当前 session、run、受影响订单/商品/卡券 |
| `/accounts` | `AccountsPage` | accounts、connection、login-session、QR login-session、scopes | account create/update/refresh、QR session create/poll、login-session cancel/renew/reauthorize/cleanup、scope patch | account context、相关 domain queries |
| `/messages` | `MessagesPage` | conversations、messages、`WS /api/v1/conversations/{id}/events` | send text/image、recall、handoff、release | conversation、order link、unread count、handoff risk todo |
| `/products` | `ProductsPage` | products、product detail/assets | create/update/sync/pull/assets/publish/bulk-publish | product list/detail、coupon bindings、workspace links |
| `/coupons` | `CouponsPage` | batches、batch detail、content preview | create/update/delete/bind/unbind/items/assets/void | batch inventory、product bindings、order delivery preview |
| `/orders` | `OrdersPage` | orders、order detail、refresh | delivery-preview/deliver/cancel/retry | order、delivery record、conversation、coupon inventory |
| `/settings` | `SettingsPage` | agent/reply-policy/delivery-policy/policy-gateway/external-services/runtime/outbox/account-scopes/profile/sessions | settings PATCH、credential CRUD/rotate/revoke/enable/disable、password/session revoke | only affected settings/domain query |

所有写命令统一由 controller 生成 `Idempotency-Key`，将服务端 envelope 转为 `MutationViewModel`，未知结果必须进入查询或恢复流程。

`/settings/:section` 只负责路由承载，不拥有所有保存逻辑：`agent`、`reply-policy`、`delivery-policy`、`policy-gateway`、`external-services`、`runtime`、`outbox`、`account-scopes` 由 `useSettingsController` / `SettingsSectionPanel` 分别拥有；`profile`、`sessions` 及密码变更只由 `useAuthController`（或其命名别名 `AuthSettingsController`）拥有；`credentials` 只由 `useCredentialController` 拥有。`SettingsPage` 和 `SettingsTabs` 不得直接发请求或拼接 payload。

### 5.2 API contract gaps that block PASS

以下接口已在阶段 2 API 契约中冻结，本文件补充它们在前端的 owner、ViewModel、命令和恢复语义；实现前不得绕过这些契约创建临时路径。

| 能力 | 当前状态 | 阻断原因 |
| --- | --- | --- |
| 首次管理员初始化 | 阶段 2 已冻结 `POST /api/v1/auth/bootstrap` 与 `bootstrapRequired` | `FirstRunPage` 必须复用阶段 2 的 bootstrap 语义，不得新增平行路径 |
| 消息人工接管 | 阶段 2 已冻结 `POST /api/v1/conversations/{id}/handoff` 与 `/release` | `HandoffRiskPanel` 可映射到稳定路由，不能复用普通消息发送 |
| Admin Profile / Password / Session | 阶段 2 已定义 `/api/v1/auth/profile`、`/api/v1/auth/password`、`/api/v1/auth/sessions...` | 必须在 Settings route registry 中单独注册，防止被 `SettingsPanel` 吞并 |
| CredentialStore | 阶段 2 已定义 `/api/v1/credentials...` | 必须冻结 CredentialViewModel 和明文读取的受控 modal 流程 |

#### 5.2.1 FirstRun bootstrap canonical contract

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

- `GET /api/v1/auth/session` 在未登录状态也返回 `bootstrapRequired`；`FirstRunPage` 只能消费该字段，不得由路由或本地缓存推断初始化状态。
- `POST /api/v1/auth/bootstrap` 只允许 `bootstrapRequired=true` 时调用；成功后原子创建管理员、Session、CSRF token 和 `auth.bootstrap.completed` 审计事件。
- bootstrap 使用专用幂等作用域 `bootstrap + normalizedRoute + Idempotency-Key`；同指纹重放原 envelope，不重复创建管理员或 Session；不同指纹返回 `409 IDEMPOTENCY_CONFLICT`。
- 初始化完成后再次调用返回 `409 CONFLICT`（`bootstrap_already_completed`），前端跳转 `/login`，不得自动重试。
- `password` 仅存在于 TLS 请求体和服务端哈希流程，禁止进入 query cache、URL、日志和任何 ViewModel。

#### 5.2.2 Message handoff canonical contract

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

- `POST /api/v1/conversations/{conversationId}/handoff` 将 `handlingMode` 切换为 `human`；`POST /api/v1/conversations/{conversationId}/release` 将其切换为 `ai`。两者都是独立 command，不得复用 `POST /messages`。
- 两个 endpoint 都要求管理员 session、账号 scope、`Idempotency-Key` 和 `expectedVersion`；成功后失效 conversation detail/list、unread count、dashboard risk todo，并通过 conversation WebSocket 广播 handling event。
- `HandoffRiskPanel` 只提交 `HandoffConversationInput`；它不发送消息、不改写 `MessageVM.status`、不直接切换连接状态。
- `VERSION_CONFLICT` 保留用户填写的 `reason` 草稿并刷新 conversation；`EXTERNAL_TIMEOUT`/`EXTERNAL_UNKNOWN` 进入 `unknown` 恢复态，只允许查询 handling 状态或人工确认，不得盲目重放。

### 5.3 Endpoint-to-component catalog

下表是页面 controller 必须消费的最小 endpoint 集。每行只有一个 method + canonical path；页面不得自行拼接 URL、复用其他 controller 的 mutation 或把多个路径合并成一个“万能命令”。

| Controller | Method + canonical path | Request → response | Scope / idempotency | Query key / invalidation | Error recovery |
| --- | --- | --- | --- | --- | --- |
| `useAuthController` | `POST /api/v1/auth/login` | `LoginRequest` → `SessionVM` | 未认证；不要求幂等 | 写入 `['auth','global','session']`、`['accounts','global','context']` | `UNAUTHENTICATED` 保留表单错误；`RATE_LIMITED` 按 retry-after |
| `useAuthController` | `POST /api/v1/auth/password-login` | `PasswordLoginRequest` → `SessionVM` | 未认证；不要求幂等 | 同上 | `VALIDATION_FAILED` 字段级展示；成功轮换 CSRF |
| `useAuthController` | `POST /api/v1/auth/logout` | 空 → `MutationViewModel` | 已认证；要求幂等 | 清除 auth/session、所有 account/domain query | 失败仍清理本地 session，记录可观测错误 |
| `useAuthController` | `GET /api/v1/auth/session` | Query 空 → `SessionVM` | 未认证可调用；只读 | `['auth','global','session']` | `UNAUTHENTICATED` 进入登录；网络错误可读请求重试 |
| `useAuthController` | `GET /api/v1/auth/profile` | Query 空 → `AdminProfileVM` | admin only；只读 | `['auth','global','profile']` | `FORBIDDEN` 进入 ForbiddenState |
| `useAuthController` | `PATCH /api/v1/auth/profile` | `ProfilePatchRequest` → `AdminProfileVM` | admin only；Idempotency-Key | 更新 `['auth','global','profile']`、session display cache | `VERSION_CONFLICT` 保留草稿并刷新 diff |
| `useAuthController` | `POST /api/v1/auth/password` | `PasswordChangeRequest` → `MutationViewModel` | admin only；Idempotency-Key | 清除 sessions，刷新 `['auth','global','session']` | `VALIDATION_FAILED` 保留字段；成功重新登录 |
| `useAuthController` | `GET /api/v1/auth/sessions` | Query 空 → `SessionVM[]` | admin only；只读 | `['auth','global','sessions']` | 只读请求限次重试 |
| `useAuthController` | `POST /api/v1/auth/sessions/{id}/revoke` | 空 → `MutationViewModel` | admin only；Idempotency-Key | 失效 `['auth','global','sessions']` | `NOT_FOUND` 视为已撤销并刷新 |
| `useAuthController` | `POST /api/v1/auth/sessions/revoke-all` | `{exceptCurrent?: boolean}` → `MutationViewModel` | admin only；Idempotency-Key | 失效所有 `['auth','global','sessions']` | 不自动重放；按服务端结果提示 |
| `useAuthController` | `POST /api/v1/auth/bootstrap` | `BootstrapAdminInput` → `BootstrapAdminOutput` | bootstrap capability；专用 Idempotency-Key | 写入 auth/session、profile、account context | 已完成 bootstrap 返回 `CONFLICT` 并跳 `/login` |
| `useDashboardController` | `GET /api/v1/dashboard/snapshot` | `DashboardFilters` → `DashboardSnapshotVM` | account scope；只读 | `['dashboard',accountId,'snapshot',filters]` | 空数据走 EmptyState；网络错误可刷新 |
| `useDashboardController` | `GET /api/v1/dashboard/order-trend` | `TrendFilters` → `DashboardTrendVM` | account scope；只读 | `['dashboard',accountId,'trend',filters]` | 同上 |
| `useWorkspaceController` | `GET /api/v1/workspace/agent-sessions` | `SessionListFilters` → `WorkspaceSessionVM[]` | admin + account scope；只读 | `['workspace',accountId,'sessions',filters]` | 只读重试；禁止跨账号回退 |
| `useWorkspaceController` | `POST /api/v1/workspace/agent-sessions` | `CreateSessionRequest` → `WorkspaceSessionVM` | admin + account scope；Idempotency-Key | 失效 workspace sessions | `IDEMPOTENCY_IN_PROGRESS` 轮询同 key |
| `useWorkspaceController` | `GET /api/v1/workspace/agent-sessions/search` | `SearchSessionQuery` → `WorkspaceSessionVM[]` | admin + account scope；只读 | `['workspace',accountId,'sessions','search',query]` | 空结果明确展示 |
| `useWorkspaceController` | `POST /api/v1/workspace/agent-sessions/{id}/switch` | `SwitchSessionRequest` → `WorkspaceSessionVM` | admin + account scope；Idempotency-Key | 更新 active session、workspace query | `CONFLICT` 刷新并提示会话已改变 |
| `useWorkspaceController` | `POST /api/v1/workspace/agent-sessions/{id}/archive` | 空 → `MutationViewModel` | admin + account scope；Idempotency-Key | 失效 sessions、active session | 已归档视为幂等成功 |
| `useWorkspaceController` | `POST /api/v1/workspace/runs` | `StartRunInput` → `RunVM` | capability + account scope；Idempotency-Key | 写入 `['workspace',accountId,'run',runId]`、sessions | `VALIDATION_FAILED` 保留 composer 草稿 |
| `useWorkspaceController` | `GET /api/v1/workspace/runs/{id}` | Query 空 → `RunVM` | account scope；只读 | `['workspace',accountId,'run',runId]` | `NOT_FOUND` 结束 stale route |
| `useWorkspaceController` | `GET /api/v1/workspace/runs/{id}/confirmation` | Query 空 → `ConfirmationVM` | account scope；只读 | `['workspace',accountId,'confirmation',runId]` | pending 轮询；expired 进入过期态 |
| `useWorkspaceController` | `POST /api/v1/workspace/runs/{id}/confirm` | `ConfirmRunRequest` → `MutationViewModel` | capability + policy；Idempotency-Key | 失效 run、confirmation、outbox | `VERSION_CONFLICT` 刷新 confirmation；unknown 仅查状态 |
| `useWorkspaceController` | `POST /api/v1/workspace/runs/{id}/cancel` | `CancelRunRequest` → `MutationViewModel` | account scope；Idempotency-Key | 失效 run、steps、outbox | cancelling/unknown 进入恢复态，不盲重试 |
| `useWorkspaceController` | `POST /api/v1/workspace/runs/{id}/retry` | `RetryRunRequest` → `MutationViewModel` | capability + policy；Idempotency-Key | 失效 run、steps、outbox | 仅 failed/expired 可重试；unknown 禁止 |
| `useWorkspaceController` | `WS /api/v1/workspace/runs/{id}/events` | cursor → `RealtimeVM` + run event | Session + Origin + account scope | 更新 run/step/confirmation/outbox query | reconnect 后 cursor 补偿，禁止重复 append |
| `useAccountsController` | `GET /api/v1/auth/qr-sessions/{id}` | Query 空 → `QrLoginSessionVM` | admin + account scope；只读 | `['accounts',accountId,'qr-session',qrSessionId]` | waiting 按 `pollAfterMs` 轮询；expired/failed 停止轮询并提供重新扫码 |
| `useAccountsController` | `POST /api/v1/auth/qr-sessions` | `CreateQrSessionRequest` → `QrLoginSessionVM` | admin + account scope；Idempotency-Key | 写入 `['accounts',accountId,'qr-session',qrSessionId]`、account connection | `EXTERNAL_TIMEOUT` 进入轮询；`FORBIDDEN` 保留账号上下文；不得把 QR token 写入 URL |
| `useAccountsController` | `GET /api/v1/accounts` | `AccountListFilters` → `AccountVM[]` | admin；只读 | `['accounts','global','list',filters]` | 只读重试 |
| `useAccountsController` | `GET /api/v1/accounts/{id}` | Query 空 → `AccountVM` | admin + account scope；只读 | `['accounts',accountId,'detail']` | `NOT_FOUND` 结束 stale route；`FORBIDDEN` 保留列表上下文 |
| `useAccountsController` | `POST /api/v1/accounts` | `CreateAccountRequest` → `AccountVM` | admin；Idempotency-Key | 失效 accounts、account context | `CONFLICT` 展示重复账号并刷新 |
| `useAccountsController` | `PATCH /api/v1/accounts/{id}` | `AccountPatchRequest` → `AccountVM` | admin；Idempotency-Key | 失效 account detail/list/context | `VERSION_CONFLICT` 保留草稿并 diff |
| `useAccountsController` | `GET /api/v1/accounts/{id}/connection` | Query 空 → `AccountConnectionVM` | account scope；只读 | `['accounts',accountId,'connection']` | 连接失败展示当前已知状态 |
| `useAccountsController` | `POST /api/v1/accounts/{id}/refresh` | `RefreshAccountRequest` → `AccountConnectionVM` | admin + account scope；Idempotency-Key | 失效 connection、account list | `EXTERNAL_TIMEOUT` 转轮询/人工恢复 |
| `useAccountsController` | `GET /api/v1/accounts/{id}/scopes` | Query 空 → `AccountScopeVM[]` | admin；只读 | `['accounts',accountId,'scopes']` | 无权限进入 ForbiddenState |
| `useAccountsController` | `POST /api/v1/accounts/{id}/scopes` | `CreateScopeRequest` → `AccountScopeVM` | admin；Idempotency-Key | 失效 account scopes | `CONFLICT` 刷新列表 |
| `useAccountsController` | `PATCH /api/v1/accounts/{id}/scopes/{scopeId}` | `ScopePatchRequest` → `AccountScopeVM` | admin；Idempotency-Key | 失效 account scopes | `VERSION_CONFLICT` 保留编辑内容 |
| `useAccountsController` | `DELETE /api/v1/accounts/{id}/scopes/{scopeId}` | 空 → `MutationViewModel` | admin；Idempotency-Key | 失效 account scopes、dependent queries | 已删除视为幂等成功 |
| `useAccountsController` | `POST /api/v1/accounts/{id}/login-sessions` | `CreateLoginSessionRequest` → `LoginSessionVM` | admin + account scope；Idempotency-Key | 写入 login session query | `EXTERNAL_TIMEOUT` 进入二维码轮询 |
| `useAccountsController` | `GET /api/v1/accounts/{id}/login-sessions/{sid}` | Query 空 → `LoginSessionVM` | account scope；只读 | `['accounts',accountId,'login-session',sid]` | 轮询等待/过期/失败分别渲染 |
| `useAccountsController` | `POST /api/v1/accounts/{id}/login-sessions/{sid}/cancel` | 空 → `MutationViewModel` | admin + account scope；Idempotency-Key | 失效 login session、connection | cancelling 不自动重复提交 |
| `useAccountsController` | `POST /api/v1/accounts/{id}/login-sessions/{sid}/renew` | 空 → `LoginSessionVM` | admin + account scope；Idempotency-Key | 失效 login session、connection | unknown 仅查询状态 |
| `useAccountsController` | `POST /api/v1/accounts/{id}/login-sessions/{sid}/reauthorize` | `ReauthorizeRequest` → `LoginSessionVM` | admin + account scope；Idempotency-Key | 失效 login session、connection | 需重新授权时展示明确 CTA |
| `useAccountsController` | `POST /api/v1/accounts/{id}/login-sessions/{sid}/cleanup` | 空 → `MutationViewModel` | admin + account scope；Idempotency-Key | 失效 login session | NOT_FOUND 可视为已清理 |
| `useCredentialController` | `GET /api/v1/credentials` | `CredentialFilters` → `CredentialRefVM[]` | admin only；只读 | `['credentials','global','list',filters]` | 明文永不进入错误/缓存 |
| `useCredentialController` | `POST /api/v1/credentials` | `CreateCredentialRequest` → `CredentialRefVM` | admin only；Idempotency-Key | 失效 credentials、account connection | `VALIDATION_FAILED` 保留表单，不回显 secret |
| `useCredentialController` | `GET /api/v1/credentials/{id}` | Query 空 → `CredentialRefVM` | admin only；只读；`credentialId` 全局唯一例外 | `['credentials','global','detail',credentialId]` | 不返回明文；需要 reveal 走独立受控动作 |
| `useCredentialController` | `PATCH /api/v1/credentials/{id}` | `CredentialPatchRequest` → `CredentialRefVM` | admin only；Idempotency-Key | 失效 credential detail/list | `VERSION_CONFLICT` 展示差异 |
| `useCredentialController` | `POST /api/v1/credentials/{id}/rotate` | `RotateCredentialRequest` → `CredentialRefVM` | admin only；Idempotency-Key | 失效 credential、connection、account health | `EXTERNAL_UNKNOWN` 进入人工恢复 |
| `useCredentialController` | `POST /api/v1/credentials/{id}/revoke` | `RevokeCredentialRequest` → `MutationViewModel` | admin only；Idempotency-Key | 失效 credential、connection、account health | 不自动重放；刷新最终状态 |
| `useCredentialController` | `POST /api/v1/credentials/{id}/enable` | 空 → `CredentialRefVM` | admin only；Idempotency-Key | 失效 credential、health | `CONFLICT` 刷新状态 |
| `useCredentialController` | `POST /api/v1/credentials/{id}/disable` | `DisableCredentialRequest` → `CredentialRefVM` | admin only；Idempotency-Key | 失效 credential、health | 已 disabled 视为幂等成功 |
| `useMessagesController` | `GET /api/v1/conversations` | `ConversationFilters` → `ConversationVM[]` | account scope；只读 | `['messages',accountId,'conversations',filters]` | 空结果走 EmptyState |
| `useMessagesController` | `GET /api/v1/conversations/{id}/messages` | `MessageCursorQuery` → `MessageVM[]` | account scope；只读 | `['messages',accountId,'timeline',conversationId,cursor]` | cursor 失效则从最新 cursor 重拉 |
| `useMessagesController` | `POST /api/v1/conversations/{id}/messages` | `SendMessageRequest` → `MessageVM` | account scope；Idempotency-Key | 失效 conversation/messages/unread | unknown 只查消息状态，不重复发送 |
| `useMessagesController` | `POST /api/v1/conversations/{id}/images` | `UploadImageRequest` → `MessageVM` | account scope；Idempotency-Key | 同上 | 上传失败可重试上传，不重放已确认发送 |
| `useMessagesController` | `POST /api/v1/conversations/{id}/messages/{messageId}/recall` | `RecallMessageRequest` → `MessageVM` | sender/admin + account scope；Idempotency-Key | 失效 message/conversation | 平台不支持撤回时展示审计失败 |
| `useMessagesController` | `POST /api/v1/conversations/{id}/handoff` | `HandoffConversationInput` → `ConversationHandlingOutput` | admin + account scope；Idempotency-Key + expected version | 失效 conversation、unread、risk todo | `VERSION_CONFLICT` 保留草稿；unknown 仅查 handling 状态 |
| `useMessagesController` | `POST /api/v1/conversations/{id}/release` | `ReleaseConversationInput` → `ConversationHandlingOutput` | admin + account scope；Idempotency-Key + expected version | 同上 | 冲突刷新 conversation，不自动覆盖 |
| `useMessagesController` | `WS /api/v1/conversations/{id}/events` | cursor → `RealtimeVM` + message/handoff event | Session + Origin + account scope | 更新 conversation/messages/unread | reconnect 后先补 cursor 再刷新 query |
| `useProductsController` | `GET /api/v1/products` | `ProductFilters` → `ProductVM[]` | account scope；只读 | `['products',accountId,'list',filters]` | 空结果明确展示 |
| `useProductsController` | `POST /api/v1/products` | `CreateProductRequest` → `ProductVM` | account scope；Idempotency-Key | 失效 products list | `VALIDATION_FAILED` 保留草稿 |
| `useProductsController` | `GET /api/v1/products/{id}` | Query 空 → `ProductVM` | account scope；只读 | `['products',accountId,'detail',productId]` | `NOT_FOUND` 结束 stale route |
| `useProductsController` | `PATCH /api/v1/products/{id}` | `ProductPatchRequest` → `ProductVM` | account scope；Idempotency-Key + expected version | 失效 product detail/list | `VERSION_CONFLICT` 展示 diff |
| `useProductsController` | `POST /api/v1/products/sync` | `SyncProductsRequest` → `MutationViewModel` | account scope；Idempotency-Key | 失效 products、dashboard snapshot | unknown 进入 outbox 状态查询 |
| `useProductsController` | `POST /api/v1/products/pull` | `PullProductsRequest` → `MutationViewModel` | account scope；Idempotency-Key | 同上 | 仅查询任务状态，不盲重放 |
| `useProductsController` | `GET /api/v1/products/{id}/assets` | Query 空 → `ProductAssetVM[]` | account scope；只读 | `['products',accountId,'assets',productId]` | 图片失败保留占位和重试 |
| `useProductsController` | `POST /api/v1/products/{id}/assets` | `CreateAssetRequest` → `ProductAssetVM` | account scope；Idempotency-Key | 失效 assets/product detail | 上传与发布分离 |
| `useProductsController` | `PATCH /api/v1/products/{id}/assets/{assetId}` | `AssetPatchRequest` → `ProductAssetVM` | account scope；Idempotency-Key | 失效 assets/product detail | 版本冲突保留编辑 |
| `useProductsController` | `DELETE /api/v1/products/{id}/assets/{assetId}` | 空 → `MutationViewModel` | account scope；Idempotency-Key | 失效 assets/product detail | 已删除视为幂等成功 |
| `useProductsController` | `POST /api/v1/products/{id}/publish` | `PublishProductRequest` → `PublishResultVM` | Policy + Confirmation + Outbox；Idempotency-Key | 失效 product detail/list、dashboard | 部分成功按逐项结果展示 |
| `useProductsController` | `POST /api/v1/products/bulk-publish` | `BulkPublishRequest` → `PublishResultVM[]` | Policy + Confirmation + Outbox；Idempotency-Key | 失效受影响 products/dashboard | 不以 HTTP 200 替代逐项失败 |
| `useCouponsController` | `GET /api/v1/coupons/batches` | `CouponBatchFilters` → `CouponBatchVM[]` | account scope；只读 | `['coupons',accountId,'batches',filters]` | 正文不在列表，空结果明确展示 |
| `useCouponsController` | `POST /api/v1/coupons/batches` | `CreateCouponBatchRequest` → `CouponBatchVM` | account scope；Idempotency-Key | 失效 batches | `VALIDATION_FAILED` 保留草稿 |
| `useCouponsController` | `GET /api/v1/coupons/batches/{id}` | Query 空 → `CouponBatchVM` | account scope；只读 | `['coupons',accountId,'batch',batchId]` | `NOT_FOUND` 结束 stale route |
| `useCouponsController` | `PATCH /api/v1/coupons/batches/{id}` | `CouponBatchPatchRequest` → `CouponBatchVM` | account scope；Idempotency-Key + expected version | 失效 batch/list/inventory | `VERSION_CONFLICT` 展示 diff |
| `useCouponsController` | `DELETE /api/v1/coupons/batches/{id}` | 空 → `MutationViewModel` | account scope；Idempotency-Key | 失效 batch/list/inventory | 已删除视为幂等成功 |
| `useCouponsController` | `POST /api/v1/coupons/batches/{id}/bind` | `BindCouponBatchRequest` → `InventoryLockVM` | account + product scope；Idempotency-Key | 失效 batch/product/order preview | 冲突刷新绑定关系 |
| `useCouponsController` | `POST /api/v1/coupons/batches/{id}/unbind` | `UnbindCouponBatchRequest` → `MutationViewModel` | account + product scope；Idempotency-Key | 失效 batch/product/order preview | unknown 仅查询绑定状态 |
| `useCouponsController` | `POST /api/v1/coupons/batches/{id}/items/import` | `ImportCouponItemsRequest` → `InventoryLockVM` | account scope；Idempotency-Key | 失效 batch/inventory | 逐项错误返回，保留成功项 |
| `useCouponsController` | `POST /api/v1/coupons/batches/{id}/items/bulk-save` | `BulkSaveCouponItemsRequest` → `InventoryLockVM` | account scope；Idempotency-Key | 失效 batch/inventory | 逐项结果，不整批伪成功 |
| `useCouponsController` | `POST /api/v1/coupons/batches/{id}/items/bulk-delete` | `BulkDeleteCouponItemsRequest` → `InventoryLockVM` | account scope；Idempotency-Key | 失效 batch/inventory | 已删除项幂等，失败项可重试 |
| `useCouponsController` | `POST /api/v1/coupons/batches/{id}/assets` | `CreateCouponAssetRequest` → `CouponAssetRef` | account scope；Idempotency-Key | 失效 batch/assets | 上传失败可单独重试 |
| `useCouponsController` | `DELETE /api/v1/coupons/batches/{id}/assets/{assetId}` | 空 → `MutationViewModel` | account scope；Idempotency-Key | 失效 batch/assets | 已删除视为幂等成功 |
| `useCouponsController` | `POST /api/v1/coupons/batches/{id}/void` | `VoidCouponBatchRequest` → `MutationViewModel` | Policy + account scope；Idempotency-Key | 失效 batch/inventory/order preview | void 后禁止恢复性盲重试 |
| `useCouponsController` | `GET /api/v1/coupons/{id}/content` | `CouponContentQuery` → `CouponContentPreviewVM` | admin + account scope + purpose + deliveryScope；只读 | `['coupons',accountId,'content',couponId,purpose,scope]` | 受控内容失败只显示拒绝原因，不泄露正文 |
| `useOrdersController` | `GET /api/v1/orders` | `OrderFilters` → `OrderVM[]` | account scope；只读 | `['orders',accountId,'list',filters]` | 空结果明确展示 |
| `useOrdersController` | `GET /api/v1/orders/{orderNo}` | Query 空 → `OrderVM` | account scope；只读 | `['orders',accountId,'detail',orderNo]` | `NOT_FOUND` 结束 stale route |
| `useOrdersController` | `POST /api/v1/orders/refresh` | `RefreshOrdersRequest` → `MutationViewModel` | account scope；Idempotency-Key | 失效 orders、dashboard、conversation links | timeout 转任务状态查询 |
| `useOrdersController` | `POST /api/v1/orders/{orderNo}/delivery-preview` | `DeliveryPreviewRequest` → `DeliveryPreviewVM` | payment + match + inventory + policy；Idempotency-Key | 写入 `['orders',accountId,'delivery-preview',orderNo]` | validation 展示缺口，不创建 outbox |
| `useOrdersController` | `POST /api/v1/orders/{orderNo}/deliver` | `DeliverOrderInput` → `DeliveryRecordVM` + `OrderVM` | Confirmation + Outbox；Idempotency-Key | 失效 order/detail/list、delivery、coupon inventory、risk todo | unknown/timeout 只查 outbox/external state |
| `useOrdersController` | `POST /api/v1/orders/{orderNo}/cancel` | `CancelOrderRequest` → `OrderVM` | policy + account scope；Idempotency-Key | 失效 order/detail/list、conversation | cancelling/unknown 不自动重放 |
| `useOrdersController` | `POST /api/v1/orders/{orderNo}/retry` | `RetryOrderRequest` → `MutationViewModel` | failed/cancelled + policy；Idempotency-Key | 失效 order/detail/list、delivery | 仅允许明确可重试状态 |
| `useSettingsController` | `GET /api/v1/settings/agent` | Query 空 → `SettingsSectionVM` | admin；只读 | `['settings','global','agent']` | forbidden/timeout 由 StateBoundary 展示 |
| `useSettingsController` | `PATCH /api/v1/settings/agent` | `SettingsPatchRequest` → `SettingsSectionVM` | admin；Idempotency-Key + expected version | 失效 settings/agent、workspace/dashboard | `VERSION_CONFLICT` 保留草稿并 diff |
| `useSettingsController` | `GET /api/v1/settings/reply-policy` | Query 空 → `SettingsSectionVM` | admin；只读 | `['settings','global','reply-policy']` | 同上 |
| `useSettingsController` | `PATCH /api/v1/settings/reply-policy` | `SettingsPatchRequest` → `SettingsSectionVM` | admin；Idempotency-Key + expected version | 失效 reply-policy、messages/dashboard | 同上 |
| `useSettingsController` | `GET /api/v1/settings/delivery-policy` | Query 空 → `SettingsSectionVM` | admin；只读 | `['settings','global','delivery-policy']` | 同上 |
| `useSettingsController` | `PATCH /api/v1/settings/delivery-policy` | `SettingsPatchRequest` → `SettingsSectionVM` | admin；Idempotency-Key + expected version | 失效 delivery-policy、orders/dashboard | 同上 |
| `useSettingsController` | `GET /api/v1/settings/policy-gateway` | Query 空 → `SettingsSectionVM` | admin；只读 | `['settings','global','policy-gateway']` | 同上 |
| `useSettingsController` | `PATCH /api/v1/settings/policy-gateway` | `SettingsPatchRequest` → `SettingsSectionVM` | admin；Idempotency-Key + expected version | 失效 policy-gateway、workspace/orders | 同上 |
| `useSettingsController` | `GET /api/v1/settings/external-services` | Query 空 → `SettingsSectionVM` | admin；只读 | `['settings','global','external-services']` | 同上 |
| `useSettingsController` | `PATCH /api/v1/settings/external-services` | `SettingsPatchRequest` → `SettingsSectionVM` | admin；Idempotency-Key + expected version | 失效 external-services、health | 同上 |
| `useSettingsController` | `GET /api/v1/settings/runtime` | Query 空 → `SettingsSectionVM` | admin；只读 | `['settings','global','runtime']` | 同上 |
| `useSettingsController` | `PATCH /api/v1/settings/runtime` | `SettingsPatchRequest` → `SettingsSectionVM` | admin；Idempotency-Key + expected version | 失效 runtime、workspace health | 同上 |
| `useSettingsController` | `GET /api/v1/settings/outbox` | Query 空 → `SettingsSectionVM` | admin；只读 | `['settings','global','outbox']` | 同上 |
| `useSettingsController` | `PATCH /api/v1/settings/outbox` | `SettingsPatchRequest` → `SettingsSectionVM` | admin；Idempotency-Key + expected version | 失效 outbox/execution settings | 同上 |
| `useSettingsController` | `GET /api/v1/settings/account-scopes` | Query 空 → `SettingsSectionVM` | admin；只读 | `['settings','global','account-scopes']` | 同上 |
| `useSettingsController` | `PATCH /api/v1/settings/account-scopes` | `SettingsPatchRequest` → `SettingsSectionVM` | admin；Idempotency-Key + expected version | 失效 account scopes、accounts | 同上 |
| `useExecutionController` | `GET /api/v1/execution/outbox` | `OutboxFilters` → `OutboxResultVM[]` | admin；只读 | `['execution','global','outbox',filters]` | 只读可刷新，不能隐式 retry |
| `useExecutionController` | `GET /api/v1/execution/outbox/{id}` | Query 空 → `OutboxResultVM` | admin；只读；`outboxId` 全局唯一例外 | `['execution','global','outbox',outboxId]` | unknown 显示恢复入口 |
| `useExecutionController` | `POST /api/v1/execution/outbox/{id}/retry` | `RetryOutboxRequest` → `MutationViewModel` | admin + policy；Idempotency-Key | 失效 outbox、关联 domain query | dead-letter 需显式确认；unknown 不盲重放 |
| `useExecutionController` | `POST /api/v1/execution/outbox/{id}/recover` | `RecoverOutboxRequest` → `MutationViewModel` | admin + policy；Idempotency-Key | 失效 outbox、关联 domain query | 仅允许状态机定义的 recover |

`Response` 一律先经过 adapter 再交给 View；`MutationViewModel.phase` 只由 controller 写入，View 只能读取。任何 `unknown` 或 `timeout` 结果都必须先进入状态查询/人工恢复，不得通过 UI 的“再次点击”隐式重放。

### 5.4 Query key、缓存失效与恢复矩阵

| 命令 | 成功后的最小失效集合 | `VERSION_CONFLICT` | `unknown / timeout` |
| --- | --- | --- | --- |
| `workspace.run.confirm` | run detail、confirmation、outbox、受影响订单/商品/卡券 | 刷新 confirmation，保留确认前上下文并展示 diff | 查询 run/outbox 状态，不自动重试 |
| `messages.handoff` | conversation detail/list、unread count、dashboard risk todo | 保留 reason，刷新 conversation version | 查询 handling 状态，等待人工确认 |
| `messages.release` | conversation detail/list、unread count、dashboard risk todo | 刷新 conversation version，不覆盖当前人工状态 | 查询 handling 状态，等待人工确认 |
| `products.publish` | product detail/list、dashboard snapshot、关联 coupon bindings | 刷新 product configVersion，保留发布草稿 | 查询 outbox/逐项结果 |
| `coupons.items.bulk-save` | batch detail、inventory、delivery preview | 刷新库存版本，保留未保存行 | 查询 inventory lock，不盲目重放 |
| `orders.delivery-preview` | delivery preview only；不失效 order until deliver | 重新计算 preview | 查询 preview/outbox，不创建重复交付 |
| `orders.deliver` | order detail/list、delivery record、coupon inventory、conversation link、risk todo | 重新加载订单与 preview | 查询 outbox 和外部订单状态 |
| `credentials.rotate/revoke` | credential detail/list、account connection、health | 刷新 credential version | 查询连接/凭证状态，管理员人工恢复 |
| `settings.*.patch` | 对应 settings section + 直接依赖 domain query | 保留表单，展示服务端版本 diff | 查询 section version，不自动覆盖 |

Query key 统一遵循以下规则：

1. 账号作用域资源使用 `['domain', accountId, route, normalized identity, normalized filters]`；detail、timeline、preview、realtime 和 QR login-session key 默认都必须带 `accountId`。
2. 全局管理员资源使用 `['domain', 'global', route, normalized identity, normalized filters]`，仅限明确声明“全局唯一 ID/不属于任何账号”的资源：`auth` session/profile/sessions、`credentialId`、`outboxId`、settings section 和账号全局列表。
3. `runId`、`conversationId`、`productId`、`batchId`、`orderNo` 即使服务端可能全局唯一，也不使用例外，仍保留 `accountId` 以防跨账号缓存碰撞；`qrSessionId` 同样必须带 `accountId`。
4. 任何 mutation 只能失效受影响 key，不能清空全局缓存作为“修复”；query key 顺序不得由页面自行改变。

### 5.5 Command payload / response examples

```ts
type DeliverOrderInput = {
  orderNo: string;
  deliveryType: 'manual' | 'no_logistics' | 'coupon_only' | 'mixed';
  previewRef: string;
  idempotencyKey: string;
};

type DeliverOrderOutput = {
  order: OrderVM;
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
├─ RunActionBar (cancel/retry/outbox-recover)
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

`HandoffRiskPanel` 的唯一输入是 `conversationId`、`handlingMode`、风险标签、当前会话版本和 `MutationViewModel`；唯一输出是 typed `onHandoff(HandoffConversationInput)` 与 `onRelease(ReleaseConversationInput)`。它不得发送消息、修改 `MessageVM.status`、读取买家正文或直接调用 API。

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
│  └─ ContentPreview
├─ DeliveryActionBar
└─ InventoryLockBanner
```

`ContentPreview` 展示受控领域接口返回的管理员可见内容和用途，不执行发货；`DeliveryActionBar` 只提交受控 delivery command。买家可见交付仍由订单策略和 `deliveryScope` 条件决定。

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

Settings 页面必须逐一落名：`AgentPanel`、`AutoReplyPolicyPanel`、`DeliveryPolicyPanel`、`PolicyGatewayPanel`、`CredentialStorePanel`、`ExternalServicesPanel`、`RuntimePanel`、`OutboxPanel`、`AccountPermissionPanel`、`AdminProfilePanel`、`SessionManagementPanel`。`RuntimePanel` 只负责 Runtime 配置，`OutboxPanel` 只负责执行队列查询与恢复；两者不得共享 owner、mutation state 或保存入口。`SettingsTabs` 只切换 panel，不拥有保存逻辑；`DirtyFormGuard` 负责离开前确认。

Auth 必须拆分为 `AuthGate`、`LoginPage`、`FirstRunPage`、`SessionExpiredPage`，不得继续使用合并三种状态的 `AuthPreview`。

`FirstRunPage` 进一步拆分为 `FirstRunController`、`BootstrapForm`、`BootstrapPolicyNotice`、`BootstrapStateBoundary` 和 `BootstrapSuccessRedirect`：`FirstRunController` 唯一消费 `bootstrapRequired` 并发出 `BootstrapAdminInput`；`BootstrapForm` 只维护字段校验和草稿；`BootstrapSuccessRedirect` 只处理成功后的 `/login` 跳转。密码不进入 URL、query cache、日志或 ViewModel。

### 6.9 Feature component contract matrix

以下矩阵是设计级反超级组件证据。UI primitive 只遵守通用 `View` 规则，不拥有领域状态；页面和 feature component 必须在矩阵中有唯一 owner。

| Component | Owner | Props / input | Typed events | Data source | State consumed | Forbidden dependencies |
| --- | --- | --- | --- | --- | --- | --- |
| `DashboardPage` | `useDashboardController` | `RouteContext`, account scope | `onOpenTodo(TodoRef)`, `onRefresh()` | snapshot/trend query | loading/empty/error/forbidden/timeout | direct API, raw DTO, mutation dispatch |
| `KpiGrid` | `DashboardPage` | `DashboardSnapshotVM` | `onSelectKpi(KpiKey)` | page ViewModel | success/empty | query client, policy evaluation |
| `WorkspacePage` | `useWorkspaceController` | session/run route context | `onSelectSession`, `onStartRun`, `onOpenBusinessRef` | session/run/confirmation/outbox queries + WS | loading/empty/reconnect/forbidden | direct Pi API, DOM action routing |
| `RunChat` | `WorkspacePage` | `RunVM`, `StepVM[]` | `onOpenStep(StepId)` | `RunVM` | run status + step status | confirm/cancel/retry commands |
| `RunActionBar` | `useWorkspaceController` | `RunVM`, `MutationViewModel`, related outbox ref | `onCancel(CancelRunRequest)`, `onRetry(RetryRunRequest)`, `onRecoverOutbox(RecoverOutboxRequest)` | run state + linked outbox reference | submitting/unknown/timeout/conflict | mutating `RunVM.status`, direct outbox API |
| `ConfirmationCard` | `useWorkspaceController` | `ConfirmationVM` | `onConfirm(ConfirmRunRequest)`, `onCancel(CancelRunRequest)` | confirmation query | pending/expired/conflict | policy recomputation, API client |
| `ConversationList` | `useMessagesController` | `ConversationVM[]`, selected id | `onSelectConversation(ConversationId)` | conversation list query | loading/empty/unread | message send/handoff API |
| `AccountsPage` | `useAccountsController` | account route context | `onSelectAccount(AccountId)`, `onOpenLoginSession(LoginSessionId)` | account list/detail/connection/QR queries | loading/empty/error/forbidden | direct credential value access, platform API |
| `MessagesPage` | `useMessagesController` | conversation route context | `onSelectConversation`, `onSend`, `onHandoff`, `onRelease` | conversation/message/WS queries | loading/empty/reconnect/forbidden | raw WebSocket client, policy mutation |
| `ProductsPage` | `useProductsController` | product route context | `onOpenProduct(ProductId)`, `onSave`, `onPublish` | product/assets queries | loading/empty/dirty/conflict | direct storage or platform API |
| `CouponsPage` | `useCouponsController` | coupon route context | `onOpenBatch(BatchId)`, `onSaveItems`, `onBind`, `onVoid` | batch/content/inventory queries | loading/empty/partial-success/conflict | direct inventory writes, buyer channel |
| `OrdersPage` | `useOrdersController` | order route context | `onOpenOrder(OrderNo)`, `onPreview`, `onDeliver`, `onCancel`, `onRetry` | order/detail/preview queries | loading/empty/unknown/conflict | direct external delivery adapter |
| `SettingsPage` | `useSettingsController` + `useAuthController` + `useCredentialController` + `useExecutionController` | section route context | `onChangeSection`, typed section commands | section/profile/session/credential/runtime/outbox queries | loading/dirty/saved/conflict/timeout | central save dispatcher, cross-section payload merging |
| `HandoffRiskPanel` | `useMessagesController` | `conversationId`, `handlingMode`, risk flags, `expectedVersion`, mutation | `onHandoff(HandoffConversationInput)`, `onRelease(ReleaseConversationInput)` | `ConversationVM` | submitting/conflict/unknown/reconnect | send message, raw buyer text, direct API |
| `MessageComposer` | `MessagesPage` | draft, upload state, capabilities | `onSend(SendMessageRequest)`, `onUpload(UploadImageRequest)` | local draft + upload VM | dirty/submitting/failed | changing conversation mode, policy decisions |
| `ProductDrawer` | `useProductsController` | `ProductVM`, active tab | `onSave(ProductPatchRequest)`, `onPublish(PublishProductRequest)` | product detail/assets query | dirty/validation/conflict | direct publish API, cross-domain coupon mutation |
| `CouponItemEditor` | `useCouponsController` | `CouponItemVM[]`, batch version | `onBulkSave(BulkSaveCouponItemsRequest)`, `onBulkDelete(BulkDeleteCouponItemsRequest)` | batch detail query | dirty/partial-success/conflict | inventory lock mutation outside controller |
| `ContentPreview` | `useCouponsController` | `CouponContentPreviewVM` | `onCopyContent(ContentRef)`, `onOpenDeliveryPreview(OrderRef)` | controlled content query | allowed/forbidden/error | redaction heuristics, order delivery mutation |
| `OrderStatusMatrix` | `OrdersPage` | `OrderVM` | `onOpenStatusHelp(StatusKey)` | `OrderVM` | four canonical status sets | deriving status from labels |
| `OrderActionBar` | `useOrdersController` | `OrderVM`, `DeliveryPreviewVM`, mutation | `onPreview(DeliveryPreviewRequest)`, `onDeliver(DeliverOrderInput)`, `onCancel(CancelOrderRequest)`, `onRetry(RetryOrderRequest)` | order/detail/preview query | submitting/unknown/timeout/conflict | direct external adapter, inventory writes |
| `SettingsTabs` | `SettingsPage` | section registry | `onChangeSection(SettingsSectionKey)` | typed route registry | active/disabled | saving settings, fetching section data |
| `SettingsSectionPanel` | `useSettingsController` | `SettingsSectionVM` | `onSave(SettingsPatchRequest)` | section query | dirty/validation/conflict/timeout | profile/session/credential commands |
| `AgentPanel` | `useSettingsController` | `SettingsSectionVM<'agent'>` | `onSave(AgentSettingsPatch)` | `['settings','global','agent']` | dirty/validation/conflict/timeout | profile/session/credential commands |
| `AutoReplyPolicyPanel` | `useSettingsController` | `SettingsSectionVM<'reply-policy'>` | `onSave(ReplyPolicyPatch)` | `['settings','global','reply-policy']` | dirty/validation/conflict/timeout | direct message mutation, account credential access |
| `DeliveryPolicyPanel` | `useSettingsController` | `SettingsSectionVM<'delivery-policy'>` | `onSave(DeliveryPolicyPatch)` | `['settings','global','delivery-policy']` | dirty/validation/conflict/timeout | direct order delivery API |
| `PolicyGatewayPanel` | `useSettingsController` | `SettingsSectionVM<'policy-gateway'>` | `onSave(PolicyGatewayPatch)` | `['settings','global','policy-gateway']` | dirty/validation/conflict/timeout | bypassing policy checks |
| `CredentialStorePanel` | `useCredentialController` | `CredentialRefVM[]` | `onCreate`, `onEdit`, `onRotate`, `onRevoke`, `onEnable`, `onDisable` | credential query | rotating/revoked/disabled/conflict | buyer-visible message/response paths |
| `ExternalServicesPanel` | `useSettingsController` | `SettingsSectionVM<'external-services'>` | `onSave(ExternalServicesPatch)` | `['settings','global','external-services']` | dirty/validation/conflict/timeout | direct provider SDK calls |
| `RuntimePanel` | `useSettingsController` | `SettingsSectionVM<'runtime'>` | `onSave(RuntimePatch)` | `['settings','global','runtime']` | dirty/validation/conflict/timeout | direct worker control, outbox mutations |
| `OutboxPanel` | `useExecutionController` | `OutboxFilters`, `OutboxResultVM[]` | `onRetryOutbox(RetryOutboxRequest)`, `onRecoverOutbox(RecoverOutboxRequest)` | `['execution','global','outbox',filters]` | loading/unknown/timeout/conflict | settings save, direct worker control, state bypass |
| `AccountPermissionPanel` | `useSettingsController` | `SettingsSectionVM<'account-scopes'>` | `onSave(AccountScopePatch)` | `['settings','global','account-scopes']` | dirty/validation/conflict/timeout | cross-account mutation without scope |
| `AdminProfilePanel` | `useAuthController` | `AdminProfileVM` | `onSave(ProfilePatchRequest)`, `onChangePassword(PasswordChangeRequest)` | auth profile query | dirty/validation/conflict | settings section mutation |
| `SessionManagementPanel` | `useAuthController` | `SessionVM[]` | `onRevoke(SessionId)`, `onRevokeAll(RevokeAllSessionsRequest)` | auth sessions query | loading/empty/revoked | credential or account scope mutation |
| `AuthGate` | `useAuthController` | session state, child route | `onAuthenticated`, `onExpired`, `onBootstrapRequired` | `['auth','global','session']` | checking/authenticated/expired/forbidden | page-specific API, password persistence |
| `LoginPage` | `useAuthController` | login form state | `onLogin(LoginRequest)`, `onPasswordLogin(PasswordLoginRequest)` | auth session query | idle/submitting/validation/error | business domain queries |
| `FirstRunPage` | `useAuthController` | `bootstrapRequired`, bootstrap form state | `onBootstrap(BootstrapAdminInput)` | auth session query | checking/submitting/conflict/success | direct admin table access, password persistence |
| `SessionExpiredPage` | `useAuthController` | expiry reason, return route | `onReauthenticate()` | auth session query | expired/submitting/error | clearing unrelated domain data |

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
| dashboard | `DashboardPage` | `MobileDashboardPage` | `useDashboardController` / `DashboardSnapshotVM + DashboardTrendVM + RiskTodoVM` | 设计已定义，实施后置 |
| workspace | `WorkspacePage` | `MobileWorkspacePage` | `useWorkspaceController` / `WorkspaceSessionVM + RunVM + StepVM + ConfirmationVM + OutboxResultVM` | 设计已定义，实施后置 |
| accounts | `AccountsPage` | `MobileAccountsPage` | `useAccountsController` / `AccountVM + AccountConnectionVM + LoginSessionVM + QrLoginSessionVM + AccountScopeVM` | 设计已定义，实施后置 |
| messages | `MessagesPage` | `MobileMessagesPage` | `useMessagesController` / `ConversationVM + MessageVM + BuyerContextVM + RealtimeVM` | 设计已定义，实施后置 |
| products | `ProductsPage` | `MobileProductsPage` | `useProductsController` / `ProductVM + ProductAssetVM + SkuVM + PublishResultVM` | 设计已定义，实施后置 |
| coupons | `CouponsPage` | `MobileCouponsPage` | `useCouponsController` / `CouponBatchVM + CouponItemVM + CouponContentPreviewVM + InventoryLockVM` | 设计已定义，实施后置 |
| orders | `OrdersPage` | `MobileOrdersPage` | `useOrdersController` / `OrderVM + DeliveryPreviewVM + DeliveryRecordVM + AfterSalesVM` | 设计已定义，实施后置 |
| settings | `SettingsPage` | `MobileSettingsPage` | `useSettingsController` + `useAuthController` + `useCredentialController` + `useExecutionController` / `SettingsSectionVM + CredentialRefVM + RuntimeHealthVM + AdminProfileVM + SessionVM` | 设计已定义，实施后置；各 controller 仅拥有对应 panel，不得合并为单一保存入口 |

不得把未实现页面回退到 `MobileDashboardView`，也不得复制一套不同的 API 与状态解释。

## 9. 阶段 3 设计门禁 DoD

阶段 3 在以下条件全部满足前保持未通过：

1. 每个正式页面都有 Container、Controller、ViewModel、View 和 StateBoundary 清单。
2. 所有阶段 2 P0 API 都有 route/command/query 映射；缺失接口必须显式登记，不得用静态数组掩盖。
3. 每个组件都有唯一 owner、props 输入、typed events、数据来源、状态消费和禁止依赖。
4. `Settings`、`Workspace`、`Auth`、`ProductEditor` 等设计节点已拆成独立职责，不把多个 bounded context 合并为一个组件。
5. canonical ViewModel inventory、ControllerResult、canonical error mapping 和 route/API catalog 在文档中一致。
6. Desktop/Mobile 8×2 页面矩阵完整，且每个移动页面复用同一 domain VM 与命令契约。
7. 至少完成一条纵向设计走查：订单交付预览 → Confirmation → Outbox 结果，逐节点指出数据来源、状态持有者、失效范围和错误处理。
8. 独立评审确认设计层面“无超级组件、无隐式文案分派、无页面直连原始字段”；源码实现检查留到后续实现阶段。

上述 DoD 已完成并通过独立设计复审，阶段 3 状态为 `PASS`；本阶段不得进行具体编码，阶段 4 可在设计门禁关闭后启动。

## 10. 设计级反超级组件审计证据

阶段 3 设计复审必须提供以下文档级证据；不得要求源码扫描或高保真截图作为本阶段前置：

1. 组件职责矩阵中每个节点只有一个 owner；Settings 各 section、Workspace 子块、Orders 四态动作分别有独立 feature owner。
2. 每个页面契约都列出 Container、Controller、ViewModel、View、StateBoundary 和 typed commands。
3. 每个写动作都列出 method、canonical path、payload、response、Idempotency-Key、权限/账号 scope、成功/失败/unknown/timeout/retry 处理。
4. Desktop/Mobile 页面覆盖矩阵为 8×2；Products/Coupons/Orders 不得回退 Dashboard。
5. `docs/03-frontend-design.md`、本文件和 `docs/02-data-api.md` 的 canonical status、error code、敏感字段裁剪规则一致。
6. 原型截图只用于视觉参考；源码目录、源码行数、现有组件数量不参与本阶段评分。

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

## 11. 阶段 5 未完成切片的 owner 与禁止依赖

阶段 5 实现按以下纵向切片落地。每片只能由自己的 controller 发出命令，页面组件不得跨片直接写入别的领域。

| 切片 | 页面 / owner | 允许承担 | 明确禁止 |
| --- | --- | --- | --- |
| `S4-VS2A` | `ProductDrawer` / `useProductsController` | 草稿基础信息、版本校验、字段错误、保存后刷新 | 直接发布、直接上传对象存储、修改 SKU 或卡券库存 |
| `S4-VS2B` | `SkuVariantEditor` / `useProductsController` | SKU 变体编辑、价格/库存校验、逐项结果 | 在列表组件中拼装 SKU 状态；绕过商品版本或库存约束 |
| `S4-VS2C` | `AssetPanel` / `useProductsController` | AssetRef 上传/替换/删除、上传状态和单项重试 | 直接调用 MinIO SDK；把临时 URL 写入 ProductVM 作为永久事实 |
| `S4-VS2D` | `PublishConfirmation` / `useProductsController` | Policy 预检、Confirmation、发布结果和恢复入口 | 页面直接调用外部闲鱼发布 adapter；unknown 自动重放 |
| `S4-VS2E` | `SyncPullToolbar` / `useProductsController` | 账号选择、分页同步、结果摘要、外部错误展示 | 用 fixture 数量冒充真实账号结果；改写本地草稿或静默切换账号 |
| `S4-VS3A` | `CouponItemEditor`、`AssetPanel` / `useCouponsController` | CouponItem bulk-save/delete、素材状态、批量部分成功 | 直接扣减库存；在列表返回正文或敏感链接 |
| `S4-VS3B` | `InventoryLockBanner` / `useCouponsController` + execution adapter | 仅展示锁定/消耗/释放结果和恢复状态 | CouponsPage 直接执行订单交付或买家可见发送 |
| `S4-VS4A` | `OrdersPage` / `useOrdersController` | 订单只读、筛选、四套状态、详情关联 | 读取卡券正文；从列表按钮直接发货 |
| `S4-VS4B` | `DeliveryPreview` / `useOrdersController` | 预览校验、策略结果、库存预锁提示 | 预览阶段创建 DeliveryRecord 或提交外部动作 |
| `S4-VS4C` | `OrderActionBar` / `useOrdersController` | Confirmation、deliver/cancel/retry、unknown 人工恢复入口 | 直接调用外部 adapter；跳过 Outbox、审计或幂等 |

### 11.1 跨切片状态边界

- `ProductDrawer`、`BatchDrawer` 和 `OrderDetailDrawer` 只组合子组件，不拥有跨领域保存入口。
- `CouponContentPreview` 只能消费受控内容 ViewModel；`OrderActionBar` 只能消费 `DeliveryPreviewVM` 和 typed delivery command，不能读取正文。
- 商品、卡券、订单共用 `MutationViewModel` 形状，但各自拥有 mutation key、缓存失效和审计引用；不得把一个领域的 `version` 当成另一个领域的版本。
- Desktop/Mobile 共用 controller、ViewModel、command 和错误映射，仅替换布局组合；每片都要对 `1440×900` 与 `390×844` 的适用状态分别留证。
- 横向门禁（迁移恢复、真实外部账号、Pi Runtime）不属于任何页面 owner；只能由对应 execution/ops 模块提供状态，不得把门禁逻辑塞进页面组件。
