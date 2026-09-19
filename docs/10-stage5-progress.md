# 阶段 5 执行进度：S4-VS1 账号管理

- 日期：2026-09-19
- 状态：进行中；ENV-0 内存运行与账号只读跨层首片已通过，容器级门禁和完整账号状态机仍未完成。

## 已落地

1. `apps/api/`：Node HTTP API、独立 Worker、统一 API envelope、HttpOnly Session、CSRF 双提交、幂等记录、账号范围、最小 AuditEvent、Memory/Postgres Store。
2. `apps/api/migrations/`：保留阶段 2 逻辑编号，落地 `001_auth_accounts.sql`、`006_workspace_execution.sql`、`007_observability.sql`；Credential/Catalog/Coupon/Order 迁移继续后置。
3. `apps/web/src/features/accounts/`：AccountVM、AccountConnectionVM、Accounts API adapter、controller、toolbar/table/state boundary，避免复用原型超级组件。
4. `apps/web` live 模式已能通过 canonical `/api/v1/accounts` 读取统一 envelope；`SellerAgent/` 仅保留视觉原型。

## 已验证

- `npm run test:api`：通过，`env0 smoke passed`。
- `npm run build:api`：通过。
- `npm run typecheck:web && npm run test:web && npm run build:web`：通过（正式前端工作区）。
- `npm run test:web`：通过，真实启动 `apps/api/dist/index.js`，bootstrap 后创建账号，再由前端 canonical adapter 读取账号。
- `docker compose config --quiet`：通过。

## 当前阻断与后续

- Docker Desktop Linux engine 未启动，无法完成 PostgreSQL/Redis/MinIO 容器实跑、迁移持久化和 Testcontainers 验证。
- QR session 与 account login-session 状态机、连接刷新、闲鱼 adapter 协议探针和真实凭证复现仍未实现。
- 继续实现顺序：账号写入/详情/连接 → QR/login-session → scope/policy/CredentialRef 最小管理 → 本机 Chrome 390×844 补充路径与视觉偏差复核 → 再进入商品切片；1440×900 截图已执行。

## Git 记录

- `f72f688`：阶段 5 账号管理前端只读切片。
- `e2740a7`：阶段 5 路由骨架。
- `5c8f9e5`：阶段 5 前端测试门禁。
- `d134f9d`、`2567714`、`50cbe0b`：ENV-0 后端运行时、bootstrap Cookie 重放修复、幂等竞争/异常清理修复。
- `65b48d6`：接通账号真实读取链路、统一 envelope adapter、Compose 与首片迁移骨架，并回写阶段记录。
- `2de5ff7`：接通账号详情与连接状态读取；外部闲鱼结果未知时返回明确 `unknown`/`ADAPTER_UNKNOWN`，不伪造成功。
- `325161f`：落地账号登录会话持久化状态机与 QR session 查询/取消/续期入口，当前只推进 waiting/expired/cancelled，不伪造外部扫码成功。
- 2026-09-19 S4-VS1 增量：真实 `XIANYU_QR_MODE=real` 集成探针已通过创建、二维码 Data URL 返回、轮询 waiting 与取消；`apps/web` 已接入 QR modal、轮询、重试、取消和成功后刷新。自动化测试继续使用 stub，人工扫码成功、Cookie 落库与 `connection/verify` 仍待真实账号复核。`verification_required` 已保留为独立可恢复状态。
- 2026-09-19 前端增量：正式 `apps/web` 账号页按 design token 重建控制台壳层，补充账号创建表单；本机 Chrome + CDP E2E 已通过“创建账号 → API → 页面可见持久化账号 → 二维码授权弹窗”。
- Git 提交：`c04b189`（`feat(阶段5): 接通闲鱼二维码登录与凭证校验`）。
- Git 提交：`7cf0c0e`（`feat(阶段5): 完成账号管理前端与Chrome端到端验证`）。
