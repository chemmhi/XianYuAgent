# XianyuSellerAgent 项目状态

- 项目阶段：5
- 阶段状态：进行中（S4-VS1 账号管理切片已获人工放行；S4-VS2 商品列表/详情只读首片已完成验证；页面仍有非阻塞 UI 缺陷，转为后续修复项）
- 最近一次通过门禁：S4-VS2 商品列表/详情只读首片复核 / 2026-09-19
- 当前目标：继续 S4-VS2 商品管理，已完成“按闲鱼账号同步商品到本地目录”首个纵向切片；下一步冻结并实现草稿编辑、SKU、素材和受控发布确认边界
- 已完成范围：阶段 0 范围门禁；阶段 1 架构与模块边界；阶段 2 数据模型、数据库表设计、关系基数、状态机、API envelope、幂等、鉴权、敏感交付、迁移边界；阶段 5 账号登录方法选择、真实 QR 适配器、Cookie 登录、账号资料同步、登录会话持久化、AuthGate 会话门禁、Vite 默认代理、账号列表真实读取和 Chrome/CDP 控制环境 E2E；S4-VS2 商品列表/详情只读首片、003_catalog 迁移、Memory/Postgres scope-aware 查询、真实 PostgreSQL smoke 和 Chrome/CDP 商品 E2E
- 未完成范围：完整商品创建/编辑、SKU 写入、素材上传、发布确认/Policy/Outbox、真实闲鱼 APP 扫码成功回调、真实外部 Cookie 验证、完整迁移/回滚/Testcontainers 与视觉差异回归；账号密码登录依赖独立浏览器运行时，当前明确不可用。商品同步首片已完成，但真实账号外部验收仍未完成
- 未解决风险：R-001/P1、R-002/P1、R-005/P2、R-006/P2、R-007/P2、R-008/P1、R-009/P1、R-011/P1、S3-I001/P1、S3-I002/P1、S3-I003/P1、S3-I004/P1、S3-I005/P1、S3-I006/P1、S3-I007/P1、S3-I008/P1、S4-I003/P1、S4-I004/P1、S4-I005/P1、S4-I006/P1、S4-I007/P2、S5-I001/P1、S5-I002/P1、S5-I003/P1、S5-I004/P1；S3-I009/S3-I010/S5-I006 已关闭，S4-I001/S4-I002 已部分缓解
- 待复审问题：S3-R5 为超出当前范围的实现审计；S3-R6 设计范围已澄清；S1-I004 保持 P2 跟进项；阶段 4 计划门禁已通过
- 下一步：继续 S4-VS2 商品草稿/素材/SKU 子切片；真实闲鱼 APP 扫码、外部 Cookie 验证、迁移回滚、重启恢复和 Testcontainers 证据继续作为独立复核项。商品同步已通过 Memory/PostgreSQL smoke、MTOP 脱敏 mapper smoke 和 Chrome/CDP fixture E2E；真实发布仍未接入

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

阶段 4 计划门禁已关闭。阶段 5 已完成 S4-VS1 账号管理切片人工放行，进入 S4-VS2 商品管理；账号切片遗留的非阻塞 UI 缺陷继续登记和修复，不阻断商品切片。真实闲鱼 APP 扫码、外部 Cookie 验证、完整迁移回滚/Testcontainers 和发布级恢复仍作为独立待复核项。

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
