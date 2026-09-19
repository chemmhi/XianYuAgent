# S4-VS1 账号登录切片实现说明

- 文档版本：v0.3
- 更新日期：2026-09-19
- 适用范围：阶段 5 的账号登录纵向切片（QR、Cookie、账号列表持久化与资料同步）
- 正式前端：`apps/web/`
- 视觉参考：`SellerAgent/` 与 `xianyu-admin-design-style/assets/design-tokens.json`；高保真目录不是正式前端源码目录

## 1. 切片目标

本切片把“添加闲鱼账号”从占位创建改为真实登录入口。登录成功后由服务端完成账号识别、凭证保存、登录会话落库、闲鱼资料同步，前端再通过账号列表 API 读取并展示结果。

核心不变量：

1. 不允许先创建没有有效登录态的占位账号。
2. QR 成功前允许只有临时登录会话；拿到闲鱼返回的 `unb` 后才创建或更新正式账号。
3. 昵称、备注、头像和平台用户 ID 来自闲鱼资料接口或受控 adapter，不在前端硬编码。
4. CredentialStore 只对管理员后台可见和可操作，不得进入闲鱼买家可见的消息、订单交付或外部响应。
5. `verification_required`、超时、失败和取消保持为独立状态，不得伪造为 `succeeded`。

## 2. 登录方式与路由

| 方式 | 前端入口 | 服务端路由 | 当前状态 |
| --- | --- | --- | --- |
| 管理员会话门禁 | `App` → `AuthGate` | `GET /api/v1/auth/session`、`POST /api/v1/auth/password-login`、`POST /api/v1/auth/bootstrap` | 已接入正式前端根布局；未认证、首次初始化、会话检查失败均阻断业务页面；通过同源 `/api` 访问 |
| QR 扫码 | `AccountLoginModal` → `QrLoginView` | `POST /api/v1/auth/qr-sessions`、`GET /api/v1/auth/qr-sessions/{id}`、`POST /api/v1/auth/qr-sessions/{id}/renew`、`POST /api/v1/auth/qr-sessions/{id}/cancel` | 真实二维码生成、轮询、取消和续期已接通；真实 APP 扫码成功待人工验收 |
| 已有账号重新授权 | 账号详情或连接状态入口 | `POST/GET /api/v1/accounts/{id}/login-sessions` 及其状态、取消、续期接口 | 支持账号范围校验和登录会话持久化 |
| 手动 Cookie | `CookieLoginForm` | `POST /api/v1/auth/cookie-login` | 受控 adapter、内存 smoke 和 Chrome/CDP E2E 已通过；真实外部 Cookie 验证待人工验收 |
| 账号密码 | `PasswordLoginForm` | `POST /api/v1/accounts/password-login` | 入口保留，但后端明确返回 `PASSWORD_LOGIN_UNAVAILABLE`；依赖独立浏览器运行时，不能伪造成功 |
| 账号列表 | `AccountsPage` | `GET /api/v1/accounts` | 从服务端账号记录读取，成功登录后刷新 |

QR 仍提供历史兼容字段 `id`，正式前端统一归一化为 `qrSessionId`。二维码图片由闲鱼登录接口返回的 `codeContent` 生成，不再使用模拟 SVG 图片。

## 3. 账号登录数据流

### 3.1 QR 扫码

1. 管理员在 `apps/web` 的“添加闲鱼账号”入口选择扫码。
2. 前端调用 `POST /api/v1/auth/qr-sessions`；新账号场景不传 `accountId`，服务端创建带 `provisionalAccountRef` 的临时 `AccountLoginSession`。
3. `XianyuQrLoginAdapter` 服务端调用闲鱼登录页、二维码生成和二维码状态查询接口，向前端返回真实 `qrImageDataUrl`。
4. 前端按 `pollAfterMs` 轮询状态，显示 waiting、scanned、verification_required、succeeded、expired、failed、cancelled。
5. 闲鱼确认登录后，服务端读取 `unb` 和 Cookie，创建或更新账号，保存 CredentialStore，调用资料接口同步 `displayName`、`remark`、`avatarUrl`、`platformUserId`，再把登录会话更新为 `succeeded`。
6. 前端收到成功状态后重新请求 `GET /api/v1/accounts`，页面展示数据库/Store 中的账号记录。

### 3.2 Cookie 登录

1. 管理员在 Cookie 表单粘贴完整 Cookie；前端只通过同源 API 提交，不回显 Cookie。
2. 服务端创建无正式账号 ID 的登录会话，调用闲鱼 `verifyLogin` 校验登录态。
3. 校验成功后从 Cookie 提取 `unb`，创建或更新账号，保存 Cookie 凭证，并调用资料接口获取昵称、备注、头像和平台用户 ID。
4. 服务端在同一登录流程中将登录会话更新为 `succeeded`，返回账号摘要与会话状态。
5. 前端刷新账号列表，验证账号信息来自 API，而不是表单输入或本地 mock。

### 3.3 AuthGate 与 Vite 代理

1. `apps/web/src/app/App.tsx` 只创建一个带 `credentials: 'include'` 的 HTTP transport，并同时交给 `AuthGate` 与账号 API adapter，避免认证请求和业务请求使用不同基址。
2. `AuthGate` 在渲染正式管理台前先请求 `GET /api/v1/auth/session`，按 `checking`、`bootstrap-required`、`login-required`、`error`、`authenticated` 分支渲染；未进入 `authenticated` 时不得展示账号、商品或订单页面。
3. `apps/web/vite.config.ts` 始终注册 `/api` 代理，未设置 `VITE_API_PROXY_TARGET` 时默认转发到 `http://127.0.0.1:8080`；这修复了本地开发环境中浏览器请求 `/api/v1/auth/session` 直接落到 Vite 404 的问题。
4. API 不在默认端口时，必须显式设置 `VITE_API_PROXY_TARGET` 或 `VITE_API_BASE_URL`，并在验证记录中写出实际目标地址。

## 4. 数据持久化与迁移

本轮新增迁移：

- `apps/api/migrations/011_account_profile.sql`：补充账号资料字段，包括 `remark`、`avatar_url`、`platform_user_id`。
- `apps/api/migrations/012_login_session_admin.sql`：为登录会话补充 `admin_id`、可空 `account_id`、`provisional_account_ref` 及必要索引，支持“先登录、后建账号”。

Memory store 已通过受控 smoke 验证完整链路。PostgreSQL 迁移文件与 Compose 配置已存在；当前 Docker Compose 已启动 API、Worker、PostgreSQL、Redis、MinIO，容器内 health/ready、`pg_isready` 和 Redis `PONG` 均通过，并完成账号写入、列表读取及 API 重启后的持久化复读。完整迁移回滚、Testcontainers 和发布级恢复演练仍未覆盖，不能据此宣称生产发布门禁全部关闭。

## 5. 已执行验证

根目录可复现命令：

```text
npm run typecheck
npm test
npm run build
npm run test:e2e:chrome
npm run verify
```

本轮（Vite proxy / AuthGate 增量）结果：

| 命令或检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | PASS | API 与 Web 类型检查均通过。 |
| `npm test` | PASS | API `env0 smoke passed`、`onboarding cookie login smoke passed`；Web 4 个测试文件、15 个测试通过。 |
| `npm run build` | PASS | API TypeScript 构建与 Vite production build 均通过。 |
| `npm run compose:config` | PASS | Compose 配置可解析；不代表容器已实际启动。 |
| `git diff --check` | PASS | 仅有换行格式提示，无 diff 空白错误。 |
| 默认 Vite 代理 `GET /api/v1/auth/session` | PASS | 未设置 `VITE_API_PROXY_TARGET` 时，经 Vite 代理返回 HTTP 200 canonical envelope；`data.bootstrapRequired=true`。 |
| `npm run test:e2e:chrome` | PASS | 未认证 `/accounts` 先停留在 `AuthGate` 且不渲染账号业务面；注入 bootstrap session cookie 后，账号列表、登录方式选择、无旧创建弹窗、无模拟二维码、Cookie 登录、资料回显和页面持久化结果均通过。 |
| `npm run verify` | PASS | 类型检查、API smoke、Web 4 个测试文件/15 个测试、构建、Chrome/CDP E2E、Compose 配置和 diff 检查全部通过。 |

专项实现证据：

- `apps/api/src/xianyu-qr-login.ts`：真实模式包含 h5 token 初始化、登录参数解析、真实二维码生成、轮询、取消、超时和 `verification_required` 分支；未把风控挑战改写为 `succeeded`。
- `apps/api/src/xianyu-mtop.ts`：真实 Cookie 复用、token 轮换、资料接口调用和失效/风控错误分类集中在服务端 adapter；前端不直连闲鱼平台。
- `npm --workspace apps/web run test`：账号 API adapter、AuthGate API contract、QR 状态机和 QR 视图测试通过。
- 最新 `npm run test:e2e:chrome` 已重新生成 `docs/evidence/stage5/S4-VS1/screenshots/accounts-desktop-1440x900.png`、`accounts-mobile-390x844.png`；截图来自 AuthGate 门禁通过后的已认证账号页面，但仍属于受控 harness 视觉证据，不等价于真实外部平台验收。
- 受控 harness 使用 stub adapter 和内存 store，只证明跨层请求、会话和页面状态编排，不等价于真实闲鱼 APP 扫码、外部 Cookie 验证或 PostgreSQL/Redis 持久化。

## 6. 真实环境人工复核前置条件

参考项目 `http://localhost:9000/accounts` 必须在**当前已经打开且已登录的 Chrome 浏览器**中打开。不要使用新建 Chrome profile、无痕窗口或另一台浏览器，否则参考项目持有的闲鱼登录 Cookie 不会被复用，页面会表现为未登录或要求重新授权。

人工复核顺序：

1. 在当前已登录 Chrome 中打开 `http://localhost:9000/accounts`，确认参考项目仍显示已登录账号。
2. 在同一个 Chrome 会话中保留该页面或登录态，再启动本项目正式前端 `apps/web`。
3. 用真实闲鱼 APP 扫描本项目生成的二维码，观察 waiting → scanned → succeeded 或 verification_required 的真实转移。
4. 成功后确认账号列表中的昵称、备注、头像和平台用户 ID 来自闲鱼返回值；确认登录会话与凭证记录已落库。
5. 若闲鱼返回人脸/验证码挑战，记录 `verification_required` 和 `verificationUrl`，不得手工改写为成功。

这项 Chrome 前置条件只针对参考项目的登录态复用；本项目正式实现仍由服务端 adapter 管理闲鱼 Cookie，不读取浏览器 localStorage，也不把浏览器 Cookie 直接暴露给买家。

## 7. 当前门禁结论

| 检查项 | 结论 | 说明 |
| --- | --- | --- |
| `/api` Vite 代理与本地 404 修复 | PASS | 默认目标 `http://127.0.0.1:8080` 已生效；代理请求 `GET /api/v1/auth/session` 返回 200，未认证业务读取被 API 返回 401。 |
| AuthGate 会话门禁接入 | PASS（受控 E2E） | 已挂到 `App` 根布局；未认证 `/accounts` 不渲染业务面，注入 bootstrap session cookie 后才放行账号页面。 |
| 登录方式选择与职责拆分 | PASS | `AccountLoginModal`、`LoginMethodSelector`、`CookieLoginForm`、`PasswordLoginForm`、QR 子模块职责分离 |
| 受控 Cookie 登录闭环 | PASS（受控 harness） | API/onboarding smoke 与 Chrome/CDP E2E 均通过；真实外部 Cookie 验证仍待人工复核。 |
| 真实 QR 生成与状态轮询 | PARTIAL PASS | 服务端真实模式探针通过；真实 APP 扫码成功及外部凭证落库待人工复核 |
| 真实浏览器登录态复用 | PENDING | 必须在当前已登录 Chrome 打开 `http://localhost:9000/accounts` 后执行人工验收 |
| PostgreSQL/Redis 容器持久化 | PARTIAL PASS | Compose 已启动；API/Worker/PostgreSQL/Redis/MinIO 健康，账号写入后列表读取且 API 重启后仍可复读；迁移回滚、Testcontainers 和发布级恢复仍待补证 |
| 账号密码登录 | NOT IMPLEMENTED | 后端显式返回不可用，不允许将入口误报为完成 |
