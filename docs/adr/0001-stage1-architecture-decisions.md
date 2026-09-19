# ADR-0001 阶段 1 核心架构决策

- 日期：2026-09-19
- 状态：ACCEPTED（阶段 1 复核通过，2026-09-19）
- 关联文档：docs/01-architecture.md、docs/TECHNICAL_SELECTION.md

## ADR-001：模块化单体 + 独立 Worker

### 决策

首期后端采用一个模块化单体 API 和一个独立异步 Worker。领域模块在同一代码仓库中按职责拆分，外部平台和基础设施通过接口适配。

### 原因

- 账号、商品、卡券、订单和执行记录需要事务一致性；
- 当前只有管理员角色，业务规模不足以支持微服务拆分成本；
- Worker 可以隔离外部平台调用、重试和长任务；
- 后续可独立拆分聊天接入、Agent Runtime 或平台适配器。

### 约束

- 页面不直接调用 Worker；
- Worker 不直接持有页面状态；
- 所有异步动作通过 Outbox 和幂等键进入 Worker。

## ADR-002：Pi Runtime 使用独立服务

### 决策

业务 API 和 Worker 只依赖 `AgentRuntime` / `PiRuntimeAdapter` 接口，Pi Runtime 作为独立服务部署，不以内嵌对象或同进程包形式暴露给业务模块。

### 原因

- 独立服务提供故障隔离和独立扩缩容边界；
- 避免 Pi 内部对象污染领域模块；
- 便于替换运行时和执行策略。

### 验证要求

- 阶段 1 完成最小健康检查、请求超时、服务不可用和重试边界验证；
- 阶段 5 前补真实 Agent Run 集成测试。

## ADR-003：CredentialStore 直接数据库存储，管理员直管理

### 决策

CredentialStore 提供最小接口：`create`、`read`、`update`、`rotate`、`revoke`，数据直接存储在项目数据库。管理员可以查看、编辑、替换、启停和操作系统凭证。

### 硬边界

- 系统凭证不得进入闲鱼买家可见消息、订单交付内容或外部买家可见响应；
- 业务模块通过 CredentialStore 接口访问数据库存储；
- 当前原型的 `localStorage.auth_token` 仅作为阶段 0/原型例外，不得进入真实生产实现。

## ADR-004：生产鉴权使用服务端会话

### 决策

真实后端使用服务端会话和 HttpOnly Cookie，并启用 Secure、SameSite 和注销失效机制。前端不把管理员长期 Token 写入 localStorage。

### 迁移

- 阶段 1 定义会话、登录、注销、失效和跨账号上下文边界；
- 阶段 2 补鉴权 API、错误结构、权限模型和 E2E；
- 原型 `localStorage.auth_token` 在真实 API 接入前移除。
- 不采用生产双轨认证；原型 token 只在 mock / liveApi 原型模式存在；
- 服务端会话负责管理员账号范围，前端不得用持久化字段覆盖或扩大账号范围；
- 阶段 2 验证未认证、会话过期、注销失效、管理员禁用和跨账号访问拒绝。

### 鉴权迁移验收条件

- 登录成功后由服务端创建会话，浏览器只保存 `HttpOnly` Cookie，不再保存长期 Token；
- Cookie 在生产启用 `Secure` 和明确的 `SameSite` 策略；
- 注销、管理员禁用、会话过期和密码变更都会使服务端会话失效；
- 每次请求由服务端解析管理员身份和账号范围，前端不能自行声明当前管理员或账号范围；
- 账号切换只改变服务端上下文，不复制或暴露闲鱼系统凭证；
- 阶段 2 必须补登录成功、未登录、过期、注销失效、跨账号越权和刷新恢复的集成/E2E。

## ADR-005：首期生产允许 Docker Compose

### 决策

首期生产允许使用 Docker Compose 编排 API、Worker、PostgreSQL、Redis、S3 兼容对象存储和 Pi Runtime。

### 后置要求

- 阶段 7 完成健康检查、备份、告警和资源限制；
- 阶段 8 完成新环境部署演练、迁移顺序和回滚演练；
- 不把 Compose 作为放弃监控、备份或回滚的理由。

## ADR-006：Pi Runtime 内部协议与故障边界

### 决策

- API / Worker 与 Pi Runtime 使用仅限内网的 HTTP + JSON v1 接口；浏览器和买家链路不可直连；
- 每次调用必须携带 `requestId`、`runId`、`idempotencyKey` 和协议版本；返回 `accepted`、`running`、`succeeded`、`failed`、`cancelled` 或 `unknown` 状态；
- 服务间使用独立服务凭证鉴权，凭证只由服务端配置和 CredentialStore 管理，不进入前端或买家响应；
- Pi Runtime 提供 `/healthz`、`/readyz` 和能力版本信息；业务 API 不依赖 Pi 内部对象或数据库；
- 默认连接超时 5 秒、请求超时 60 秒、心跳 15 秒；最多 3 次指数退避重试，达到上限进入 `unknown` / `dead_letter`，取消操作按 `runId` 幂等处理；
- Runtime 不可用或网络超时属于可重试错误；协议版本、鉴权和参数校验错误属于不可重试错误。

### 验证要求

- 阶段 1 记录健康检查、超时、不可用、重复 `idempotencyKey`、取消和版本不兼容的最小验证结果；
- 阶段 5 补真实 Agent Run 集成测试和故障恢复测试。

## ADR-007：闲鱼适配器隔离与 Worker 承载边界

### 决策

- 所有闲鱼 HTTP / WebSocket 调用都经过 `xianyu-adapter`；页面、Workspace 和其他领域模块不得直接调用平台协议；
- 查询请求由领域 Query Service 调用 adapter 并返回领域模型；发布、发货、发消息、登录续期等写动作只能由 Worker 消费 Outbox 后调用 adapter；
- adapter 是 CredentialStore 的唯一系统凭证消费者，领域模块只传递账号引用和领域命令，不接触 Cookie、Token、签名原文；
- adapter 负责登录会话、签名、HTTP/WS 生命周期、字段映射和平台错误归一化，统一输出 `retryable`、`non_retryable`、`unknown`；
- 外部结果未知时，Worker 必须先按原幂等键查询外部状态，再决定重试、取消或进入人工处理，不得盲目重复写入。

### 验证要求

- 阶段 1 固化接口、错误映射、查询/写入承载边界和凭证不可泄露约束；
- 阶段 5 前完成登录、签名、WebSocket、未知结果、重试和重复写入的协议探针与集成测试。

## 待评审问题

1. S1-R1 是否逐项确认 PRD -> 模块 -> 数据所有权 -> 接口映射；
2. S1-R2 是否批准 ADR-001/002/006/007 的依赖、协议和故障边界；
3. S1-R3 是否批准 ADR-004 的鉴权迁移与 R-011 的实现前风险保留。
