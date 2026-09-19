# XianyuSellerAgent 项目状态

- 项目阶段：5
- 阶段状态：进行中（账号管理、商品、卡券已具备主体链路；S4-VS3 仍待真实环境人工复核；下一批优先切片调整为在线聊天、Workspace 工作台和 Settings API Key 配置）
- 最近一次通过门禁：S4-VS2 商品列表/详情只读首片复核 / 2026-09-19
- 当前目标：按 `docs/04-plan.md` 执行 `S4-VS5A/B/C` 在线聊天、`S4-VS6A/B` Workspace、`S4-VS7A` Settings API Key 三组优先垂直切片；账号/商品/卡券剩余真实环境门禁继续收尾，不再抢占下一批开发顺序
- 多 Agent 协作状态：已启用独立 worktree、登记表和全局 merge lock 强制规则；当前活动登记见 `docs/agent-worktree-registry.md`，主工作区禁止直接开发
- 已完成范围：阶段 0 范围门禁；阶段 1 架构与模块边界；阶段 2 数据模型、数据库表设计、关系基数、状态机、API envelope、幂等、鉴权、敏感交付、迁移边界；阶段 5 账号登录方法选择、真实 QR 适配器、Cookie 登录、账号资料同步、登录会话持久化、AuthGate 会话门禁、Vite 默认代理、账号列表真实读取和 Chrome/CDP 控制环境 E2E；S4-VS2 商品列表/详情只读首片、003_catalog 迁移、Memory/Postgres scope-aware 查询、真实 PostgreSQL smoke 和 Chrome/CDP 商品 E2E
- 未完成范围：在线聊天 `S4-VS5A/B/C`、Workspace `S4-VS6A/B`、Settings API Key `S4-VS7A`；订单 `S4-VS4A/B/C`；商品/卡券剩余写入与库存门禁；`S4-ENV-RECOVERY`、`S4-EXT-ACCOUNT`、`S4-ENV-RUNTIME`；完整迁移/回滚/Testcontainers、Redis/MinIO 恢复和逐状态视觉回归。账号密码登录依赖独立浏览器运行时，当前明确不可用。
- 未解决风险：R-001/P1、R-002/P1、R-005/P2、R-006/P2、R-007/P2、R-008/P1、R-009/P1、R-011/P1、S3-I001/P1、S3-I002/P1、S3-I003/P1、S3-I004/P1、S3-I005/P1、S3-I006/P1、S3-I007/P1、S3-I008/P1、S4-I003/P1、S4-I004/P1、S4-I005/P1、S4-I006/P1、S4-I007/P2、S5-I001/P1、S5-I002/P1、S5-I003/P1、S5-I004/P1、S5-I007/P1、S5-I008/P1、S5-I009/P1、S5-RISK-013/P1、S5-RISK-014/P1、S5-RISK-015/P1、S5-RISK-016/P1、S5-RISK-017/P1、S5-RISK-018/P1、S5-RISK-019/P1、S5-RISK-020/P1、S5-RISK-021/P1、S5-RISK-022/P1、S5-RISK-023/P1、S5-RISK-024/P1、S5-RISK-025/P1、S5-RISK-026/P1；S3-I009/S3-I010/S5-I006 已关闭，S4-I001/S4-I002 已部分缓解
- 待复审问题：S3-R5 为超出当前范围的实现审计；S3-R6 设计范围已澄清；S1-I004 保持 P2 跟进项；阶段 4 计划门禁已通过
- 下一步：先冻结并实现 `S4-VS5A` 在线聊天读取与实时重连；随后推进 `S4-VS5B/C`、`S4-VS6A/B` 和 `S4-VS7A`。商品同步、卡券首页等既有首片证据继续保留，但不替代真实外部账号、持久化和人工视觉门禁

## 当前证据
- `2026-09-19 S4-VS2 商品同步入口修复`：商品页从普通 `/products` 入口加载管理员可见账号，默认选择可用账号并将 `accountId` 写回列表查询与同步请求；Chrome/CDP fixture 验证 29 件同步商品可落库，列表总数由 1 增至 30。

- `SellerAgent/npm test`：已通过，`mock API contract flow passed`；
- `SellerAgent/npm run build`：已通过，TypeScript 检查和 Vite production build 通过；
- `git diff --check`：当前工作树已通过；仅有换行格式提示，无 diff 空白错误；
- `docs/02-data-api.md`：v0.4，状态 PASS，覆盖字段级 schema、PK/FK、唯一约束、关系基数、状态机、P0 API、FirstRun bootstrap、消息 handoff、幂等、安全和迁移；
- `docs/02-database-schema.md`：v0.1，状态 PASS，覆盖 PostgreSQL 表清单、列类型、默认值、PK/FK、唯一/部分唯一索引、跨表约束、迁移顺序和回滚边界；
- `docs/05-review-log.md`：S2-R1、S2-R2、S2-R3 均 PASS，S2-I001 至 S2-I005 已关闭；
- `docs/03-frontend-design.md`：v0.1，阶段 3 组件树、状态边界与 stockAlert/inventoryStatus 契约已同步；
- `docs/03-component-contract.md`：v0.1，补充模块树、组件职责矩阵、canonical ViewModel、路由/API、数据流、移动端对等性和 DoD；独立设计复审 PASS；
- `docs/04-plan.md`：v0.1，阶段 4 主体功能优先的 ENV-0 与 S4-VS1 至 S4-VS4 纵向切片计划、依赖、DoD、测试、视觉基线和回滚边界；计划门禁 PASS；
- `npm --workspace apps/api run test`：已通过，`env0 smoke passed`、`onboarding cookie login smoke passed`；覆盖 health、bootstrap、Session/CSRF、幂等重放/冲突、账号创建、Cookie 登录、资料同步、登录状态和账号列表读取；
- `npm --workspace apps/web run test`：已通过，覆盖账号 API adapter、QR 状态机和组件相关单元/契约测试；
- `docker compose config --quiet`：已通过；`docker compose up -d --build` 已启动 API、Worker、PostgreSQL、Redis、MinIO；`pg_isready`、Redis `PONG`、容器内 health/ready 通过，并完成账号写入、列表读取及 API 重启后的持久化复读；完整迁移回滚/Testcontainers 仍未覆盖；
- `npm run verify`：已通过；包含类型检查、API smoke、前端 4 个测试文件/15 个测试、构建、本机 Chrome/CDP E2E、1440×900 与 390×844 截图生成、Compose 配置和 diff 检查。
- `npm run test:e2e:chrome`：已通过；未认证 `/accounts` 先停留在 AuthGate 且不渲染账号业务面，注入 bootstrap session cookie 后完成账号列表、登录方式选择、无旧创建弹窗、无模拟二维码、Cookie 登录、服务端资料回传和页面可见持久化结果；不安装或执行 Playwright。
- `docs/evidence/stage5/S4-VS1/test-baseline.md`：已补充 Cookie 登录、资料同步、登录会话落库、当前 Chrome 参考项目登录态前置条件，以及受控 E2E 与真实外部验收的边界；
- `docs/13-account-login-slice.md`：新增账号登录切片实现说明、路由/数据流、迁移、测试证据、Chrome 登录态复核步骤和当前门禁结论；
- `docs/evidence/stage5/S4-VS1/screenshots/`：已由最新 Chrome/CDP 受控 E2E 重新生成 `accounts-desktop-1440x900.png` 与 `accounts-mobile-390x844.png`；
- `npm run test:products:postgres`：已通过真实 PostgreSQL 商品迁移、管理员账号范围、商品列表/详情读取和测试数据清理；
- `npm run test:e2e:chrome:products`：已通过本机 Chrome/CDP 真实 API + MemoryStore 商品列表 → 详情 → 刷新后持久化可见链路；生成 `docs/evidence/stage5/S4-VS2/screenshots/` 桌面/移动证据；
- `docs/evidence/stage5/S4-VS2/test-baseline.md`：已记录商品首片范围、迁移/API/组件边界、实际验证命令、证据与回滚边界；
- `SellerAgent/npm test`、`SellerAgent/npm run build`、`git diff --check`：仅作为原型健康检查，不作为阶段 3 组件设计证据；
- 高保真原型和现有源码：仅作为视觉与背景参考，不作为阶段 3 组件拆分依据；正式前端账号页已独立按 design token 重建壳层与账号切片。
- 以上受控证据不证明真实闲鱼 APP 扫码成功或真实外部 Cookie 验证；阶段 5 的剩余门禁必须按 `docs/13-account-login-slice.md` 的人工复核步骤关闭。
- Vite 默认代理证据：未设置 `VITE_API_PROXY_TARGET` 时，`GET /api/v1/auth/session` 经 Vite 返回 HTTP 200 canonical envelope；未认证业务读取被 API 返回 401，AuthGate 不渲染账号业务面。

- canonical 设计同步：FirstRun 使用 `POST /api/v1/auth/bootstrap`；消息人工接管使用 `POST /api/v1/conversations/{id}/handoff`，恢复 AI 使用 `POST /api/v1/conversations/{id}/release`；统一字段为 `BootstrapAdminInput/Output`、`HandoffConversationInput`、`ReleaseConversationInput`、`ConversationHandlingOutput`，状态字段为 `handlingMode`，版本字段为 `expectedVersion`。

## S4-VS3 卡券首页（已合入 master，待人工复核）

- 原独立 worktree：`F:\ChenHai\Project\XianYuAgent-s4-vs3`，分支 `feature/s4-vs3-coupons`；本次以 merge commit 合入 `master`，临时 worktree 与分支随后删除。
- 实现：批次列表、搜索/重置/类型筛选、当前页全选、批量删除、创建/编辑/复制、启用/禁用、库存/`stockAlert`、首批库存、导入库存、绑定/解绑、双栏商品关联、图片原图预览、作废、DELETE 软作废、管理员受控正文预览/复制、403/404/409/网络错误状态。
- 后端：`apps/api/migrations/013_coupons.sql` + `014_coupon_card_metadata.sql`、Memory/Postgres store、`purpose=text/data/api/image` 校验、列表安全元数据摘要、PATCH/PUT 编辑、scope 校验、加密正文存储、审计摘要。
- 前端：`apps/web/src/features/coupons/`，通过 `/coupons` 正式路由接入，表格视觉保持平台样式，仅参考旧项目字段和操作。
- 验证：已完成类型检查、单测、构建、API smoke、Chrome/CDP E2E、桌面/移动截图；Chrome/CDP 使用 MemoryStore/stub，真实 PostgreSQL/Redis/MinIO 仍需人工浏览器复核。
- 门禁：代码已合入 `master`，人工审核仍需按 `docs/evidence/stage5/S4-VS3/test-baseline.md` 执行并回写结论。

## 未完成切片索引（2026-09-19）

| 切片 | 状态 | 当前边界 | 下一证据 |
| --- | --- | --- | --- |
| `S4-VS2A` 商品草稿与基础信息 | `PLANNED` | create/detail/PATCH、账号 scope、`expectedVersion`、草稿保留 | 真实 PostgreSQL 写入/复读、403/404/409、Chrome/CDP 桌面/移动 |
| `S4-VS2B` SKU / 多规格与库存 | `PLANNED` | SKU 增删改、校验、并发和逐项结果 | PostgreSQL 并发集成、部分成功与移动端 |
| `S4-VS2C` 商品素材与对象存储 | `PLANNED` | AssetRef、上传/替换/删除、失败重试、MinIO | MinIO 持久化/重启复读、过期/403/失败截图 |
| `S4-VS2D` 受控发布 | `PLANNED` | Policy → Confirmation → Idempotency → Outbox | worker/unknown/timeout/人工恢复与真实页面状态 |
| `S4-VS2E` 商品外部同步真实验收 | `PARTIALLY_VERIFIED` | 真实账号、Cookie、分页、字段映射和数量口径 | 当前已登录 Chrome + 真实闲鱼账号人工复核 |
| `S4-VS3A/B` 卡券明细、素材、库存锁定消耗 | `PLANNED` | CouponItem bulk 操作、素材、reserve/consume/release | PostgreSQL/Redis/MinIO 并发集成、敏感字段裁剪 |
| `S4-VS4A/B/C` 订单与交付 | `PLANNED` | 订单只读、delivery-preview、发货/取消/重试/unknown 恢复 | 四套状态、库存锁、Outbox、DeliveryRecord、移动端 |
| `S4-VS5A` 在线聊天读取与实时连接 | `PLANNED` | 会话列表、消息时间线、WebSocket、cursor 重连 | 真实 Redis/WS、断线补事件不重复、403/空/移动端 |
| `S4-VS5B` 在线聊天发送/附件/撤回 | `PLANNED` | 文本发送、图片上传、失败重试、撤回 | PostgreSQL/对象存储、幂等、unknown/timeout、脱敏 |
| `S4-VS5C` 人工接管与 AI 恢复 | `PLANNED` | handoff/release、版本冲突、审计 | 非法转换、403/409、桌面/移动状态 |
| `S4-VS6A` Workspace 会话与 Run 首链路 | `PLANNED` | AgentSession、Run/Step、实时事件 | Worker/Runtime、持久化、clientRunRef、断线补事件 |
| `S4-VS6B` Workspace Confirmation/Outbox | `PLANNED` | confirm/cancel/retry/recover、unknown 恢复 | Policy、幂等、租约、审计、真实 Runtime |
| `S4-VS7A` Settings API Key 配置 | `PLANNED` | CredentialStore 入口、创建/轮换/启停/撤销、脱敏 metadata | PostgreSQL 加密复读、403/409、审计、禁止明文回显 |
| `S4-ENV-RECOVERY` | `BLOCKED` | 迁移回滚、Testcontainers、Redis/MinIO 重启恢复 | 发布级恢复演练和旧数据兼容证据 |
| `S4-EXT-ACCOUNT` | `BLOCKED` | 真实 APP 扫码、Cookie、资料同步 | 真实外部账号人工验收 |
| `S4-ENV-RUNTIME` | `PLANNED` | Pi Runtime 健康、超时、重试、取消和观测 | 独立运行时验证；不以页面/API smoke 代替 |

切片状态说明：`PASS` 仅表示所有适用测试、视觉、持久化、回滚和独立评审均通过；当前新增切片均未达到 `PASS`。`S4-VS3` 代码虽已合入，但其人工真实环境审核仍保持 `READY_FOR_REVIEW`。

## 长期决策摘要

- 阶段 0 不提前开发真实后端；
- SellerAgent 原型 + design token 是阶段 3 前的临时视觉基线；
- `knowledge`、`review` 入口直接删除；
- Pi Runtime 采用独立服务；首期生产允许 Docker Compose；
- CredentialStore 直接存项目数据库，管理员拥有绝对管理权限，但凭证不得暴露给闲鱼买家；
- `unknown` 作为 `externalOutcome`，不作为 OutboxStatus；
- 幂等作用域为 `adminId + accountId + route + Idempotency-Key`，默认保留 30 天；
- 鉴权基线为 SameSite=Lax、CSRF 双提交、WebSocket Origin allowlist、Session 空闲 30 分钟/绝对 8 小时、登录和密码变更后轮换；
- 卡券正文、夸克链接、提取码仅按 `buyer_deliverable`、订单已支付、商品与账号匹配、策略通过和审计完成后交付。

## 阶段边界

阶段 4 计划门禁已关闭并完成优先级重排。阶段 5 已完成 S4-VS1 账号管理人工放行，S4-VS2 商品与 S4-VS3 卡券具备主体链路；下一批进入 S4-VS5 在线聊天、S4-VS6 Workspace、S4-VS7A Settings API Key。账号/商品/卡券遗留的真实外部、持久化和视觉门禁继续登记和复核，不因优先级调整而宣称全部 PASS。

## Git 提交记录

- 阶段 0：`38862e5`（`feat: 阶段0文档产出`）
- 阶段 1：`cfc756b`（docs(阶段1): 完成架构与模块边界）
- 阶段 2：`076a969`（docs(阶段2): 完成数据库表设计与数据契约）
- 阶段 3：`66fd989`（docs(阶段3): 完成前端信息架构与状态契约）
- 阶段 3 门禁重开：`6c5533e`（docs(阶段3): 重开组件门禁并补充详细契约）
- 阶段 3 组件契约复审关闭：`bcf47b5`（docs(阶段3): 完成组件契约复审并关闭门禁）
- 阶段 4 主体功能纵向切片计划：`f55f7dc`（docs(阶段4): 编排主体功能纵向切片计划）
- 阶段 4 计划提交哈希回写：`3e0a0aa`（docs(阶段4): 回写主体切片计划提交哈希）
- 阶段 5 前端账号只读首片：`f72f688`（feat(阶段5): 落地账号管理前端只读切片）
- 阶段 5 路由骨架：`e2740a7`（feat(阶段5): 补充页面路由骨架）
- 阶段 5 测试门禁：`5c8f9e5`（test(验证): 建立阶段五前端测试门禁）
- 阶段 5 ENV-0 后端运行时：`d134f9d`、`2567714`、`50cbe0b`（基础运行时、bootstrap Cookie 重放、幂等竞争与异常清理）
- 阶段 5 账号真实读取链路与 ENV-0 部署骨架：`65b48d6`（feat(阶段5): 接通账号真实读取链路与ENV0部署骨架）
- 阶段 5 账号详情与连接状态读取：`2de5ff7`（feat(阶段5): 接通账号详情与连接状态读取）
- 阶段 5 账号登录会话状态机：`325161f`（feat(阶段5): 落地账号登录会话状态机）
- 2026-09-19 阶段5 S4-VS1 更新：二维码登录前后端闭环已接通；真实模式已验证二维码生成、轮询与取消，前端已展示二维码并自动轮询。人工扫码成功及外部闲鱼账号凭证落库仍需人工验收；风控 `verification_required` 保留为可恢复状态。
- 本轮提交：`c04b189`（`feat(阶段5): 接通闲鱼二维码登录与凭证校验`）。
- 本轮前端提交：`7cf0c0e`（`feat(阶段5): 完成账号管理前端与Chrome端到端验证`）。
- 本轮账号登录提交：`9388056`（`feat(阶段5): 完成账号登录与Chrome复核链路`）。
- 2026-09-19 二维码首开竞态已修复：保留 StrictMode，前端 QR controller 增加 in-flight 去重、弹窗增加一次性自动启动保护；Chrome/CDP E2E 断言首开仅发送 1 个二维码创建请求，前端并发回归测试已补齐。
- 2026-09-19 二维码 creating 卡死已修复：移除 StrictMode 开发期 cleanup 对有效请求的误失效，Chrome/CDP E2E 现在同时断言二维码区域实际渲染。
- 2026-09-19 本轮运行时统一：本地 dev 默认使用 PostgreSQL/Redis/MinIO，MemoryStore 仅限显式测试；Compose API/Worker 使用 `full` profile，避免与本地 API 竞争 `8080`。`/healthz`/`/readyz` 增加 `storage` 诊断字段。验证：`npm run verify`、真实本地 dev `storage=postgres`、PostgreSQL 管理员登录与账号列表读取均通过。
- 2026-09-19 人工裁决：S4-VS1 账号管理审核通过；账号列表及账号信息可正常加载。现存页面 UI 缺陷标记为非阻塞后续项，切换至 S4-VS2 商品管理。
- 2026-09-19 S4-VS2 商品列表/详情只读首片完成：003_catalog、统一商品 API、前端 Products feature、PostgreSQL smoke 和 Chrome/CDP E2E 均通过；商品写入、同步、素材、SKU、发布仍未宣称完成。
- 2026-09-19 S4-VS2 商品同步首片完成：`POST /api/v1/products/sync`、MTOP 脱敏 mapper、Memory/PostgreSQL 幂等 Upsert、本地草稿跳过、商品页同步按钮和 Chrome/CDP fixture E2E 均通过；提交 `edecc3e`。真实发布仍未接入。
- 2026-09-19 S4-VS2 商品同步入口修复完成：普通 `/products` 自动选择可用账号并携带 `accountId` 查询/同步，Chrome/CDP fixture 验证 29 件同步商品可见；本轮已单独提交。真实闲鱼外部验收仍待人工执行。
- 2026-09-19 S4-VS2 商品同步 Compose 回归修复：PostgreSQL 外部商品 Upsert 补齐部分唯一索引冲突谓词，真实 19 件账号同步由 500 恢复为 200 并落库；多账号无 query 时改为要求显式选择，避免静默同步到返回 0 件的错误账号。当前 Compose 两个账号实测为 0/19 件，用户所说 29 件仍待确认目标账号与统计口径。
- 2026-09-19 当前切片：账号管理新增软删除与全局账号上下文；商品页移除重复账号选择，新增“同步闲鱼 / 刷新本地 / 发布商品”三项动作。发布入口只创建本地草稿，不调用真实闲鱼发布接口。
- 验证证据：`npm run typecheck`、`npm test`、`npm run test:products:postgres`、`npm run test:e2e:chrome`、`npm run test:e2e:chrome:products`、`npm run compose:config`、`git diff --check` 均通过。
- 范围边界：账号上下文采用认证后前端壳层的 localStorage 持久化；删除账号采用软删除，撤销 scope/credential，保留历史商品与审计记录；真实闲鱼 APP 扫码和真实发布仍未完成外部验收。
- 2026-09-19 文档切片拆分提交：`d2ba0c3`（`docs(阶段5): 拆分未完成纵向切片`）；已同步更新阶段 4 计划、阶段 5 状态矩阵、数据/API 契约、组件 owner、风险、决策和评审记录。验证：`git diff --check`、风险号唯一性与 Markdown 风险表列数检查通过；未重复执行代码 E2E（本轮仅文档变更）。
- 2026-09-19 优先级重排提交：`56b6260`（`docs(阶段5): 重排聊天工作台与凭证切片`）；已将下一批切片调整为 `S4-VS5A/B/C`、`S4-VS6A/B`、`S4-VS7A`，并同步补齐 canonical API、账号级 CredentialStore、BusinessLinkVM、clientRunRef/Idempotency-Key 和风险/评审记录。验证：`git diff --check`、新风险号唯一性、canonical 路径和状态一致性检查通过；未执行代码 E2E（本轮仅文档变更）。
- 2026-09-19 多 Agent 协作规范提交：`9e1684c`（`docs(协作): 建立多agent worktree与合并锁规则`）；登记状态回写提交为 `1b39e6c`、`b278617`，已通过人工审核并在 merge lock 内以 `e9aaf782` 合入 `master`，随后完成 worktree/分支清理登记。
