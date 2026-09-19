# XianyuSellerAgent

本仓库采用根目录 npm workspaces 统一管理前端与后端。

目录边界：

- `apps/web/`：正式 React + Vite 前端应用。
- `apps/api/`：Node HTTP API、数据库迁移和独立 Worker 入口。
- `SellerAgent/`：只读高保真原型与视觉参考，不是正式业务前端目录。
- `xianyu-admin-design-style/`：design token 与视觉规范参考。

## 常用命令

首次安装：

```powershell
npm install
```

本地同时启动 API 与前端：

```powershell
$env:XIANYU_QR_MODE = "real"
$env:ALLOW_IN_MEMORY = "true"
$env:COOKIE_SECURE = "false"
npm run dev
```

需要单独观察 Worker 时：

```powershell
npm run dev:worker
```

默认地址：

- 前端：`http://localhost:5173`
- API：`http://localhost:8080`

分开启动（仅用于排障）：

```powershell
npm run dev:api
npm run dev:web
```

构建、类型检查和测试：

```powershell
npm run typecheck
npm run build
npm test
npm run verify
```

Docker Compose：

```powershell
npm run compose:config
npm run compose:up
npm run compose:up:d
npm run compose:logs
npm run compose:ps
npm run compose:down
```

Compose 当前负责 API、Worker、PostgreSQL、Redis 和 MinIO；本地前端由根命令 `npm run dev` 启动。

真实闲鱼二维码模式由 `XIANYU_QR_MODE=real` 控制；未设置或设置为其他值时，后端默认仍采用真实模式，自动化测试会显式使用 `stub`。
