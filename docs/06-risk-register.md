# XianyuSellerAgent 风险登记册

- 文档版本：v0.2
- 更新日期：2026-09-19
- 当前阶段：阶段 5——S4-VS2 商品管理只读首片
- 风险状态：开放风险已登记；当前无 P0
- 阶段门禁规则：阶段 5 允许受控 adapter、内存 store 和本机 Chrome/CDP 先形成证据，但不得把受控验证冒充真实闲鱼 APP 扫码、外部 Cookie 验证或 PostgreSQL/Redis 持久化；未关闭的 P1 外部登录和容器门禁不得扩展到商品、卡券、订单写入。

| 编号 | 风险 | 级别 | 概率 | 影响 | 负责人 | 缓解措施 | 触发条件 / 截止阶段 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-001 | ENV-0 已有真实 API、Worker、迁移骨架和 Compose 配置，但完整发布级恢复证据尚未验收 | P1 | 高 | 阻塞可回滚的真实发布链路 | 架构负责人 | 已落地 `apps/api/`、Memory/Postgres store、迁移和 Compose；已完成容器健康、账号持久化和 API 重启复读，后续补迁移回滚与 Testcontainers | 阶段 5 S4-VS1 关闭前 | 部分缓解，发布级证据开放 |
| R-002 | 闲鱼登录、签名和 WebSocket 协议依赖外部平台，真实扫码和可复现凭证仍可能变化 | P1 | 高 | 影响账号、商品、订单和聊天迁移 | 后端负责人 | 平台逻辑集中在 xianyu 适配器；真实 QR 生成/轮询/Cookie 校验已接通，保留协议探针和人工真实账号复核；页面不得直连 | 阶段 5–6 外部平台验收前 | 部分缓解，外部验收开放 |
| R-003 | 没有正式 Figma 文件、版本号和逐状态标注 | P2 | 中 | 影响阶段 3 高保真验收 | 产品 / 设计负责人 | 已书面确认 SellerAgent 原型和 design token 作为临时视觉基线；阶段 3 已固定 1440×900 / 390×844 和状态清单 | 阶段 5 视觉回归前 | 已接受，待阶段 5 验收 |
| R-004 | CredentialStore 直接存储在项目数据库，管理员拥有绝对管理权限 | P3 | 低 | 影响后续凭证轮换和数据库运维设计，不属于项目主线 | 后端负责人 | 按数据库字段和管理员界面实现；仅保留买家不可见边界，后续补基础备份与迁移说明 | 阶段 7 前 | 已接受，非当前主线 |
| R-005 | 对象存储实现尚未在 S3 / MinIO / 现有服务中定案 | P2 | 中 | 影响媒体上传和部署 | 后端负责人 | 统一 S3 兼容接口，先用 MinIO 做本地验证 | 阶段 2 数据 / API 评审前 | 开放 |
| R-006 | Pi Runtime 已确认采用独立服务，ADR 已通过但最小运行验证尚未完成 | P2 | 中 | 影响 Agent 故障隔离和发布拓扑 | 架构负责人 | 在真实运行时接入前完成健康、超时、不可用、重试和取消验证 | 阶段 5 首切片前 | 已决策，待运行验证 |
| R-007 | 首期生产允许 Docker Compose，但发布演练尚未完成 | P2 | 中 | 影响发布、回滚和运维成本 | 安全 / 运维负责人 | 阶段 7 完成健康检查、备份和回滚演练 | 阶段 7 前 | 已决策，待演练 |
| R-008 | 卡券正文、夸克链接和提取码属于可交付敏感业务数据 | P1 | 中 | 可能造成越权或日志泄露 | 安全负责人 | 已确认：系统凭证永不交付；仅在 `deliveryScope=buyer_deliverable`、订单已支付、商品与账号匹配、策略校验通过并记录审计后交付买家；仍需实现接口隔离、权限校验、日志 / Trace / Replay / Prompt 脱敏和审计 | 阶段 2 安全评审前 | 范围已确认，工程待落实 |
| R-009 | 外部动作可能超时但结果未知，重试会导致重复发布 / 发货 / 扣库存 | P1 | 中 | 造成业务重复执行和数据不一致 | 后端负责人 | 事务内记录 Idempotency + Outbox + Audit；重试前先查外部状态 | 阶段 2 契约评审前 | 开放 |
| R-010 | 原型导航包含非本轮正式页面，后续实现可能发生视觉和范围漂移 | P2 | 中 | 造成产品范围和验收不一致 | 前端负责人 | 已决定直接删除 knowledge、review 原型入口及其页面分支 | 当前迭代 | 已关闭，代码扫描、测试和构建已通过 |
| R-011 | 原型 liveApi 使用 `localStorage.auth_token`，与生产 HttpOnly Cookie 会话基线不一致 | P1 | 中 | 真实鉴权可能出现会话泄露、生命周期和退出语义不一致 | 安全 / 后端负责人 | 阶段 0 仅登记为原型例外；阶段 1/2 改为服务端会话、HttpOnly Cookie、Secure、SameSite，并补真实鉴权集成与 E2E | 阶段 1/2 鉴权实现前 | 开放 |

| S3-I001 | 当前原型部分页面使用静态数组，尚未接入阶段 2 全量 API | P1 | 高 | 影响首个真实前端切片 | 前端负责人 | 阶段 3 已冻结 API 映射；阶段 5 先接订单交付纵向切片 | 阶段 5 首切片前 | 开放 |
| S3-I002 | 移动端 Products/Coupons/Orders 的实际实现尚未完成 | P1 | 中 | 影响后续移动端正式页面功能承载 | 前端负责人 | 阶段 4/5 按 8×2 设计矩阵实现，复用同一 controller/ViewModel | 阶段 4/5 实现前 | 开放，后续实现风险 |
| S3-I003 | 原型仍使用 `localStorage.auth_token`，与生产 Session 基线不一致 | P1 | 中 | 影响真实鉴权和退出语义 | 安全 / 后端负责人 | 阶段 3 只记录为原型例外；阶段 5/6 接入服务端 Session + HttpOnly Cookie | 阶段 5/6 | 开放 |
| S3-I004 | 真实 WebSocket、CredentialStore、Outbox 和截图回归尚未执行 | P1 | 中 | 影响端到端与视觉验收 | 后端 / QA / 前端负责人 | 阶段 5–7 按纵向切片补集成、E2E、安全和视觉证据 | 阶段 5–7 | 开放 |
| S3-I005 | 原型源码集中承载路由、全局反馈、业务动作分派和 DOM click capture，形成超级组件 | P1 | 高 | 后续实现难以独立测试和演进 | 前端负责人 | 阶段 4/5 按详细契约拆分；不作为阶段 3 设计门禁证据 | 阶段 4/5 实现前 | 开放，后续实现风险 |
| S3-I006 | 原型源码 Settings、Workspace、Auth、ProductEditor 职责过宽 | P1 | 高 | 后续实现数据流和职责边界不可验证 | 前端负责人 | 阶段 4/5 按详细契约拆分；不作为阶段 3 设计门禁证据 | 阶段 4/5 实现前 | 开放，后续实现风险 |
| S3-I007 | 原型源码 DTO 与阶段 2 canonical RunStatus、Order 四态不一致 | P1 | 高 | 后续实现可能产生错误映射 | 前端 / API 负责人 | 阶段 4/5 通过 adapter 收敛；不作为阶段 3 设计门禁证据 | 阶段 4/5 实现前 | 开放，后续实现风险 |
| S3-I008 | 原型源码 Products/Coupons/Orders 移动端回退 Dashboard | P1 | 中 | 后续实现移动端功能承载不完整 | 前端负责人 | 阶段 4/5 按 8×2 设计矩阵实现；不作为阶段 3 设计门禁证据 | 阶段 4/5 实现前 | 开放，后续实现风险 |
| S3-I009 | FirstRun bootstrap 与消息 handoff 的 canonical endpoint、字段和缓存失效语义已补齐并完成跨文档复审 | P1 | 中 | 路由与命令若漂移会重新形成不可执行闭环 | API / 前端负责人 | 统一为 `/api/v1/auth/bootstrap`、`/api/v1/conversations/{id}/handoff`、`/api/v1/conversations/{id}/release`，并同步 request/response/scope/幂等/审计/失效矩阵 | 2026-09-19 独立设计复审 | VERIFIED / CLOSED |
| S3-I010 | ControllerResult、canonical ViewModel 和错误码映射已冻结并通过独立设计复审 | P1 | 高 | 页面若绕过 controller 仍可能重现超级组件 | 前端 / API 负责人 | `docs/03-component-contract.md` 已补齐字段级类型、逐条 API、queryKey/invalidation、恢复矩阵、Runtime/Outbox 拆分和反超级组件规则 | 2026-09-19 独立设计复审 | VERIFIED / CLOSED |
| S4-I001 | ENV-0 的 Session/CSRF、幂等、账号范围、最小审计和 Execution foundation 尚未完成发布级恢复演练 | P1 | 高 | 首个账号切片无法形成可审计、可回滚闭环 | 架构 / 后端负责人 | 已完成 Memory/Postgres store、API、Worker、Session/CSRF、幂等、账号 scope 与最小审计；Compose 容器健康、账号持久化与 API 重启复读已通过，迁移回滚/Testcontainers 待补 | S4-VS1 关闭前 | 部分缓解，发布级证据开放 |
| S4-I002 | 闲鱼登录、QR/login-session、连接刷新协议与可复现凭证仍依赖外部平台 | P1 | 高 | 账号、商品同步和订单查询无法稳定验收 | 后端负责人 | 已接通真实 QR 生成/轮询/取消与 Cookie 登录；真实 APP 扫码、外部 Cookie 与资料接口仍需人工验收 | S4-VS1/S4-VS2 前 | 部分缓解，外部验收开放 |
| S4-I003 | 卡券正文、夸克链接、提取码和库存状态进入真实链路后存在越权或日志泄露风险 | P1 | 中 | 可能造成敏感交付泄露或错误交付 | 安全 / 后端负责人 | 受控 content API、deliveryScope、账号/商品/订单匹配、库存锁、AuditEvent 和脱敏验证 | S4-VS3/S4-VS4 前 | 开放 |
| S4-I004 | 订单交付、商品发布和外部动作可能出现 unknown/timeout，重复写会造成重复发货或扣库存 | P1 | 中 | 外部状态与本地订单/库存不一致 | 后端 / QA 负责人 | 所有高风险写入使用 Idempotency + Confirmation + Outbox；unknown 只查询/人工恢复 | S4-VS2/S4-VS4 前 | 开放 |
| S4-I005 | 迁移顺序、执行基础和业务表之间存在耦合，回滚可能影响历史订单或审计 | P1 | 中 | 无法安全回退首片 | 架构 / 数据负责人 | 为每片冻结迁移编号、expand/backfill/verify/switch/rollback、fixture 和兼容读路径 | 各切片实现前 | 开放 |
| S4-I006 | 实现阶段可能因赶主体功能重新形成超级组件或跨域保存入口 | P1 | 中 | 组件不可独立测试，后续功能扩展失控 | 前端负责人 | 严格复用阶段 3 owner/VM/API 矩阵；每片复审组件边界和 forbidden dependencies | S4-VS1 至 S4-VS4 | 开放 |
| S4-I007 | 移动端对等、视觉回归和真实验收证据可能后置，导致主体功能只在桌面可用 | P2 | 中 | 影响正式页面承载和验收完整性 | 前端 / QA 负责人 | 每片固定 1440×900、390×844、代表性数据、状态截图和回归记录 | 各切片验收前 | 开放 |
| S5-I001 | Compose 容器已启动，但完整迁移回滚、Testcontainers 和发布级恢复尚未验收 | P1 | 高 | 阻断发布级迁移、恢复和回滚证明 | 运维 / QA 负责人 | 已完成 `docker compose up -d --build`、容器健康、`pg_isready`、Redis `PONG`、账号持久化及 API 重启复读；继续补迁移、Testcontainers 和恢复演练 | S4-VS1 关闭前 | 开放，发布级证据未闭环 |
| S5-I002 | 真实闲鱼 APP 扫码成功、Cookie 校验和 `loginuser.get` 资料同步仍未在外部账号上完成 | P1 | 高 | 账号凭证与昵称/备注/头像真实性无法最终验收 | 后端 / QA 负责人 | 保留真实 QR 模式；执行当前已登录 Chrome 参考项目复核和真实 APP 扫码；`verification_required` 不得降级 | S4-VS1 关闭前 | 开放 |
| S5-I003 | 参考项目登录态依赖当前已登录 Chrome；使用新 profile、无痕窗口或另一浏览器会丢失闲鱼 Cookie | P1 | 中 | 人工复核会误判为未登录，无法复现参考项目正确链路 | QA / 产品负责人 | 人工验收前强制在当前已登录 Chrome 打开 `http://localhost:9000/accounts`；记录浏览器环境和时间 | S4-VS1 人工验收前 | 开放 |
| S5-I004 | 受控 E2E 使用临时 Chrome profile 与 stub adapter，不能证明真实外部扫码和真实数据库持久化 | P1 | 高 | 可能把测试绿色误报为生产链路完成 | QA / 后端负责人 | 当前 Chrome/CDP 已覆盖 AuthGate 阻断、bootstrap cookie 注入、账号列表、登录方式、Cookie 登录和截图；仍需补真实扫码、外部 Cookie、PostgreSQL/Redis 证据后关闭 | S4-VS1 关闭前 | 开放 |
| S5-I005 | 账号密码登录依赖独立浏览器运行时，当前后端明确返回 `PASSWORD_LOGIN_UNAVAILABLE` | P2 | 中 | 入口若被误当成已实现会造成错误承诺 | 产品 / 后端负责人 | 保留入口但显示不可用原因；在独立浏览器运行时具备可复现验证前不得宣称密码登录完成 | 阶段 6 评审前 | 已接受，显式未实现 |
| S5-I006 | 开发环境 `/api` 请求曾因 Vite 未配置默认代理而落到 404；AuthGate 接入后需证明未认证业务面不会越过会话门禁 | P1 | 高 | 登录页、账号列表和真实 API 联调可能被错误判定为不可用或未鉴权 | 前端 / QA 负责人 | `apps/web/vite.config.ts` 默认代理到 `http://127.0.0.1:8080`；Chrome/CDP 验证未认证 `/accounts` 不渲染业务面、session cookie 注入后才放行，且 `npm run verify` 通过 | 2026-09-19 增量复核 | VERIFIED / CLOSED（受控环境） |
| S5-I007 | 商品目录首片新增 `003_catalog` 迁移；已有 PostgreSQL volume 不会自动重新执行 initdb 脚本，迁移顺序和回滚证据仍需独立复核 | P1 | 中 | API 与数据库 schema 不一致会导致商品列表/详情不可用或发布后续迁移受阻 | 架构 / 数据负责人 | 已补 `apps/api/migrations/003_catalog.sql`、PostgreSQL 持久化 smoke 和重复执行校验；正式环境仍需记录 expand/verify/rollback 与已有 volume 的执行方式 | S4-VS2 关闭前 | 部分缓解，迁移回滚证据开放 |
| S5-I008 | 闲鱼 MTOP `fetchItems` 只读探针已存在，但商品列表首片仍以本地目录持久化为主，外部商品同步/pull 尚未接入 | P1 | 高 | 真实账号商品无法自动拉取，列表数据可能与闲鱼外部状态不一致 | 后端负责人 | 保留 `XianyuMtopClient.fetchItems` 作为后续 sync/pull 适配入口；当前只验收本地列表/详情，外部同步前需补脱敏 fixture、字段映射、超时/unknown 与账号凭证复核 | S4-VS2 外部同步扩展前 | 已接受，明确不属于只读首片 |
| S5-I009 | 商品首片当前只覆盖列表/详情只读链路，创建/编辑、SKU、素材、发布确认与 Outbox 尚未实现 | P1 | 中 | 若将当前页面误当作完整商品管理，会造成范围误判并影响后续切片排期 | 产品 / 前端 / 后端负责人 | 页面与 API 明确标注只读；后续切片按 ProductEditor 子域、Asset、SKU、Policy → Confirmation → Idempotency → Outbox 依次扩展，不把写入逻辑塞入列表组件 | S4-VS3 前 | 已接受，后续切片风险 |

### 2026-09-19 商品同步入口修复记录
- `S5-I011`：普通 `/products` 入口此前没有账号上下文，导致同步按钮置灰且商品列表始终按未筛选范围读取；现已通过账号列表选择、`accountId` URL/filters 同步和 Chrome/CDP 29 件 fixture 回归关闭该前端入口缺陷。真实闲鱼外部接口、凭证和数据数量仍保留人工验收风险，不将 fixture 结果视为真实平台验收。

## 风险分级说明

- P0：必须立即停止推进，存在数据破坏、凭证泄露、不可回滚或不可复现构建；当前为 0。
- P1：未缓解前不得进入对应阶段的实现或联调；必须有负责人和验证条件。
- P2：可在当前阶段推进，但必须在指定阶段前关闭或转为书面接受。

## 阶段 5 更新（2026-09-19）

- `S4-I001`：ENV-0 已有可运行 Memory/Postgres store、API、Worker、Session/CSRF、幂等、账号 scope 与审计最小实现；Compose 容器健康、账号持久化与 API 重启复读已通过，状态为“部分缓解，发布级恢复证据待补”。
- `S4-I002`：已接通真实 QR 生成、轮询、取消与 Cookie 登录受控闭环；真实 APP 扫码成功、外部 Cookie 和资料接口仍待人工验收。
- `S4-I005`：首片迁移保持阶段 2 逻辑编号，新增 `apps/api/migrations/README.md` 说明未实现的 002-005 后续域；状态改为“部分缓解”。
- `S5-I001`：Compose 已启动，API/Worker/PostgreSQL/Redis/MinIO 健康，账号持久化和 API 重启复读已通过；完整迁移回滚、Testcontainers 和发布级恢复仍未覆盖。
- `S5-I002`：Cookie 登录、资料同步和登录会话在受控 adapter/Memory store 已通过；真实闲鱼 APP 扫码、外部 Cookie 和 `loginuser.get` 仍需人工验收；`verification_required` 继续保留为可恢复状态。
- `S5-I003`：参考项目 `http://localhost:9000/accounts` 必须在当前已登录 Chrome 打开以保留登录态；该环境前置条件已写入账号登录切片说明和人工复核步骤。
- `S5-I004`：本机 Chrome/CDP E2E 已通过 AuthGate 未认证阻断、bootstrap cookie 注入、账号列表、登录方式、Cookie 登录和截图生成；仍只证明受控跨层链路，不等价于真实外部平台和数据库验收。
- `S5-I005`：账号密码登录入口保留但后端显式返回 `PASSWORD_LOGIN_UNAVAILABLE`，直到独立浏览器运行时具备可复现验证条件前，不得宣称完成。
- `S5-I006`：默认 Vite `/api` 代理与 AuthGate 门禁已通过受控 E2E 和 `npm run verify` 复核；未认证业务面被阻断，认证 cookie 注入后才放行账号页。
- `S5-I007`：S4-VS2 已新增 `003_catalog` 商品、SKU、素材引用迁移，并通过 Memory/PostgreSQL 持久化 smoke；已有 PostgreSQL volume 的迁移执行、完整回滚和发布级恢复仍开放。
- `S5-I008`：商品首片已通过本地目录列表/详情真实 API 链路；闲鱼 `fetchItems` 仅保留为后续同步/pull 适配入口，未将外部同步冒充为当前切片完成。
- `S5-I009`：商品首片范围冻结为只读列表/详情；创建/编辑、SKU、素材上传、发布确认和 Outbox 留待后续切片，当前风险已显式接受，不阻断进入下一切片。
- `S5-I010`：商品同步首片已落地受控 MTOP mapper、分页聚合与本地 Upsert；仍未完成真实账号外部验收、游标/同步批次持久化、鱼小铺专用列表接口和发布链路。同步不会归档远端缺失商品，也不会覆盖本地草稿；真实发布继续禁止进入本切片。
