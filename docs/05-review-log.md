# XianyuSellerAgent 阶段评审记录

- 文档版本：v0.5
- 更新日期：2026-09-19
- 评审规则：问题先修复，再复验，再由独立评审关闭；未关闭的 P0-P2 不得进入下一阶段。

## 1. 阶段 0 评审结论

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| S0-R1 | 业务 / 验收 | PASS | PRD 范围、J-01 至 J-06、正式页面、管理员角色、交付边界已确认 |
| S0-R2 | 可实现性 / 边界 | PASS | SellerAgent/npm test、SellerAgent/npm run build、git diff --check 通过；真实后端转后续阶段 |
| S0-R3 | 异常 / 安全 / 运维 | PASS | 凭证、交付数据、失败路径、回滚边界和阶段后置实现已确认 |

阶段 0 门禁：PASS。阶段 0 只锁定范围，不提前开发真实后端、数据库、API 或 Docker Compose。

## 2. 阶段 0 问题关闭

| 问题编号 | 修复动作 | 状态 |
| --- | --- | --- |
| S0-I001 | 缺少后端、数据库和部署骨架明确为后续阶段范围，转为 R-001 | CLOSED |
| S0-I002 | SellerAgent 原型 + design token 作为临时视觉基线，阶段 3 固定 viewport | CLOSED |
| S0-I003 | 直接删除 knowledge/review 入口及页面分支，不保留隐藏或内部入口 | CLOSED |
| S0-I004 | 用户确认阶段 0 只验收范围锁定 | CLOSED |
| S0-I005 | 用户确认阶段 0 从 BLOCKED 转 PASS 的裁决 | CLOSED |

## 3. 阶段 1 评审结论

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| S1-R1 | 业务 / 模块映射 | PASS | `docs/01-architecture.md` §4.1、§6、§6.1；用户于 2026-09-19 接受 |
| S1-R2 | 架构 / 数据流 | PASS | `docs/01-architecture.md` §5、§7；ADR-001/002/006/007；用户于 2026-09-19 接受 |
| S1-R3 | 质量 / 安全 / 运维 | PASS | `docs/01-architecture.md` §8.1/§8.2；ADR-003/004；用户于 2026-09-19 接受 |

阶段 1 门禁：PASS。S1-I004（四环境拓扑）降为 P2 跟进项，不影响阶段 1 通过。

## 4. 阶段 2 评审结论

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S2-R1 | 架构 / 数据模型 | 实体字段、PK/FK、唯一约束、关系基数、状态机、生命周期 | repo_audit | PASS | `docs/02-data-api.md` §2-§4、§10-§11；`docs/02-database-schema.md` §2-§5；修订后复核通过 |
| S2-R2 | API / 契约 | envelope、HTTP 语义、分页、错误码、幂等、P0 API 覆盖 | repo_audit | PASS | `docs/02-data-api.md` §5、§10-§11；`docs/02-database-schema.md` §3；S2-I001/S2-I002 已按用户裁决关闭 |
| S2-R3 | 安全 / 运维 | SameSite、CSRF、Session、账号范围、敏感交付、迁移和回滚 | manual_review_points | PASS | `docs/02-data-api.md` §6-§8；`docs/02-database-schema.md` §4-§5；S2-I003/S2-I004/S2-I005 已按用户裁决关闭 |

阶段 2 门禁：PASS。允许进入阶段 3 前端信息架构与 API 映射设计；仍不得提前创建真实后端实现。

## 5. 阶段 3 评审结论

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S3-R1 | 业务 / 验收 | 8 个正式页面、canonical path、用户旅程、异常态和确认卡边界 | stage3_review | PASS | `docs/03-frontend-design.md` §1、§3、§6–§7；本次门禁不以源码导航实现为证据 |
| S3-R2 | 架构 / 数据流 | 组件树、状态归属、请求生命周期、缓存失效、WebSocket、阶段 2 API 映射 | repo_audit | PASS | `docs/03-frontend-design.md` §4–§10；`docs/02-data-api.md` §5–§11 |
| S3-R3 | 质量 / 安全 / 运维 | 权限一致性、敏感数据边界、可访问性、viewport、回滚与后续验证边界 | root + stage3_review | PASS | `docs/03-frontend-design.md` §2、§5、§8、§9、§11；`docs/07-visual-acceptance.md` |
| S3-R4 | 视觉 | SellerAgent 原型、design token、1440×900 / 390×844、状态映射可追踪性 | stage3_review | PASS | `xianyu-admin-design-style/assets/design-tokens.json`；`docs/03-frontend-design.md` §2、§8、§10 |

阶段 3 初审结论：PASS。但该结论仅覆盖页面旅程和概念映射，不覆盖实现级组件职责落地。

### 5.1 阶段 3 组件职责复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S3-R5 | 架构 / 组件 / 数据流 | 是否存在超级组件、页面职责是否拆分、Controller/ViewModel/API/移动端是否完整 | component_split_review + feature_coverage_review | OUT OF SCOPE | 该复核以源码实现为证据；用户已明确阶段 3 只审设计，不以源码或原型作为组件设计依据 |

### 5.2 阶段 3 设计范围澄清

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S3-R6 | 范围 / 设计门禁 | 当前阶段只进行组件设计；高保真原型仅作视觉参考；源码不作为组件拆分依据；本阶段不编码 | 用户 | ACCEPTED | `docs/03-component-contract.md` §1、§9、§10；`docs/09-decision-log.md` 阶段 3 范围澄清 |

阶段 3 门禁：PASS。组件职责、数据流、路由/API、8×2 页面矩阵和独立设计复审均已完成；阶段 4 可进入执行门禁编排，但本阶段未进行具体编码。

| S3-R7 | 设计 / 组件 / 数据流 | 详细组件契约、canonical ViewModel、route/API catalog、设计级反超级组件 | feature_coverage_review | PASS | `docs/03-component-contract.md`；RunActionBar/Outbox recover、RuntimePanel/OutboxPanel 拆分、8×2 矩阵、queryKey/account isolation、ControllerResult/error map、stockAlert/inventoryStatus 均已复核 |

## 6. 阶段 2 人工裁决关闭记录

| 编号 | 用户裁决 | 关闭结论 |
| --- | --- | --- |
| S2-I001 | `unknown` 不作为 OutboxStatus | `unknown` 仅作为 `externalOutcome` 字段 |
| S2-I002 | 幂等作用域和保留期 | `adminId + accountId + route + Idempotency-Key`，默认 30 天；同指纹重放原结果，不同指纹冲突 |
| S2-I003 | 鉴权安全基线 | SameSite=Lax、CSRF 双提交、WebSocket Origin allowlist、Session 空闲 30 分钟/绝对 8 小时、登录和密码变更后轮换 |
| S2-I004 | 交付数据边界 | 三类 deliveryScope、正文读取、交付预览和订单交付 API 纳入阶段 2 |
| S2-I005 | CredentialStore 范围 | CRUD、rotate、revoke、enable、disable 纳入阶段 2；管理员绝对管理但不得暴露给买家 |

## 7. 当前失败点（供人工复核）

当前仅保留设计/API 契约阻断；源码拆分和原型实现问题转为后续阶段风险，不作为当前阶段 3 设计门禁证据：

| 编号 | 风险 | 级别 | 处理阶段 |
| --- | --- | --- | --- |
| S1-I004 | local/test/staging/production 的完整拓扑、环境隔离和回滚演练尚未实现 | P2 | 阶段 7/8 |
| R-011 | 原型 `localStorage.auth_token` 尚未替换为真实 Session + HttpOnly Cookie | P1 | 阶段 5/6 |
| R-008 | CredentialStore 字段加密、备份与轮换演练尚未实现 | P1 | 阶段 7 |
| S3-I005 | 原型源码集中路由、全局反馈、业务动作和 DOM click capture，形成超级组件 | P1 | 后续实现阶段，非当前设计门禁 |
| S3-I006 | 原型源码 Settings、Workspace、Auth、ProductEditor 职责过宽 | P1 | 后续实现阶段，非当前设计门禁 |
| S3-I007 | 原型源码 DTO 与阶段 2 canonical 状态不一致 | P1 | 后续实现阶段，非当前设计门禁 |
| S3-I008 | 原型源码 Products/Coupons/Orders 移动端回退 Dashboard | P1 | 后续实现阶段，非当前设计门禁 |

如出现新的越权、凭证明文泄露、库存重复扣减、不可回滚迁移或核心链路不可用，必须重新打开阶段门禁并人工复核。

## 8. 阶段 3 已关闭问题

| 编号 | 关闭结论 | 复核证据 |
| --- | --- | --- |
| S3-I009 | VERIFIED / CLOSED：FirstRun bootstrap 与消息 handoff 的 canonical endpoint、字段和缓存失效语义跨文档一致 | `docs/02-data-api.md`、`docs/03-frontend-design.md`、`docs/03-component-contract.md`；MR-015/MR-016 |
| S3-I010 | VERIFIED / CLOSED：ControllerResult、canonical ViewModel、错误码映射和反超级组件规则经独立设计复审通过 | `docs/03-component-contract.md` §6.9、§8、§9、§10；S3-R7 / MR-018 |

## 9. 阶段 4 计划门禁

阶段 4 仍只做迭代计划与纵向切片编排，不写业务代码；阶段 5 才按切片执行实现。

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S4-R1 | 业务 / 验收 | 账号管理 → 商品管理 → 卡券首页/库存 → 订单列表/详情/交付的主体功能优先级、用户旅程和后置范围 | stage4_slice_plan | PASS | `docs/04-plan.md` §1、§3、§4；Dashboard、Messages、Workspace、Settings 不抢占前四片 |
| S4-R2 | 架构 / 数据流 | ENV-0、账号范围、Execution foundation、API/VM、query invalidation 和 VS1→VS2→VS3→VS4 依赖 | stage4_dependency_audit | PASS | `docs/04-plan.md` §2、§3、§5；执行基础与最小审计前置，QR session 与 login-session 分离；迁移拆分、DTO 冻结、fixture/清理责任在阶段 5 各片执行前回写并验证 |
| S4-R3 | 质量 / 安全 / 运维 | 幂等、unknown/timeout、敏感交付、库存锁、审计、测试证据、视觉基线和回滚动作 | stage4_gate_review | PASS | `docs/04-plan.md` §3、§5、§6；阶段 5 执行时逐片留存真实测试、视觉和回滚证据 |

阶段 4 计划门禁：PASS。允许进入阶段 5 的 S4-VS1 账号管理真实纵向切片；未满足 ENV-0 或首片字段冻结前，不得扩展到商品、卡券和订单写入。

## 10. 阶段 5 ENV-0 与 S4-VS1 首片复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R1 | 基础设施 / 安全 | API、Worker、Session/CSRF、统一 envelope、幂等、账号范围、最小审计、Memory/Postgres store | env0_recon + root | PASS（内存运行） | `apps/api/src/app.ts`、`apps/api/src/services.ts`、`apps/api/scripts/smoke.mjs`；`npm run test:api` |
| S5-R2 | 前端 / API 适配 | 账号只读页面按 AccountVM/Controller/StateBoundary 拆分，接入 canonical `/api/v1/accounts` envelope | account_frontend_recon + root | PASS（迁移复核中） | `apps/web/src/features/accounts/`、`apps/web/src/features/accounts/api.test.ts`、`npm run typecheck:web`、`npm run test:web` |
| S5-R3 | 运维 / 发布 | Compose 拓扑与迁移文件可解析，容器实跑与 PostgreSQL/Redis 持久化验证 | root | PARTIAL PASS | `docker compose up -d --build` 已启动；health/ready、`pg_isready`、Redis `PONG`、账号写入/列表读取和 API 重启后持久化复读通过；迁移回滚/Testcontainers 未覆盖 |

阶段 5 当前结论：允许继续 S4-VS1 账号管理；AuthGate 未认证阻断、bootstrap cookie 注入、账号列表、登录方式选择、受控 Cookie 登录和 1440×900 / 390×844 截图的 Chrome/CDP E2E 已通过。仍不得宣称 PostgreSQL/Redis 容器、真实闲鱼扫码成功、真实凭证落库或完整视觉回归已完成；商品、卡券、订单仍冻结。
- 2026-09-19 S5-R4：QR/login-session 复核为 PARTIAL PASS。后端真实二维码生成、轮询与取消通过；前端二维码展示、状态轮询、重试/取消、成功后刷新已通过构建与单测。人工扫码成功及外部凭证落库尚未完成，不能关闭该门禁。

### 10.1 账号登录切片增量复核（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R5 | 纵向切片 / Cookie 登录 | Cookie 校验、账号创建或更新、CredentialStore、闲鱼资料同步、登录会话状态和账号列表读取 | api_onboarding_smoke + root | PASS（受控 adapter） | `apps/api/scripts/onboarding-smoke.mjs`；`npm --workspace apps/api run test`；`docs/13-account-login-slice.md` §3.2 |
| S5-R6 | 前端 / 浏览器 E2E | 登录方式选择、旧占位创建弹窗移除、无模拟二维码、Cookie 登录后昵称/备注回显和列表刷新 | chrome_e2e + root | PASS（受控 harness） | `apps/web/scripts/e2e-chrome.mjs`；`npm run test:e2e:chrome`；`docs/evidence/stage5/S4-VS1/screenshots/` |
| S5-R7 | 外部平台 / 人工验收 | 真实闲鱼 APP 扫码、真实 Cookie 验证、`verification_required` 恢复路径、外部凭证落库 | manual_review | PENDING | 必须在当前已登录 Chrome 打开 `http://localhost:9000/accounts` 后执行；真实扫码成功前不得关闭 |
| S5-R8 | 数据库 / 运维 | PostgreSQL/Redis 迁移、重启恢复、真实持久化和容器级 E2E | root | PARTIAL PASS | 容器健康、真实账号写入/读取与 API 重启后的持久化复读已通过；完整迁移回滚、Testcontainers 和发布级恢复演练仍待补证 |

### 10.2 人工复核入口

1. 参考项目 `http://localhost:9000/accounts` 必须在当前已经打开且已登录的 Chrome 中访问；新建 profile、无痕窗口或另一浏览器不视为等价环境。
2. 使用真实闲鱼 APP 扫描项目生成的二维码，记录 waiting → scanned → succeeded 或 `verification_required` 的实际结果。
3. 成功后核对昵称、备注、头像、平台用户 ID、CredentialStore 和 `account_login_sessions` 是否来自服务端持久化；买家侧不得看到 Cookie、Token 或内部凭证。
4. 若出现风控挑战，保留 `verificationUrl` 和失败码，禁止人工把失败状态改成 `succeeded`。

### 10.3 404 / Vite proxy / AuthGate 增量复核（2026-09-19）

本节记录当前工作树在 AuthGate 与开发代理修复后的最新证据。此前 S5-R6 的 PASS 结论已由本节重新执行并覆盖到当前增量。

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R9 | 开发环境 / 路由 | 浏览器 `/api/v1/auth/session` 是否因 Vite 未配置代理而落到 404 | root | PASS | `apps/web/vite.config.ts` 默认转发到 `http://127.0.0.1:8080`；未设置 `VITE_API_PROXY_TARGET` 时，经 Vite 代理请求返回 HTTP 200 canonical envelope |
| S5-R10 | 前端 / 鉴权门禁 | `App` 根布局是否先经过 `AuthGate`，并按 session、bootstrap、login、error、authenticated 分支阻断或放行业务页面 | root | PASS（受控 E2E） | `apps/web/src/app/App.tsx`、`apps/web/src/features/auth/`；未认证 `/accounts` 不渲染业务面，bootstrap cookie 注入后才放行账号列表 |
| S5-R11 | 外部适配器 / QR | 真实 QR 适配器是否保留 token 初始化、二维码生成、轮询、取消、超时和 `verification_required` | root | PARTIAL PASS | `apps/api/src/xianyu-qr-login.ts`、`apps/api/src/xianyu-mtop.ts`；受控 API smoke/adapter 测试通过，真实 APP 扫码和外部凭证落库仍待人工验收 |
 | S5-R12 | 浏览器 E2E / 交付门禁 | AuthGate 增量后是否可重新通过 Chrome/CDP、Cookie 登录和截图生成 | root | PASS（受控 harness） | `npm run test:e2e:chrome` 已通过：未认证 AuthGate 阻断、bootstrap cookie 注入、账号列表、登录方式选择、无旧创建弹窗、无模拟二维码、Cookie 登录和页面可见资料均通过；截图已重生成 |

### 10.5 二维码首开竞态修复（2026-09-19）

| 评审编号 | 类型 | 发现 | 处理 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-I013 | 前端并发 / QR | 开发模式 `StrictMode` 重放 `AccountLoginModal` 首次 effect，导致首开并发发送两个 `POST /api/v1/auth/qr-sessions`；后一个请求可能收到 `IDEMPOTENCY_IN_PROGRESS`，覆盖前一个成功结果并显示“二维码生成失败” | QR controller 增加 in-flight promise 去重，弹窗增加一次性自动启动保护；保留 `StrictMode`，不以关闭开发检查规避问题 | CLOSED | `apps/web/src/features/accounts/qr-login/controller.ts`、`apps/web/src/features/accounts/components/AccountLoginModal.tsx`、`apps/web/src/features/accounts/qr-login/controller.test.ts` |
| S5-R13 | 回归验证 | 首次打开二维码弹窗只能发出一个创建请求，且后续重试仍可执行 | Chrome/CDP E2E 监听 `Network.requestWillBeSent` 并断言首开创建请求数为 1；前端单测验证并发调用共享同一 promise；API smoke、构建和类型检查通过 | PASS（受控环境） | `npm run test:e2e:chrome`、`npm run test:web`、`npm run test:api`、`npm run build`、`npm run typecheck:web` |

本项只关闭前端首开竞态，不替代真实闲鱼 APP 扫码、外部凭证落库和人工验收门禁。

### 10.6 二维码 creating 状态卡死修复（2026-09-19）

| 评审编号 | 类型 | 发现 | 处理 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-I014 | 前端生命周期 / QR | React `StrictMode` 的开发期 effect cleanup 递增 `requestId`，但自动启动保护阻止第二次 start；首个 API 成功结果被判定为过期，界面永久停在 `creating` | 不再在普通卸载 cleanup 中使请求失效；真实登录方式切换仍在 `enabled=false` 分支中取消旧请求并重置去重锁 | CLOSED | `apps/web/src/features/accounts/qr-login/controller.ts` |
| S5-R14 | 浏览器 E2E | 仅断言 POST 发出不足以覆盖“请求成功但 UI 仍卡住” | Chrome/CDP 额外断言 `.qr-login-code` 已渲染；类型检查、前端单测和 Chrome E2E 通过 | PASS（受控环境） | `apps/web/scripts/e2e-chrome.mjs`；`npm run typecheck:web`；`npm run test:web`；`npm run test:e2e:chrome` |

当前增量复核结论：Vite 代理 404 根因已关闭；AuthGate 代码接入和受控浏览器门禁已通过；根 `npm run verify` 已通过。Compose 已完成容器健康与账号持久化复读，但完整迁移回滚/Testcontainers/发布级恢复、真实闲鱼 APP 扫码与外部 Cookie 验证仍待人工复核。

### 10.7 S4-VS1 账号管理人工放行（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R15 | 人工验收 / 账号管理 | 账号管理页面是否可进入、账号列表是否能正常加载并展示账号信息 | 用户 | PASS（人工放行） | 用户确认：账号管理审核通过，列表可正常加载账号信息 |
| S5-I015 | 遗留问题 / UI | 页面仍存在若干 UI 缺陷，但未影响账号列表读取、账号信息展示或进入下一主体切片 | 用户 + root | NON-BLOCKING | 转入后续 UI 修复队列；不阻断 S4-VS2 |

本次放行仅针对账号管理切片的可用性与进入下一切片条件；真实闲鱼 APP 扫码、外部 Cookie 验证、完整迁移回滚/Testcontainers 和发布级恢复仍保留独立待复核状态。

### 10.8 S4-VS2 商品列表/详情只读首片复核（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R16 | 后端 / 数据 | 003_catalog 迁移、Product domain、账号 scope 过滤、分页/筛选/排序、列表/详情 API、403/404/422 错误 envelope | inspect_product_backend + root | PASS | `apps/api/migrations/003_catalog.sql`、`apps/api/src/services.ts`、`apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`apps/api/scripts/products-smoke.mjs`；`npm run test:api` |
| S5-R17 | 数据库 / 持久化 | 真实 PostgreSQL 执行迁移、写入商品、通过 API 读取列表/详情、校验后清理测试数据 | root | PASS | `apps/api/scripts/products-postgres-smoke.mjs`；`npm run test:products:postgres` |
| S5-R18 | 前端 / 组件边界 | Products feature 按 api/controller/types/components 拆分；列表 loading/empty/error/forbidden；详情抽屉、重试和移动端共用 controller | inspect_product_frontend + root | PASS | `apps/web/src/features/products/`、`apps/web/src/app/App.tsx`；`npm run test:web`、`npm run typecheck:web`、`npm run build:web` |
| S5-R19 | 浏览器 / 端到端 | 本机 Chrome/CDP 从 `/products` 进入真实 API，读取商品列表、打开详情、刷新后确认商品仍可见 | root | PASS | `apps/web/scripts/e2e-products-chrome.mjs`；`npm run test:e2e:chrome:products`；`docs/evidence/stage5/S4-VS2/screenshots/` |
| S5-R20 | 范围 / 发布门禁 | 商品创建/编辑、SKU、素材、同步/拉取、发布确认、Policy、Outbox 是否被错误宣称完成 | root | PARTIAL PASS | 首片明确只读；完整 S4-VS2 仍保持开放，后续必须补写入状态机、外部同步和发布链路后再复审 |

### 10.10 S4-VS2 商品同步入口账号上下文复核（2026-09-19）
| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R25 | 前端 / 账号上下文 | 普通 `/products` 入口是否自动加载账号、选择可用账号、刷新列表并启用同步按钮 | root + inspect_sync_ui_bug | PASS | `apps/web/src/features/products/account-scope.ts`、`ProductsPage.tsx`、`ProductToolbar.tsx`；`npm run typecheck:web`、`npm --workspace apps/web run test` |
| S5-R26 | 浏览器 / 端到端 | 无 `accountId` query 时是否能选择账号、触发同步并展示 29 件同步商品 | root + inspect_sync_backend_bug | PASS（fixture adapter） | `apps/web/scripts/e2e-products-chrome.mjs`；`npm run test:e2e:chrome:products` |
| S5-R27 | 范围 / 发布门禁 | 修复是否误触发真实发布或修改闲鱼发布链路 | root | PASS | 仅修复账号上下文和同步入口；仍只调用 `POST /api/v1/products/sync`，未接入发布 |

本轮结论：已关闭“普通 `/products` 入口同步按钮置灰”问题；真实闲鱼账号的 29 件商品仍需在当前已登录 Chrome / Compose 环境执行人工外部验收，fixture E2E 不替代外部平台验收。

### 10.9 S4-VS2 商品同步只读切片复核（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R21 | 后端 / 闲鱼适配 | MTOP 商品卡片脱敏映射、分页聚合、账号 scope、凭证失效错误边界 | root + inspect_product_backend | PASS（受控 adapter） | `apps/api/src/xianyu-product-mapper.ts`、`apps/api/src/xianyu-mtop.ts`、`npm --workspace apps/api run test` |
| S5-R22 | 数据 / 幂等 | `(accountId, externalProductRef)` Upsert、重复同步更新、本地草稿跳过、Memory/PostgreSQL 一致性 | root | PASS | `apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`apps/api/scripts/products-sync-smoke.mjs`、`npm run test:products:postgres` |
| S5-R23 | 前端 / Chrome E2E | 商品页触发“从闲鱼同步”，真实 API/store 返回同步商品并刷新列表；不调用真实发布 | root | PASS（fixture adapter） | `apps/web/scripts/e2e-products-chrome.mjs`、`npm run test:e2e:chrome:products` |
| S5-R24 | 发布范围门禁 | 同步切片是否误触发闲鱼真实发布、素材上传、Outbox/Worker | root | PASS（范围受控） | 当前仅新增 `POST /api/v1/products/sync`；发布继续保持未实现，后置到 Policy → Confirmation → Outbox → Worker |

本轮门禁结论：S4-VS2 商品列表/详情只读首片 PASS，可继续同一商品切片的草稿、素材、SKU 和发布子切片；不能将当前结果表述为完整商品管理或真实闲鱼商品同步/发布完成。

### 10.11 S4-VS2 商品同步 Compose 回归复核（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R28 | 后端 / PostgreSQL | 外部商品 Upsert 是否正确命中 `products_account_external_ref_uq` 部分唯一索引，避免真实同步返回 500 | root | PASS | `apps/api/src/store-postgres.ts` 在 `ON CONFLICT` 中补充 `WHERE external_product_ref IS NOT NULL`；`npm run test:products:postgres` 通过；真实 Compose 同步接口返回 200 |
| S5-R29 | 前端 / 账号上下文 | 多个可用闲鱼账号时是否避免静默选中错误账号，要求显式选择后再加载/同步 | root + inspect_sync_backend_bug | PASS（受控 E2E） | `apps/web/src/features/products/account-scope.ts`、`ProductStateView.tsx`；`npm run test:web`、`npm run test:e2e:chrome:products` 通过 |
| S5-R30 | 外部平台 / 商品数量口径 | 当前 Compose 凭证是否实际返回用户所说的 29 件商品 | root + inspect_sync_backend_bug | PENDING 人工复核 | 当前两个 connected 账号 MTOP 实测分别返回 0 和 19 件；`nextPage=false`，在售分组为 19；未发现可安全推导 29 件的分组/分页参数，不能用 fixture 结果替代外部验收 |

本轮结论：已关闭 PostgreSQL 同步 500 与多账号误选账号两个代码问题；真实闲鱼“29 件”数量口径仍需确认目标账号及是否包含非在售分组，当前同步继续保持只读在售范围，不伪造或扩大外部数量。

### 10.4 本地 dev / Compose 数据源统一复核（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R13 | 开发环境 / 数据源 | 本地 dev 是否与 Compose 使用同一 PostgreSQL/Redis/MinIO，且不再静默回退 MemoryStore | root | PASS | `apps/api/src/config.ts` 默认 `ALLOW_IN_MEMORY=false`；根 `dev:*` 显式注入宿主机 PostgreSQL/Redis；`GET /healthz` 返回 `storage=postgres`、`database=ok`、`redis=configured` |
| S5-R14 | 运行编排 / 端口 | 本地 API 与 Compose API 是否避免同时占用 `8080` | root | PASS | `docker-compose.yml` 的 API/Worker 使用 `full` profile；`npm run dev` 的 `dev:prepare` 停止 Compose API/Worker 后再启动本地进程 |
| S5-R15 | 管理员初始化 / 认证 | 初始化页是否仍由真实 `bootstrapRequired` 驱动，已有管理员时是否只显示登录页 | root | PASS | `GET /api/v1/auth/session` 返回 `bootstrapRequired=false` 与 PostgreSQL 中现有管理员一致；`1051585831@qq.com` 登录成功，账号列表读取成功 |

本轮结论：本地 dev 与 Compose 已统一持久化数据源；当前不显示初始化页是因为开发 PostgreSQL 已存在管理员，不是前端渲染缺陷。若需再次演示首次初始化，必须人工确认后清理管理员数据。
- 2026-09-19 S5-R31 账号上下文与删除账号：PASS。账号管理新增 `DELETE /api/v1/accounts/{id}` 软删除，撤销当前管理员 scope 与 active credential，保留历史商品/审计；前端通过 `AccountContextProvider` + localStorage 传播当前账号，商品页不再重复选择账号。证据：`npm test`、`npm run test:e2e:chrome`、`npm run test:e2e:chrome:products`。
- 2026-09-19 S5-R32 商品动作边界：PASS。商品页明确区分“同步闲鱼”（POST `/api/v1/products/sync`）、“刷新本地”（GET `/api/v1/products`）和“发布商品”（仅打开本地草稿流程）；Chrome/CDP E2E 覆盖同步、刷新网络门禁、草稿创建/详情/编辑/持久化及 UI 账号切换。
