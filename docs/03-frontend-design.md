# XianyuSellerAgent 阶段 3 前端信息架构与设计契约

- 文档版本：v0.1
- 更新日期：2026-09-19
- 状态：PASS（阶段 3 只审前端组件设计；源码与高保真原型不作为本阶段验收依据）
- 前置门禁：阶段 2 PASS（`docs/02-data-api.md`、`docs/02-database-schema.md`）
- 适用范围：前端信息架构、响应式布局、组件边界、状态归属、API 映射和可访问性
- 非范围：真实后端、数据库、WebSocket 服务、Pi Runtime、闲鱼适配器和前后端联调实现
- 设计边界：SellerAgent 源码和高保真原型只作为参考；正式实现目录为 `apps/web/`，不以原型源码证明组件已实现或反推组件职责。

## 1. 阶段目标与已确认决策

本阶段把正式页面、路由、组件、状态和接口边界冻结为可执行的前端设计契约；SellerAgent 原型只提供视觉、文案和交互参考，不决定组件拆分。

已确认决策：

1. 正式一级页面仅保留 8 个：Dashboard、Workspace、Accounts、Messages、Products、Coupons、Orders、Settings。
2. `knowledge`、`review` 不提供一级路由、侧边栏入口、移动端 Tab、隐藏入口或内部入口。知识与复盘仍可作为产品、策略和插件能力的业务名词，但不形成独立页面。
3. SellerAgent 原型与 `xianyu-admin-design-style/assets/design-tokens.json` 作为当前视觉基线；没有正式 Figma 时，不宣称已完成 Figma 高保真验收。
4. 桌面目标 viewport 固定为 **1440 × 900**；移动目标 viewport 固定为 **390 × 844**。
5. 前端只调用领域 API 契约，不直接调用 Pi Runtime、闲鱼原始 MTOP/WebSocket、旧项目 API wrapper 或数据库。
6. 系统凭证只显示受控引用和元数据；卡券正文、夸克链接和提取码只有在阶段 2 定义的 `buyer_deliverable` 交付条件满足后，才允许进入买家交付预览或发送链路。

## 2. 视觉与布局基线

### 2.1 设计输入

| 输入 | 位置 | 阶段 3 约束 |
| --- | --- | --- |
| 高保真原型参考 | SellerAgent 原型页面 | 仅作为页面结构、文案和交互状态参考，不作为组件拆分或 API 设计依据 |
| 路由设计契约 | 本文 §3、`docs/03-component-contract.md` §5 | 8 个 `PageKey` 和 canonical path 以设计契约为准 |
| Design token | `xianyu-admin-design-style/assets/design-tokens.json` | 颜色、字体、间距、圆角、阴影和 viewport 的单一来源 |
| 组件参考 | `xianyu-admin-design-style/references/design-system.md`、`component-recipes.md` | 复用卡片、状态标签、表格、确认卡和移动端底部 Tab 规则 |

### 2.2 固定布局

| 平台 | 目标 viewport | 外壳 | 关键尺寸 |
| --- | --- | --- | --- |
| Desktop | 1440 × 900 | `DesktopShell` | 侧栏 224px、顶部栏 56px、主区内边距 22px 28px、网格间距 14px |
| Mobile | 390 × 844 | `MobileFrame` | 状态栏 44px、内容内边距 14px 16px、底部 Tab 预留 80px |

### 2.3 语义 token

- 页面背景 `#F6F7F9`，卡片 `#FFFFFF`，侧栏 `#1D2638`，品牌深蓝 `#1F3A5F`，主操作蓝 `#245A8D`。
- 正常 `#2E7D5B`，警告 `#B7791F`，危险 `#B42318`，信息 `#2F6F8F`。
- 字体顺序：Inter、Noto Sans SC、PingFang SC、Microsoft YaHei、sans-serif。
- 卡片默认 10px 圆角、1px 边框、轻阴影；状态标签采用低饱和 tinted pill，不使用大面积高亮色块。
- 主要图标使用 inline SVG + `currentColor`，描边 1.3–1.5px，不使用 emoji 作为核心导航图标。

## 3. 路由与导航契约

原型当前通过 `page: PageKey` 在单页内切换。阶段 3 冻结以下生产级 canonical path；阶段 4/5 再将其接入真实路由和服务端 Session。

| Canonical path | `PageKey` | 页面 | 进入条件 | 主要离开路径 |
| --- | --- | --- | --- | --- |
| `/dashboard` | `dashboard` | 仪表盘 | 已登录管理员 | 8 个主导航、风险待办深链 |
| `/workspace` | `workspace` | Workspace | 已登录管理员 + 至少一个可用账号范围 | 账号、商品、订单、设置详情 |
| `/accounts` | `accounts` | 账号管理 | 已登录管理员 | 登录会话详情、账号切换、凭证设置 |
| `/messages` | `messages` | 在线聊天 | 已登录管理员 + 当前账号范围 | 订单详情、Workspace、风险确认 |
| `/products` | `products` | 商品管理 | 已登录管理员 + 当前账号范围 | 商品编辑、素材、发布确认 |
| `/coupons` | `coupons` | 卡券管理 | 已登录管理员 + 当前账号范围 | 批次详情、正文受控预览、商品绑定 |
| `/orders` | `orders` | 订单管理 | 已登录管理员 + 当前账号范围 | 订单详情、交付预览、重试确认 |
| `/settings` | `settings` | 设置 | 已登录管理员 | 设置分区、账号范围、Runtime/Outbox |
| `/login` | `auth` | 登录 | 未登录或 Session 失效 | 成功后 `/dashboard` |
| `/first-run` | `auth` | 首次管理员初始化 | 系统不存在管理员 | 创建成功后 `/login` |

禁止项：不存在 `/knowledge`、`/review`，不存在侧栏隐藏项、移动端隐藏 Tab 或通过 query 参数恢复的内部页面。

## 4. 页面外壳与组件树

```text
App
├─ AuthGate
│  ├─ LoginPage (/login)
│  ├─ FirstRunPage (/first-run)
│  └─ SessionExpiredState
└─ ResponsiveShell
   ├─ DesktopShell (1440x900)
   │  ├─ Sidebar
   │  │  ├─ Logo
   │  │  ├─ PrimaryNav[8]
   │  │  ├─ AgentHealthCard
   │  │  └─ Notification / AdminIdentity
   │  ├─ TopBar
   │  └─ MainPage
   └─ MobileFrame (390x844)
      ├─ MobileStatusBar
      ├─ MobileHeader
      ├─ MobilePageContent
      └─ MobileBottomTabs[8]
```

共享组件边界：

- `Icon`、`Logo`：只负责图形，不包含业务状态。
- `Badge`、`StatusPill`、`RiskTag`：只接收语义状态，不在组件内推断业务状态。
- `KpiCard`、`Timeline`、`DataTable`、`CatalogToolbar`：只负责展示和事件回调。
- `ConfirmationCard`、`BeforeAfterRows`、`AuditStrip`：用于高风险外部写动作，必须显示风险、差异、幂等键摘要和审计引用。
- `LoadingState`、`EmptyState`、`ErrorState`、`ForbiddenState`、`DisabledState`：统一页面状态，不允许各页自行创造互相冲突的文案和颜色。
- `ModalHost`、`ToastHost`：只管理交互反馈，不直接执行 API；API 调用由页面 controller 发起。
- `SelectField`：所有业务域原生下拉统一通过共享组件渲染，组件负责统一 chevron、字号、边框、圆角、焦点和 disabled option；页面只传入 `options` 与受控事件。高保真按钮式下拉（例如 Agent 动态筛选）属于明确的视觉特例，不回退为原生 `<select>`。

页面组件只拥有页面布局和 controller，不拥有数据库字段映射、平台原始字段或凭证明文。

## 5. 状态归属与数据流

### 5.1 状态分层

| 层级 | 归属 | 示例 | 生命周期 |
| --- | --- | --- | --- |
| Session | `AuthGate` / app store | `authenticated`、`expired`、`forbidden` | 登录、刷新、注销、密码变更时轮换 |
| Account context | `ResponsiveShell` | `currentAccountId`、账号范围、连接状态 | 切换账号后使相关 server state 失效 |
| Server state | 各页面 controller / query cache | dashboard snapshot、商品列表、订单列表、会话消息 | 按 `accountId + route + query` 缓存，成功/失败/过期可重取 |
| Page state | 页面组件 | 当前筛选、分页、选中行、活动 Tab、展开项 | 路由卸载时清理，URL 可表达的筛选需同步 query |
| Form state | 表单/Modal | 草稿值、校验错误、dirty、提交中 | 提交成功后清空或刷新；取消不写服务端 |
| Mutation state | controller | `idle`、`submitting`、`succeeded`、`failed`、`unknown`、`conflict`、`timeout` | 通过 Idempotency-Key 与 Outbox 关联；冲突、超时和未知结果必须提供刷新/查询/恢复入口 |
| Realtime state | Messages / Workspace | WebSocket 连接、重连、事件游标 | Origin、Session、账号范围校验失败时转错误态 |
| Feedback | app-level `ToastHost` / `ModalHost` | toast、确认卡、错误抽屉 | 可关闭；不得把敏感正文写入 toast、Trace 或 Replay |

### 5.2 请求生命周期

```text
用户动作
  → controller 校验本地输入与权限前置条件
  → 生成 requestId / Idempotency-Key（写动作）
  → 进入 loading 或 submitting
  → 调用 /api/v1 领域 API
  → 解析统一 response envelope
  → 成功：更新 cache + 页面状态 + 审计引用
  → 失败：按错误码映射可重试 / 需确认 / 无权限 / 过期
  → unknown/timeout：禁止盲目重试，先查询外部状态或打开恢复入口
```

缓存失效规则：切换账号、账号连接状态变化、批次作废、订单交付、商品发布和设置保存后，只失效受影响账号与资源的 query，不清空全局缓存。

### 5.3 权限一致性

- 页面可见性由管理员 Session + `account_scopes` 决定；页面可见不代表写权限可用。
- 高风险动作必须同时满足 capability、account scope、permission、policy gateway 和 confirmation（如适用）。
- 前端收到 `401` 时进入登录/SessionExpired；`403` 保留当前页面并显示权限说明，不自动重试。
- `system_only` 凭证永远不进入买家预览、消息编辑器、订单交付内容、日志、Trace 或 Replay。

## 6. 通用状态契约

所有正式页面和抽屉至少实现以下状态；页面特有状态在第 7 节补充。

| 状态 | 视觉表现 | 交互规则 |
| --- | --- | --- |
| 首次加载 | skeleton 或 compact spinner，保留页面骨架 | 禁止显示上一账号数据；可取消长查询 |
| 刷新中 | 顶部细进度条或按钮 loading | 只禁用当前刷新控件，避免整页不可操作 |
| 成功 | 正常数据、状态标签、更新时间 | 保留筛选、分页和当前账号上下文 |
| 空数据 | 空状态卡、原因、下一步 CTA | 不显示“成功”假数据；CTA 必须映射真实 API |
| 失败 | 错误卡、错误码可读摘要、重试 | 可恢复错误显示重试；权限/参数错误不盲重试 |
| 未登录 | SessionExpired / LoginPage | 清理本地业务缓存，不展示敏感数据 |
| 无权限 | 403 状态卡 | 保留路径与上下文，提供返回或联系管理员 |
| 禁用 | 控件置灰并说明原因 | 由状态/权限决定，不通过 CSS 视觉隐藏代替逻辑禁用 |
| 提交中 | 按钮 loading、表单锁定、幂等键摘要 | 防止重复点击；允许明确取消的操作取消 |
| 超时 / 结果未知 | amber warning + 查询状态 / 恢复入口 | 不直接再次调用外部写动作 |
| 冲突 / 重复提交 | `IDEMPOTENCY_CONFLICT` 或版本冲突提示 | 引导刷新、比较差异或使用原请求结果 |
| 断网 / 重连 | 顶部连接提示、消息/Workspace 显示重连状态 | 恢复后按游标补事件，不重复渲染消息 |

## 7. 八个正式页面契约

### 7.1 Dashboard `/dashboard`

- 目标：查看订单金额、自动处理率、待人工数量、可售卡券和风险待办；不直接拥有业务事实。
- 组件树：`PageHeader → KpiGrid → TrendCard + HealthCard → ProductRankCard + RecentActivityTimeline → RiskTodoDrawer`。
- 读取 API：`GET /api/v1/dashboard/snapshot`、`GET /api/v1/dashboard/order-trend`。
- 写 API：无业务写动作；“打开插件配置”仅跳转 `/settings` 或 Workspace，不直接修改配置。
- 状态：首次加载显示 4 个 KPI skeleton；成功显示趋势和风险待办；空数据显示“暂无今日数据”；失败提供局部重试；403 显示账号范围说明；刷新中只锁定刷新动作；API 超时显示“指标可能滞后”而不是清零。
- 数据边界：聚合值按当前账号范围计算；风险待办深链保留 `accountId`、资源类型和审计引用。

### 7.2 Workspace `/workspace`

- 目标：通过 AgentSession 发起查询或受控写动作，展示 Run/Step/Confirmation/Outbox 结果。
- 组件树：`SessionToolbar + SessionList + SessionControls + ContextPanel + RunChat (ToolCallSummary + StepTimeline + RunResult + BusinessLink) + ConfirmationCard + OutboxResult + RunActionBar + RealtimeBanner + WorkspaceComposer`。
- 读取 API：`GET/POST /api/v1/workspace/agent-sessions`、`GET /api/v1/workspace/agent-sessions/search`、`GET /api/v1/workspace/runs/{id}`、`GET /api/v1/workspace/runs/{id}/confirmation`、`WS /api/v1/workspace/runs/{id}/events`。
- 写 API：`POST /api/v1/workspace/runs`、`POST /api/v1/workspace/runs/{id}/confirm`、`POST /api/v1/workspace/runs/{id}/cancel`、`POST /api/v1/workspace/runs/{id}/retry`、会话切换/归档接口。
- 状态：输入框 idle、校验失败、提交中；Run queued/running/waiting_confirmation/executing/retrying/cancelling/succeeded/partially_succeeded/failed/cancelled/expired；Confirmation active/confirmed/rejected/cancelled/expired；WebSocket connecting/connected/reconnecting/closed；无会话显示创建 CTA；无账号范围显示先连接账号；403 禁用写入但允许查看历史。
- 安全：确认卡必须显示 before/after、风险、policyRef、idempotencyKey 摘要和 auditRef；确认后前端只显示服务端结果，不自行把状态改成 succeeded。

### 7.3 Accounts `/accounts`

- 目标：查看账号连接状态、切换当前账号、发起二维码登录/刷新授权、管理账号范围。
- 组件树：`AccountToolbar + AccountKpiGrid + AccountTable + AccountStatusActions + AddAccountDialog (LoginMethodPicker) + LoginSessionDrawer + ScopeEditor + AccountPolicyEditor + CredentialLink`。
- 读取 API：`GET /api/v1/accounts`、`GET /api/v1/accounts/{id}`、`GET /api/v1/accounts/{id}/connection`、`GET /api/v1/accounts/{id}/login-sessions/{sid}`、`GET /api/v1/accounts/{id}/scopes`、`GET /api/v1/auth/qr-sessions/{id}`。
- 写 API：`POST /api/v1/accounts`、`PATCH /api/v1/accounts/{id}`、`POST /api/v1/accounts/{id}/refresh`、`POST /api/v1/auth/qr-sessions`、`POST /api/v1/accounts/{id}/login-sessions`、`POST /api/v1/accounts/{id}/login-sessions/{sid}/cancel`、`POST /api/v1/accounts/{id}/login-sessions/{sid}/renew`、`POST /api/v1/accounts/{id}/login-sessions/{sid}/reauthorize`、`POST /api/v1/accounts/{id}/login-sessions/{sid}/cleanup`、账号切换和 scope 修改接口。
- 状态：账号列表 loading/success/empty/error/403；登录会话 created/waiting/scanned/succeeded/expired/failed/cancelled；切换账号 submitting/succeeded/conflict；账号 disabled 时保留历史但禁用业务写动作；刷新授权超时提供继续轮询/取消。
- 安全：账号切换后清理不属于新账号的页面缓存；二维码 token 只显示短期引用，不进入 URL、日志或截图。

### 7.4 Messages `/messages`

- 目标：按账号查看会话、接收实时消息、人工发送文本/图片、撤回自己发送的消息。
- 组件树：`ConversationList + ConversationHeader + BuyerContextPanel + MessageTimeline + AiSuggestionPanel + HandoffRiskPanel + AttachmentUpload + MessageComposer + MessageActionMenu + ConnectionBanner`；账号范围由全局 `AccountContext` 提供，消息页只读当前账号，不提供账号切换控件。
- 读取 API：`GET /api/v1/conversations`、`GET /api/v1/conversations/{id}/messages`、`WS /api/v1/conversations/{id}/events`。
- 写 API：`POST /api/v1/conversations/{id}/messages`、`POST /api/v1/conversations/{id}/images`、`POST /api/v1/conversations/{id}/messages/{messageId}/recall`、`POST /api/v1/conversations/{id}/handoff`、`POST /api/v1/conversations/{id}/release`。
- 状态：会话列表 loading/empty/error；消息首次加载/分页补历史；WebSocket connecting/connected/reconnecting/forbidden；发送 idle/submitting/sent/failed/unknown；撤回 pending/succeeded/failed；图片 uploading/processed/failed；人工接管 handoff submitting/succeeded/conflict/failed；恢复 AI release submitting/succeeded/conflict/failed；买家发起 Prompt Injection 或索取 system_only 凭证时显示拦截提示，不把内容复制到配置或知识能力。
- 可访问性：消息流使用 `aria-live="polite"`，但不朗读敏感正文；发送按钮在空文本、上传中或无权限时禁用；键盘支持 Enter 发送、Shift+Enter 换行。

### 7.5 Products `/products`

- 目标：按账号查看/编辑商品、管理素材、同步商品、生成发布确认并执行批量发布。
- 组件树：`ProductToolbar + SyncPullToolbar + ProductTable + BulkActionBar + ProductDrawer (ProductBasicForm + PricingInventoryForm + SkuVariantEditor + ReplyPromptEditor + AssetPanel + PublishPreview) + PublishConfirmation`。
- 读取 API：`GET /api/v1/products`、`GET /api/v1/products/{id}`、`GET /api/v1/products/{id}/assets`。
- 写 API：`POST /api/v1/products`、`PATCH /api/v1/products/{id}`、`POST /api/v1/products/sync`、`POST /api/v1/products/pull`、`POST /api/v1/products/{id}/assets`、`PATCH /api/v1/products/{id}/assets/{assetId}`、`DELETE /api/v1/products/{id}/assets/{assetId}`、`POST /api/v1/products/{id}/publish`、`POST /api/v1/products/bulk-publish`。
- 状态：列表 loading/success/empty/error/403；编辑 dirty/validation-error/submitting/saved/conflict；素材 upload/progress/failed/removed；发布 preview/confirmation/submitting/succeeded/failed/unknown；批量发布逐项显示 succeeded/failed/skipped/unknown，不将整体标记为全成功。
- 安全：发布动作必须进入 Policy → Confirmation → Idempotency → Outbox；前端不能直接把商品 status 从 draft 改为 published。

### 7.6 Coupons `/coupons`

- 目标：创建批次、导入/保存/删除卡券项、上传素材、绑定商品、作废批次和进行受控正文预览。
- 组件树：`BatchToolbar + CouponBatchTable + BatchDrawer (BatchMetadataForm + CouponItemEditor + AssetPanel + BindingPanel + ContentPreview) + DeliveryActionBar + InventoryLockBanner`。
- 读取 API：`GET /api/v1/coupons/batches`、`GET /api/v1/coupons/batches/{id}`、`GET /api/v1/coupons/{id}/content`（显式用途与审计前置）。
- 写 API：`POST /api/v1/coupons/batches`、`PATCH /api/v1/coupons/batches/{id}`、`DELETE /api/v1/coupons/batches/{id}`、`POST /api/v1/coupons/batches/{id}/bind`、`POST /api/v1/coupons/batches/{id}/unbind`、`POST /api/v1/coupons/batches/{id}/items/import`、`POST /api/v1/coupons/batches/{id}/void`；`items/bulk-save`、`items/bulk-delete`、`assets` 为后续切片契约，当前页面使用批次级批量删除和 metadata.imageUrls 原图预览。
- 状态：批次 loading/empty/error；批次库存生命周期使用 `inventoryStatus`（available/reserved/delivered/void/exhausted），批次列表另使用由 `availableCount` 与阈值派生的 `stockAlert`（normal/low_stock/exhausted）；批量保存/删除显示逐项结果；绑定账号不匹配时阻断；管理员正文预览/编辑直接由受控领域接口提供，买家可见交付在不满足 `buyer_deliverable`、订单已支付、商品与账号匹配、策略通过和审计完成时显示 forbidden；作废提交中禁用重复操作。
- 安全：系统凭证与买家可交付卡券分离；管理员查看正文、夸克链接、提取码时保留 purpose、账号范围和 auditRef；买家交付仍必须满足全部策略条件。

### 7.7 Orders `/orders`

- 目标：查询订单、查看支付/交付/售后状态、生成交付预览、执行人工发货或失败重试。
- 组件树：`OrderSyncToolbar + OrderFilters + OrderTable + OrderDetailDrawer (OrderStatusMatrix + DeliveryModeSelector + DeliveryPreview + OrderActionBar + ConversationLink) + RetryConfirmation + AuditTimeline`。
- 读取 API：`GET /api/v1/orders`、`GET /api/v1/orders/{orderNo}`、`POST /api/v1/orders/refresh`。
- 写 API：`POST /api/v1/orders/{orderNo}/delivery-preview`、`POST /api/v1/orders/{orderNo}/deliver`、`POST /api/v1/orders/{orderNo}/cancel`、`POST /api/v1/orders/{orderNo}/retry`。
- 状态：列表 loading/success/empty/error/403；`paymentStatus` unpaid/paid/closed/unknown；`orderStatus` open/cancelling/cancelled/completed/closed/failed；`deliveryStatus` pending/reserving/delivered/partially_delivered/failed/cancelled；`afterSalesStatus` none/requested/refunding/refunded/rejected/closed；预览 ready/blocked；发货/重试 submitting/succeeded/failed/unknown；结果未知时只能查询外部状态或恢复 Outbox，不直接再次发货。
- 安全：只有订单已支付、商品和账号匹配、deliveryScope 允许、库存成功锁定、Policy 通过且 Audit 完成时，才显示买家交付内容和可执行 CTA。

### 7.8 Settings `/settings`

- 目标：管理 Agent、回复策略、交付策略、Policy Gateway、外部服务、Runtime、Outbox 和账号范围；管理员资料、密码和会话仍由 auth feature controller 持有。
- 组件树：`SettingsTabs + AgentPanel + AutoReplyPolicyPanel + DeliveryPolicyPanel + PolicyGatewayPanel + CredentialStorePanel + ExternalServicesPanel + RuntimePanel + OutboxPanel + AccountPermissionPanel + AdminProfilePanel + SessionManagementPanel + DirtyFormGuard`；`RuntimePanel` 与 `OutboxPanel` 分属不同 controller 和状态机，不合并为超级组件。
- 读取 API：`GET/PATCH /api/v1/settings/agent`、`/reply-policy`、`/delivery-policy`、`/policy-gateway`、`/external-services`、`/runtime`、`/outbox`、`/account-scopes`；CredentialStore 使用 `/api/v1/credentials...` 管理接口；`AdminProfileController` 单独读取 `/api/v1/auth/profile` 与 `/api/v1/auth/sessions`。
- 写 API：同上各设置 PATCH；凭证 `POST /api/v1/credentials/{id}/rotate`、`/revoke`、`/enable`、`/disable`；设置保存必须带 config version 和 Idempotency-Key；`AdminProfileController` 负责 profile/password，`SessionManagementController` 负责 session revoke。
- 状态：tab loading/success/error/403；表单 clean/dirty/validation-error/submitting/saved/conflict；凭证 masked/reference-only/rotating/revoked/disabled；危险配置变更显示 before/after 与确认；保存超时进入 unknown + 查询状态，不重复写入。
- 安全：管理员拥有绝对管理权限，但任何凭证值只在管理员受控界面显示；前端不得将明文放入 React error、toast、URL、localStorage、Trace 或 Replay。

## 8. 响应式与可访问性契约

### 8.1 Desktop

- 侧栏固定 224px；主区支持纵向滚动，表格在卡片内部横向滚动。
- Dashboard 使用 4 列 KPI；图表与健康度采用 `1fr + 296px`。
- Products、Coupons、Orders 使用密集表格；高风险确认使用右侧或居中 Modal，但保留页面上下文。
- 所有按钮至少 36px 高；高风险主按钮使用 danger/warn 语义并显示提交中状态。

### 8.2 Mobile

- 移动端是独立组合，不是桌面布局缩放；底部 Tab 保留 8 个正式页面入口。
- Dashboard、Workspace、Messages、Accounts 使用卡片化任务流；Products、Coupons、Orders 使用分组卡片和抽屉详情替代表格横向堆叠。
- 390px 宽度下所有主操作可触达；表单控件与底部 Tab 目标尺寸不低于 36px。
- 断网/重连、Session 失效、权限不足在顶部 Banner 或整卡状态中表达，不通过颜色单独表达。

### 8.3 可访问性

- 页面必须有唯一 `h1`；导航使用 `nav` + 当前项语义；Modal 使用 `role="dialog"`、焦点移入并支持 Escape 关闭。
- 状态标签同时提供文本，不依赖颜色；错误、成功、提交中消息通过 `aria-live` 告知。
- 图表提供文本摘要和 `aria-label`；表格表头、行操作和 checkbox 都有可读名称。
- 键盘焦点必须可见；禁用控件需提供可理解原因；移动端不使用 hover 承载关键信息。

## 9. API 映射与错误处理

统一采用阶段 2 的 `/api/v1` envelope。页面 controller 不读取旧字段名、不拼接平台原始请求、不将 HTTP 200 视为业务成功。

| 错误类别 | 前端行为 | 是否允许自动重试 |
| --- | --- | --- |
| `UNAUTHENTICATED` | 交给 `AuthGate`，清理敏感 query 并进入登录 / SessionExpired | 否 |
| `FORBIDDEN` | 显示 403 状态，保留路径和上下文；账号范围拒绝写入 `details.reason` | 否 |
| `NOT_FOUND` | 显示资源不存在或已失效，保留返回列表入口 | 否 |
| `VALIDATION_FAILED` | 定位字段错误，保留用户输入 | 否 |
| `VERSION_CONFLICT` | 刷新资源并展示服务端版本差异，不自动覆盖 | 否 |
| `CONFLICT` | 显示业务冲突、受影响资源和替代动作 | 否 |
| `IDEMPOTENCY_CONFLICT` | 展示原请求结果或刷新状态 | 否 |
| `IDEMPOTENCY_IN_PROGRESS` | 显示处理中并轮询原请求状态 | 仅轮询 |
| `EXTERNAL_TIMEOUT` / `EXTERNAL_UNKNOWN` | 显示查询外部状态 / 恢复 Outbox | 否，除非服务端明确安全 |
| `CSRF_INVALID` | 由 `AuthGate` 刷新 CSRF 并重建会话上下文 | 否 |
| `RATE_LIMITED` | 显示退避时间 | 仅按服务端 retry-after |
| `SERVICE_UNAVAILABLE` | 顶部服务不可用提示，提供手动重试 | 读请求可限次重试，写请求不可盲重试 |

## 10. 高保真页面映射与验证证据

| 设计页面/状态 | 视觉参考位置 | 目标实现边界 | 设计/后续验证证据 |
| --- | --- | --- | --- |
| Desktop shell / nav | SellerAgent 桌面原型 | `/dashboard` 等 8 路由共享外壳 | 设计契约；阶段 5/6 1440×900 回归 |
| Mobile shell / tabs | SellerAgent 移动原型 | 390×844 独立移动组合 | 设计契约；阶段 5/6 390×844 回归 |
| Workspace confirmation | SellerAgent Workspace 视觉参考 | Confirmation + Outbox 结果只由 API 驱动 | 设计走查；后续 Run/Confirmation E2E |
| Message stream | SellerAgent 消息视觉参考 | WebSocket 事件、重连、发送失败 | 设计走查；后续 WebSocket 集成/E2E |
| Credential boundary | SellerAgent 设置视觉参考 | 只显示引用/元数据，明文不进入买家链路 | 设计契约；后续安全测试与审计检查 |
| Order delivery | SellerAgent 订单/消息视觉参考 | delivery preview → policy → outbox | 设计走查；后续订单交付 E2E |

阶段 3 只冻结映射，不宣称上述真实 API、WebSocket 或截图回归已经完成。真实高保真截图、浏览器交互、端到端数据和视觉偏差记录属于阶段 5/6 验证证据。

## 13. 商品自动化页面映射（2026-09-22）

| 设计状态 | 实现组件 | 交互边界 | 验收证据 |
| --- | --- | --- | --- |
| 商品列表 / 批量入口 | `ProductsPage`、`BatchAutomationDialog` | 勾选商品后批量配置；未配置商品不展示自动化明细 | `01-products-list-*.png`、Chrome/CDP E2E |
| 付款后自动发货 | `AutomationDrawer` | 只提供发货卡券选择入口；卡券规则与库存细节在卡券管理维护 | `02-payment-after-delivery-*.png` |
| 拍下未付款自动改价 | `AutomationDrawer` | 配置目标价格与改价后文本；保存时带版本校验 | `03-unpaid-reprice-*.png` |
| 评价后发送赠品 | `AutomationDrawer` | 只提供赠品卡券选择入口；评价事实与赠品库存由后端执行链维护 | `04-review-gift-*.png` |
| 超时未评价求评价 | `AutomationDrawer` | 配置首次等待、重复间隔、最大次数和文案 | `05-overdue-review-*.png` |
| 选择发货卡券 | `CouponPickerDialog` | 复用卡券创建/编辑穿梭框语义；支持搜索、全选、移入/移出、多选与保存计数 | `06-delivery-coupon-picker-*.png` |

桌面与移动固定视口为 `1440×900` / `390×844`。视觉脚本按 6 个状态各生成两张截图，并与 `docs/design/product-automation-interaction-v1.html` 同尺寸比较；当前 strict diff 已执行但尚未达到像素级 PASS。

## 11. 阶段 3 门禁与遗留风险

### 11.1 门禁自检

- 8 个正式用户旅程均有页面、canonical path、组件树、状态和阶段 2 API 映射。
- 每页覆盖 loading、success、empty、error、403、disabled、submitting，并补充 timeout、conflict、reconnect 等适用状态。
- 当前账号、Session、server state、page state、form state 和 mutation state 已分层归属。
- 1440×900 与 390×844 viewport 已冻结，token 来源和视觉边界已记录。
- 设计契约不依赖未定义字段、未定义接口或 Pi/闲鱼原始 API。
- `knowledge` / `review` 无一级入口；残留“Knowledge Plugin / 知识补充”等仅表示插件能力或风险任务，不产生独立页面。
- 详细组件职责、模块路径、ViewModel、Controller、路由/API、数据流和禁止超级组件规则见 `docs/03-component-contract.md`。

### 11.2 遗留风险

| 编号 | 风险 | 级别 | 处理阶段 |
| --- | --- | --- | --- |
| S3-I001 | 当前原型部分页面使用静态数组，尚未接入阶段 2 全量 API | P1 | 阶段 5 实现风险，不阻断当前设计门禁 |
| S3-I002 | 移动端实际实现尚未完成 | P1 | 阶段 4/5 实现风险，不阻断当前设计门禁 |
| S3-I003 | 原型 liveApi 使用 `localStorage.auth_token` | P1 | 阶段 5/6 实现风险，不阻断当前设计门禁 |
| S3-I004 | 真实 WebSocket、CredentialStore、Outbox 和视觉回归尚未执行 | P1 | 阶段 5–7 实现/验证风险，不阻断当前设计门禁 |
| S3-I005 | 原型源码存在超级宿主 | P1 | 阶段 4/5 实现风险，不阻断当前设计门禁 |
| S3-I006 | 原型源码页面职责过宽 | P1 | 阶段 4/5 实现风险，不阻断当前设计门禁 |
| S3-I007 | 原型源码 DTO 与 canonical 状态不一致 | P1 | 阶段 4/5 实现风险，不阻断当前设计门禁 |
| S3-I008 | 原型源码移动端回退 Dashboard | P1 | 阶段 4/5 实现风险，不阻断当前设计门禁 |

S3-I005 至 S3-I008 属于后续实现阶段的落地风险，不作为当前阶段 3 设计门禁的验收证据；S3-I009/S3-I010 已完成跨文档复核并关闭。

## 12. 阶段 3 下一步

阶段 3 设计门禁已通过。`docs/03-component-contract.md` §9 的设计 DoD、独立评审、数据流和路由/API 契约均已完成；可进入阶段 4 迭代计划与纵向切片编排，本阶段不进行具体编码。
# Agent 动态页面增量设计（2026-09-21）

新增第 9 个一级页面 `Agent 动态`，路由 `/agent-dynamics`，位于 `订单管理` 与 `设置` 之间。页面采用原型 `artifacts/auto-reply-agent-ui.html` 的独立视觉壳（224px sidebar、56px topbar、浅灰画布、右侧 drawer），避免通用占位页稀释高保真验收。页面数据只来自真实 Auto Reply Activity API，首版以 5 秒轮询实现“实时刷新”并展示 `asOf`。

组件映射：`AgentDynamicsPage -> AgentDynamicsViews (KpiStrip/RuntimePanel/HealthPanel/StatusPanel/ExceptionPanel/RunsTable/RunDrawer)`；状态由 `AgentDynamicsController` 管理，覆盖 loading、success、empty、error、forbidden、drawer loading/error、polling stale。

固定验收视口：桌面 `1440×900`、移动 `390×844`；视觉 token 继续沿用本文件 §2，原型偏差记录写入 `docs/agent/agent-dynamics/evidence/`。
