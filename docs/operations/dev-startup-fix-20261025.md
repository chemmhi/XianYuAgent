# 本地 main 开发启动修复（2026-10-25）

## 问题与修复

1. `npm run dev` 的 `predev` 在拉取 `quay.io/minio/minio:latest` 时收到 401，应用没有进入启动阶段。开发 Compose 改用与生产相同的 `minio/minio:latest`，支持通过 `OBJECT_STORAGE_IMAGE` 指定镜像代理或固定版本。
2. 基础设施恢复后，Worker 因默认凭证加密密钥不满足内部 IM 认证要求，抛出 `XIANYU_IM_OWNER_SECRET_REQUIRED`。根开发启动器为 API 与 Worker 共享一个每次启动随机生成的独立 IM 密钥；配置显式密钥时保留配置。已有凭证加密密钥保持不变。独立启动的服务仍需配置共同密钥，未配置独立 IM 密钥时保留原来的加密密钥认证路径。
3. Windows 允许通配地址探测与其他程序的回环地址监听同时成功，导致 Vite 宣称启动于 5173，但浏览器访问了另一个项目。端口选择补充 IPv4 回环地址探测，保留其他程序并递增端口。

变更职责分别位于开发 Compose、开发环境/端口装配、API 配置与 IM RPC 装配；未改变账号数据模型、业务页面或生产 Compose。

## 回归证据

- Compose 默认/覆盖/空值回退：修复前 3 项失败，修复后 `npm run test:dev-compose` 3/3 通过。
- Worker 启动和临时密钥：清空测试进程中的相关密钥后，修复前开发启动集成与密钥回归失败。修复后测试明确等待真实 Worker 启动日志，并验证 API、前端代理、登录会话、账号读写和 WebSocket 来源检查。
- Windows 回环端口占用：修复前新增测试失败，修复后 `npm run test:dev-lifecycle` 12/12 通过。集成测试也使用真实回环监听模拟其他程序占用端口。
- `npm --workspace apps/api run test:xianyu-im-owner`：11/11 通过，包括独立密钥的真实 HTTP 认证通信、错误密钥拒绝、默认开发加密密钥拒绝、重放与账号范围检查。
- `npm --workspace apps/api run build`：通过。
- `git diff --check`：通过。

## main 实际运行验证

本地合并提交：`f042174`（镜像）、`5ca1749`（Worker 密钥）、`7b21448`（回环端口）。所有适用检查均在本地执行，未推送或部署。

在 main 实际执行 `npm run dev`，基础设施启动、数据库迁移、API、Worker 与 Vite 全部成功；随后重复启动复用了已有容器和数据卷，迁移成功。

- API：`http://127.0.0.1:8080`。`/healthz` 返回 PostgreSQL、Redis 健康；`/readyz` 返回数据库就绪。
- 前端：`http://localhost:5174/`。保留其他程序占用的 `127.0.0.1:5173`；响应包含本项目 `/src/main.tsx`，代理 `/api/v1/auth/session` 返回真实 API 的未登录/待初始化状态。
- MinIO：`http://127.0.0.1:19000/minio/health/ready` 返回 200。
- Worker：启动日志确认收件队列、清理、结果审查和商品自动化 Worker 已启动。

当前环境无启动阻塞。本次使用本机已有的 MinIO 镜像，未验证冷缓存机器从公网拉取；网络受限环境可配置 `OBJECT_STORAGE_IMAGE`。本次验证范围为开发启动和相关通信回归，未执行全量业务测试、真实闲鱼扫码或视觉回归；未改动对应业务或页面，不将启动检查作为这些流程的端到端验收。

停止命令：`npm run dev:stop`。本次未删除数据卷；为释放 19000 端口，仅停止此前本任务创建的临时容器 `xianyu-account-delete-minio-20261025`，容器及其数据保留。
