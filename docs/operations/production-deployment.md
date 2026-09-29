# FishAgent 生产部署记录与防回归清单

## 发布来源约束

生产部署必须通过 GitHub `origin/main` 完成。禁止向服务器裸仓库直接推送，禁止从开发机使用 `scp`、`rsync` 或其他方式上传代码，禁止在服务器工作树中手工改代码。服务器部署目录的 `origin` 必须是 `https://github.com/chemmhi/XianYuAgent.git` 或等价的 GitHub SSH 地址；部署前必须执行 `git fetch origin main && git pull --ff-only origin main`。

## 固定部署入口

生产 API 由 Nginx 反代到 `127.0.0.1:18082`，容器内部仍监听 `8080`。服务器部署目录为 `/home/ubuntu/xianyu-agent-prod`，必须显式使用 `compose.prod.yml`：

```bash
cd /home/ubuntu/xianyu-agent-prod
bash scripts/deploy-production.sh
```

脚本会在执行前拒绝以下两类配置错误：

- 使用开发用 `docker-compose.yml`，它把 API 暴露为宿主机 `8080`；
- Compose 发布端口与 Nginx 的 `proxy_pass` 不一致。

脚本通过后才会执行 `docker compose -f compose.prod.yml up -d --build --force-recreate`，并保留所有数据卷，不执行 `down -v`。随后检查本地与公网的 `/healthz`、`/readyz`，以及 `/api/v1/auth/session`（允许未登录时的 `401/403`）。

## 2026-09-25 502 事故记录

### 现象

浏览器打开管理会话返回 `502 Bad Gateway`，Nginx 错误日志显示连接 `127.0.0.1:18082` 被拒绝。

### 根因

运行中的容器标签显示 Compose 配置文件是 `/home/ubuntu/xianyu-agent-prod/docker-compose.yml`，API 映射为 `0.0.0.0:8080->8080`；而 `/etc/nginx/conf.d/xy.chemhi.top.conf` 的 `/healthz`、`/readyz` 和 `/api/` 全部反代到 `127.0.0.1:18082`。因此 Nginx 上游端口没有监听。

### 修复与证据

1. 使用 `docker compose -f compose.prod.yml up -d --build --force-recreate postgres redis object-storage api worker` 重建服务；未删除 PostgreSQL、Redis、MinIO 或 `browser_data` 数据卷。
2. 修复后 API 映射为 `127.0.0.1:18082->8080`。
3. 2026-09-25 21:55（Asia/Shanghai）验证：本地 `/healthz`、`/readyz` 为 `200`；公网 `https://xy.chemhi.top/healthz`、`/readyz` 和 `/api/v1/auth/session` 均为 `200`。
4. 服务器未安装 Node/npm；前端必须在服务器从 GitHub 工作树使用一次性 Node 容器执行 `npm ci && npm run build:web`，再由服务器本机备份并同步到 `/var/www/xy.chemhi.top`。禁止从开发机上传源码或 `dist`。发布前备份保存为 `/var/backups/xy.chemhi.top-20260925215631/site.tgz`。公网 HTML 标题已为 `FishAgent · 运营控制台`。

### 防止下次复发

- 不再直接运行 `docker compose up`；只运行 `scripts/deploy-production.sh`。
- 部署前保留 `docker compose -f compose.prod.yml config --quiet`、发布端口校验和 Nginx 上游校验。
- 发布后必须同时检查本地端口、公网健康检查和会话接口；任何一步失败都停止交付。
- 发布保持“本地检查并推送 GitHub → 服务器 `git pull --ff-only` → 服务器构建 → 服务器备份 → 服务器本机 `rsync --delete`”顺序，并记录备份路径。

## 回滚

- 后端：回到上一个已验证 Git 提交后，仍使用 `scripts/deploy-production.sh` 重建；不要删除数据卷。
- 前端：将对应 `/var/backups/xy.chemhi.top-*/site.tgz` 解压回 `/var/www/xy.chemhi.top`，再执行公网健康检查。
