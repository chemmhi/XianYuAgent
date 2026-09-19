# 根目录包管理与开发编排规范

更新时间：2026-09-19

## 规范结论

- 根目录 `package.json` 是唯一正式安装入口，使用 npm workspaces 管理 `apps/web` 与 `apps/api`。
- 根目录 `package-lock.json` 是唯一正式 workspace 锁文件；`apps/api/package-lock.json` 已删除。
- `SellerAgent/package-lock.json` 属于独立的高保真参考项目，不参与根 workspace 安装。
- 构建工具、类型检查器、测试运行器和开发编排工具必须放在对应 workspace 或根目录的 `devDependencies`，不得作为运行时依赖发布。
- Node/npm 版本通过 `.nvmrc`、`.node-version`、`package.json#packageManager` 与 `engines` 四处保持一致。
- 本地首次安装和 CI/验收安装统一使用 `npm ci`；依赖变更必须在根目录执行 npm 命令并提交根锁文件。

## 版本基线

```text
Node.js 24.12.0
npm 11.6.2
```

`engine-strict=true` 会让版本不符合约束的环境在安装阶段直接失败，避免“本机可用、CI 不可复现”。

## 根目录命令

```powershell
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run verify
npm run test:e2e:chrome
npm run db:migrate
```

`npm run dev` 使用成熟的 `concurrently` 同时启动 API、Worker 和正式前端；`predev` 先执行 `dev:prepare`，停止 Compose API/Worker，仅启动 PostgreSQL、Redis、MinIO 作为本地共享依赖。根脚本使用 `cross-env` 注入统一环境变量，不需要进入子目录手动切换数据源或 mock/live 模式。

`npm run infra:up` / `npm run infra:down` 只管理本地开发依赖，不删除数据卷；`npm run compose:up:d` 使用 Compose `full` profile 启动全容器模式。两种模式互斥，不能同时占用 `8080`。

`npm run test:e2e:chrome` 使用本机 Chrome + Chrome DevTools Protocol，验证真实前端入口、Vite 代理、API、Session/CSRF、账号创建、持久化可见结果、二维码授权弹窗，并保存 1440×900 与 390×844 截图证据；不安装 Playwright。若 Chrome 不在默认路径，可设置 `CHROME_PATH`。

Compose 使用 `quay.io/minio/minio:latest`；对象存储宿主端口为 `19000/19001`，不得占用 PRD 参考项目使用的 `localhost:9000`。

## 变更规则

1. 不在 `apps/*` 内执行独立的正式安装，不新增子目录 lockfile。
2. 修改依赖时使用 `npm install --workspace <workspace> ...` 或根目录等价命令。
3. 提交前必须执行 `npm ci`、类型检查、测试、构建、Compose 配置检查和 `git diff --check`。
4. 依赖升级必须同时审查运行时/开发时归类、Node/npm engine、锁文件变化和 Docker 构建入口。
