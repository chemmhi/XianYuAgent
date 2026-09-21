# XianyuSellerAgent 风险登记册

- 文档版本：v0.2
- 更新日期：2026-09-20
- 当前阶段：阶段 5——优先推进 S4-VS5 在线聊天、S4-VS6 Workspace、S4-VS7A Settings API Key
- 风险状态：开放风险已登记；当前无 P0
- 阶段门禁规则：阶段 5 允许受控 adapter、内存 store 和本机 Chrome/CDP 先形成证据，但不得把受控验证冒充真实闲鱼 APP 扫码、外部 Cookie 验证或 PostgreSQL/Redis 持久化；未关闭的 P1 外部登录和容器门禁不得扩展到商品、卡券、订单写入。

### 2026-09-21 缺陷关闭

| 编号 | 风险 | 级别 | 缓解措施 | 状态 |
| --- | --- | --- | --- | --- |
| S5-RISK-031 | 闲鱼历史同步与实时 push 使用不同外部消息号，导致同一买家消息重复落库并重复触发 AI 回复 | P1 | 两路解析均优先稳定 `.PNM`；新增 parser、历史导入和原始 push 幂等回归；保留旧重复数据供后续受控清理 | CLOSED |

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
| S5-RISK-027 | seller 订单列表请求错误携带 `idle_site_biz_code: COMMONPRO` 会返回 `PERMISSION_EXCEPTION::无权限访问` | P1 | 高 | 错误请求头会阻断真实订单同步并可能误导为空单 | 后端 / 外部平台负责人 | 已移除该请求头并补充回归断言；真实 active 凭证、Chrome/CDP、API 和 PostgreSQL 复验通过，旧失败保留为 A/B 证据 | 2026-09-20 | CLOSED |
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
- `S5-I010` 进一步缓解：账号删除已采用软删除并在 Memory/PostgreSQL 同时撤销 active credential 与管理员 scope；历史商品和审计记录保留，避免 FK 破坏。商品“发布”当前仅为本地草稿入口，真实闲鱼发布仍明确阻断在后续切片。

## S4-VS3 增量更新（2026-09-19）

- `S4-I003`：卡券受控 content API、管理员 scope、审计摘要、正文加密存储、列表安全元数据摘要和图片/接口配置边界已实现并通过受控 API/Chrome E2E；真实 PostgreSQL/Redis 容器级验收、订单交付策略和真实买家链路仍开放。
- `S4-I005`：metadata JSON 已通过 `013_coupons.sql` 扩展和 `014_coupon_card_metadata.sql` 迁移接入 Memory/Postgres store；并行 `013` 迁移编号需在后续迁移整理中统一，回滚、旧数据兼容和容器级恢复演练仍开放。
- `S4-I006`：卡券实现按 `features/coupons` 拆分 API adapter、controller、ViewModel、table、drawer、modal、relation modal、state boundary；待人工审核确认组件边界和操作可发现性。
- `S4-I007`：已生成非空 `1440×900` 和 `390×844` 截图，并完成桌面/移动浏览器路径；完整逐状态视觉回归仍开放，状态暂不关闭。
- `S5-I012`：S4-VS3 Chrome/CDP 自动化使用临时 profile + MemoryStore/stub，仅作为真实前端跨层受控证据；人工审核必须在目标环境复核搜索/类型筛选、工具栏新建/刷新、全选/批量删除、编辑/复制、启禁用、双栏关联和图片预览，不能把该证据升级为生产持久化或外部平台通过。

## 未完成切片拆分风险（2026-09-19）

| 风险编号 | 风险描述 | 级别 | 影响 | 负责人 | 关闭条件 | 关联切片 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S5-RISK-013 | 商品草稿、SKU、素材和发布若未按 ProductEditor 子域拆分，可能重新形成跨域保存入口和版本覆盖 | P1 | 中 | 商品写入不可独立测试，冲突时覆盖用户草稿 | 前端 / API 负责人 | `S4-VS2A/B/C/D` 分别具备独立 controller、API、版本校验、真实 E2E 和复审记录 | `S4-VS2A`–`S4-VS2D` | 开放，已拆分待实现 |
| S5-RISK-014 | 商品 SKU/库存与发布命令的并发、幂等和部分成功语义尚未落到真实持久化 | P1 | 高 | 可能出现重复发布、库存覆盖或部分成功被误报为整体成功 | 后端 / QA 负责人 | PostgreSQL 并发集成、Idempotency/Outbox worker、逐项结果和 unknown 人工恢复均通过 | `S4-VS2B`、`S4-VS2D` | 开放 |
| S5-RISK-015 | AssetRef 与 MinIO contract 尚未完成，上传失败、过期 URL、删除和重启恢复可能污染草稿 | P1 | 中 | 图片不可见、对象泄漏或草稿引用悬空 | 后端 / 运维负责人 | MinIO 持久化/重启复读、失败重试、403/过期、checksum/status 和回滚验证通过 | `S4-VS2C` | 开放，承接 R-005 |
| S5-RISK-016 | CouponItem 批量操作、卡券素材和库存锁仍停留在后续契约，真实订单交付前没有原子 reserve/consume/release 证据 | P1 | 高 | 重复发券、库存负数、正文越权或失败无法恢复 | 后端 / 安全负责人 | PostgreSQL/Redis/MinIO 真实集成、并发锁、敏感字段裁剪和订单联调通过 | `S4-VS3A`、`S4-VS3B` | 开放，承接 S4-I003/R-009 |
| S5-RISK-017 | 订单只读、交付预览和商品/卡券状态尚未拆成独立门禁，可能混用支付、交付、售后状态 | P1 | 中 | 预览误扣库存、退款订单重复交付或页面状态误导 | API / 前端负责人 | `OrderStatusMatrix` 四态独立、预览不写入、交付动作单独走 Confirmation/Outbox | `S4-VS4A`、`S4-VS4B` | 开放 |
| S5-RISK-018 | 发货 unknown/timeout/cancel/retry 的恢复语义未在外部 adapter、worker 和 UI 中闭环 | P1 | 高 | 重试导致重复发货或人工无法判断最终结果 | 后端 / QA 负责人 | 外部状态查询、租约、人工 recover、DeliveryRecord 和审计在真实 E2E 中可复核 | `S4-VS4C` | 开放，承接 S4-I004/R-009 |
| S5-RISK-019 | 迁移编号并行、已有 PostgreSQL volume、回滚与 Testcontainers 证据未形成发布级闭环 | P1 | 高 | 应用与 schema 漂移，无法安全回退或恢复 | 架构 / 运维负责人 | 迁移清单、apply/rollback、旧数据兼容、容器重启复读和恢复演练全部有证据 | `S4-ENV-RECOVERY` | BLOCKED，承接 R-001/S5-I001 |
| S5-RISK-020 | Pi Runtime 的健康、超时、重试、取消、不可用与可观测性仍未真实运行验证 | P1 | 中 | Agent/Worker 异常可能卡死或无法恢复 | 架构 / 运维负责人 | Runtime 独立服务健康探针、超时/取消/重试和日志指标通过；不把页面 200 当作证据 | `S4-ENV-RUNTIME` | PLANNED，承接 R-006 |
| S5-RISK-021 | 在线聊天 WebSocket、cursor 补事件、未读和重连状态尚未形成真实闭环 | P1 | 高 | 断线后消息重复、丢失或跨账号串流 | 消息 / QA 负责人 | Redis/WS 集成、cursor 去重、账号 scope、断线重连和 Chrome/CDP E2E 通过 | `S4-VS5A` | 部分缓解：已补真实 PostgreSQL + Redis 双 API 实例广播、Redis 重启恢复、PostgreSQL 重启后的消息读回/写入恢复、cursor/账号 scope/ownership/前端去重，以及 Chrome/CDP 双 viewport 断线与视觉证据；仍开放，待独立复审确认生产部署拓扑 |
| S5-RISK-022 | 消息发送、附件上传、撤回的幂等和外部 unknown/timeout 尚未真实验证 | P1 | 高 | 重复发送、孤儿附件、撤回结果误报或敏感内容泄露 | 消息 / 安全负责人 | PostgreSQL/对象存储、Idempotency、敏感字段裁剪、失败/重试/unknown 复核 | `S4-VS5B` | 开放，承接 R-008/R-009 |
| S5-RISK-023 | 人工接管与 AI 恢复可能绕过会话版本、审计或权限边界 | P1 | 中 | 买家会话处理模式错误或越权切换 | 消息 / 安全负责人 | `expectedVersion`、reason、scope、幂等、AuditEvent 和非法转换测试通过 | `S4-VS5C` | 开放 |
| S5-RISK-024 | Workspace Run/Step/Confirmation/Outbox 状态可能被页面或 Runtime 直接改写 | P1 | 高 | 高风险动作不可审计、重复执行或无法人工恢复 | Workspace / 执行负责人 | 独立 controller、状态机、Policy→Confirmation→Outbox、worker lease 和 recover E2E | `S4-VS6A`、`S4-VS6B` | 开放，承接 R-006/R-009 |
| S5-RISK-025 | Workspace 实时事件、unknown、cancel、retry 尚未在真实 Runtime 中形成可恢复证据 | P1 | 中 | Run 卡死、误重试或外部结果未知时无法判断最终状态 | Runtime / QA 负责人 | 真实 Worker/Runtime、超时/取消/重试、事件游标、人工恢复和日志指标通过 | `S4-VS6A`、`S4-VS6B` | 开放，承接 R-006 |
| S5-RISK-026 | Settings API Key 配置若复用通用设置保存入口，可能泄露明文或覆盖其他凭证 | P1 | 高 | 凭证泄露、轮换失败覆盖旧密钥或跨域读取 | 安全 / 凭证负责人 | CredentialStore 唯一 owner、加密复读、脱敏 UI、轮换/启停/撤销审计和 403/409 E2E | `S4-VS7A` | 开放，承接 R-004/S3-I004 |
| S5-RISK-027 | `018_credential_store.sql` 已实现但尚未在真实 PostgreSQL volume 完成 apply/verify/rollback 与密文复读 | P1 | 高 | schema 漂移、密文不可读或回滚破坏旧凭证引用，无法证明发布级持久化安全 | 架构 / 数据 / 运维负责人 | 真实 PostgreSQL 执行 018、加密字段复读、重复执行、旧数据兼容、回滚演练和清理证据 | `S4-VS7A`、`S4-ENV-RECOVERY` | 开放，承接 R-001/S5-I001 |
| S5-RISK-028 | Settings 首片尚无 Chrome/CDP 1440×900 与 390×844 截图、逐状态视觉偏差和真实跨层 403/409 E2E | P2 | 中 | 页面可能仅在单元/MemoryStore 下可用，移动端或真实权限冲突被遗漏 | 前端 / QA / 安全负责人 | 固定双 viewport 覆盖 loading/empty/error/forbidden/submitting/saved，真实 API + PostgreSQL + 浏览器回写证据并完成独立复审 | `S4-VS7A` | 开放，承接 S4-I007/S5-RISK-026 |
| S5-RISK-031 | 主配置失败后已能切换备用，但 fallback 专用审计事件尚未形成可查询记录 | P2 | 中 | 故障原因、主备切换和 trace 关联无法在运维侧直接复核 | Agent / 可观测性负责人 | 在 fallback wrapper 中写入脱敏 AuditEvent，补 Memory/PostgreSQL 查询和 E2E 断言 | `S4-VS7A` | 开放；当前 E2E `fallbackAudit=false`，不得宣称完整审计闭环 |
| S5-RISK-032 | OpenAI 主备配置新增迁移 024，尚未完成既有生产 volume 的发布级 rollback / 兼容窗口演练 | P1 | 高 | 旧唯一约束、历史 credential refs 或回滚时的主备角色数据可能不兼容 | 架构 / 数据 / 运维负责人 | 在隔离 volume 执行 apply、重复 apply、旧数据读取、回滚和恢复，并记录数据兼容策略 | `S4-VS7A`、`S4-ENV-RECOVERY` | 开放 |

### 2026-09-19 S4-VS6A 风险复核

- `S5-RISK-024`：受控首链路已降低“页面直接改写 Run/Step 状态”的风险；服务端状态迁移、脱敏 ViewModel、controller cursor 去重和 API/WS smoke 已落地，但独立 Worker lease、Confirmation/Outbox 与真实 Runtime 仍未完成，风险保持开放。
- `S5-RISK-025`：MemoryStore + 受控 Runtime 已证明事件追加、cursor replay、`after=NaN` 防护和基础权限门禁；真实 Runtime 的 unknown/timeout/cancel/retry、断线人工复核和生产级观测仍缺失，风险保持开放。

### 2026-09-20 S4-VS6A 证据复核

- `S5-RISK-024` 与 `S5-RISK-025` 继续保持开放；本轮已确认 Workspace 专项 build、API 全量 smoke、HTTP/WS smoke、真实 PostgreSQL/Chrome/CDP 首链路、Web typecheck/test/build 和 diff hygiene，但不提前关闭独立 Worker/Pi Runtime、发布级恢复、Confirmation/Outbox 或人工视觉签核门禁。
- 端口占用属于已清理的验证环境问题；清理残留 `dist/index.js` 进程后，`npm --workspace apps/api run test` 完整通过，未留下业务数据（真实验证临时数据已事务化清理）。
- 当前切片复核状态为 `READY_FOR_REVIEW`；后续仅需补齐独立 Runtime、发布级恢复、人工视觉签核与 `S4-VS6B` 业务门禁，不把已完成的真实 PostgreSQL/浏览器证据重复列为未执行。

### 2026-09-20 S4-VS5A 真实回读与账号上下文复核

- `S5-RISK-021` 已部分缓解并保持开放：真实登录态回读确认了两个账号的会话列表、历史消息分页和消息去重（`19cf…`：3 会话 / 4 条历史；`6f0…`：1 会话 / 20 条历史且 `hasMore=true`；`duplicate_external_refs=0`），但独立复审和生产部署拓扑仍未确认。
- 消息页已移除账号选择器，统一消费 `/accounts` 设置的 `AccountContext.currentAccountId`；Chrome/CDP 已断言无 tablist/账号选择器，桌面与移动截图显示“真实连接”和断线恢复状态。

### 2026-09-21 S4-VS7A OpenAI API 主备复核

- `S5-RISK-026` 已部分缓解：主/备配置分角色保存，CredentialStore 继续负责密文，API 只返回脱敏视图；真实 Chrome/CDP + PostgreSQL 已覆盖账号 scope、更新版本、密钥不回显和 Agent 消费。
- `S5-RISK-028` 已部分缓解：双 viewport 截图、视觉偏差记录、Model provider 动态下拉和保存成功态已补齐；独立人工视觉签核仍未关闭。
- `S5-RISK-031` 保持开放：主失败切备用行为通过，但 fallback 专用 audit record 未暴露为可查询结果。
- `S5-RISK-032` 保持开放：迁移 024 已在当前 PostgreSQL 执行并通过复读，发布级 rollback / 旧凭证兼容窗口尚未演练。
- 本轮未重复 Cookie 登录、未发送真实闲鱼消息；发送/附件/撤回的外部 unknown/timeout 与幂等风险继续由 `S5-RISK-022` 和 `S4-VS5B` 承接。

### 2026-09-20 商品表格空态修订风险复核

- 本轮只调整前端状态容器布局、工具栏冗余统计展示和对应回归/E2E 断言，不改变商品 API、数据库、外部同步或持久化边界；`S5-I007`、`S5-I008`、`S5-I009` 及商品后续切片风险保持原状态。
- `S5-RISK-017` 部分缓解：四套订单状态已在 `OrderVM`、PostgreSQL 约束、API 筛选和详情抽屉中独立维护；`npm --workspace apps/api run test:orders`、`npm --workspace apps/api run test:orders:postgres` 和 `npm run test:e2e:chrome:orders` 通过。交付预览、库存锁、发货动作、unknown/timeout/retry 仍未实现，不能关闭 `S4-VS4B/C` 风险。
- 新增 `018_orders.sql` 使用单调编号并已在当前 PostgreSQL 实例执行；`S5-RISK-019` 仍开放，因为完整迁移回滚、旧数据兼容、Testcontainers 和发布级恢复演练尚未完成。
- 历史复验保留：旧实现携带 `idle_site_biz_code: COMMONPRO` 时返回 `PERMISSION_EXCEPTION::无权限访问`，并已通过回归断言防止重新引入；修复后真实订单读取与 PostgreSQL 落库复读通过，未使用 fixture 伪造外部订单。

### 2026-09-20 S4-VS4A 订单列表界面修订风险复核

- 本轮仅调整订单列表前端展示与交互：移除页面标题，保留操作列/查看详情/详情抽屉，收敛搜索与状态筛选，增加买家姓名悬浮提示、表格内部滚动和分页；不改变订单 API、数据库、外部请求、状态模型或交付边界。
- `S5-RISK-017` 继续保持开放：四套订单状态仍按既有 canonical 字段投影到当前状态筛选；交付预览、库存锁、发货/取消/重试、unknown/timeout、Outbox 和 DeliveryRecord 仍不在本轮范围。
- `S5-RISK-027` 已关闭：完整浏览器入口、真实 active 凭证、MTOP、API、PostgreSQL 与页面可见结果均通过；订单交付动作另由 `S4-VS4B/C` 承接。
- 买家昵称与实名目前继续共用既有 `buyerName` 数据契约；本轮只增加悬浮提示，不伪造额外实名字段。详情抽屉内容留待下一步单独调整。

### 2026-09-20 S4-VS4A 订单字段与头像聚合风险复核

- `S5-RISK-017` 继续保持开放：本轮只读列表仍不包含交付预览、库存锁、发货/取消/重试、unknown/timeout、Outbox 和 DeliveryRecord。
- 字段完整性风险已部分关闭：`OrderRecord` / `XianyuOrderItem` 已分离买家昵称、姓名和头像；MemoryStore/PostgresStore 按账号从本地会话与商品表聚合缺失昵称、头像、商品名称和商品缩略图，列表不再回退显示买家姓名、用户 ID 或商品 ID；商品无法从本地数据聚合时显示“商品已删除”提示。
- 迁移风险继续开放：`019_order_display_fields.sql` 与 `020_order_buyer_avatar.sql` 已幂等执行，完整迁移回滚、旧数据兼容、Testcontainers 和发布级恢复演练仍未覆盖。
- 真实外部 seller 权限仍沿用 S4-VS4A 既有结论，不以受控 fixture 的头像/订单数据代替真实外部验收。

### 2026-09-20 S4-VS4A 订单状态筛选边界风险复核

- “待发货”已收紧为 `paymentStatus=paid + deliveryStatus=pending`；“待收货”已收紧为 `paymentStatus=paid + orderStatus=open + deliveryStatus=delivered`；“待评价”已收紧为 `paymentStatus=paid + orderStatus=completed + deliveryStatus=delivered + afterSalesStatus=none`。
- 此前的“待评价”筛选异常已通过 `order-status` 单元测试和 Chrome/CDP E2E 修复并锁定，回归断言明确排除待发货、待收货及已退款订单；该项不单独关闭 `S5-RISK-017`，因为交付预览、库存锁和发货动作仍属 `S4-VS4B/C`。
- 后续任何订单状态字段调整必须同步更新 `filtersForStatus`、`statusFilterFromFilters`、`getOrderDisplayStatus` 与浏览器回归断言，避免再次退回到仅按 `orderStatus=completed` 识别待评价。

### 2026-09-20 S4-VS7A Settings API Key 风险复核

- `S5-RISK-026` 已部分缓解但保持开放：CredentialStore 已独立于通用设置保存入口，API 只返回 `CredentialRef` 脱敏 metadata，明文仅在 create/rotate 请求边界出现；`Idempotency-Key`、`expectedVersion`、账号 scope、轮换/启停/撤销审计、403/409 与撤销后禁止启用均已由 smoke/Chrome/CDP 覆盖。旧 `auth.account_credentials` 兼容迁移仍需独立方案与签核。
- `S5-RISK-027` 已部分缓解但保持开放：临时 PostgreSQL 已执行 `001`–`018`，并复读 `credential_values.ciphertext/key_version/checksum/metadata_json`；发布级 rollback、已有 volume 回退与重复迁移后的恢复演练仍未覆盖。
- `S5-RISK-028` 已部分缓解但保持开放：Settings 已生成 `1440×900`、`390×844` 固定 viewport 截图并完成桌面/移动偏差记录；loading/empty/error/submitting/saved 与移动短标签导航均有浏览器路径，正式人工视觉签核仍待 merge lock 后完成。

### 2026-09-20 自动回复链路风险复核

- `S5-RISK-029`：自动回复已接入与 Workspace 共享的 OpenAI-compatible Provider，但仍为 dry-run / Noop 投递，未完成 Outbox Worker、超时/unknown 恢复和人工接管 API；不能把 `auto_reply_runs.status=persisted` 解释为买家已收到真实消息。状态：部分缓解，继续承接 `S4-VS5B/C` 与发布级执行门禁。
- `S5-RISK-030`：模型生成器已接入，但尚未覆盖多轮指代消解、商品事实缺失时的澄清策略、真实模型评测和离线回放集。状态：开放；后续补离线评测集、置信度阈值、事实引用和人工抽检。
- 已关闭本轮专项风险：入站重复消息导致重复自动回复、跨账号商品查询、敏感内容进入运行记录、模拟发送误触发闲鱼发送。证据为 `auto_reply_runs` 唯一约束、账号范围商品/订单查询、digest-only 审计以及 E2E 的真实发送调用数为 0。

### 2026-09-21 自动回复网关 push 排查

- `S5-RISK-021`：已补充账号级 listener 单飞、启动串行扫描、有限退避重试、网关非 200 响应拒绝、同帧 `syncPushPackage` 继续解析、断线自动重连和 push handler 隔离；相关单测与真实 PostgreSQL 凭证只读探针通过。风险仍开放，因为探针期间没有新的真实买家消息，尚未形成“闲鱼买家 push → 自动回复 → 真实发送 → 落库”的完整证据。
- `S5-RISK-029`：继续保持 `PARTIALLY_VERIFIED / DRY-RUN ONLY`。共享模型 Provider 的单测和受控自动回复 E2E 已通过；现有 live 白名单配置可用，但仓库没有可复现的真实 live 发送归档；不得把历史同步导入、FakeSocket 或直接调用 `handleExternalEvent` 解释为真实买家网关 E2E。
- 买家身份缺失门禁已修复：真实 push 无 `senderName` 且本地会话无昵称时，监听器会先按稳定会话引用调用闲鱼资料接口补全昵称；资料接口失败仍安全跳过并留下 `TEST_BUYER_NOT_ALLOWLISTED`，真实买家 push 仍需单独验收。
- 历史/push 竞态已修复：历史导入不会自动回复，但后续同 external ref 的真实 push 不再因去重而提前返回；仍需用下一条真实买家消息确认网关 parser 能产生 push 事件。

### 2026-09-21 Agent 动态壳层复核

- `R-AD-004` 已从开放风险降为已修复：Agent 动态嵌入 `AuthenticatedShell`，外层 host CSS 清除全局 main 的重复 padding 与嵌套滚动；移动端沿用项目横向导航。
- `R-AD-005` 已缓解但保留：当前 worktree 没有原型 HTML，视觉验收使用 Git 固定截图基线并记录对象 ID；不阻塞当前实现，但后续应补回可直接打开的原型文件。
# Agent 动态新增风险（2026-09-21）

| 编号 | 风险 | 等级 | 应对 |
| --- | --- | --- | --- |
| R-AD-001 | 旧运行没有阶段事件，详情时间线不完整 | P2 | 兼容生成最小时间线并标记来源；新运行写入 024 事件 |
| R-AD-002 | 原型展示正文可能包含敏感买家内容 | P1 | 仅通过管理员已授权的 messages 查询受控预览；禁止写入 runs/events/log |
| R-AD-003 | 轮询期间数据库暂时不可用导致页面陈旧 | P2 | 显示最近成功刷新时间与错误状态，不用假数据覆盖 |
| R-AD-004 | 页面壳与现有全局壳重复 | P2 | 已修复：复用 `AuthenticatedShell`，移除原型内置侧栏与顶部栏；host CSS 消除双重 padding / 嵌套滚动 |
| R-AD-005 | 原型 HTML 不在当前 worktree，人工逐像素复核入口不稳定 | P2 | 已从 Git 固定截图 blob 恢复基线并记录对象 ID；后续补回原型文件以便人工复核 |
| R-AD-006 | PostgreSQL 运行记录与首个阶段事件当前由相邻事务写入，极短窗口内可能出现运行已落库但事件暂缺 | P2 | 当前列表/详情兼容无事件时间线；后续将 create/update + event append 收敛为同一事务并补故障注入集成测试 |
