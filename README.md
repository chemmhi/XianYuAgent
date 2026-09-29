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

## 生产部署（GitHub + SSH）

生产部署的唯一代码来源是 GitHub `origin/main`。禁止向服务器裸仓库直接 `git push`，禁止从开发机使用 `scp`、`rsync` 或其他方式上传代码，禁止在服务器工作树中手工改代码。以下命令以 SSH 别名 `server-prod` 和服务器目录 `/home/ubuntu/xianyu-agent-prod` 为例；如果目录或别名不同，只替换这两个值。

### 1. 提交并推送代码

在本地工作树执行：

```powershell
git status --short
npm ci
npm run typecheck
npm run build
docker compose config --quiet
git diff --check
git add <已确认的文件>
git commit -m "<说明本次部署变更>"
git push origin HEAD:main
```

不要把其他未相关的工作树改动一起提交。推送成功后，服务器只能从 GitHub 拉取该提交；服务器上的本地裸仓库、临时目录或手工复制都不属于发布链路。

### 2. 检查并更新服务器工作树

```powershell
ssh server-prod 'cd /home/ubuntu/xianyu-agent-prod && origin_url="$(git remote get-url origin)" && case "$origin_url" in https://github.com/chemmhi/XianYuAgent.git|git@github.com:chemmhi/XianYuAgent.git) ;; *) echo "拒绝部署：origin 必须指向 GitHub，当前为 $origin_url" >&2; exit 1;; esac && git status --short && git fetch origin main && git pull --ff-only origin main'
```

如果服务器存在未提交的代码改动，先停止部署并处理这些改动；`.env` 及 `.env.bak-*` 属于运行配置/备份，不应提交到 Git。首次切换旧服务器时，先将 `origin` 改为 GitHub，再执行上面的校验：

```powershell
ssh server-prod 'cd /home/ubuntu/xianyu-agent-prod && git remote set-url origin https://github.com/chemmhi/XianYuAgent.git'
```

### 3. 重建并滚动 API/Worker

生产环境优先只重建应用服务，避免因为基础设施镜像仓库权限、MinIO 拉取或已有数据卷导致整套 Compose 被重启：

```powershell
ssh server-prod 'cd /home/ubuntu/xianyu-agent-prod && docker compose config --quiet && docker compose build api worker && docker compose up -d --no-deps api worker'
```

只有在需要初始化或变更 PostgreSQL、Redis、MinIO 时，才执行完整拓扑启动：

```powershell
ssh server-prod 'cd /home/ubuntu/xianyu-agent-prod && docker compose --profile full up -d --build'
```

如果完整启动因为 `object-storage` 镜像仓库返回 `unauthorized` 失败，保持现有基础设施容器运行，改用上面的 `docker compose build api worker` 与 `docker compose up -d --no-deps api worker`。

### 4. 应用已有 PostgreSQL volume 的迁移

已有数据卷不会因为 Compose 重建而自动重放新迁移。服务器必须从已拉取的 GitHub 工作树执行迁移，再开放新功能写入：

```powershell
ssh server-prod 'cd /home/ubuntu/xianyu-agent-prod && POSTGRES_PASSWORD="$(sed -n "s/^POSTGRES_PASSWORD=//p" .env | tr -d "\r" | head -n 1)" && test -n "$POSTGRES_PASSWORD" && docker run --rm --network xianyu-agent-prod_default -v "$PWD:/workspace" -w /workspace -e DATABASE_URL="postgres://xianyu:${POSTGRES_PASSWORD}@postgres:5432/xianyu_agent" node:24-bookworm-slim node apps/api/scripts/migrate.mjs'
```

### 5. 在服务器工作树构建并发布前端

服务器不需要安装 Node/npm；前端必须从服务器已拉取的 GitHub 工作树构建，并在服务器本机备份后发布到 Nginx 目录。开发机不得上传 `dist` 或源码：

```powershell
ssh server-prod 'cd /home/ubuntu/xianyu-agent-prod && docker run --rm -u 0 -e NPM_CONFIG_UPDATE_NOTIFIER=false -e NPM_CONFIG_REGISTRY=https://registry.npmmirror.com -v "$PWD:/workspace" -w /workspace node:24-bookworm-slim bash -lc "rm -rf node_modules apps/api/node_modules apps/web/node_modules SellerAgent/node_modules && npm ci --registry=https://registry.npmmirror.com && npm run build:web"'
ssh server-prod 'cd /home/ubuntu/xianyu-agent-prod && backup="/var/backups/xy.chemhi.top-$(date +%Y%m%d%H%M%S)" && sudo mkdir -p "$backup" && sudo tar -czf "$backup/site.tgz" -C /var/www/xy.chemhi.top . && sudo rsync -a --delete apps/web/dist/ /var/www/xy.chemhi.top/'
```

### 6. 部署后验收

```powershell
ssh server-prod 'cd /home/ubuntu/xianyu-agent-prod && docker compose ps'
ssh server-prod 'cd /home/ubuntu/xianyu-agent-prod && docker compose logs --tail=80 api worker'
ssh server-prod 'cd /home/ubuntu/xianyu-agent-prod && docker compose exec -T postgres sh -lc "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Atc \"select count(*) from settings.auto_reply_repair_policies;\""'
```

API/Worker 应为 `Up`，日志应包含 `repairMode=enforce`、`primaryRoute=repair` 和 `outcomeReviewWorker=enabled`；策略表至少应有一个有效账号策略。若出现 `28P01`，优先检查 `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB` 与已存在数据卷是否一致。

### 7. 自动回复相关环境变量

`.env` 是隐藏文件，`ls` 默认不会显示；它只在服务器上保存运行配置，不进入 Git。Compose 通过显式映射把需要的变量注入 API/Worker，不能假设“服务器有 `.env`”就等于“容器能读取 `.env`”。

必需的生产开关：

- `AUTO_REPLY_REPAIR_MODE=enforce`：启用修复后的自动回复主链路。
- `AUTO_REPLY_OUTCOME_REVIEW_WORKER_ENABLED=true`：启用发送结果审核 Worker。
- `AUTO_REPLY_MODEL_ENABLED=true`：允许使用配置的模型生成回复；仍受 `API_KEY`、`BASE_URL`、`MODEL` 等配置约束。
- `AUTO_REPLY_SEND_MODE=live`：允许真实发送；排障或演练时可切换为 `simulate`。
- `AUTO_REPLY_POLICY_BOOTSTRAP_DEFAULT=true`：账号没有持久化策略时，API 启动自动写入版本化默认策略。
- `AUTO_REPLY_POLICY_JSON`：兼容兜底用的完整 JSON bundle，包含 policy、pre-send policy 和 outcome policy。正常生产不再依赖它；只有关闭默认策略引导或无法写入策略表时才需要提供。

数据库和容器内连接：

- `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`：PostgreSQL 数据卷初始化和应用连接使用的凭据；已有数据卷的密码必须保持一致。
- `DATABASE_URL_DOCKER`、`REDIS_URL_DOCKER`：可选的容器内连接覆盖。不要把仅适用于宿主机的 `127.0.0.1` 地址直接当作容器间地址。

完整模板见 `.env.example`。自动回复策略的正常启动路径是“读取账号持久化策略 → 缺失时自动引导默认策略 → 兼容配置兜底”，因此后续按本节 Git 部署流程发布时，不应再因为漏配 `AUTO_REPLY_POLICY_JSON` 而导致 `POLICY_CONFIG_UNAVAILABLE`。

真实闲鱼二维码模式由 `XIANYU_QR_MODE=real` 控制；未设置或设置为其他值时，后端默认仍采用真实模式，自动化测试会显式使用 `stub`。

二维码或 IM 遇到风控验证时，可启用 Patchright 驱动的系统 Chrome：

- `XIANYU_VERIFICATION_BROWSER_MODE=launch`：服务端按账号/会话启动持久化系统 Chrome；
- `XIANYU_VERIFICATION_BROWSER_HEADLESS=false`：默认使用系统 Chrome 有头引擎；自动模式窗口移出屏幕，避免出现空白验证窗口；
- `XIANYU_VERIFICATION_SLIDER_MODE=auto`：使用 Patchright 页面 API 和真实鼠标事件执行滑块轨迹；算法失败直接返回验证失败，不伪造成功；生产默认 `disabled`；
- `XIANYU_VERIFICATION_SLIDER_MAX_RETRIES=3`：单次验证最多自动尝试次数；
- 验证完成后，服务端必须同时确认页面已离开验证态并拿到新的 `x5sec`，随后关闭浏览器上下文。

滑块适配位于 `apps/api/src/xianyu-slider-trajectory.ts` 与 `apps/api/src/xianyu-slider-solver.ts`：

1. 通过 Patchright locator 在主文档和 iframe 中发现验证码容器、滑块按钮和轨道；
2. 按轨道宽度减去按钮宽度计算水平位移；
3. 生成带加减速、二维抖动、超调、回弹和时间轴延迟的轨迹；
4. 通过 Patchright `page.mouse` 回放真实按下、移动、释放事件；
5. 轮询成功/失败文本和页面 URL；失败时点击重试控件或刷新验证页；
6. 任意自动尝试失败都返回验证错误，不伪造成功；只有新的 `x5sec` 且页面离开验证态才算通过。

该实现不依赖裸 CDP，也不在服务端日志中输出业务 Cookie 或 Token；服务器部署时需要可执行的正式版 Chrome。验证上下文完成后立即关闭，持久化 profile 仅用于复用账号登录态。
