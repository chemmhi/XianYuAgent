# 本地开发端口兼容验证

验证日期：2026-10-21（Asia/Shanghai）。环境：Windows、Node 24.12.0、npm 11.6.2。

## 行为与模块

`npm run dev` 从 `PORT=8080` 和 `VITE_PORT=5173` 开始逐个查找空闲端口，API 与前端不会分配到同一端口。进程环境优先于根目录 `.env`。启动器输出实际地址，统一下发 API 端口、Vite 端口、HTTP/WebSocket 代理和本地 WebSocket 允许来源，并保留自定义允许来源。

- `scripts/dev-ports.mjs`：端口校验、真实 socket 探测、顺序选择及环境配置。
- `scripts/dev-runner.mjs` / `scripts/dev-lifecycle.mjs`：启动装配与子进程环境传递。
- `apps/web/vite.config.ts` / `package.json`：读取选定端口并保留代理配置；由启动器选定端口后，Vite 禁止自行改用另一端口。
- 端口检查使用服务的实际绑定地址；到达 65535 后明确失败，其他绑定错误不会被误判为占用。

## 实际执行

| 命令 | 结果 |
| --- | --- |
| `npm run test:dev-lifecycle` | 9 项通过，0 失败、0 跳过 |
| `node --test scripts/dev-verification-config.test.mjs scripts/verification-container-config.test.mjs scripts/production-deploy-workflow.test.mjs` | 12 项通过，0 失败、0 跳过 |
| `npm --workspace apps/web run test` | 97 个文件、432 项通过 |
| `npm run typecheck` | API 与前端类型检查通过 |
| `npm run build` | API 与前端构建通过；保留现有大于 500 kB 的前端 chunk 提示 |
| `git diff --check` | 通过 |

新增 CLI 回归测试在修复前复现了 `EADDRINUSE` 导致启动退出。修复后的同一场景占用两个连续端口，让 API 与前端从相同起点查找，断言它们分别使用后续两个空闲端口，且原端口占用者继续存活。

测试通过临时工作目录的 `npm run dev` 启动仓库的实际启动器、API、Worker 和 Vite，复用正式前端脚本的环境配置。通过前端代理完成管理员初始化、Cookie/CSRF 会话和账号创建，再从 API 直连读取同一账号并从代理确认登录会话。WebSocket 升级请求验证动态来源与自定义来源进入认证检查，未允许来源被拒绝。

测试端口使用实际 socket 预留在 20000–29999 内，避免启动子进程时被操作系统临时出站端口抢占；临时进程、监听 socket 和目录在结束后清理。

## 验证范围

本次仅修改本地开发启动装配，不涉及业务接口或数据库结构，无迁移要求。CLI 集成验证使用隔离 MemoryStore，替换 Docker 预启动及正式脚本中的本地数据库/闲鱼实时模式默认值；不验证 PostgreSQL 持久化、真实闲鱼交互或 WebSocket 完整消息流。未执行全量后端业务测试、远程部署或生产环境验收。适用的本地验证无阻塞。

端口探测后会释放 socket 再启动服务；其他进程若恰好在此间抢占选定端口，启动仍可能失败。Vite 固定选定端口，避免静默切换导致代理或允许来源不匹配。
