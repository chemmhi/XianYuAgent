# XianyuSellerAgent 阶段评审记录

- 文档版本：v0.6
- 更新日期：2026-09-19
- 评审规则：问题先修复，再复验，再由独立评审关闭；未关闭的 P0-P2 不得进入下一阶段。

## 2026-09-21 消息重复落库修复复审

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| S5-R-CHAT-DEDUPE-01 | 业务 / 验收 | PASS | 历史同步与实时 push 对同一闲鱼消息统一使用稳定 `.PNM` 外部消息号，避免同一买家消息生成两条本地记录和两次 AI 出站 |
| S5-R-CHAT-DEDUPE-02 | 架构 / 数据流 | PASS | `parsePushPayload`、`normalizeHistoryMessage` 和既有 `(conversation_id, external_message_ref)` 唯一约束形成同一幂等键；前端无需按正文强行合并 |
| S5-R-CHAT-DEDUPE-03 | 质量 / 运维 | PASS | `npm --workspace apps/api run test:xianyu-im-gateway`、`npm --workspace apps/api run test:auto-reply:unit`、`npm test`、`npm run typecheck`、`npm run build`、`git diff --check` 均通过 |

复审结论：本轮消息重复落库缺陷已修复；历史上已存在的重复数据未自动删除，避免破坏 `auto_reply_runs.inbound_message_id` 外键和审计链路。

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

### 10.12 S4-VS3 卡券首页合并后复核（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R33 | 后端 / API | 批次、`purpose` 类型、metadata、列表安全摘要、PATCH/PUT 编辑、库存导入、绑定、作废、DELETE 软作废、正文受控预览、scope、审计和加密存储 | root + backend_coupons | PASS（受控环境） | `apps/api/src/services.ts`、`apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`apps/api/migrations/013_coupons.sql`、`apps/api/migrations/014_coupon_card_metadata.sql`；`node apps/api/scripts/coupons-smoke.mjs` |
| S5-R34 | 前端 / API 适配 | `/coupons`、搜索/类型筛选（变更即生效）、选择列/批量删除、详情/创建/编辑/复制、启用/禁用、导入/绑定、双栏关联、图片原图预览、错误状态、content 预览/复制、字段映射 | root | PASS（受控环境） | `apps/web/src/features/coupons/`；`npm test`；`npm run typecheck`；`npm run build` |
| S5-R35 | 真实浏览器 / 人工审核 | 正式路由 → 真实 API → MemoryStore → 列表安全元数据列 → 选择/关联 → 编辑/复制 → 启禁用 → 详情/预览/导入/绑定/作废 → 刷新后状态保持，以及平台样式一致性和移动 viewport | 用户 | READY_FOR_REVIEW | `apps/web/scripts/e2e-coupons-chrome.mjs`；`npm run test:e2e:chrome:coupons`；`docs/evidence/stage5/S4-VS3/test-baseline.md`；人工审核结论待回写，不再阻断代码合入但仍是发布门禁 |

本轮结论：S4-VS3 已与 S4-VS2 共享代码路径并入 `master`；自动化证据保持受控环境边界，真实 PostgreSQL/Redis/MinIO 及浏览器人工复核仍需按 runbook 执行。

2026-09-20 工具栏 follow-up 复核：`5a9f3cb` 已合入 `master`，补充“新建卡券”置末、移除 `共 N 张` 统计和居中空态文案回归；`CouponToolbar.test.ts`、`CouponStateView.test.ts`、Coupons Chrome/CDP E2E 及主线构建/类型检查作为证据。S5-R35 仍保持 `READY_FOR_REVIEW`，不代表真实持久化或人工视觉门禁已关闭。

### 10.13 未完成任务切片拆分复核（2026-09-19）

本节只复核“后续工作是否被拆成可执行纵向切片”，不把计划当作实现结论。

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R36 | 业务 / 验收 | 商品草稿、SKU、素材、受控发布、外部同步、卡券库存、订单交付和环境门禁是否有清晰用户路径、正式路由、非目标与完成门禁 | root + 待人工复核 | READY_FOR_REVIEW | `docs/04-plan.md` §3.1；`STATUS.md` 未完成切片索引 |
| S5-R37 | 架构 / 数据流 | 每个切片是否有独立 owner、API/store/migration 边界、账号 scope、状态机、幂等/审计和回滚；迁移 `013` 并行编号是否被显式阻断 | root + 待独立复核 | READY_FOR_REVIEW | `docs/02-data-api.md` §12；`docs/03-component-contract.md` §11；`docs/09-decision-log.md` 未完成任务切片化决策 |
| S5-R38 | 质量 / 安全 / 运维 | 是否明确真实 PostgreSQL/Redis/MinIO、Chrome/CDP、视觉状态、Testcontainers、恢复和外部账号证据；是否避免 smoke/mock 冒充完成 | root + QA/运维待复核 | BLOCKED | `docs/06-risk-register.md` `S5-RISK-013~S5-RISK-020`；`S4-ENV-RECOVERY`、`S4-EXT-ACCOUNT`、`S4-ENV-RUNTIME` 尚无完成证据 |

当前切片拆分门禁结论：`READY_FOR_REVIEW`。切片规划已写入文档，但尚未授权把任何新增切片标记为 `PASS`；实现阶段必须按单片执行 5 → 5.5 → 6 门禁，并在每片完成后追加独立业务/架构/质量复审记录。

### 10.14 优先级重排复核：在线聊天 / Workspace / Settings API Key（2026-09-19）

本节复核基础域已成型后的下一批开发顺序，不代表三项功能已经实现。

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R39 | 业务 / 验收 | 在线聊天、Workspace、Settings API Key 是否分别拆成可交付用户旅程，并明确先后顺序与非目标 | root + 待人工复核 | READY_FOR_REVIEW | `docs/04-plan.md` §3.2；`docs/10-stage5-progress.md` 优先切片队列 |
| S5-R40 | 架构 / 数据流 | Messages、Workspace、CredentialStore 是否保持独立 owner、API/store/WS/Runtime 边界，是否复用既有账号上下文 | root + 待独立复核 | READY_FOR_REVIEW | `docs/02-data-api.md` §13；`docs/03-component-contract.md` §12 |
| S5-R41 | 质量 / 安全 / 运维 | WebSocket 重连、Run unknown、Outbox recover、API Key 脱敏/加密/轮换是否都有真实测试和回滚门禁 | root + QA/安全待复核 | BLOCKED | `docs/06-risk-register.md` `S5-RISK-021~S5-RISK-026`；真实实现与证据尚未开始 |

重排结论：下一批只进入 `S4-VS5A/B/C`、`S4-VS6A/B`、`S4-VS7A`；订单交付及其他 Settings/运营页面继续后置。账号、商品、卡券的剩余真实环境复核仍按原风险矩阵推进，不被本次重排宣称为全部 PASS。

### 2026-09-19：S4-VS6A 首链路复审结论

- 业务/架构复核：Workspace 已形成 AgentSession → Run → Step → event stream 的受控首链路；Run 绑定 `accountId + sessionId`，状态迁移由服务端负责，前端只消费脱敏 ViewModel。
- 质量复核：API Workspace 专项 smoke、raw WebSocket smoke、Web typecheck/test/build 均通过；覆盖 `clientRunRef` 去重、`Idempotency-Key` 冲突、cursor replay 去重、Origin/认证/404 门禁。
- 结论：`S4-VS6A = PARTIALLY_VERIFIED`。受控进程内 Runtime 和 MemoryStore 只能证明首链路行为，不足以关闭独立 Worker/Pi Runtime、真实 PostgreSQL 持久化、浏览器 E2E/视觉和人工断线恢复门禁。
- 后续门禁：先补真实 Worker/Pi Runtime 与 Postgres smoke，再补 Chrome/CDP `1440x900` / `390x844` 截图和断线恢复复核；Confirmation/Outbox 不提前并入本片，按 `S4-VS6B` 执行。

### 2026-09-20：S4-VS6A 证据复核与状态维持

- 本轮复核通过：`npm --workspace apps/api run build`、`npm --workspace apps/api run test`、Workspace HTTP/WS smoke、`npm --workspace apps/web run typecheck`、`npm --workspace apps/web run test`（13 files / 41 tests）、`npm --workspace apps/web run build`、`git diff --check`。
- 真实浏览器 `npm run test:e2e:chrome:workspace` 通过：临时 PostgreSQL 迁移 001–015、`ALLOW_IN_MEMORY=false` API、Vite、Chrome/CDP、session/Run 持久化、断线重连、7 条事件回放、WS handshake 和 1440×900 / 390×844 截图均有可复现证据。
- 结论维持：`S4-VS6A = PARTIALLY_VERIFIED`；本轮切片文档/独立复核状态为 `READY_FOR_REVIEW`，未关闭独立 Worker/Pi Runtime、发布级恢复、人工视觉签核与 `S4-VS6B` Confirmation/Outbox 门禁。

### 2026-09-20：S4-VS5A 真实闲鱼回读与账号上下文复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R42 | 业务 / 验收 | 账号管理页设置当前账号后，消息页是否复用全局账号上下文且不再渲染账号选择器 | root + Chrome/CDP | PASS（当前切片） | `apps/web/src/app/account-context.tsx`、`apps/web/src/features/messages/components/MessagesPage.tsx`、`npm run test:e2e:chrome:messages`、桌面/移动截图 |
| S5-R43 | 外部平台 / 数据读取 | 使用 PostgreSQL 中已有登录态读取真实会话和历史消息，是否保持账号 scope、分页游标和消息去重 | root + real_api_verify | PASS（真实回读） | 账号 `19cf…`：3 会话 / 首会话 4 条；账号 `6f0…`：1 会话 / 首会话 20 条且 `hasMore=true`；数据库 `duplicate_external_refs=0` |
| S5-R44 | 质量 / 安全 / 运维 | 是否避免把真实登录态用于无意义测试或发送真实买家消息，并保持发布级边界声明 | root | PASS（范围受控） | 本轮未重复 Cookie 登录、未发送真实消息；`docs/evidence/stage5/s4-vs5a-chat-read/test-baseline.md`；`S5-RISK-021` 保持开放 |
| S5-R45 | 消息状态 / 实时链路 | 是否使用闲鱼真实 40103 已读回执与 `/r/MessageStatus/read`，并通过服务端事件更新 UI，而不是用买家回复推断卖家已读 | root | PASS（受控验证） | `npm --workspace apps/api run test:xianyu-im-read` 8/8；`npm --workspace apps/api run test:messages:infra`；`apps/api/src/xianyu-im.ts`、`apps/api/src/xianyu-im-service.ts`、`apps/api/migrations/017_message_read_status.sql`；`S4-VS5A` 仍保持 `PARTIALLY_VERIFIED`，外部线上 40103 仍待独立复审 |

本轮结论：真实闲鱼凭证回读、账号级上下文复用、40103 已读回执链路、Redis/PostgreSQL 恢复和 Chrome/CDP 视觉证据均已形成可复核记录；`S4-VS5A` 仍为 `PARTIALLY_VERIFIED`，独立复审与生产部署拓扑确认未关闭前不得宣称发布级完成。发送、附件、撤回继续进入 `S4-VS5B`。

### 2026-09-20：账号列表分页与工具栏修订复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R46 | 业务 / 验收 | 账号列表是否按服务端分页，搜索与状态/连接筛选是否真正生效，空态是否居中且表格滚动不带动页面 | root + Chrome/CDP | PASS（当前切片） | `apps/api/scripts/smoke.mjs`、`apps/web/src/features/accounts/api.test.ts`、`npm run test:e2e:chrome` |
| S5-R47 | UI / 交互 | 是否移除账号表格操作列与工具栏“共 x 个账号”统计，并保留紧凑的分页导航 | root | PASS（当前切片） | `apps/web/src/features/accounts/components/AccountTable.tsx`、`AccountToolbar.tsx`、`accounts.css` |
| S5-R48 | 质量 / 交付 | 是否在独立 worktree、merge lock 和主线门禁内完成合入 | root | PASS | `8b7c398`、`npm run verify`、`docs/agent-worktree-registry.md` |

本轮结论：账号列表分页/筛选和页面布局修订已合入 `master`；账号管理外部闲鱼登录、真实 PostgreSQL/外部账号人工验收等既有风险边界不变。

### 2026-09-20：账号表格操作列回归修订复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R51 | 业务 / 验收 | 操作列是否恢复切换账号、扫码授权/重新授权、删除账号，并验证真实切换与删除结果 | root + Chrome/CDP | PASS（当前切片） | `apps/web/src/features/accounts/components/AccountTable.tsx`、`AccountsPage.tsx`、`apps/web/scripts/e2e-chrome.mjs`；账号 Chrome/CDP E2E 通过 |
| S5-R52 | UI / 交互 | 分页是否与商品管理页保持三段式布局、选中态一致，表格是否继续最大高度内部滚动 | root | PASS（当前切片） | `apps/web/src/features/accounts/components/accounts.css`、`AccountTable.test.tsx`、`docs/evidence/stage5/S4-VS1/screenshots/accounts-desktop-1440x900.png`、`accounts-mobile-390x844.png` |
| S5-R53 | 质量 / 交付 | 是否在独立 worktree、merge lock 和主线门禁内完成合入 | root | PASS | `ed0f8eab`、`npm run verify`、`docs/agent-worktree-registry.md` |

本轮结论：账号表格操作列与行操作已恢复，账号分页视觉与商品管理页对齐；服务端分页、搜索/筛选、空态居中和表格内部滚动行为保持不变。

### 2026-09-20：商品表格空态与工具栏修订复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R49 | UI / 交互 | 商品表格空态和加载失败提示是否在表格剩余区域完整居中，工具栏是否移除冗余“共 0 件”统计且保留分页底部统计 | root + Chrome/CDP | PASS（当前切片） | `apps/web/src/features/products/components/ProductStateView.tsx`、`ProductToolbar.tsx`、`products.css`；商品 Chrome/CDP E2E 已覆盖空态/失败态布局和工具栏节点缺失 |
| S5-R50 | 质量 / 交付 | 是否补充回归测试并在独立 worktree、merge lock 和主线完成验证 | root | PASS | `99c60bf`、Web typecheck、Vitest 25 files / 86 tests、Web/API build、商品 Chrome/CDP E2E、`git diff --check` |

本轮结论：商品列表空态/失败态布局修订和工具栏统计清理已合入 `master`；商品真实 PostgreSQL、外部闲鱼数据和视觉人工复核等既有边界保持不变。

### 2026-09-20：S4-VS4A 订单列表只读切片复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R54 | 业务 / 验收 | 订单页面是否支持账号 scope、关键词、支付/订单/发货/售后四态、分页、详情和空/错/403 状态，且不暴露交付正文 | root + test_recon | PASS | `apps/web/src/features/orders/`、`apps/api/scripts/orders-smoke.mjs`、`npm test`、`npm run test:e2e:chrome:orders` |
| S5-R55 | 架构 / 数据流 | `018_orders.sql`、Postgres/Memory Store、OrderService、HTTP route 和闲鱼 mapper 是否职责分离、金额/时间/外部 upsert 契约一致 | root + test_recon | PASS | `apps/api/migrations/018_orders.sql`、`apps/api/src/store-postgres.ts`、`apps/api/src/services.ts`、`apps/api/src/xianyu-order-mapper.ts`、`npm --workspace apps/api run test:orders:postgres` |
| S5-R56 | 浏览器 / 视觉 | 真实 Vite + API + Chrome/CDP 是否完成桌面/移动订单旅程，桌面列是否完整可见，移动端是否无横向溢出 | root + test_recon + orders_e2e | PASS | `npm run test:e2e:chrome:orders`；`docs/evidence/stage5/S4-VS4A/screenshots/` |
| S5-R57 | 外部平台 / 质量 | 真实闲鱼 active 凭证是否可完成只读订单请求，失败不泄露敏感凭证，空结果不被伪造为订单 | root + test_recon + ydisks_order_recon | PASS | A/B 复验确认 `idle_site_biz_code: COMMONPRO` 请求头触发 `MTOP_PERMISSION_DENIED`；移除该头后真实返回 5 条订单，Chrome/CDP refresh 经 API 写入 PostgreSQL 并在订单页可见；未输出 Cookie/Token/raw payload |

| S5-R58 | 前端 / 架构 / 质量 | Dashboard 真实入口是否经 API、数据库和闲鱼完成跨层闭环，且浏览器可见结果与持久化一致 | root + fullchain_audit + integration_audit | PASS | `ALLOW_SHARED_E2E=1 REQUIRE_XIANYU_ORDER_SYNC=1 npm run test:e2e:chrome:dashboard:fullchain` 通过；PostgreSQL/Redis 可达，资料/商品/IM/订单读取成功，商品同步与订单刷新均落库并回读，桌面/移动截图与 `fullchain-evidence.json` 已归档 |
| S5-R58 | 范围 / 发布门禁 | 是否误把交付预览、发货/取消/重试、库存锁、Outbox、DeliveryRecord 宣称为本片完成 | root | PASS | `docs/evidence/stage5/S4-VS4A/test-baseline.md`；`S4-VS4B/C` 保持后置 |

本轮结论：`S4-VS4A = PASS（只读范围）`。前端、后端、PostgreSQL、浏览器和真实 seller 订单读取/落库复读均已通过；交付相关能力继续按 `S4-VS4B/C` 单独立项和复审。

### 2026-09-20：S4-VS4A 订单列表界面修订复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R62 | 业务 / 验收 | 订单列表是否收敛为订单号、买家昵称、商品名称、金额、下单时间、当前状态六个业务列，并保留操作列、查看详情按钮和详情抽屉 | root + orders_e2e | PASS | `apps/web/src/features/orders/components/OrderTable.tsx`、`OrdersPage.tsx`；`npm run test:e2e:chrome:orders` |
| S5-R63 | UI / 交互 | 筛选区是否仅保留关键词搜索和单状态下拉，买家昵称是否支持姓名悬浮提示，表格是否自适应高度、内部滚动并分页 | root + orders_e2e | PASS | `OrderFilters.tsx`、`orders.css`、`OrderFilters.test.ts`、`OrderTable.test.ts`、订单桌面/移动截图 |
| S5-R64 | 质量 / 交付 | 修订是否在独立 worktree、merge lock 和主线验证后合入，且不误改详情抽屉内容或真实外部权限结论 | root | PASS | `8ad36cd`、`npm run typecheck`、`npm test`、`npm run build`、`npm run compose:config`、`git diff --check`、`docs/agent-worktree-registry.md` |

本轮结论：订单列表界面修订已合入 `master`；详情抽屉内容按用户更正保留原样，下一步再单独调整。真实 seller 订单请求仍返回 `PERMISSION_EXCEPTION::无权限访问`，因此 `S4-VS4A` 整体继续保持 `PARTIALLY_VERIFIED/BLOCKED`。

### 2026-09-20：S4-VS4A 订单字段、头像与列表信息复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R65 | 业务 / 验收 | 缺失昵称、头像或商品名称时，是否从账号隔离的本地会话/商品数据聚合，而不是回退显示买家姓名、用户 ID 或商品 ID | root + orders_display_review | PASS | `apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`apps/api/scripts/orders-smoke.mjs`、`apps/api/scripts/orders-postgres-smoke.mjs` |
| S5-R66 | UI / 交互 | 列表是否只展示昵称/商品名称，头像 URL 是否渲染真实头像，无头像时不显示首字，昵称是否仍保留姓名 hover | root + orders_display_review | PASS | `apps/web/src/features/orders/components/OrderTable.tsx`、`OrderTable.test.ts`、订单桌面/移动截图 |
| S5-R67 | 质量 / 交付 | 迁移、构建、全量测试、PostgreSQL 持久化与 Chrome/CDP 订单旅程是否在 merge lock 后于 master 重跑通过 | root | PASS | merge `490e145`；`npm run typecheck`、`npm test`、`npm run build`、`npm run db:migrate`、`npm --workspace apps/api run test:orders:postgres`、`npm run test:e2e:chrome:orders`、`docker compose config --quiet`、`git diff --check` |

本轮结论：订单列表字段与头像聚合修订已通过复审并合入 `master`；详情抽屉内容仍按用户更正保留原样。真实外部 seller 权限与发布级回滚风险继续沿用 `S4-VS4A` 既有结论，不以受控 fixture 代替真实外部验收。

### 2026-09-20：S4-VS4A 订单状态筛选边界复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R68 | 业务 / 状态机 | “待发货”“待收货”“待评价”是否按已支付、订单、发货和售后 canonical 字段组合筛选，避免把未付款、待发货或退款订单误归入“待评价” | root + verify_pending_review_filter | PASS | `apps/web/src/features/orders/order-status.ts`、`apps/web/src/features/orders/order-status.test.ts` |
| S5-R69 | 浏览器 / 回归 | Chrome/CDP 是否验证“待评价”请求包含 `paymentStatus=paid`、`orderStatus=completed`、`deliveryStatus=delivered`、`afterSalesStatus=none`，且结果不混入“待发货/待收货” | root + orders_e2e | PASS | `apps/web/scripts/e2e-orders-chrome.mjs`、`npm run test:e2e:chrome:orders`、`npm test` |

本轮结论：此前记录的“待评价”筛选异常已修复并固定为四字段组合；回归用例明确排除已退款订单。该项作为状态机回归关注点继续保留，后续修改不得退回到仅按 `orderStatus=completed` 判定。详情抽屉内容本轮仍保持不变，交付动作继续后置至 `S4-VS4B/C`。
### 2026-09-20：S4-VS7A Settings API Key 首片复核

本节只复核当前实现和受控证据，不把 MemoryStore smoke、构建成功或页面可打开升级为发布级通过。

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R59 | 业务 / 验收 | `/settings` 是否要求明确 `accountId`，并支持 API Key 引用的列表、创建、编辑、轮换、启用、禁用、撤销；密钥是否不回显 | root + 待人工复核 | READY_FOR_REVIEW | `apps/web/src/features/settings/`、`apps/api/src/credential-store.ts`、`apps/api/scripts/credential-store-smoke.mjs`；受控 smoke 覆盖 create/list/rotate/status/version conflict/revoked guard |
| S5-R60 | 架构 / 数据流 | CredentialStore 是否独立于通用 Settings 保存入口，是否使用 `credential_refs` / `credential_values`、AES-256-GCM、fingerprint、scope、expectedVersion、Idempotency-Key 和审计摘要 | root + 待独立复核 | READY_FOR_REVIEW | `apps/api/migrations/018_credential_store.sql`、`apps/api/src/credential-crypto.ts`、`apps/api/src/credential-store.ts`、`apps/api/src/app.ts`；`npm --workspace apps/api run build` 已通过，真实 PostgreSQL 迁移复读尚未执行 |
| S5-R61 | 质量 / 安全 / 运维 | 是否完成真实 PostgreSQL/403/409/回滚、Chrome/CDP 双 viewport、逐状态视觉和三轮独立评审 | root + QA/安全待复核 | BLOCKED | 当前仅有 `allowInMemory=true` credential-store smoke、Web 26 files / 88 tests、typecheck/build；暂无 Settings 专属 1440×900 / 390×844 截图、真实 DB 回读或跨层浏览器证据 |

本轮结论：`S4-VS7A = READY_FOR_REVIEW`。实现已形成可审计首片，但 `S5-RISK-026` 及新增的 migration/视觉证据风险仍开放；未达到 `PASS`，不得宣称已完成发布级 Settings。

### 2026-09-20：S4-VS7A 真实证据增量复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R62 | 业务 / 验收 | `/settings` 账号隔离、create/rotate/disable/revoke、刷新后状态与明文不回显 | root + Chrome/CDP | PASS（受控链路） | `npm run test:e2e:chrome:settings`；`docs/evidence/stage5/S4-VS7A/screenshots/` |
| S5-R63 | 架构 / 数据流 | 真实 PostgreSQL migration 018、ciphertext/key_version/checksum、PG ref 投影指纹与 API 脱敏 | root + settings_audit | PASS（临时 PostgreSQL） | `npm --workspace apps/api run test:postgres:credentials`；`apps/api/scripts/credential-store-postgres-smoke.mjs` |
| S5-R64 | 质量 / 安全 / 视觉 | 403/409、secret 不进入 URL/localStorage/input、1440×900/390×844 双端视觉与短标签导航 | root + prototype_audit | PASS（受控环境） | `apps/web/scripts/e2e-settings-chrome.mjs`；`docs/evidence/stage5/S4-VS7A/README.md` |

增量结论：`S4-VS7A` 已完成首片真实浏览器与临时 PostgreSQL 证据闭环，状态仍保持 `READY_FOR_REVIEW`；发布级 rollback、旧明文 `auth.account_credentials` 双读单写兼容迁移和正式 merge lock 签核未关闭前，不标记 `PASS`。

### 2026-09-20：Dashboard 默认真实 API 入口修复复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R65 | 前端 / 配置 | `VITE_API_MODE=live` 且未设置 `VITE_DASHBOARD_MODE` 时是否使用真实 Dashboard API；显式 mock 覆盖是否仍可用 | root | PASS | `6522286`；`apps/web/src/app/App.tsx`、`App.dashboard-mode.test.ts`；Web 37 files / 110 tests、typecheck、build、显式 mock Chrome E2E、默认 live fullchain |
| S5-R66 | 真实全链路 | 默认模式是否完成 Chrome → API → PostgreSQL/Redis → 闲鱼 → Dashboard 回读，且不依赖显式 live 开关 | root + fullchain_audit + integration_audit | PASS | `ALLOW_SHARED_E2E=1 REQUIRE_XIANYU_ORDER_SYNC=1 npm run test:e2e:chrome:dashboard:fullchain`；`docs/evidence/stage5/S4-VS-DASHBOARD/fullchain-evidence.json` |

本轮结论：Dashboard 不再因缺少独立 `VITE_DASHBOARD_MODE` 而默认展示 mock；mock 仅作为显式测试覆盖保留。高保真视觉签核、旧 `/order-trend` 兼容接口与 rollback 门禁仍按 `S4-VS-DASHBOARD` 原范围开放。

### 2026-09-20：自动回复链路切片复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R70 | 业务 / 验收 | 闲鱼监听事件是否完成入站规范化、消息幂等、风险优先意图识别、商品/订单/会话上下文组装、受事实约束的生成与高风险转人工 | root + docs_scan | PASS（dry-run 范围） | `docs/16-auto-reply-slice.md`、`apps/api/src/auto-reply.ts`、`apps/api/src/xianyu-im-service.ts`、`npm --workspace apps/api run test:auto-reply:unit`、`npm --workspace apps/api run test:auto-reply:e2e` |
| S5-R71 | 架构 / 数据流 | 自动回复是否复用 `MessageService` 和 Store 边界，入站/出站/运行记录是否可回读，是否按 `adminId + inboundMessageId` 幂等 | root + code_scan | PASS | `apps/api/migrations/021_auto_reply_runs.sql`、`apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`npm run db:migrate`、`npm --workspace apps/api run test:auto-reply:postgres` |
| S5-R72 | 质量 / 安全 / 运维 | 是否禁止真实闲鱼发送，敏感正文是否不进入运行记录，重复事件是否不重复出站，完整门禁是否通过 | root + postgres_verify | PASS（受控验证） | E2E 断言 `/r/MessageSend/sendByReceiverScope` 调用为 0；PostgreSQL 关闭/重启后回读 `messages.messages` 与 `messages.auto_reply_runs`；`npm run typecheck`、`npm test`、`npm run build`、`npm run compose:config`、`git diff --check` |

本轮结论：自动回复 dry-run 纵向切片通过。其科学链路不是无条件直通，而是“事实先落库、风险先门禁、上下文分层、生成受事实约束、Noop 投递、审计回读”；真实发送、模型 Provider、Outbox Worker、人工接管 API 和发布级恢复继续保持后置范围。

### 2026-09-21：真实闲鱼网关 push 路径复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R73 | 外部平台 / 数据流 | 历史同步是否与买家网关 push 分离；响应与同帧 `syncPushPackage` 是否都被处理；非 200 响应是否不会被误当成功 | root + gateway_path | PASS（适配器层） | `apps/api/src/xianyu-im.ts`、`apps/api/scripts/xianyu-im-gateway.test.ts`：5/5；真实 DB 凭证 probe 连接、历史读取、`/s/vulcan` 同步帧与 ACK 证据 |
| S5-R74 | 运行时 / 可恢复性 | 应用启动是否自动恢复 listener，多个账号是否串行、单飞且有限重试；连接关闭后是否自动重连 | root + listener_fix | PASS（受控验证） | `apps/api/src/app.ts`、`apps/api/src/xianyu-im-service.ts`、`apps/api/scripts/auto-reply.test.ts`：11/11；`xianyu-im-gateway.test.ts`：断线重连通过 |
| S5-R75 | 业务 / 真实验收 | 是否已有真实买家 WebSocket push 驱动自动回复和 live 发送的完整证据 | root | BLOCKED / PARTIALLY_VERIFIED | 当前 `4310178918003.PNM` 仅存在历史导入消息，`auto_reply_runs` 为空；DB probe 未收到新的买家消息，禁止用合成事件代替 |

本轮结论：已修复网关混合帧丢失、错误响应误判、并发启动和断线恢复问题；当前应用会在启动后自动监听，不依赖管理员打开页面。真实买家 push→自动回复→真实发送仍需在 probe 等待窗口内由闲鱼外部买家产生新消息后单独归档。

| S5-R76 | 前端 / 鉴权 | 在线聊天页面在 API 重启后是否能恢复旧 CSRF token 并安全重放发送请求 | root + csrf_send_fix | PASS | `apps/web/src/api/http.ts`、`apps/web/src/api/http.test.ts`；403 `CSRF_INVALID` → session refresh → 单次重试，保留幂等键；Web 38 files / 117 tests、typecheck、build |
| S5-R77 | 业务 / 白名单 | 真实 push 缺少买家昵称时是否会因身份缺失而被错误跳过 | root + listener_ready | PASS（受控回归） | `apps/api/src/xianyu-im-service.ts`、`apps/api/scripts/auto-reply.test.ts`；按 external conversation ref 补全身份后 allowlist 通过，run persisted |
| S5-R78 | 业务 / 事件幂等 | 历史同步先落库后，真实 push 是否仍会触发一次自动回复 | root + listener_ready | PASS（受控回归） | `apps/api/src/xianyu-im-service.ts`、`apps/api/scripts/auto-reply.test.ts`；`created=false` 的 push 继续调用 `processInbound`，同一 inbound idempotent 且仅一条 outbound |
