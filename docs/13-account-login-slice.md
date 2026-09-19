# S4-VS1 账号登录切片实现说明

- 文档版本：v0.1
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
| QR 扫码 | `AccountLoginModal` → `QrLoginView` | `POST /api/v1/auth/qr-sessions`、`GET /api/v1/auth/qr-sessions/{id}`、`POST /api/v1/auth/qr-sessions/{id}/renew`、`POST /api/v1/auth/qr-sessions/{id}/cancel` | 真实二维码生成、轮询、取消和续期已接通；真实 APP 扫码成功待人工验收 |
| 已有账号重新授权 | 账号详情或连接状态入口 | `POST/GET /api/v1/accounts/{id}/login-sessions` 及其状态、取消、续期接口 | 支持账号范围校验和登录会话持久化 |
| 手动 Cookie | `CookieLoginForm` | `POST /api/v1/auth/cookie-login` | 受控 adapter、内存 smoke 和 Chrome/CDP E2E 已通过；真实 Cookie 验证待人工验收 |
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

## 4. 数据持久化与迁移

本轮新增迁移：

- `apps/api/migrations/011_account_profile.sql`：补充账号资料字段，包括 `remark`、`avatar_url`、`platform_user_id`。
- `apps/api/migrations/012_login_session_admin.sql`：为登录会话补充 `admin_id`、可空 `account_id`、`provisional_account_ref` 及必要索引，支持“先登录、后建账号”。

Memory store 已通过受控 smoke 验证完整链路。PostgreSQL 迁移文件与 Compose 配置已存在，但由于当前 Docker Desktop Linux engine 未启动，容器级迁移、重启恢复和真实数据库持久化尚未形成证据，不能宣称生产持久化已验收。

## 5. 已执行验证

根目录可复现命令：

```text
npm run typecheck
npm test
npm run build
npm run test:e2e:chrome
npm run verify
```

专项证据：

- `npm --workspace apps/api run test`：`env0 smoke passed`、`onboarding cookie login smoke passed`。
- `npm --workspace apps/web run test`：账号 API adapter、QR 状态机及组件相关测试通过。
- `npm run test:e2e:chrome`：本机 Chrome + CDP 完成登录方式选择、旧创建弹窗不存在、无模拟二维码、Cookie 登录、API 返回资料在页面可见等断言。
- 固定 viewport 截图：`docs/evidence/stage5/S4-VS1/screenshots/accounts-desktop-1440x900.png`、`accounts-mobile-390x844.png`。
- E2E 使用临时 Chrome profile 和受控 adapter；它证明前后端跨层交互，不等价于真实闲鱼 APP 扫码或真实外部 Cookie 验收。

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
| 登录方式选择与职责拆分 | PASS | `AccountLoginModal`、`LoginMethodSelector`、`CookieLoginForm`、`PasswordLoginForm`、QR 子模块职责分离 |
| 受控 Cookie 登录闭环 | PASS | 账号、登录会话、凭证和资料同步均有 smoke/E2E 证据 |
| 真实 QR 生成与状态轮询 | PARTIAL PASS | 服务端真实模式探针通过；真实 APP 扫码成功及外部凭证落库待人工复核 |
| 真实浏览器登录态复用 | PENDING | 必须在当前已登录 Chrome 打开 `http://localhost:9000/accounts` 后执行人工验收 |
| PostgreSQL/Redis 容器持久化 | BLOCKED | Docker Desktop Linux engine 未启动 |
| 账号密码登录 | NOT IMPLEMENTED | 后端显式返回不可用，不允许将入口误报为完成 |
