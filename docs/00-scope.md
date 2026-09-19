# XianyuSellerAgent 项目启动与范围锁定

- 文档版本：v0.1
- 更新日期：2026-09-19
- 当前阶段：阶段 0——项目启动与范围锁定
- 当前状态：待独立评审
- 关联文档：docs/PRD.md、docs/TECHNICAL_SELECTION.md、docs/DEVELOPMENT_WORKFLOW_AND_STANDARDS.md

## 1. 文档目的

本文件把 PRD 和技术选型中的内容收敛为阶段 0 可审计的范围基线，明确本轮要做什么、暂不做什么、谁可以做什么、哪些状态必须被支持，以及后续如何用测试证据验收。

阶段 0 只允许补充范围、假设和验收标准；在本文件通过阶段 0 门禁前，不开始系统架构、数据模型、API 设计或业务编码。

## 2. 当前基线

### 2.1 已有输入

- docs/PRD.md：产品目标、非目标、核心流程、页面需求、接口原则、Agent 闸门、领域实体和验收标准。
- docs/TECHNICAL_SELECTION.md：TypeScript 全栈、React + Vite、NestJS + Fastify、PostgreSQL、Redis、Outbox、AgentRuntime + Pi Adapter 等技术基线。
- SellerAgent/：React + Vite + TypeScript 高保真原型，作为页面结构、信息密度和交互基线；当前仅使用 mock/live API 门面。
- xianyu-admin-design-style/：设计 token、图标和组件设计参考。

### 2.2 尚不存在的交付物

- 后端 apps/api、apps/worker 和业务模块目录；
- PostgreSQL 迁移、Redis、对象存储和 Docker Compose；
- 当前项目自己的 xianyu 平台适配器；
- OpenAPI / JSON Schema 契约、真实鉴权、Policy、Confirmation、Idempotency、Outbox 和 Agent Runtime；
- 集成测试、端到端测试、视觉回归基线和部署演练。

现有原型的构建与 mock API 契约测试可以作为启动阶段的环境证据，但不能替代后续真实链路验收。

## 3. 产品目标

### 3.1 本项目目标

1. 迁移账号、商品、卡券、订单和聊天五类核心能力。
2. 保持当前高保真控制台的页面结构、信息架构和操作密度。
3. 让 Workspace 能发起查询、生成、上传、发布和发货任务。
4. 通过 AgentRuntime 抽象隔离 Pi，使 Pi 成为可替换运行时适配器。
5. 让所有业务写动作经过 Policy Gateway；需要人工确认的动作生成 Confirmation Card，随后进入 Outbox。
6. 将系统凭证与受控业务数据分离：Cookie、Token、密码和 API Key 由管理员通过后端管理界面查看、编辑和操作；卡券正文、夸克链接和提取码通过受控领域接口按授权读取和交付，系统凭证不得暴露给闲鱼买家。

### 3.2 成功标准

阶段 0 的成功不是“功能已完成”，而是以下范围锁定结果可被复核：

- 每个 P0 核心用户旅程都有目标、参与者、前置条件、成功结果、失败结果和可验证验收标准；
- 非目标和暂不实现内容已明确；
- 当前唯一角色为管理员，动作权限与页面可见性分离；
- Run、Step、Confirmation、Outbox 的关键状态和禁止转移已登记；
- 技术、运行环境、外部依赖和未决决策已区分为“已确认”或“假设 / 风险”；
- 当前原型、设计 token、目标 viewport 和缺失设计输入已登记；
- P0 阻塞项为 0，P1 风险均有负责人、缓解方式和进入实现前的验证条件。

## 4. 范围

### 4.1 本阶段锁定的产品范围

正式产品包含八个一级页面：

| 页面 | P0 责任 | 关键结果 |
| --- | --- | --- |
| 仪表盘 | KPI、趋势、异常队列、快捷任务 | 能发现登录失效、发货失败、库存不足和待确认动作 |
| Workspace | 自然语言任务、Run、Step、确认和结果 | 能查询业务数据并跟踪受控写动作 |
| 账号管理 | 登录、状态、切换、授权和策略 | 能添加账号、看到登录 / 连接状态并切换当前账号 |
| 在线聊天 | 会话、消息、人工接管 | 能加载会话、接收实时消息、发送文本 / 图片并标记风险 |
| 商品管理 | 草稿、素材、规格和发布 | 能查询、编辑、上传素材、保存草稿并发起发布 |
| 卡券管理 | 批次、库存、绑定和交付 | 能生成批次、查看受控正文、绑定商品和执行交付 |
| 订单管理 | 查询、详情、发货和失败重试 | 能执行人工发货并看到失败原因与可重试状态 |
| 设置 | Agent、策略、凭证、运行参数 | 能查看并维护受控运行配置 |

### 4.2 明确非目标

- 不复制 xianyu-auto-reply 的完整后台、推广、分销、广告和管理员体系；
- 不让业务页面直接依赖 Pi API、闲鱼原始接口、旧项目数据库或旧项目 API wrapper；
- 不在本阶段改动 SellerAgent/ 的高保真页面结构和视觉方案；
- 不实现通用 Marketplace；Pi Skill 走 Pi 原生安装、启用和调用机制；
- 不在没有阶段门禁证据的情况下提前做大规模后端、数据库或前端联调。

## 5. 角色、权限和边界

### 5.1 角色

当前版本仅支持一个业务角色：管理员。

| 角色 | 允许范围 |
| --- | --- |
| 管理员 | 访问八个产品页面，管理账号、商品、卡券、订单、聊天、Workspace、设置和高风险确认 |
| Agent Runtime | 不是后台角色；只能通过 Manifest / 领域 API 读取，或通过 Policy → Confirmation（如需要）→ Idempotency → Outbox 发起写动作 |
| 闲鱼 / 外部服务 | 外部依赖，不属于本系统授权角色；所有访问由当前项目适配器和领域服务封装 |

### 5.2 权限不变量

- 页面可见不等于动作可执行；查看订单不自动授予发货权限。
- 账号级数据必须按管理员账号范围过滤。
- 高风险动作至少同时通过 capability + account_scope + permission + policy。
- 系统凭证允许管理员在管理界面查看、编辑和操作；CredentialStore 只负责后端存取，不限制管理员的内部管理动作。
- 卡券正文、夸克链接和提取码属于受控业务数据；只有在 `deliveryScope=buyer_deliverable`、订单已支付、商品与账号匹配、策略校验通过、审计记录已写入且管理员会话有效时，才能交付买家。
- 系统凭证不得出现在闲鱼买家可见的消息、订单交付内容或外部买家可见响应中；管理员内部管理链路不再额外要求脱敏、二次确认或超时隐藏。

## 6. 核心用户旅程与验收标准

| 编号 | 用户旅程 | 成功验收 | 关键失败 / 边界验收 | 后续证据 |
| --- | --- | --- | --- | --- |
| J-01 | 添加并启用账号 | 管理员可选择二维码、密码或导入 Cookie；登录成功后创建账号记录并看到启用 / 连接状态 | 扫码等待、已扫码、过期、失败、登录失效、凭证缺失均有可见状态；管理员可查看和编辑凭证，闲鱼买家不可见 | API 集成测试、账号状态 E2E、审计记录 |
| J-02 | 商品草稿与发布 | 可创建 / 编辑草稿、上传素材、保存本地校验结果，并生成发布预览 | 素材解析失败、校验失败、重复发布、外部超时 / 结果未知、部分成功可恢复 | 契约测试、Outbox 集成测试、发布 E2E、视觉证据 |
| J-03 | 卡券生成与绑定 | 可生成批次、查看库存和受控正文、绑定商品，并形成交付记录 | 库存不足、重复扣减、无权限读取、批次作废、内容引用失效有明确错误 | 库存事务测试、权限测试、交付 E2E |
| J-04 | 订单查询与发货 | 可筛选订单、查看详情、执行人工 / 免物流 / 只发卡券并看到最终状态 | 登录失效、库存不足、发货失败、重复发货、外部结果未知可重试且不重复执行 | 领域单测、Outbox 集成、发货 E2E |
| J-05 | 在线聊天与人工接管 | 可加载会话和历史消息，接收 WebSocket 事件，发送文本 / 图片并看到发送结果 | 断线重连、发送失败、退款 / 投诉 / 凭证请求 / Prompt Injection 进入待人工 | WebSocket 集成、聊天 E2E、异常回归 |
| J-06 | Workspace 查询与写任务 | Agent 可通过 Manifest 读取业务数据；写动作按策略直接执行或等待确认后进入 Outbox | Confirmation 过期、取消、重复确认、失败重试、部分成功、结果未知和越权调用均被拦截或可恢复 | Policy / 状态机单测、Agent API 集成、Workspace E2E |

### 6.1 Workspace 状态基线

RunStatus：queued → running → waiting_confirmation / executing → succeeded。

异常分支必须支持：retrying、cancelling、partially_succeeded、failed、cancelled、expired。

- Confirmation 过期后必须是 expired，不得自动执行；
- 取消在外部动作已投递且结果未知时，必须先查询原幂等键对应的外部状态；
- 重试只处理失败或结果未知的 Step，成功 Step 不得重放；
- 同一幂等键重复确认必须返回原结果，不得重复调用外部接口。

### 6.2 Outbox 状态基线

pending、running、retrying、succeeded、failed、dead_letter、cancelling、cancelled。

进入 dead_letter 后不得自动重放；管理员恢复或重试前必须使用原业务幂等键并先查询外部状态。

### 6.3 工程验收基线

| 编号 | 工程约束 | 阶段性验收 |
| --- | --- | --- |
| E-01 | 页面层不直接依赖旧项目 API wrapper 或闲鱼原始字段 | 代码扫描确认领域契约隔离；页面只依赖当前项目契约 |
| E-02 | mockApi 与 liveApi 使用同一套领域契约 | 契约测试覆盖同一请求 / 响应结构，切换模式不改变页面类型 |
| E-03 | 外部写动作必须经过 Policy、Audit、Idempotency 和 Outbox | 集成测试证明重复请求不重复发布、发货、扣库存或发消息 |
| E-04 | 系统凭证仅对管理员开放，不得进入闲鱼买家可见链路 | 安全测试确认买家消息、订单交付和外部响应不含系统凭证 |
| E-05 | SellerAgent 高保真页面作为验收基线，不在本阶段改动 | git diff 和视觉基线记录证明原型未被范围外修改 |

## 7. 技术、环境与外部依赖

### 7.1 已确认基线

- 前端：React + Vite + TypeScript；
- 后端：Node.js 24 LTS、NestJS + Fastify；
- API：REST /api/v1，事件使用 WebSocket；
- 数据：PostgreSQL 17+ 为事实来源，Redis 只负责短期状态和缓存；
- 异步：PostgreSQL Outbox + 独立 Worker；
- 对象存储：S3 兼容接口，开发环境可使用 MinIO；
- 契约：OpenAPI + JSON Schema；
- 测试：Vitest、Supertest、Playwright、Testcontainers；
- 本地编排：Docker Compose。

### 7.2 当前假设 / 已决策待验证项

| 编号 | 假设或未决项 | 影响 | 进入实现前的验证 |
| --- | --- | --- | --- |
| A-01 | CredentialStore 直接存储在项目数据库，管理员拥有绝对管理权限 | 影响数据库字段、备份和后续轮换设计 | 阶段 7 前补基础备份与迁移说明 |
| A-02 | 闲鱼登录、签名和 WebSocket 协议由 xianyu-adapter 隔离，写动作由 Worker 承载；协议可复现性仍待验证 | 影响外部集成和首个真实切片 | 阶段 5 协议探针、契约测试和真实凭证验证 |
| A-03 | 对象存储采用云 S3、MinIO 或现有文件服务尚未确定 | 影响上传链路和部署 | 阶段 1 / 2 前确定兼容策略 |
| A-04 | Pi Runtime 已确认采用独立服务，ADR 已固化，最小运行验证待后续阶段完成 | 影响 AgentRuntime 生命周期、故障隔离和发布拓扑 | 阶段 5 Runtime 健康、超时、重试和取消验证 |
| A-05 | 首期生产已确认允许 Docker Compose，待演练 | 影响发布和回滚方式 | 阶段 7 前完成部署、健康检查和回滚演练 |
| A-06 | SellerAgent 原型 liveApi 当前读取 `localStorage.auth_token`，仅作为原型例外；生产采用服务端会话 + HttpOnly Cookie | 影响真实鉴权安全和会话生命周期 | 阶段 2/5 完成真实鉴权集成、E2E 和安全复核 |

上述项均已显式列为假设，不作为阶段 0 的 P0 阻塞；但在对应阶段前未关闭时，不得进入相关实现。

## 8. 设计输入与视觉基线

- 基线实现：SellerAgent/ 当前 React 原型；
- 设计资源：xianyu-admin-design-style/assets/design-tokens.json、icon-symbols.svg 和组件参考文档；
- 已知目标尺寸：README 中登记了桌面控制台和 390px 移动端构图；桌面精确 viewport 需在阶段 3 前固定；
- 视觉基线决策：已确认以 SellerAgent 原型和 xianyu-admin-design-style design token 作为临时视觉基线；阶段 3 仍需固定桌面 viewport 和状态验收清单。
- 原型范围决策：knowledge、review 入口直接从原型代码中删除，不保留为隐藏、归档或内部入口。

详细登记见 docs/07-visual-acceptance.md。

## 9. 阶段 0 门禁自检

| 门禁项 | 结果 | 证据 / 说明 |
| --- | --- | --- |
| 每个核心需求有可验证验收标准 | PASS | 本文 J-01 至 J-06 已建立需求 → 验收 → 证据映射 |
| 非目标明确 | PASS | 本文 4.2 与 PRD 1.2 一致 |
| 角色、权限、状态无未标记歧义 | PASS | 本文 5、6；未决项进入 A-01 至 A-06 |
| 技术、环境、外部依赖已确认或列为假设 | PASS | 本文 7；缺失项已显式列为假设或后续阶段风险 |
| 设计输入已取得，缺失项已列出 | PASS | 本文 8 与 docs/07-visual-acceptance.md |
| P0 阻塞项为 0 | PASS | 当前没有确认的 P0；P1 风险转对应阶段前置条件 |

阶段状态只有在 docs/05-review-log.md 的必需评审全部关闭后，才可由 STATUS.md 更新为 PASS。
