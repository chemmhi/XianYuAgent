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
npm ci
```

本地同时启动 API 与前端：

```powershell
$env:XIANYU_QR_MODE = "real"
$env:ALLOW_IN_MEMORY = "true"
$env:COOKIE_SECURE = "false"
$env:VITE_API_MODE = "live"
npm run dev
```

默认情况下，Vite 会把 `/api` 请求代理到 `http://127.0.0.1:8080`；只有 API 不在默认端口时，才需要设置 `VITE_API_PROXY_TARGET` 或 `VITE_API_BASE_URL`。

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
npm run test:e2e:chrome
npm run verify
```

前端真实浏览器 E2E 使用本机已安装的 Google Chrome，通过 Chrome DevTools Protocol 执行；项目不安装或引入 Playwright。

### 参考项目的真实登录态

`http://localhost:9000/accounts` 是 PRD 中的参考项目账号页，不是本项目正式前端。进行真实闲鱼扫码、复用参考项目 Cookie 或检查参考项目接口时，必须在当前已经打开且已登录闲鱼的 Chrome 窗口中直接打开该地址。不要使用无痕窗口、无头窗口、另一套 `--user-data-dir` 或新启动的独立 Chrome 实例，否则浏览器 Cookie、Local Storage 和登录态不会复用。

本项目的 `npm run test:e2e:chrome` 使用临时隔离 Chrome profile 仅验证本地前端/API 跨层链路；它不会证明参考项目的真实浏览器登录态，也不会替代人工在当前 Chrome 中打开上述地址进行复核。

Docker Compose：

```powershell
npm run compose:config
npm run compose:up
npm run compose:up:d
npm run compose:logs
npm run compose:ps
npm run compose:down
```

Compose 当前负责 API、Worker、PostgreSQL、Redis 和 MinIO；对象存储映射到 `19000/19001`，保留 `9000` 给 PRD 参考项目；本地前端由根命令 `npm run dev` 启动。

真实闲鱼二维码模式由 `XIANYU_QR_MODE=real` 控制；未设置或设置为其他值时，后端默认仍采用真实模式，自动化测试会显式使用 `stub`。

二维码遇到风控验证时，可启用用户协同浏览器：

- `XIANYU_VERIFICATION_BROWSER_MODE=launch`：服务端启动 Chrome/Edge 并打开验证页；
- `XIANYU_VERIFICATION_BROWSER_MODE=connect`：连接已启用 CDP 的浏览器，需同时配置 `XIANYU_VERIFICATION_BROWSER_DEBUG_PORT`；
- `XIANYU_VERIFICATION_BROWSER_HEADLESS=false`：默认有头模式，便于用户完成验证；无头模式仅适合外部 CDP 控制或受控测试；
- `XIANYU_VERIFICATION_SLIDER_MODE=auto`：在已有 Chrome/CDP 页面中启用抽离后的滑块轨迹算法；算法失败时保留人工验证流程，不伪造成功；生产默认 `disabled`；
- `XIANYU_VERIFICATION_SLIDER_MAX_RETRIES=3`：单次验证最多自动尝试次数；
- 验证完成后，服务端只检查页面已离开验证态并读取浏览器 Cookie，然后继续 QR 登录。

滑块适配位于 `apps/api/src/xianyu-slider-trajectory.ts` 与 `apps/api/src/xianyu-slider-solver.ts`：

1. 通过 CDP `Runtime.evaluate` 在主文档和可访问 iframe 中发现验证码容器、滑块按钮和轨道；
2. 按轨道宽度减去按钮宽度计算水平位移；
3. 生成带加减速、二维抖动、超调、回弹和时间轴延迟的轨迹；
4. 通过 CDP `Input.dispatchMouseEvent` 回放按下、移动、释放；
5. 轮询成功/失败文本和页面 URL；失败时点击重试控件或刷新验证页；
6. 任意自动尝试失败都回到现有人工验证等待，不改变 `verification_required` 的状态语义。

该实现不引入 Playwright，不在服务端保存业务 Cookie 或 Token，也不依赖桌面窗口；服务器部署时需要可执行的 Chrome/Edge 和可用的 CDP 端口。无头浏览器适合受控测试或专用验证容器，真实账号登录仍建议由人工复核风控结果。
