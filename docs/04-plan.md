# XianyuSellerAgent 阶段 4 迭代计划与纵向切片编排

- 文档版本：v0.2
- 更新日期：2026-09-19
- 状态：PASS（阶段 4 计划门禁；本阶段只做计划、依赖、DoD、风险和回滚设计，不写业务代码）
- 前置门禁：阶段 3 组件设计 PASS
- 下一门禁：阶段 5 首个真实纵向切片实现

## 1. 阶段目标

阶段 4 只负责把阶段 5 的实现顺序、依赖、字段冻结、验收证据和回滚动作编排清楚。账号管理、商品管理和卡券首页已经具备可用主体链路，后续以真实持久化/人工审核门禁收尾；下一批优先建设在线聊天、Workspace 工作台和 Settings API Key 配置，订单交付排在这三项之后。

当前优先级：

1. 在线聊天（Messages）
2. Workspace 工作台（AgentSession / Run / Confirmation / Outbox）
3. Settings API Key 配置（CredentialStore 的设置页入口）
4. 订单列表、详情与交付动作
5. Dashboard、其他 Settings 分区和运营聚合

本阶段不创建真实后端、数据库、API、Worker、闲鱼 adapter 或前端业务实现；高保真原型和现有源码只作为视觉与交互参考，不作为组件拆分依据。

## 2. ENV-0 环境与执行前置

ENV-0 不是用户可见业务切片，但必须在 S4-VS1 开始前完成或明确阻塞证据：

| 前置项 | 完成标准 | 证据 | 回滚 / 阻塞处理 |
| --- | --- | --- | --- |
| Compose 基础服务 | PostgreSQL、Redis、对象存储、API、Worker 的本地拓扑可启动 | 可复现启动命令、健康检查输出 | 保留上一版 Compose；服务不可用时阻断 S4-VS1 |
| Session / CSRF / API envelope | 登录态、CSRF 双提交、统一响应 envelope 和 canonical error map 可被首片消费 | 请求/响应样例、负向测试计划 | 只保留只读健康检查，不进入业务写入 |
| 幂等与账号范围 | `adminId + accountId + normalizedRoute + Idempotency-Key` 可注入 controller/API | 幂等冲突和跨账号拒绝用例 | 禁止绕过 scope 的写请求 |
| 最小审计能力 | AuditEvent 可记录账号、请求、命令、结果摘要，不写凭证明文或卡券正文 | 审计 schema/写入验证 | 无审计能力时阻断所有高风险写入 |
| Execution foundation | `idempotency_records`、`confirmations`、`outbox_jobs` 与最小 AuditEvent 在首个业务切片前可用，不受后置 Workspace 迁移阻塞 | 迁移顺序、DDL/fixture、状态机验证 | 无法回滚或无法查询 unknown 时阻断发布/交付写入 |
| 闲鱼 adapter 探针 | 登录、连接状态、订单/商品只读探针的失败/超时/未知结果可复现 | 协议探针记录、脱敏 fixture | 外部协议不可复现时仅允许本地草稿/只读切片 |

迁移前置说明：阶段 2 的逻辑迁移编号保持不变；阶段 5 实现时可将 `006_workspace_execution` 拆出 execution foundation（`confirmations`、`idempotency_records`、`outbox_jobs`）作为首片前置，并将 `007_observability` 拆出最小 `audit_events` 前置。任何拆分、编号或依赖变化必须先回写 `docs/02-database-schema.md`，完成 expand/backfill/verify/switch/contract 和回滚验证后才能开放高风险写入。

## 3. 主体纵向切片顺序

### S4-VS1 账号管理（首个真实切片）

- 用户旅程：管理员登录 / 首次初始化 → 添加账号 → QR 或登录会话轮询 → 连接成功 → 切换当前账号 → 查看 scope 和凭证引用。
- 页面与组件：`/accounts`、`AccountsPage`、`useAccountsController`、`AccountVM`、`AccountConnectionVM`、`LoginSessionVM`、`QrLoginSessionVM`、`AccountScopeVM`。
- API 范围：账号列表/详情/创建/更新/刷新、QR session 创建与查询、login-session 创建/查询/取消/续期/重新授权/清理、scope 查询与修改、CredentialRef 管理；`/api/v1/auth/qr-sessions` 只表示扫码会话，`/api/v1/accounts/{id}/login-sessions` 表示账号授权会话，二者不得混用状态或 queryKey。
- 依赖：ENV-0、auth session/bootstrap、账号范围、闲鱼登录协议探针、最小审计。
- 禁止范围：凭证明文进入 URL、ViewModel、买家消息、日志、Trace 或 Prompt；不实现商品、卡券和订单业务。
- DoD：覆盖 loading/empty/error/forbidden/submitting/conflict/timeout/unknown；账号隔离 queryKey；QR 超时/失败可重新扫码；写操作具备幂等、审计和回滚；Desktop 1440×900 与 Mobile 390×844 均有验收证据。
- 回滚：停止账号写入和外部刷新，保留账号历史及审计；恢复到只读列表/详情。

### S4-VS2 商品管理

- 用户旅程：当前账号 → 创建商品草稿 → 编辑基础信息 / SKU → 上传素材 → 保存 → 发布确认 → Outbox 结果。
- 页面与组件：`/products`、`ProductsPage`、`useProductsController`、`ProductVM`、`ProductAssetVM`、`SkuVM`、`PublishResultVM`。
- API 范围：列表/详情/创建/更新、素材增删改、同步/拉取、单个发布和批量发布。
- 依赖：S4-VS1 当前账号上下文、对象存储、Policy、Confirmation、Idempotency、Outbox；外部同步/发布依赖 adapter 探针通过。
- 禁止范围：页面直接修改 `ProductVM.status`；不把商品、卡券、订单保存逻辑塞进 `ProductEditor`。
- DoD：草稿可保留；素材失败可单项重试；发布必须走 Policy → Confirmation → Idempotency → Outbox；部分成功逐项返回；跨账号操作拒绝；移动端复用同一 controller/VM/命令；字段级 request/query/response 在实现前冻结。
- 回滚：停止同步和发布，保留商品行与草稿；撤回未提交素材引用；Outbox 按 attempt 回滚，不删除审计。

### S4-VS3 卡券首页 / 批次与库存管理

- 用户旅程：当前账号 → 查看批次首页 → 创建批次 → 导入/批量编辑库存 → 查看 `stockAlert` → 绑定商品 → 管理员受控查看正文。
- 页面与组件：`/coupons`、`CouponsPage`、`useCouponsController`、`CouponBatchVM`、`CouponItemVM`、`CouponContentPreviewVM`、`InventoryLockVM`。
- API 范围：批次列表/详情/创建/更新/删除、items 导入/批量保存/批量删除、素材、绑定/解除绑定、作废、受控正文读取。
- 依赖：S4-VS1 账号范围、S4-VS2 商品绑定、对象存储、事务锁、AuditEvent、deliveryScope 策略。
- 首页口径：首期首页以批次列表、可用库存、`stockAlert`、状态筛选为主；跨批次 KPI 若需要新增 summary API，必须先冻结字段，不得在页面自行聚合未知字段。
- DoD：正文不进列表；管理员受控查看/复制；`low_stock` 只作为 `stockAlert` 派生告警；库存写入事务化并逐项返回；绑定必须校验商品与账号一致；作废后禁止恢复性盲重试；敏感字段不进日志/Trace/Replay/Prompt；覆盖空数据、部分成功、冲突、超时和权限失败。
- 回滚：冻结库存写入；绑定仅允许状态回退，不删除历史；作废不可逆；恢复到只读批次和库存查询。

### S4-VS4 订单列表、详情与交付

- 用户旅程：当前账号 → 订单筛选 → 订单详情四态 → 交付预览 → Confirmation → manual / no_logistics / coupon_only / mixed 发货 → DeliveryRecord 与审计。
- 页面与组件：`/orders`、`OrdersPage`、`useOrdersController`、`OrderVM`、`DeliveryPreviewVM`、`DeliveryRecordVM`、`AfterSalesVM`。
- API 范围：订单列表/详情/刷新、delivery-preview、deliver、cancel、retry。
- 依赖：S4-VS1 账号、S4-VS2 商品、S4-VS3 卡券库存、Policy、Confirmation、Outbox、闲鱼 adapter。
- 禁止范围：未知结果时自动再次发货；订单页面直接调用外部交付 adapter；混用支付、订单、交付、售后四套状态。
- DoD：支持四套独立状态和筛选；交付前校验支付、商品/账号匹配、deliveryScope、库存锁定和策略；重复提交幂等；`unknown/timeout` 只查询 outbox/外部状态或进入人工恢复；失败可按状态重试；交付写 DeliveryRecord 和审计；覆盖未登录/无权/空数据/冲突/超时/重复提交/移动端对等。
- 回滚：停止新的 delivery outbox，等待租约结束；保留 DeliveryRecord 和审计；必要时退回只读订单和外部状态查询，不回滚已成功交付。

### 3.2 当前优先垂直切片：Messages / Workspace / Settings API Key

账号、商品、卡券不再作为下一批首要开发目标；它们仍需按已有风险矩阵补真实环境和人工审核，但不阻塞下面三个功能进入切片实现。

#### `S4-VS5A` 在线聊天读取与实时连接

- 用户旅程：管理员进入 `/messages` → 选择账号 → 查看会话列表 → 打开会话 → 读取消息时间线 → 连接断开后按游标补事件并恢复。
- 组件边界：`MessagesPage`、`useMessagesController`、`AccountTabs`、`ConversationList`、`ConversationHeader`、`MessageTimeline`、`ConnectionBanner`。
- API / 数据：`GET /api/v1/conversations`、`GET /api/v1/conversations/{id}/messages`、`WS /api/v1/conversations/{id}/events`；queryKey 必须包含 `accountId`、`conversationId` 和 cursor。
- 状态与权限：loading/empty/error/forbidden/reconnect/timeout；WebSocket 校验 Session、Origin、账号 scope 和会话归属；恢复连接先按 cursor 补事件，禁止重复追加。
- 禁止范围：不发送消息、不接管会话、不读取未授权买家正文、不直连闲鱼 WebSocket。
- 验收与证据：真实 API + PostgreSQL/Redis 或等价容器、Chrome/CDP 桌面/移动、断线/重连/游标/403/空数据；截图记录时间线、未读状态和连接提示。
- 回滚：关闭实时订阅、保留历史消息和游标，不删除会话；降级为只读历史查询。

#### `S4-VS5B` 在线聊天发送、附件与消息动作

- 用户旅程：在会话中输入文本 → 提交中 → 发送成功或失败 → 重试；图片先上传再发送；支持撤回时进入 `recalled`。
- 组件边界：`MessageComposer`、`AttachmentUpload`、`MessageActionMenu`，命令由 `useMessagesController` 唯一发出。
- API / 数据：`POST /api/v1/conversations/{id}/messages`、`POST /api/v1/conversations/{id}/images`、`POST /api/v1/conversations/{id}/messages/{messageId}/recall`；所有写请求带 Idempotency-Key，外部结果写 `externalOutcome`。
- 状态与权限：submitting/succeeded/failed/unknown/conflict/timeout/disabled；失败可重试，unknown 只能查询外部结果或人工恢复，不盲目重复发送。
- 禁止范围：不改变 `handlingMode`，不绕过 Policy，不把凭证、卡券正文或内部提示写入买家消息。
- 验收与证据：真实 API、对象存储、消息持久化、重复提交、上传失败、撤回不支持、403、外部 timeout/unknown、Chrome/CDP 和移动端输入体验。
- 回滚：停止新发送和上传，保留已落库消息与审计；未完成附件标记失败并清理临时对象。

#### `S4-VS5C` 在线聊天人工接管与 AI 恢复

- 用户旅程：管理员从会话风险面板选择接管原因 → `handoff` → 会话切为人工 → 处理完成后 `release` 恢复 AI。
- API / 数据：`POST /api/v1/conversations/{id}/handoff`、`POST /api/v1/conversations/{id}/release`；请求包含 `expectedVersion`、`reason`、Idempotency-Key，响应返回 `handlingMode`、`auditRef`。
- 状态与权限：confirmation/submitting/succeeded/conflict/forbidden/unknown；版本冲突刷新差异；原因只记录运营元数据，不进入买家可见消息、Trace、Replay 或 Prompt。
- 禁止范围：不把接管原因当作聊天消息发送，不在页面直接改 `ConversationVM.handlingMode`。
- 验收与证据：成功、非法转换、重复请求、版本冲突、无权、持久化失败、页面禁用与恢复；人工审核固定桌面/移动截图。
- 回滚：恢复到最近一致的 `handlingMode`，保留审计；未知结果只允许查询，不自动重复切换。

#### `S4-VS6A` Workspace 会话与 Run 首条链路

- 用户旅程：进入 `/workspace` → 创建/搜索/切换 `AgentSession` → 提交一条受控指令 → 查看 Run/Step 实时状态和业务引用。
- 组件边界：`WorkspacePage`、`useWorkspaceController`、`SessionToolbar`、`SessionList`、`WorkspaceComposer`、`RunChat`、`RealtimeBanner`。
- API / 数据：AgentSession 列表/创建/搜索/切换/归档；`POST /api/v1/workspace/runs`、`GET /api/v1/workspace/runs/{id}`、`WS /api/v1/workspace/runs/{id}/events`。
- 状态与权限：queued/running/executing/succeeded/failed/cancelled/reconnect/forbidden；Run 必须绑定账号 scope 和 session，不暴露 Pi 原始 API。
- 禁止范围：不确认高风险动作、不直接改 Run/Step 状态、不在页面执行外部平台动作。
- 验收与证据：真实 API + Worker/Runtime、session 持久化、重复 clientRunRef、断线补事件、403/404/空会话、桌面/移动截图。
- 回滚：停止新 Run，等待执行租约结束；保留 Session、Run、Step 和审计，回退到只读历史。

#### `S4-VS6B` Workspace Confirmation / Cancel / Retry / Outbox

- 用户旅程：Run 进入 `waiting_confirmation` → 查看 Confirmation → 确认/取消 → 查看 Outbox 结果 → 失败或 unknown 时查询/人工恢复/重试。
- 组件边界：`ConfirmationCard`、`RunActionBar`、`OutboxResult`，命令由 `useWorkspaceController` 发出；`OutboxPanel` 不承担 Settings 保存。
- API / 数据：`GET /api/v1/workspace/runs/{id}/confirmation`、`POST /confirm`、`/cancel`、`/retry`；必要时使用 execution outbox query/recover API。
- 状态与权限：active/expired/confirmed/rejected/cancelled、unknown/timeout/conflict；必须经过 Policy → Confirmation → Idempotency → Outbox，unknown 不盲重放。
- 禁止范围：不把页面按钮直接映射为外部 adapter 调用，不跳过审计、租约和幂等。
- 验收与证据：成功、过期、非法转换、重复确认、版本冲突、持久化失败、worker 重试/取消、Outbox 人工恢复、Chrome/CDP 和运行日志。
- 回滚：停止新确认和 Outbox 写入，等待租约；保留已有执行结果与审计，不回滚已成功外部动作。

#### `S4-VS7A` Settings API Key 配置核心链路

- 用户旅程：进入 `/settings` → 选择明确的 `accountId` → API Key 分区 → 查看该账号已配置 provider/alias/状态（不显示密钥）→ 新增/编辑 → 校验 → 保存 → 轮换/启用/禁用/撤销；切换账号必须失效当前 credentials query，禁止跨账号编辑。
- 组件边界：`SettingsPage`、`SettingsTabs`、`ExternalServicesPanel` 或独立 `ApiKeyConfigPanel`、`CredentialStorePanel`、`useCredentialController`；保存逻辑不得回到 `SettingsPage` 总入口。
- API / 数据：复用 `GET/POST/PATCH /api/v1/credentials`、`POST /{id}/rotate`、`/enable`、`/disable`、`/revoke`；Settings 只接收 `CredentialRefVM` 和脱敏 metadata，不接收明文旧值。
- 状态与权限：loading/empty/forbidden/submitting/saved/conflict/timeout；明文只在创建/轮换请求的受控边界出现，服务端加密存储，列表与日志只返回 alias、provider、status、lastRotatedAt、fingerprint 摘要。
- 禁止范围：不得把 API Key 放入 URL、localStorage、query cache、日志、Trace、Replay、Prompt 或买家消息；不得让 Workspace/Chat 直接读取 CredentialValue。
- 验收与证据：PostgreSQL 加密字段复读、创建/编辑/轮换/启停/撤销、重复提交、403/409、错误脱敏、Chrome/CDP 桌面/移动截图和审计记录。
- 回滚：禁用新增 CredentialRef、保留旧密钥引用与审计；轮换失败不得覆盖旧密文，撤销不可恢复需二次确认并可审计。

#### 新优先级依赖顺序

```text
S4-VS5A → S4-VS5B → S4-VS5C
      └──────────────┐
                     ├→ S4-VS6A → S4-VS6B
S4-VS7A（可与 VS5A/VS6A 并行，但先完成 CredentialStore 契约）
                     ↓
             S4-VS4A/B/C 订单交付
```

`S4-VS7A` 不依赖订单；`S4-VS6B` 依赖 Execution foundation 和 Runtime 可用性；在线聊天与 Workspace 的账号 scope 均复用已成型的账号上下文，不重新建设账号选择逻辑。

### 3.1 未完成事项的纵向切片拆分

本节把当前仍未完成的工作拆成可独立实现、验证和回滚的阶段 5 切片。状态只表示当前证据，不表示代码已经实现：

| 切片 | 目标 | 依赖 | 当前状态 | 主要风险 |
| --- | --- | --- | --- | --- |
| `S4-VS2A` 商品草稿与基础信息 | 创建、详情、PATCH、版本冲突、账号 scope、草稿保留 | `S4-VS1`、`003_catalog`、现有 Products 首片 | `PLANNED` | `S5-RISK-013`、`S4-I005`、`S4-I006` |
| `S4-VS2B` SKU / 多规格与库存 | SKU 增删改、价格/库存校验、批量部分成功、乐观锁 | `S4-VS2A` | `PLANNED` | `S5-RISK-013`、`S5-RISK-014` |
| `S4-VS2C` 商品素材与对象存储 | AssetRef 上传、预览、替换、删除、失败重试、MinIO 持久化 | `S4-VS2A`、对象存储 contract | `PLANNED` | `R-005`、`S5-RISK-015` |
| `S4-VS2D` 受控发布 | Policy → Confirmation → Idempotency → Outbox，逐项结果与恢复 | `S4-VS2A/B/C`、Execution foundation | `PLANNED` | `R-008`、`R-009`、`S5-RISK-014` |
| `S4-VS2E` 商品外部同步真实验收 | 真实 Cookie/账号、分页/字段映射、unknown/timeout/重试口径 | `S4-VS1`、现有 sync 首片 | `PARTIALLY_VERIFIED` | `R-002`、`S5-I002`、`S5-I008` |
| `S4-VS3A` 卡券明细与素材 | CouponItem bulk-save/delete、资产上传/删除、敏感正文隔离 | `S4-VS3` 已合入代码、`S4-VS2` 商品绑定 | `PLANNED` | `S4-I003`、`S5-RISK-016` |
| `S4-VS3B` 库存锁定与消耗 | reserve/consume/lock、并发冲突、订单交付前库存一致性 | `S4-VS3A`、事务锁 | `PLANNED` | `R-009`、`S5-RISK-016` |
| `S4-VS4A` 订单列表与详情 | 订单只读、筛选、四套状态、会话/商品关联 | `S4-VS1/B`、订单 schema | `PLANNED` | `S5-RISK-017` |
| `S4-VS4B` 交付预览与库存锁 | delivery-preview、策略校验、库存预锁、可解释失败 | `S4-VS3B`、Policy/Confirmation | `PLANNED` | `S4-I003`、`S4-I004`、`S5-RISK-017` |
| `S4-VS4C` 发货/取消/重试/未知恢复 | manual/no_logistics/coupon_only/mixed、Outbox、人工恢复 | `S4-VS4B`、外部 adapter | `PLANNED` | `R-009`、`S4-I004`、`S5-RISK-018` |
| `S4-ENV-RECOVERY` 发布级恢复门禁 | 迁移回滚、Testcontainers、Redis/MinIO 重启恢复 | 所有写入切片前置 | `BLOCKED` | `R-001`、`S5-I001`、`S5-RISK-019` |
| `S4-EXT-ACCOUNT` 真实闲鱼账号验收 | APP 扫码、Cookie、资料同步和账号口径人工复核 | 当前 Chrome 登录态、外部账号 | `BLOCKED` | `R-002`、`S5-I002`、`S5-I004` |
| `S4-ENV-RUNTIME` Pi Runtime 门禁 | 健康、超时、重试、取消、不可用和观测 | Execution foundation | `PLANNED` | `R-006`、`S5-RISK-020` |

#### 切片卡片与统一门禁

每个切片都必须在实现前冻结以下边界，未冻结不得进入编码：

1. **用户路径与正式入口**：写清页面、路由、controller、ViewModel、命令和用户可见成功/失败结果。
2. **后端边界**：route/controller、application service、domain rule、store/adapter、migration 和审计 owner 必须分开；前端不得直连 store、对象存储或闲鱼 adapter。
3. **权限与敏感数据**：所有写请求带管理员 Session、账号 scope、CSRF 和 Idempotency-Key；卡券正文、夸克链接、提取码只在受控 API 内出现，不进列表、日志、Trace、Replay 或 Prompt。
4. **状态机**：至少覆盖成功、非法转换、资源不存在、403、重复请求/幂等冲突、持久化失败、timeout、unknown、取消和人工恢复；状态字段沿用阶段 2 canonical 定义。
5. **证据**：单元 + 集成/真实依赖 + 真实 Chrome/CDP E2E + 视觉回归；必须同时断言用户可见结果和持久化结果，不能用 smoke、mock 或页面可打开代替。
6. **视觉**：固定 `1440×900` 和 `390×844`，记录 loading/empty/error/forbidden/disabled/submitting/success/partial-success/unknown 等适用状态及偏差。
7. **回滚**：写明迁移 expand/backfill/verify/switch/rollback、应用回退、未完成 outbox/租约处理、历史数据保留和回滚后健康检查。

#### 依赖顺序与并行规则

```text
S4-ENV-RECOVERY（前置门禁）
        ↓
S4-VS2A → S4-VS2B → S4-VS2C → S4-VS2D
        └──────────────→ S4-VS2E（可并行，真实外部验收不替代本地写入证据）

S4-VS3A → S4-VS3B ───────────────┐
                                   ├→ S4-VS4B → S4-VS4C
S4-VS4A（可与 VS3A/B 并行只读） ───┘

S4-EXT-ACCOUNT、S4-ENV-RUNTIME 为独立门禁；未通过时只能保留明确受限的本地/受控适配证据。
```

#### 每片明确不包含的范围

- `S4-VS2A/B/C` 不包含真实闲鱼发布；`S4-VS2D` 只完成受控发布命令和 Outbox，不把外部平台未知结果伪造成成功。
- `S4-VS2E` 不新增商品编辑器能力；只验收真实外部账号、分页、字段映射和同步结果口径。
- `S4-VS3A/B` 不改变已合入的 `/coupons` 平台表格样式，不把旧项目源码或截图当作 UI 实现；不把管理员正文预览当作买家交付。
- `S4-VS4A` 只读不发货；`S4-VS4B` 只预览和预锁，不提交最终交付；`S4-VS4C` 才允许受控发货、取消、重试和人工恢复。
- `S4-ENV-RECOVERY`、`S4-EXT-ACCOUNT`、`S4-ENV-RUNTIME` 是横向门禁，不得以它们已计划为理由宣称业务切片完成。

#### 迁移编号与回滚策略

- 现有 `013_coupons.sql` 与 `013_product_sync.sql` 并行存在；本次只在文档中冻结风险，不直接重命名历史迁移。
- 在下一次新增迁移前，必须完成迁移清单、执行顺序、已有 PostgreSQL volume 的 apply 记录、回滚脚本和重复执行验证；新迁移不得继续占用 `013`。
- `CouponItem`、`CouponAssetRef`、库存锁和订单交付新增表/字段必须使用新的单调编号，并在 `docs/02-database-schema.md` 写明 expand/backfill/verify/switch/rollback；没有兼容读路径时不得开放流量。

## 4. 后置切片

以下内容排在当前三项优先切片之后：

1. `S4-VS4A/B/C`：订单列表、交付预览和交付动作
2. `S4-VS6C`：Workspace 业务上下文、跨域引用和高级运行能力
3. `S4-VS7B`：Settings 其他配置分区、Runtime/Outbox 运维面和运营聚合
4. Dashboard、Messages 高级自动化和非核心运营页面

Dashboard 不先于账号、商品、卡券、订单四个核心域；Settings 仅提供首片所需的最小管理员能力，不扩张为独立业务切片。

## 5. 所有切片统一 DoD

每个阶段 5 纵向切片必须同时记录：

- 目标用户旅程、输入/输出、route、controller、canonical ViewModel、API method/path 和字段级契约；
- 正常、空数据、错误、403、禁用、提交中、冲突、超时、未知结果和重试/恢复路径；
- 账号隔离 queryKey、缓存失效、幂等、审计、敏感字段裁剪和并发策略；
- 分页/排序/游标、`version` / `expectedVersion`、账号切换后的 query invalidation、seed/fixture 与清理策略；
- 单元、集成、真实端到端、视觉回归和冒烟测试范围；
- 设计版本、1440×900 与 390×844 viewport、代表性数据和视觉证据位置；
- 失败前后验证、迁移前后验证、可回滚动作和回滚后健康检查；
- 中文 Conventional Commit，并同步 `STATUS.md`、评审记录、风险登记和决策日志。

阶段 5 的真实证据统一归档到 `docs/evidence/stage5/<slice-id>/`（测试输出、API/迁移记录、脱敏 fixture、截图/录屏、回滚演练和复审结论）；阶段 4 不创建伪造证据或 mock 完成声明。

## 6. 阶段 4 门禁结果

阶段 4 计划门禁已完成并在 2026-09-19 重排：账号、商品、卡券作为已成型基础域保留收尾门禁；下一批阶段 5 优先进入 `S4-VS5A/B/C`、`S4-VS6A/B`、`S4-VS7A`。每个切片仍需独立完成实现、真实测试、视觉回归、回滚和三轮复审，不能因为基础域已成型而跳过阶段门禁。
