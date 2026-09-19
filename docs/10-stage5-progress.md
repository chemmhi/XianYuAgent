# 阶段 5 执行进度：S4-VS1 账号管理

- 日期：2026-09-19
- 状态：进行中；ENV-0 内存运行与账号只读跨层首片已通过，容器级门禁和完整账号状态机仍未完成。

## 已落地

1. `server/`：Node HTTP API、独立 Worker、统一 API envelope、HttpOnly Session、CSRF 双提交、幂等记录、账号范围、最小 AuditEvent、Memory/Postgres Store。
2. `server/migrations/`：保留阶段 2 逻辑编号，落地 `001_auth_accounts.sql`、`006_workspace_execution.sql`、`007_observability.sql`；Credential/Catalog/Coupon/Order 迁移继续后置。
3. `SellerAgent/src/features/accounts/`：AccountVM、AccountConnectionVM、Accounts API adapter、controller、toolbar/table/state boundary，避免复用原型超级组件。
4. `SellerAgent` live 模式已能通过 canonical `/api/v1/accounts` 读取统一 envelope，账号页面仍保持 mock/live 可替换。

## 已验证

- `cd server && npm test`：通过，`env0 smoke passed`。
- `cd server && npm run build`：通过。
- `cd SellerAgent && npm run verify:stage5`：通过（typecheck、Vitest 6 tests、mock contract、Vite build）。
- `cd SellerAgent && npm run test:integration`：通过，真实启动 `server/dist/index.js`，bootstrap 后创建账号，再由前端 canonical adapter 读取账号。
- `docker compose config --quiet`：通过。

## 当前阻断与后续

- Docker Desktop Linux engine 未启动，无法完成 PostgreSQL/Redis/MinIO 容器实跑、迁移持久化和 Testcontainers 验证。
- QR session 与 account login-session 状态机、连接刷新、闲鱼 adapter 协议探针和真实凭证复现仍未实现。
- 继续实现顺序：账号写入/详情/连接 → QR/login-session → scope/policy/CredentialRef 最小管理 → Playwright 1440×900 与 390×844 → S4-VS1 复审后再进入商品切片。

## Git 记录

- `f72f688`：阶段 5 账号管理前端只读切片。
- `e2740a7`：阶段 5 路由骨架。
- `5c8f9e5`：阶段 5 前端测试门禁。
- `d134f9d`、`2567714`、`50cbe0b`：ENV-0 后端运行时、bootstrap Cookie 重放修复、幂等竞争/异常清理修复。
