# XianyuSellerAgent 阶段 1 系统架构与模块边界

- 文档版本：v0.1
- 更新日期：2026-09-19
- 当前状态：PASS（阶段 1 复核通过，进入阶段 2 数据 / API 设计）
- 进入依据：阶段 0 范围门禁已 PASS
- 禁止范围：本阶段不实现真实业务后端、数据库迁移、外部闲鱼适配器或前后端联调

## 1. 架构目标

1. 用模块化单体承载首期 API、领域服务和管理后台能力。
2. 将闲鱼平台、CredentialStore、Pi Runtime、模型供应商和对象存储隔离在适配边界后。
3. 让高风险写动作统一经过 Policy、Confirmation、Idempotency、Outbox 和 Audit。
4. 保持前端只依赖当前项目领域契约，不依赖闲鱼原始字段或旧项目 API。
5. 为阶段 2 的数据模型、API 契约和安全边界提供明确的数据所有权与依赖方向。

## 2. 系统上下文

```text
管理员浏览器 / apps/web 正式前端
        |
        v
  Web API / WebSocket
        |
        +--> Auth / Session
        +--> Domain Modules
        |      accounts / products / coupons / orders / messages
        |      workspace / settings
        +--> Policy / Confirmation / Idempotency / Outbox
        |
        +--> PostgreSQL  <--> Redis
        +--> S3-compatible Object Storage
        |
        +--> Worker --> xianyu Adapter --> 闲鱼 HTTP / WebSocket
        |
        +--> Pi Runtime Service
        +--> CredentialStore
        +--> OpenTelemetry / Audit / Trace
```

闲鱼买家只通过闲鱼平台看到买家可见消息和订单交付内容，不能直接访问 Web API、CredentialStore、Pi Runtime、数据库或内部 Trace。

## 3. 部署拓扑

### 3.1 本地与测试

- `web`：React + Vite 静态资源；
- `api`：Node.js + NestJS + Fastify；
- `worker`：独立异步执行进程；
- `postgres`：事实数据、Outbox、Audit 和幂等记录；
- `redis`：会话、短期缓存、在线状态和限流；
- `minio`：S3 兼容对象存储；
- `pi-runtime`：独立服务；
- 测试环境优先使用 Docker Compose + Testcontainers。

### 3.2 首期生产

首期允许使用 Docker Compose。API、Worker、PostgreSQL、Redis、对象存储和 Pi Runtime 使用独立容器；反向代理和 TLS 终止位于容器编排入口。生产部署、健康检查、备份、迁移和回滚属于阶段 7/8 验证范围。

## 4. 模块边界

| 模块 | 主要职责 | 输入 | 输出 / 所有权 |
| --- | --- | --- | --- |
| `web` | 页面、路由、表单、状态展示和 API 调用 | 领域 API、WebSocket 事件 | 用户界面状态；不拥有业务事实 |
| `auth` | 管理员登录、会话、注销、初始化 | 凭证、会话 Cookie | 管理员身份上下文；阶段 1/2 使用 HttpOnly Cookie |
| `accounts` | 闲鱼账号、连接状态、账号范围和策略摘要 | 管理员命令、平台状态 | Account 领域事实 |
| `products` | 商品草稿、媒体引用、发布状态 | 商品命令、对象存储引用 | Product 领域事实 |
| `coupons` | 卡券批次、库存、绑定和交付范围 | 卡券正文、商品绑定命令 | Coupon / delivery 事实 |
| `orders` | 订单查询、支付状态、发货状态和售后 | 平台订单、管理员命令 | Order 领域事实 |
| `messages` | 会话、消息、人工接管和 WebSocket 投递 | 平台消息、管理员回复 | Conversation / Message 事实 |
| `workspace` | Agent Run、Step、Confirmation 和任务上下文 | 管理员自然语言任务 | Run / Step / Confirmation 事实 |
| `policy` | capability、account_scope、permission、policy 校验 | Command、管理员上下文 | 允许 / 拒绝 / 需确认 |
| `execution` | Idempotency、Outbox、重试、Audit 和 Trace | 已批准命令 | 可重试的异步执行记录 |
| `xianyu-adapter` | 登录、签名、HTTP、WebSocket、字段映射和平台错误转换 | 领域命令、CredentialStore | 外部平台结果，不向领域暴露原始协议 |
| `pi-runtime-adapter` | 调用独立 Pi Runtime 服务 | Manifest、Run、能力参数 | Agent 结果和事件 |
| `credential-store` | 系统凭证 CRUD、轮换、撤销 | 管理员操作、账号绑定 | CredentialRef / CredentialValue；不得进入买家可见链路 |
| `storage` | S3 对象上传、下载和生命周期 | 媒体文件 | AssetRef；不保存业务状态 |
| `observability` | 日志、指标、Trace、健康检查和告警 | 模块事件 | 可观测数据与 Audit 关联 |
| `settings` | Agent、模型、策略、管理员资料和账号级运行参数 | 管理员设置命令 | Settings 事实；凭证值仍归 `credential-store` |
| `dashboard` | 只读聚合与指标展示 | 各领域 Query Service、observability 投影 | Dashboard 只读视图，不拥有业务事实 |

## 4.1 PRD 能力到模块映射

| 旅程 | 入口模块 | 核心协作模块 | 数据所有者 | 关键输出 |
| --- | --- | --- | --- | --- |
| J-01 添加并启用账号 | `accounts` | `auth`、`credential-store`、`xianyu-adapter`、`observability` | `accounts` | Account、连接状态、授权审计 |
| J-02 商品草稿与发布 | `products` | `storage`、`policy`、`execution`、`xianyu-adapter` | `products` | Product、AssetRef、发布任务状态 |
| J-03 卡券生成与绑定 | `coupons` | `products`、`policy`、`observability` | `coupons` | CouponBatch、库存、绑定关系 |
| J-04 订单查询与发货 | `orders` | `coupons`、`accounts`、`policy`、`execution`、`xianyu-adapter` | `orders` | Order、发货状态、幂等记录、审计记录 |
| J-05 在线聊天与人工接管 | `messages` | `accounts`、`orders`、`policy`、`xianyu-adapter` | `messages` | Conversation、Message、人工接管状态 |
| J-06 Workspace 查询与写任务 | `workspace` | `policy`、`execution`、`pi-runtime-adapter`、各领域模块 | `workspace` | Run、Step、任务上下文；Confirmation / Outbox 由 `execution` 持有 |

边界规则：`web` 只能调用领域 API；领域模块不直接调用闲鱼原始协议；所有外部写动作统一经过 `policy -> confirmation（如需要）-> idempotency -> outbox -> worker -> adapter`。

## 5. 依赖方向

允许的依赖方向：

```text
web -> api contracts -> domain services -> repositories / adapters
workspace -> policy -> execution -> xianyu-adapter / pi-runtime-adapter
domain modules -> credential-store interface
domain modules -> storage interface
```

禁止：

- 页面直接调用闲鱼 HTTP / WebSocket；
- 页面、Agent 或 Worker 直接读取 CredentialStore 底层实现；
- 领域模块直接依赖 Pi 内部对象；
- `xianyu-adapter` 反向依赖页面或 Workspace；
- `web` 直接依赖 PostgreSQL、Redis 或对象存储；
- 旧项目 API、数据库和代码包进入当前运行时。

## 6. 数据所有权

| 数据 | 所有模块 | 访问方式 |
| --- | --- | --- |
| 管理员与会话 | `auth` | API 内部服务调用；浏览器仅持 HttpOnly Cookie |
| 设置与运行参数 | `settings` | Settings Query / Command；凭证值通过 `credential-store` 受控访问 |
| 仪表盘视图 | `dashboard` | 只读聚合查询；不写入业务事实 |
| 闲鱼账号与连接状态 | `accounts` | 领域 API；平台状态由 adapter 事件更新 |
| 商品与素材引用 | `products` | 商品模块拥有商品元数据和 AssetRef；`storage` 只负责文件生命周期 |
| 卡券库存与绑定关系 | `coupons` | `coupons` 独占库存、批次、卡券项和绑定关系；其他模块只能发命令 |
| 交付记录 | `orders` | 订单事务创建 DeliveryRecord；卡券模块只提供可扣减库存 |
| 订单与发货状态 | `orders` | 订单领域服务；外部状态由 Outbox 回写 |
| 会话与消息 | `messages` | WebSocket + 查询 API |
| Run、Step、任务上下文 | `workspace` | Workspace 状态机命令与事件 |
| Confirmation、Idempotency、Outbox | `execution` | 执行状态机命令与事件 |
| 系统凭证 | `credential-store` | 管理员可查看、编辑和操作；买家不可见 |
| Audit / Trace / HealthSnapshot | `observability` | 追加写入，业务模块只提交事件；`execution` 仅关联引用 |

## 6.1 查询与写入接口映射

| 场景 | 同步查询入口 | 异步写入入口 | 外部调用方 | 事实来源 |
| --- | --- | --- | --- | --- |
| 账号状态 | `AccountsQuery` | `AccountCommand` -> Outbox | web / workspace | `accounts` |
| 商品列表与草稿 | `ProductsQuery` | `ProductCommand` -> Outbox | web / workspace | `products` |
| 卡券库存与正文 | `CouponsQuery` | `CouponCommand` -> transaction + Outbox | web / workspace / orders | `coupons` |
| 订单与交付状态 | `OrdersQuery` | `DeliveryCommand` -> Policy -> Outbox | web / workspace | `orders` |
| 会话与消息 | `MessagesQuery` + WebSocket | `MessageCommand` -> Worker -> adapter | web / workspace | `messages` |
| Agent 运行 | `WorkspaceQuery` | `RunCommand` -> `pi-runtime-adapter` | web / workspace | `workspace` / `execution` |
| 仪表盘 | `DashboardQuery` 聚合查询 | 不直接写入 | web | 各领域只读投影 |

查询类外部请求由领域 Query Service 通过 `xianyu-adapter` 发起并归一化；写入类外部请求只能由 Worker 消费 Outbox 后调用 adapter。页面、Workspace 和领域模块都不能直接调用闲鱼 HTTP/WebSocket。

## 7. 同步与异步边界

- 查询、表单校验、策略判断：同步 API。
- 登录轮询、商品发布、消息发送、订单发货、Pi Runtime 调用：通过 Outbox + Worker 异步执行。
- WebSocket 只推送状态变化和结果摘要，不推送系统凭证明文。
- 外部动作超时：先查询外部状态，再按原幂等键决定重试；禁止盲目重复执行。
- 所有异步动作必须具备 `queued -> running -> succeeded / failed / dead_letter` 状态。

## 8. 身份、凭证与交付边界

- 阶段 0 原型可使用 `localStorage.auth_token`，仅作为已确认的原型例外。
- 真实后端必须使用服务端会话、HttpOnly Cookie、Secure、SameSite 和注销失效机制。
- 管理员可查看、编辑、替换、启停和操作系统凭证。
- CredentialStore 直接存储在项目数据库；管理员拥有绝对管理权限，不引入外部密钥管理服务。
- 系统凭证不得进入闲鱼买家可见的消息、订单交付内容或外部买家可见响应。
- 卡券正文、夸克链接和提取码只有在 `buyer_deliverable`、订单已支付、商品与账号匹配、策略通过且审计记录完成后，才允许交付买家。

### 8.1 鉴权迁移落点

- 原型模式允许 `localStorage.auth_token`，仅用于 SellerAgent mock / liveApi 原型验证；真实 API 接入前必须移除该持久化方式，不做生产双轨兼容。
- 真实登录由 `auth` 创建服务端会话并通过 HttpOnly、Secure、SameSite Cookie 返回；浏览器不保存管理员长期 Token。
- 注销、会话过期、管理员禁用和权限变化均由服务端失效会话；API 返回未认证 / 未授权结果时，前端只清理本地视图状态并引导重新登录。
- 当前管理员账号范围由服务端会话上下文注入，不能由前端持久化字段或请求参数单独决定。
- 阶段 1 评审确认上述边界；阶段 2 以鉴权 API、会话失效集成测试和关键用户流 E2E 验证。

### 8.2 R-008 / R-009 实现落点

| 风险 | 架构落点 | 阶段 2 验证 |
| --- | --- | --- |
| R-008 敏感交付数据 | `coupons` 持有内容引用与 `deliveryScope`；`policy` 校验买家交付条件、订单支付、商品 / 账号匹配、策略与管理员会话；`orders` 事务内生成交付记录；`observability` / `execution` 只记录必要审计元数据并禁止系统凭证进入日志、Trace、Replay、Prompt | 权限与买家可见链路测试、审计记录测试、日志 / Trace 抽样脱敏检查 |
| R-009 外部结果未知 | `execution` 持有 Idempotency、Outbox、Audit 和重试状态；`xianyu-adapter` 提供外部状态查询；`worker` 在重试 / 取消前按原幂等键查询外部状态，成功步骤不得重放 | 超时未知、重复请求、重试、取消和部分成功的集成测试 |

## 9. ADR 清单

| ADR | 决策 | 当前状态 |
| --- | --- | --- |
| ADR-001 | 首期采用模块化单体 + 独立 Worker | 已通过阶段 1 复核 |
| ADR-002 | Pi Runtime 采用独立服务 | 已通过阶段 1 复核 |
| ADR-003 | CredentialStore 直接存储数据库；管理员全权限 | 已确认，非主线 |
| ADR-004 | 生产鉴权采用服务端会话 + HttpOnly Cookie | 已通过阶段 1 复核 |
| ADR-005 | 首期生产允许 Docker Compose | 已确认，阶段 7/8 验证发布与回滚 |
| ADR-006 | Pi Runtime 内部 HTTP/JSON v1、服务间鉴权与故障边界 | 已通过阶段 1 复核 |
| ADR-007 | 闲鱼适配器隔离与 Worker 外部写入边界 | 已通过阶段 1 复核 |

## 10. 阶段 1 待办与门禁

### 待办

- `S1-I001`：模块依赖图、数据所有权和接口边界草案已补齐，待 S1-R1 逐项核对；
- `S1-I002`：Pi Runtime、真实鉴权和闲鱼 adapter ADR 草案已补齐，待 S1-R2 / S1-R3 独立复核；CredentialStore 仅保留数据库字段与买家不可见边界。
- `S1-I003`：localStorage 原型例外到 HttpOnly Cookie 的迁移设计已补齐，待 S1-R3 复核与阶段 2 实现验证；
- `S1-I004`：形成 local/test/staging/production 的基本拓扑；详细部署、备份与回滚在阶段 7/8 前完成，不作为阶段 1 出门禁。

### 阶段 1 通过条件

- 每个 PRD 核心能力映射到明确模块；
- 模块职责、输入、输出、数据所有权和依赖方向无歧义；
- Pi Runtime 独立服务和真实鉴权均有 ADR；CredentialStore 仅需数据库字段、管理员权限和买家不可见边界说明；
- 外部闲鱼适配器不泄漏原始协议；
- S1-R1、S1-R2、S1-R3 完成独立评审；
- 通过后才进入阶段 2 数据模型与 API 契约设计。

## 11. 回滚方式

本阶段只有文档和决策变更，回滚方式为恢复最近一次通过的阶段 0 文档状态；不回滚或改写用户已确认的范围决策。任何后续代码切片必须独立提交，并在对应切片文档中记录回滚点。
