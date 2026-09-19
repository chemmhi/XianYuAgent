# 目录边界与统一启动命令

更新日期：2026-09-19

## 已确认边界

- `SellerAgent/` 是高保真视觉与交互原型，只作为临时视觉基线。
- `apps/web/` 是正式 React + Vite 前端实现目录。
- `apps/api/` 是正式 Node API workspace，同时保留独立 `src/worker.ts` 进程入口。
- 根目录 `package.json` 是唯一项目级包管理入口，根 `package-lock.json` 是正式 workspace 的依赖锁。

## 根目录命令

```text
npm ci
npm run dev
npm run dev:api
npm run dev:worker
npm run dev:web
npm run typecheck
npm test
npm run build
npm run verify
npm run compose:up
npm run compose:down
```

`npm run dev` 会先执行 `dev:prepare`，停止 Compose API/Worker，仅保留 PostgreSQL、Redis、MinIO，再由根 npm 命令启动本地 API、Worker 和正式前端。全 Compose 模式通过 `full` profile 运行；两种模式不得同时占用 `8080`。

根脚本通过 `cross-env` 显式设置 `VITE_API_MODE=live`、`VITE_API_PROXY_TARGET=http://127.0.0.1:8080`、`ALLOW_IN_MEMORY=false` 以及宿主机 PostgreSQL/Redis 地址，不再依赖进入子目录手动设置环境变量，也不会回退到 mock 模式。

## 迁移边界

阶段 5 S4-VS1 的账号管理切片已迁移到 `apps/web/src/features/accounts/`。本次迁移不复制 `SellerAgent/src/App.tsx` 或 `SellerAgent/src/styles.css`，避免把原型超级宿主带入正式前端。
