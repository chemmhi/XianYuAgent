# XianyuSellerAgent 长期决策记录

- 记录日期：2026-09-19
- 用途：保存用户已确认、后续默认沿用的范围、架构、安全和阶段门禁决策，避免重复询问。

## 已确认决策

1. 阶段 0 只锁定产品范围、非目标、角色、交付边界和验收标准，不提前开发真实后端、数据库、API 或 Docker Compose。
2. SellerAgent 原型与 design token 作为阶段 3 前的临时视觉基线，不要求补正式 Figma 文件作为当前前置条件。
3. `knowledge`、`review` 入口直接删除，不保留隐藏、归档或内部入口。
4. Pi Runtime 采用独立服务；业务 API 与 Worker 只依赖 `AgentRuntime` / `PiRuntimeAdapter` 抽象接口。
5. 首期生产允许使用 Docker Compose；健康检查、备份、迁移、监控和回滚在阶段 7/8 验证。
6. 闲鱼协议与凭证当前项目尚未实现，只参考 PRD 中提到的参考项目；真实适配器和可复现验证放后续阶段。

7. 参考项目 `http://localhost:9000/accounts` 的人工复核必须在当前已经打开且已登录闲鱼的 Chrome 窗口中进行，以复用既有浏览器 Cookie / Local Storage；新建 Chrome profile、无痕窗口、headless 或其他浏览器实例均不作为登录态证据。
7. CredentialStore 直接存项目数据库。管理员拥有绝对管理权限，可查看、编辑、替换、启停、轮换、撤销和操作系统凭证；唯一硬边界是不得暴露给闲鱼买家。
8. 系统凭证不得进入闲鱼买家可见消息、订单交付内容、外部买家响应、日志、Trace、Replay 或 Prompt。
9. 卡券正文、夸克链接和提取码只有在 `buyer_deliverable`、订单已支付、商品与账号匹配、策略校验通过、库存成功锁定并记录审计后，才可交付买家。

## 阶段 1 结论

- 阶段 1 架构门禁：PASS。
- S1-R1、S1-R2、S1-R3：PASS。
- S1-I004（四环境拓扑、网络隔离、回滚边界）接受为 P2 跟进项，不作为阶段 1 硬门禁。
- 原型 `localStorage.auth_token` 是阶段 0/原型例外；生产必须迁移到服务端 Session + HttpOnly Cookie，并在 R-011 对应阶段验证。

## 阶段 2 裁决与完成结论

2026-09-19，用户确认 S2-I001 至 S2-I005 全部接受，结论如下：

1. `unknown` 仅作为 `externalOutcome`，不新增 OutboxStatus。
2. 幂等作用域为 `adminId + accountId + route + Idempotency-Key`，默认保留 30 天；同指纹重放原 envelope，不重复扣库存、发货、发布或发消息；同 key 不同指纹返回 `IDEMPOTENCY_CONFLICT`。
3. 鉴权基线为 `SameSite=Lax`、`X-CSRF-Token` 双提交、WebSocket Origin allowlist、Session 空闲 30 分钟/绝对 8 小时；登录和密码变更后轮换 Session。
4. `system_only / operator_only / buyer_deliverable`、卡券正文读取、交付预览和订单交付 API 纳入阶段 2 契约。
5. CredentialStore CRUD、rotate、revoke、enable、disable 纳入阶段 2 契约；管理员绝对管理，但不得向闲鱼买家暴露。

阶段 2 已补齐并冻结：

- 独立数据库表设计文档 `docs/02-database-schema.md`，覆盖 PostgreSQL 表清单、字段类型、默认值、PK/FK、唯一/部分唯一索引、跨表约束、迁移顺序和回滚边界；
- AccountLoginSession 实体与登录会话 API；
- Order 的 payment/order/delivery/after-sales 分离状态与转移；
- Run、Step、Confirmation、Outbox 的完整多步骤、重试、取消、部分成功和 expired 状态；
- 字段级 schema、PK/FK、唯一索引、空值/默认值、审计字段、版本并发控制和生命周期约束；
- 统一响应 envelope、HTTP 状态码、分页、错误码、幂等指纹与冲突语义；
- 商品同步/素材全生命周期/批量发布，卡券素材与批量操作，账号权限，Runtime/Outbox，Settings Policy Gateway 与外部服务契约；
- `system_only / operator_only / buyer_deliverable` 的正文读取、交付预览、订单交付和脱敏审计边界。

阶段 2 评审结论：S2-R1、S2-R2、S2-R3 均 PASS；阶段状态更新为 PASS，允许进入阶段 3 前端设计契约。

## 阶段 3 决策与完成结论

2026-09-19，阶段 3 前端设计契约完成并通过独立复核：

1. 正式一级页面冻结为 8 个：`dashboard`、`workspace`、`accounts`、`messages`、`products`、`coupons`、`orders`、`settings`；不存在 `knowledge` / `review` 一级入口。
2. 生产 canonical path 冻结为 `/dashboard`、`/workspace`、`/accounts`、`/messages`、`/products`、`/coupons`、`/orders`、`/settings`，认证路径为 `/login` 与 `/first-run`。
3. 桌面目标 viewport 固定为 1440×900，移动目标 viewport 固定为 390×844；SellerAgent 原型和 design token 继续作为临时视觉基线。
4. 页面状态统一覆盖 loading、success、empty、error、未登录、403、disabled、submitting，并补充 timeout、conflict、reconnect、unknown 等适用状态。
5. 前端只调用 `/api/v1` 领域 API；高风险写动作遵循 Policy → Confirmation → Idempotency → Outbox，前端不得直接修改服务端状态或访问 Pi/闲鱼原始接口。

阶段 3 评审结论：S3-R1、S3-R2、S3-R3、S3-R4 均 PASS；阶段状态更新为 PASS，允许进入阶段 4 迭代计划与纵向切片编排。

## 阶段 3 门禁重新打开

2026-09-19，经组件职责复核，用户裁决阶段 3 门禁未通过，原因不是页面数量不足，而是组件边界、数据流和 API 适配尚未达到可执行细节：

1. 拒绝超级组件；目标设计不得把路由、业务动作、全局反馈和 DOM click capture 集中到单一组件，源码实现留到后续阶段。
2. 每个页面必须明确 Container、Controller、canonical ViewModel、View、StateBoundary 和 typed commands。
3. 组件必须明确数据来源、状态持有者、缓存失效范围、错误处理和路由/API 映射。
4. `Settings`、`Workspace`、`Auth`、`ProductEditor` 等宽职责组件必须拆分为独立模块；移动端 Products/Coupons/Orders 不得回退 Dashboard。
5. 阶段 3 在 `docs/03-component-contract.md` §9 设计 DoD 完成并经独立设计复审前保持 `REOPENED / DESIGN REVIEW`，不得进入阶段 4 执行门禁。

## 阶段 3 范围澄清

2026-09-19，用户进一步明确：

1. 当前阶段只进行前端组件设计，不进行具体编码。
2. 高保真原型图只作为视觉和交互参考，不作为组件拆分依据。
3. 现有源码不作为当前组件设计的证据，也不以源码现状判定阶段 3 设计门禁。
4. 阶段 3 门禁只审设计契约：组件职责、Container/Controller/ViewModel/View/StateBoundary、数据流、路由/API、错误码、8×2 页面矩阵和设计级反超级组件规则。
5. 源码拆分、API façade 实现、移动端页面编码和真实联调均后置到后续实现阶段。

因此，S3-R5 的源码实现审计不再作为当前阶段 3 设计门禁结论；阶段 3 当前状态为 `REOPENED / DESIGN REVIEW`，等待设计契约独立复审。

## 阶段 3 契约同步结论

2026-09-19，针对阶段 3 复审发现的跨文档命名漂移，采用以下唯一 canonical contract，不再保留平行路径：

1. FirstRun 初始化使用 `GET /api/v1/auth/session` 返回 `bootstrapRequired`，写入使用 `POST /api/v1/auth/bootstrap`。
2. 消息人工接管使用 `POST /api/v1/conversations/{id}/handoff`，恢复 AI 使用 `POST /api/v1/conversations/{id}/release`。
3. 请求/响应类型统一为 `BootstrapAdminInput/Output`、`HandoffConversationInput`、`ReleaseConversationInput`、`ConversationHandlingOutput`；会话状态统一使用 `handlingMode`，乐观并发字段统一使用 `expectedVersion`。
4. `docs/03-component-contract.md` 已补齐字段级 ViewModel、逐条 method/path catalog、queryKey/invalidation/recovery matrix，并明确 Settings route 下 profile/sessions/password 由 auth controller 唯一持有。

该同步属于设计契约收敛，不改变用户已接受的产品范围、交付数据边界或“阶段 3 只设计不编码”的边界；后续独立设计复审已于 2026-09-19 通过，详见下节。

## 阶段 3 独立设计复审通过

2026-09-19，`feature_coverage_review` 完成最终只读复审并给出 `PASS`：

1. `RunActionBar` 改为 `onRecoverOutbox(RecoverOutboxRequest)`，并与阶段 2 的 Outbox recover API 对齐；不再保留未定义的 `RecoverRunRequest`。
2. `RuntimePanel` 与 `OutboxPanel` 已拆分为不同 owner、controller、query、mutation state 和保存入口，禁止跨域合并。
3. 组件职责矩阵、canonical ViewModel、8×2 页面矩阵、QR/account detail API、queryKey 账号隔离、ControllerResult、canonical error map、`stockAlert`/`inventoryStatus` 均已复核通过。
4. 阶段 3 门禁由 `REOPENED / DESIGN REVIEW` 更新为 `PASS`，允许进入阶段 4 迭代计划与纵向切片编排；阶段 3 不包含具体编码。

## 阶段 4 主体功能优先决策

2026-09-19，进入阶段 4 后确定主体功能优先于运营和辅助页面，阶段 5 按独立纵向切片执行：

1. `S4-VS1`：账号管理，覆盖登录态、账号列表/详情、QR 扫码会话、账号授权会话、连接刷新、scope 和最小 CredentialRef 管理。
2. `S4-VS2`：商品管理，覆盖商品草稿、基础信息、SKU、素材、同步/拉取契约和 Policy → Confirmation → Idempotency → Outbox 发布链路。
3. `S4-VS3`：卡券首页 / 批次与库存，覆盖批次列表、库存、`stockAlert`、导入/批量编辑、绑定关系、作废和管理员受控正文预览。
4. `S4-VS4`：订单列表、详情与交付，覆盖四套状态、筛选/刷新、交付预览、manual/no_logistics/coupon_only/mixed、取消、重试、DeliveryRecord 和审计。
5. Dashboard、Messages、Workspace/Agent、Settings 扩展后置，不得抢占前四个主体切片；ENV-0 的执行基础、最小审计、幂等和 adapter 探针必须在 S4-VS1 前完成或明确阻断。
6. 阶段 4 只输出计划、依赖、DoD、风险、测试范围、视觉基线和回滚动作；阶段 5 才开始真实代码。每个切片完成后必须更新状态/评审/风险/决策记录并使用中文 Conventional Commit。

该优先级不改变既有产品范围和交付数据边界，只冻结实现顺序与门禁要求。

## 长期执行规则

- 已确认的决策不重复询问；只有出现越权、泄密、不可回滚、库存重复扣减或核心链路不可用等新高风险证据时，才重新发起人工裁决。
- 每个阶段完成后必须：更新 `STATUS.md`、评审记录、风险登记和本日志；运行适用验证命令；使用中文 Conventional Commit 提交；将 commit hash 写回 `STATUS.md` 和本日志。

## 阶段 5 启动与 ENV-0 执行记录

2026-09-19，按用户确认的“主体功能优先、继续执行、每个阶段提交并回写长期记忆”规则，开始阶段 5：

1. 先实现 ENV-0 最小真实运行骨架：`apps/api/` Node API、独立 Worker、统一 envelope、HttpOnly Session + CSRF 双提交、幂等记录、账号范围、最小审计和 Memory/Postgres store。
2. 保留阶段 2 逻辑迁移编号，仅落地账号首片与 execution/observability foundation；未实现的 Credential/Catalog/Coupon/Order 迁移继续后置，不创建空表伪实现。
3. S4-VS1 前端首片只接账号只读列表，使用独立 `features/accounts` 领域模块和 canonical API adapter；高保真原型只作为视觉基线，不作为组件拆分依据。
4. 真实跨层内存验证已经通过；Compose 文件解析通过，但 Docker Desktop Linux engine 未启动，容器级验证必须在环境恢复后补跑。

本轮阶段 5 记录与代码提交已完成：`65b48d6`（feat(阶段5): 接通账号真实读取链路与ENV0部署骨架）。

## S4-VS3 实现与人工审核决策（2026-09-19）

1. 卡券首页在独立 worktree `F:\ChenHai\Project\XianYuAgent-s4-vs3`、分支 `feature/s4-vs3-coupons` 并行开发，不触碰主工作树中的 S4-VS2 未提交改动。
2. 旧参考项目仅提供字段与操作参考：列表列、详情抽屉、创建/编辑/复制、商品绑定、启停、删除、正文预览/复制、双栏关联和图片原图预览；表格视觉、颜色、密度和响应式行为继续遵循当前平台壳样式。
3. canonical coupons batch 只接受 `purpose=text/data/api/image`；metadata 通过 `013_coupons.sql` + `014_coupon_card_metadata.sql` 持久化，列表只返回安全摘要，详情才返回正文/API/图片配置。
4. 首批库存由前端 `createBatch` 先创建批次，再调用 `/items/import` 并重新读取详情；列表 `keyword`、`stockAlert`、`purpose` 由 API、MemoryStore、PostgresStore 一致处理；编辑使用 PATCH/PUT 语义，删除保留为软作废，绑定字段统一归一到 `bindingId`。
5. Chrome/CDP E2E 通过前端正式路由、真实 API、MemoryStore 和页面刷新可见结果，覆盖列表安全元数据列、选择/关联、编辑/复制、启禁用、详情/预览/导入/绑定/作废，生成固定桌面/移动截图；由于使用隔离临时 profile 和受控内存运行时，门禁结论保持 `READY_FOR_REVIEW`，不得直接描述为生产级持久化通过。
6. 人工审核通过前不执行 merge；人工审核必须使用真实 PostgreSQL/Redis/MinIO 开发链路打开 `http://localhost:5173/coupons`，逐项复核筛选、批量操作、编辑/复制、启禁用、双栏关联、图片预览和移动端横向表格行为；审核通过后才重新跑验证并将 VS3 分支合入 `master`。

本轮提交：当前分支 HEAD（`feat(阶段5): 完成S4-VS3卡券首页`）。

## 未完成任务切片化决策（2026-09-19）

为避免继续把“完整商品管理”“完整卡券库存”“订单交付”和“发布级环境”混成一个大任务，阶段 5 后续按以下规则推进：

1. `S4-VS2` 拆为 `S4-VS2A` 草稿基础信息、`S4-VS2B` SKU/多规格、`S4-VS2C` 素材/对象存储、`S4-VS2D` 受控发布、`S4-VS2E` 外部同步真实验收；其中 `VS2E` 可并行，但真实外部结果不能替代本地持久化与页面证据。
2. `S4-VS3` 当前只代表已合入的批次首页与受控操作，后续拆为 `S4-VS3A` CouponItem/素材和 `S4-VS3B` 库存锁定/消耗；真实 PostgreSQL/Redis/MinIO 与人工浏览器复核未完成前，状态保持 `READY_FOR_REVIEW`。
3. `S4-VS4` 拆为 `S4-VS4A` 订单只读、`S4-VS4B` 交付预览/库存预锁、`S4-VS4C` 发货/取消/重试/unknown 人工恢复；预览不扣库存、不创建 DeliveryRecord，交付动作不得绕过 Outbox。
4. `S4-ENV-RECOVERY`、`S4-EXT-ACCOUNT`、`S4-ENV-RUNTIME` 作为横向门禁独立记录，不因业务页面可打开、API 200、MemoryStore 或 fixture 通过而关闭。
5. `013_coupons.sql` 与 `013_product_sync.sql` 的并行编号本轮不做历史重命名；在新增迁移前先补齐迁移清单、apply/rollback、已有 volume 执行记录和恢复演练，新迁移不得继续使用 `013`。
6. 每个切片使用 `PLANNED / IN_PROGRESS / PARTIALLY_VERIFIED / READY_FOR_REVIEW / PASS / BLOCKED` 状态；只有真实适用层级测试、视觉证据、回滚证据和两轮独立复审完成，才允许标记 `PASS`。

该决策只调整工作拆分和门禁，不改变已合入 `master` 的代码，也不把当前受控卡券 E2E 或商品 fixture 结果升级为生产级验收。

## Git 提交记录

- 阶段 0：`38862e5`（`feat: 阶段0文档产出`）
- 阶段 1：`cfc756b`（`docs(阶段1): 完成架构与模块边界`）
- 阶段 2：`076a969`（`docs(阶段2): 完成数据库表设计与数据契约`）
- 阶段 3：`66fd989`（`docs(阶段3): 完成前端信息架构与状态契约`）
- 阶段 3 门禁重开：`6c5533e`（`docs(阶段3): 重开组件门禁并补充详细契约`）
- 阶段 3 组件契约复审关闭：`bcf47b5`（`docs(阶段3): 完成组件契约复审并关闭门禁`）
- 阶段 4 主体功能纵向切片计划：`f55f7dc`（`docs(阶段4): 编排主体功能纵向切片计划`）
- 2026-09-19 阶段5 决策：二维码登录 API 同时返回历史兼容字段 `id` 与 canonical 字段 `qrSessionId`；二维码风控状态 `verification_required` 独立持久化并展示验证链接，不降级为普通失败或伪造成功；自动化测试使用 `XIANYU_QR_MODE=stub`，真实模式仅用于可控网络探针与人工扫码验收。
