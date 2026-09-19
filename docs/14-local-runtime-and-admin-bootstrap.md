# 本地开发运行时与管理员初始化

更新日期：2026-09-19

## 运行时统一约定

本地开发与 Docker Compose 使用同一套 PostgreSQL、Redis 和 MinIO 数据源，区别只在 API/Worker 的运行方式：

- `npm run dev`：API、Worker、Web 运行在宿主机进程；PostgreSQL、Redis、MinIO 运行在 Docker Compose。
- `npm run compose:up:d`：API、Worker、PostgreSQL、Redis、MinIO 全部运行在 Docker Compose `full` profile。
- 两种模式不能同时运行，因为都会占用 API `8080` 端口。

根目录脚本负责注入环境变量，不需要进入 `apps/api` 或 `apps/web` 手动设置：

```powershell
npm run dev
npm run infra:up
npm run infra:down
npm run compose:up:d
```

本地 API 默认使用：

```text
DATABASE_URL=postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent
REDIS_URL=redis://127.0.0.1:6379
ALLOW_IN_MEMORY=false
```

`MemoryStore` 仅允许 smoke/E2E 测试通过代码显式传入 `allowInMemory: true`，不能作为开发环境兜底。若 PostgreSQL 不可达，本地 API 应启动失败并暴露环境问题，而不是静默切换到内存数据。

## 为什么之前看不到初始化页面

管理员初始化页面不是固定入口，而是由真实数据源的管理员数量决定：

1. 前端调用 `GET /api/v1/auth/session`。
2. 后端查询 `store.countAdmins()`。
3. 只有管理员数量为 0 时返回 `bootstrapRequired=true`，前端才显示初始化表单。
4. 已有管理员时只显示登录表单，前端不硬编码邮箱和密码。

之前本地 `npm run dev` 默认启用了 `MemoryStore`，而 Compose 使用 PostgreSQL；同时多个 API 进程竞争 `8080`，所以浏览器可能连到一套与 Compose 不同的管理员数据。

当前 PostgreSQL 开发数据中的管理员账号为：

```text
邮箱：1051585831@qq.com
```

这是开发账号，不是生产账号；密码由本次本地环境配置提供，不写入前端或仓库中的运行时代码。若要再次展示初始化页面，必须先确认并清理该管理员，然后重启本地 dev。

## 运行时诊断

`GET /healthz` 和 `GET /readyz` 现在返回 `storage` 字段：

- `storage=postgres`：使用 PostgreSQL；
- `storage=memory`：仅应出现在显式测试 harness。

这让本地开发可以直接确认当前请求没有误连到另一套内存 API。
