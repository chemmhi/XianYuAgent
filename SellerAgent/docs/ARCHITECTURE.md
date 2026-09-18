# XianyuSellerAgent 页面与接口架构

## 1. 目标

当前项目先交付一个可运行的运营控制台前端，页面职责与用户给出的八个一级入口保持一致：

| 一级页面 | 业务目标 | 主要聚合数据 |
| --- | --- | --- |
| 仪表盘 | 看数据、看异常、进入待处理任务 | 今日订单、自动处理率、待人工数、卡券库存、风险待办 |
| Workspace | 用自然语言发起任务、确认和跟踪执行 | 会话、Run、Step、确认卡、审计引用、幂等键 |
| 账号管理 | 登录、状态、切换和授权 | 账号状态、IM 状态、AI 开关、凭证状态 |
| 在线聊天 | 买家消息、自动回复、人工接管 | 账号、会话、消息、订单上下文、人工接管 |
| 商品管理 | 商品内容、图片、交付和发布 | 商品、图片、SKU、库存、卡券关联、发布日志 |
| 卡券管理 | 卡券生成、库存、绑定和交付 | 卡券批次、库存、商品绑定、交付状态 |
| 订单管理 | 订单状态、发货、售后和异常 | 订单、支付状态、交付状态、失败原因、重试 |
| 设置 | Agent、策略、权限和外部服务配置 | AI 配置、自动回复、自动发货、策略、系统服务 |

## 2. 前端分层

```text
src/
  app/                 应用级导航、壳层和运行模式
  api/
    contracts.ts       页面不依赖旧后端字段的稳定领域契约
    http.ts            fetch、鉴权、错误归一化
    xianyuApi.ts       参考项目接口到领域契约的 live 适配器
    mockApi.ts         无后端时可交互的确定性 mock 适配器
    index.ts           mock/live 选择入口
  shared/ui/            共享视觉类型与后续组件边界
  features/             后续拆分页面级 feature 的目标目录
```

当前高保真原型仍集中在 `src/App.tsx`，本次先把最容易产生漂移的导航和数据边界抽出。页面拆分按下面的顺序推进，不一次性重写现有原型：

1. `DashboardPage`：只读取 `api.dashboard.getSnapshot()`。
2. `WorkspacePage`：只依赖 `api.workspace`，禁止直接调用商品、订单或卡券 HTTP。
3. `AccountsPage`、`MessagesPage`：共享当前账号上下文，但通过各自领域 API 访问数据。
4. `ProductsPage`、`CouponsPage`、`OrdersPage`：分别拥有列表、详情和写操作状态机。
5. `SettingsPage`：只负责配置编辑和保存，服务重启、凭证轮换等高风险动作必须走确认流程。

## 3. 参考项目接口映射

以下路径来自 `F:\ChenHai\Project\xianyu-auto-reply` 的前端 API 包装和 `backend-web` 路由。当前项目的 live 适配器只在页面需要时聚合它们。

| 页面 | 复用接口 | 说明 |
| --- | --- | --- |
| 仪表盘 | `GET /api/v1/admin/stats`、`GET /api/v1/admin/stats/today`、`GET /api/v1/cookies/stats`、`GET /api/v1/cookies/stats/order-trend` | 聚合为 `DashboardSnapshot`，避免页面理解旧字段 |
| 账号管理 | `GET /api/v1/cookies/details/paginated`、`PUT /api/v1/cookies/{id}/status` | 授权/扫码流程可在下一步接入 `/api/v1/qr-login` |
| 在线聊天 | `GET /api/v1/chat-new/accounts`、`GET /api/v1/chat-new/conversations/{accountId}`、`GET /api/v1/chat-new/messages/{accountId}/{cid}`、`POST /api/v1/chat-new/send-message/{accountId}`、`WS /api/v1/chat-new/ws/{accountId}` | 读写走 HTTP，实时消息走 WebSocket |
| 商品管理 | `GET /api/v1/items/paginated`、`POST /api/v1/items/get-all-from-account`、`GET /api/v1/items/{cookieId}/{itemId}/seller-detail`、`PUT /api/v1/items/{cookieId}/{itemId}/seller-edit` | 商品发布、图片上传可继续接入 `productPublish` 模块 |
| 卡券管理 | `GET/POST /api/v1/cards`、`GET /api/v1/cards/{id}`、`PUT /api/v1/cards/{id}/items`、`POST /api/v1/cards/upload-image` | 卡密明文不进入页面状态，只传 credential/content 引用 |
| 订单管理 | `GET /api/v1/orders`、`GET /api/v1/orders/{orderNo}`、`POST /api/v1/orders/manual-delivery`、`POST /api/v1/orders/no-logistics-delivery`、`POST /api/v1/orders/cancel` | 重试、发货和售后动作都要带幂等键或由后端保证幂等 |
| 设置 | `GET/PUT /api/v1/system-settings`、`GET/PUT /api/v1/ai-reply-settings`、`GET /api/v1/system-control/status`、`POST /api/v1/system-control/restart/{serviceKey}` | 系统服务控制建议单独权限，不与普通策略保存混用 |

## 4. Workspace 新增接口建议

参考项目没有面向自然语言 Agent 的统一 Run 接口，因此 Workspace 使用新边界，不把多步编排塞进现有页面 API：

```text
GET  /api/v1/agent/sessions
POST /api/v1/agent/runs
GET  /api/v1/agent/runs/{run_id}
GET  /api/v1/agent/runs/{run_id}/confirmation
POST /api/v1/agent/runs/{run_id}/confirm
POST /api/v1/agent/runs/{run_id}/cancel
WS   /api/v1/agent/runs/{run_id}/events
```

### Run 状态

`queued -> running -> waiting_confirmation -> succeeded`

异常分支：

- `running -> failed`
- `waiting_confirmation -> cancelled`
- 重复确认必须返回同一个 `idempotencyKey` 对应的结果，不重复投递外部写动作。

### Confirmation Card 必须包含

- action 名称和 risk 等级；
- before / after 差异；
- `policyRef`、`auditRef`、`idempotencyKey`；
- 所属账号、商品或订单上下文；
- 不展示 Cookie、Token、卡密正文或外部资源明文。

## 5. 状态与权限边界

- **页面层**：渲染加载、空态、错误、成功和重复提交禁用态。
- **API 适配层**：把旧接口字段映射为当前领域契约，把 HTTP 错误转换为 `ApiError`。
- **Workspace 编排层**：只创建 Run，不直接修改商品、订单、账号或卡券。
- **Policy Gateway**：判断是否需要人工确认、权限是否足够、动作是否允许。
- **Outbox**：承接外部写动作，保存幂等键、审计引用和重试状态。
- **Credential Vault**：只保存 credential reference，前端永远不接触敏感正文。

## 6. 数据源切换

默认使用 mock 数据，便于当前页面继续独立运行。接入参考项目后设置：

```powershell
$env:VITE_API_MODE = 'live'
$env:VITE_API_BASE_URL = 'http://localhost:8089'
npm run dev
```

当 `VITE_API_MODE` 未设置或不是 `live` 时，使用 `createMockApi()`；live 适配器只负责请求和字段归一化，不把旧项目的数据库模型泄漏到页面组件。

## 7. 实施顺序

1. 先把 `App.tsx` 中的页面函数移动到 `src/features/*`，每次只移动一个页面并保留现有视觉结果。
2. 给 Dashboard、Accounts、Orders、Chat 接入 live 查询，补加载态、错误态和刷新操作。
3. 接入 Workspace Run + Confirmation Card，后端补 Policy Gateway、Outbox、Audit。
4. 接入商品发布、卡券生成和账号扫码授权等写操作。
5. 增加真实后端集成测试与浏览器端到端路径：聊天发送、订单补发、商品发布确认、账号切换。
