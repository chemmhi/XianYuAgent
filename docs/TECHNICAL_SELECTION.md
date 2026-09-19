# XianyuSellerAgent 技术选型文档

- 文档版本：v0.1
- 决策日期：2026-09-18
- 文档状态：技术基线已确认
- 关联需求：docs/PRD.md
- 关联原型：SellerAgent/

## 1. 选型结论

XianyuSellerAgent 采用 TypeScript 全栈、模块化单体和独立异步执行 Worker 的技术路线。

当前项目与旧项目完全解耦。旧项目只能作为闲鱼能力迁移时的历史参考，不作为运行时依赖、接口依赖、数据库依赖或代码包依赖。需要的闲鱼能力必须迁移到当前项目的 xianyu 模块中，由当前项目直接对接闲鱼平台。

本轮正式产品页面严格按照 PRD 的八个一级页面建设：

1. 仪表盘
2. Workspace
3. 账号管理
4. 在线聊天
5. 商品管理
6. 卡券管理
7. 订单管理
8. 设置

Knowledge、Review、Trace / Replay / Eval 不作为本轮页面和正式领域模块；Audit、Trace ID、Replay 所需的底层执行记录仍作为系统能力保留。

## 2. 总体技术栈

| 层级 | 选型 | 说明 |
| --- | --- | --- |
| 前端 | React + Vite + TypeScript | 延续当前高保真原型技术基础 |
| 前端数据层 | TanStack Query | 管理服务端数据、缓存、加载和失效 |
| 后端运行时 | Node.js 24 LTS | 与 TypeScript、Agent Runtime 和 Pi Adapter 保持一致 |
| 后端框架 | NestJS + Fastify | NestJS 提供模块和依赖注入，Fastify 负责 HTTP 适配 |
| API | REST /api/v1 | 面向页面和 Agent 提供稳定领域接口 |
| 实时通信 | WebSocket | 聊天、Agent Run、账号状态和 Outbox 事件 |
| 主数据库 | PostgreSQL 17+ | 事务、行级锁、唯一约束和 JSONB |
| 数据访问 | Drizzle ORM + 显式 SQL | 普通 CRUD 使用 ORM，库存、幂等和 Outbox 使用事务 SQL |
| 异步执行 | PostgreSQL Outbox + Worker | 保证业务事务和异步任务记录一致 |
| 缓存 | Redis | 会话、缓存、限流、在线状态和临时事件 |
| 文件存储 | S3 兼容对象存储 | 商品图片、视频和上传素材，开发环境可使用 MinIO |
| 凭证 | 数据库 CredentialStore | 直接存储在项目数据库，由管理员统一管理 |
| Agent | AgentRuntime + Pi Runtime Adapter | 业务层依赖抽象，不依赖 Pi 内部对象 |
| 模型 | ModelClient 抽象 | 支持 OpenAI-compatible Provider |
| 契约 | OpenAPI + JSON Schema | HTTP DTO、Manifest、Capability 输入输出可校验 |
| 日志 | Pino | 结构化日志，禁止记录系统凭证明文 |
| 可观测性 | OpenTelemetry | Trace、Metric、Log 关联 |
| 测试 | Vitest + Supertest + Playwright + Testcontainers | 覆盖单元、集成、跨层和真实用户流程 |
| 本地部署 | Docker Compose | API、Worker、PostgreSQL、Redis 和对象存储统一启动 |

## 3. 架构原则

### 3.1 当前项目独立实现

当前项目必须拥有自己的：

- 领域模型；
- 数据库和迁移脚本；
- HTTP API；
- 闲鱼平台客户端；
- 账号与凭证管理；
- Policy Gateway；
- Confirmation Card；
- Idempotency；
- Outbox Worker；
- Audit 和 Trace；
- Agent Runtime Adapter。

旧项目只用于迁移参考：

- 参考接口行为；
- 参考闲鱼协议和请求流程；
- 参考错误码和边界情况；
- 迁移已有能力和测试样例。

旧项目不进入运行时架构：

- 不调用旧项目 API；
- 不访问旧项目数据库；
- 不依赖旧项目代码包；
- 不复用旧项目内部字段作为当前领域模型；
- 不让 Agent、页面或 Worker 直接接触旧项目。

### 3.2 模块化单体优先

首期使用一个后端应用和一个 Worker 进程，后端内部按领域模块拆分。暂不引入微服务、Kafka 或 Kubernetes。

选择模块化单体的原因：

- 当前角色和业务边界集中；
- 库存、幂等、确认和 Outbox 需要强事务；
- 早期更关注领域契约和执行正确性；
- 保留未来拆分 Worker、聊天接入或 Agent Runtime 的空间。

### 3.3 闲鱼能力归入当前项目的 xianyu 模块

当前项目的调用链为：

~~~text
页面 / Agent
  -> 当前项目 API
  -> 当前项目领域服务
  -> 当前项目 xianyu 模块
  -> 闲鱼平台
~~~

xianyu 模块负责：

- 登录和会话；
- 请求签名；
- HTTP / WebSocket 接入；
- 商品、订单、聊天和媒体能力；
- 平台字段映射；
- 平台错误转换；
- 限流、重试和连接恢复。

领域服务不直接拼接闲鱼 URL、读取平台字段或处理平台原始错误码。

## 4. 后端模块划分

~~~text
apps/
  api/
  worker/

packages/
  contracts/
  config/
  shared/

modules/
  auth/
  accounts/
  xianyu/
    auth/
    signing/
    items/
    orders/
    chat/
    media/
  products/
  coupons/
  orders/
  conversations/
  agent/
  policy/
  confirmation/
  outbox/
  audit/
  settings/
~~~

### 4.1 领域模块职责

- auth：管理员登录、会话、注销、初始化和权限上下文。
- accounts：闲鱼账号、登录会话、在线状态、账号策略和当前工作账号。
- xianyu：当前项目自己的闲鱼平台客户端，不承载页面业务规则。
- products：商品、素材、规格、草稿、发布状态和商品配置。
- coupons：卡券批次、库存、绑定关系、交付范围和交付记录。
- orders：订单、支付状态、发货状态、售后状态和发货尝试。
- conversations：会话、消息、人工接管和聊天事件。
- agent：Session、Run、Step、ToolCall、SkillResult 和 Run Event。
- policy：Capability、权限、账号范围、风险等级和确认策略。
- confirmation：Confirmation Card、确认、取消、过期和重复确认。
- outbox：异步任务、重试、死信、取消和外部结果未知处理。
- audit：操作者、动作、目标、策略、幂等键、结果和 Trace 引用。
- settings：Agent、自动回复、自动发货、外部服务和运行参数。

## 5. NestJS + Fastify 选择

### 5.1 NestJS 的职责

NestJS 用于提供：

- Module 边界；
- Dependency Injection；
- Controller、Service、Guard、Interceptor；
- 统一异常和请求上下文；
- WebSocket Gateway；
- 测试模块和依赖替换。

### 5.2 Fastify 的职责

Fastify 作为 NestJS 的 HTTP Adapter，负责：

- HTTP 服务；
- JSON Schema 校验集成；
- 插件和底层 WebSocket 扩展；
- 低开销路由处理。

业务代码不得依赖 Fastify 的 request / reply 对象。需要用户、账号、Trace 和幂等信息时，统一从当前请求上下文读取。

### 5.3 不采用 Express 作为默认 Adapter

Express 不是不可用，但本项目需要 WebSocket、文件上传、Agent 流式事件和大量领域 API。统一采用 Fastify，避免后续再次更换 HTTP 底层。

## 6. API 与契约

### 6.1 API 结构

统一前缀：

~~~text
/api/v1
~~~

响应结构：

~~~json
{
  "success": true,
  "message": null,
  "data": {},
  "requestId": "req_xxx",
  "traceId": "trc_xxx"
}
~~~

写操作必须支持：

- idempotencyKey；
- 当前账号上下文；
- 权限和账号范围；
- requestId；
- traceId。

### 6.2 契约分层

~~~text
HTTP DTO
  -> Application Command / Query
  -> Domain Model
  -> Platform Adapter DTO
~~~

平台字段不能越过 Adapter 层进入页面或 Agent 契约。

### 6.3 Manifest

Manifest 只描述当前项目提供的业务能力：

- capabilityId；
- accessMode；
- version；
- inputSchema；
- outputSchema；
- riskLevel；
- requiresConfirmation；
- requiredPermissions；
- supportsStreaming；
- idempotencyStrategy。

Pi 原生 Skill 不重新注册到业务 Manifest。Skill 需要业务数据时，通过当前项目公开的 Capability 或领域 API 获取。

## 7. 数据库和数据访问

### 7.1 PostgreSQL

PostgreSQL 负责保存：

- 账号和授权会话摘要；
- 商品和素材引用；
- 卡券批次和库存；
- 订单和交付记录；
- 会话和消息；
- Agent Session、Run、Step；
- Policy 决策；
- Confirmation Card；
- Outbox；
- 幂等记录；
- Audit 事件。

### 7.2 Redis

Redis 只负责短期和高频状态：

- 管理员会话缓存；
- 登录进度缓存；
- 账号在线心跳；
- 请求限流；
- 热点查询缓存；
- WebSocket 连接索引。

Redis 不作为订单、库存、确认和 Outbox 的唯一事实来源。

### 7.3 Drizzle 与显式 SQL

- 普通列表和详情：Drizzle Repository；
- 库存扣减：事务 + 行级锁；
- 幂等写入：唯一索引 + 事务；
- Outbox 领取：显式 SQL + 行级锁；
- 状态迁移：条件更新，避免并发覆盖。

## 8. Outbox 和 Worker

业务写操作使用数据库事务：

~~~text
业务状态更新
  + Outbox Job
  + Idempotency Record
  + Audit Event
~~~

四者必须在同一个事务内完成。

Worker 负责：

- 领取 pending 任务；
- 执行当前项目的领域 Command；
- 调用当前项目的 xianyu 平台客户端；
- 处理超时、限流和可恢复错误；
- 记录重试次数；
- 转换为 succeeded、failed、dead_letter 或 cancelling；
- 发布标准化事件。

任务状态：

~~~text
pending
running
retrying
succeeded
failed
dead_letter
cancelling
cancelled
~~~

初期使用 PostgreSQL Outbox + Worker。未来如果吞吐增加，可以增加 Redis Streams 或独立消息队列，但不能移除数据库中的审计和幂等记录。

## 9. Agent 与 Pi Runtime

业务层只依赖：

~~~ts
interface AgentRuntime {
  createSession(input: CreateSessionInput): Promise<AgentSession>;
  run(input: RunInput): Promise<AgentRun>;
  stream(runId: string): AsyncIterable<RunEvent>;
  cancel(runId: string): Promise<void>;
  resume(runId: string): Promise<AgentRun>;
  installSkill(input: InstallSkillInput): Promise<SkillInstallation>;
  listSkills(input?: ListSkillsInput): Promise<SkillInfo[]>;
}
~~~

Pi 只实现 PiRuntimeAdapter。`installSkill` 和 `listSkills` 由 Runtime Adapter 对接 Pi 的原生 Skill 生命周期；业务层只依赖上述抽象，不依赖 Pi 内部对象。

Pi 不直接访问：

- 当前项目数据库；
- CredentialStore 原始接口；
- 闲鱼平台接口；
- Outbox 表；
- 其他内部模块。

Agent 的写动作必须走：

~~~text
Manifest Capability
  -> Policy Gateway
  -> Confirmation（如需要）
  -> Idempotency
  -> Outbox
  -> Worker
~~~

## 10. 权限、会话和凭证

### 10.1 管理员认证

管理后台使用：

- HttpOnly Cookie；
- Secure；
- SameSite=Lax 或更严格策略；
- 服务端会话；
- 登录、注销、失效和异常写入 Audit。

不把管理员长期 Token 写入 localStorage 作为生产方案。

### 10.2 CredentialStore

业务模块只依赖：

~~~ts
interface CredentialStore {
  create(input: CreateCredentialInput): Promise<CredentialRef>;
  read(ref: CredentialRef): Promise<CredentialValue>;
  update(ref: CredentialRef, input: UpdateCredentialInput): Promise<CredentialRef>;
  rotate(ref: CredentialRef): Promise<void>;
  revoke(ref: CredentialRef): Promise<void>;
}
~~~

CredentialStore 只负责 Cookie、Token、API Key、密码等系统凭证，直接落在项目数据库。卡券正文、夸克链接和提取码属于受控业务数据，由 `coupons` / 交付领域及其存储负责，不作为系统凭证写入 CredentialStore。

管理员拥有系统凭证的绝对管理权限，可以通过管理界面查看、编辑、替换、启停和操作。唯一硬边界是系统凭证不得进入闲鱼买家可见的消息、订单交付内容或外部买家可见响应。受控业务数据仍通过领域接口按 `deliveryScope` 和用途读取或交付。

## 11. WebSocket 和事件

统一事件结构：

~~~json
{
  "eventId": "evt_xxx",
  "type": "run.step.updated",
  "aggregateId": "run_xxx",
  "occurredAt": "2026-09-18T14:22:00Z",
  "traceId": "trc_xxx",
  "payload": {}
}
~~~

首期事件包括：

- chat.message.created；
- chat.connection.changed；
- run.updated；
- run.step.updated；
- confirmation.created；
- outbox.updated；
- account.connection.changed。

前端不根据按钮点击自行推断最终状态，以后端事件和查询结果为准。

## 12. 测试选型和验收边界

### 12.1 单元测试

覆盖：

- Policy 决策；
- Run / Step 状态机；
- 幂等键生成；
- 卡券库存扣减；
- 平台错误映射；
- DTO 和领域模型转换；
- Agent Capability 输入校验。

### 12.2 集成测试

覆盖：

- PostgreSQL 迁移；
- Outbox 领取和重试；
- Worker 执行；
- WebSocket 鉴权；
- CredentialStore；
- 当前项目的 xianyu 客户端。

### 12.3 端到端测试

至少覆盖：

1. 管理员登录；
2. 切换闲鱼账号；
3. 查询商品；
4. 生成商品发布 Confirmation Card；
5. 确认发布；
6. Outbox 执行；
7. 页面收到结果事件。

同时覆盖：

- 重复确认；
- Confirmation 过期；
- 取消；
- 失败重试；
- 部分成功；
- 外部结果未知；
- 库存不足；
- 账号登录失效。

## 13. 部署建议

### 13.1 本地开发

~~~text
Docker Compose
  ├── api
  ├── worker
  ├── postgres
  ├── redis
  └── minio
~~~

### 13.2 初期生产

- API 和 Worker 分开部署，但使用同一代码仓库；
- PostgreSQL 使用托管服务或独立高可用实例；
- Redis 用于缓存和连接状态；
- 对象存储使用 S3 兼容服务；
- 反向代理负责 HTTPS、WebSocket Upgrade 和静态资源；
- 日志和 Trace 统一输出到集中式观测系统。

### 13.3 暂不引入

- 微服务注册中心；
- Kafka；
- Kubernetes；
- 独立 Marketplace；
- 旧项目运行时代理；
- 旧项目数据库共享。

## 14. 技术风险和应对

| 风险 | 应对 |
| --- | --- |
| 闲鱼接口变化 | 所有平台逻辑集中在 xianyu 模块，并为关键能力建立契约测试 |
| 外部请求超时但结果未知 | 保留幂等键，先查询外部状态，再决定重试 |
| 卡券重复扣减 | PostgreSQL 事务、行级锁和唯一交付记录 |
| Agent 输出错误参数 | Manifest JSON Schema、Policy 校验和领域 Command 校验三层防护 |
| WebSocket 断线 | 事件 ID、断线重连、重新拉取 Run / Message 状态 |
| 凭证泄露 | 数据库存储，管理员绝对管理；买家可见链路禁止返回系统凭证 |
| 单体变大 | 维持模块边界，优先拆 Worker，再考虑拆独立服务 |

## 15. 实施顺序

1. 建立 NestJS + Fastify 后端骨架和 monorepo contracts 包。
2. 建立 PostgreSQL 迁移、认证和管理员会话。
3. 实现当前项目自己的 xianyu 基础客户端。
4. 迁移账号、商品、卡券、订单和聊天能力。
5. 建立 WebSocket 事件网关。
6. 建立 Policy、Confirmation、Idempotency 和 Outbox。
7. 建立 AgentRuntime 抽象和 Pi Adapter。
8. 接入 Workspace 的查询、上传、生成、发布和发货任务。
9. 补齐集成测试和端到端验收链路。

## 16. 未决事项

以下事项不影响当前技术基线，但在正式实施前需要确认：

- 闲鱼接入所需的登录、签名和 WebSocket 协议可复现条件；
- 对象存储使用云 S3、MinIO 还是现有文件服务。

已确认的启动阶段决策：

- Pi Runtime 采用独立服务；
- 首期生产允许使用 Docker Compose；
- CredentialStore 直接存储在项目数据库，管理员拥有绝对管理权限，系统凭证不得暴露给闲鱼买家；
- 阶段 0 仅锁定范围，不提前开发真实后端。
