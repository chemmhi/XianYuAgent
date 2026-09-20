# S4-VS6A Workspace 会话与 Run 首链路验证基线

- 验证日期：2026-09-20
- 当前结论：`PARTIALLY_VERIFIED`
- 范围：`/workspace` 页面、AgentSession 列表/创建/搜索/切换/归档、Run 创建与脱敏详情、Step 状态、事件列表、只读 WebSocket snapshot/cursor replay。
- 明确不在本片：Confirmation/Outbox、confirm/cancel/retry/recover、独立 Worker/Pi Runtime、真实外部平台动作。

## 已实现

- 数据迁移：`apps/api/migrations/015_workspace_agent.sql`，包含 session、run、step、task context、run event，并以 `(session_id, account_id)` 复合外键阻止跨账号绑定。
- 后端：`WorkspaceService`、Memory/Postgres Store、服务端 Run/Step 状态迁移、`clientRunRef` 业务去重、`Idempotency-Key` 请求幂等、指令/Step 脱敏 ViewModel。
- API：`GET/POST /api/v1/workspace/agent-sessions`、search/switch/archive、`POST /api/v1/workspace/runs`、Run/event GET。
- WebSocket：Session Cookie、Origin host、Run scope 校验；先发 snapshot，再按 `after` 游标补发事件；无效游标归一化为 0。
- 前端：`WorkspacePage`、`useWorkspaceController`、session list、composer、Run/Step timeline、realtime/reconnect/error/empty/forbidden 状态。

## 已执行命令

| 层级 | 命令 | 结果 |
| --- | --- | --- |
| API build | `npm --workspace apps/api run build` | 通过 |
| Workspace HTTP smoke | `node apps/api/scripts/workspace-smoke.mjs` | 通过：session/run、queued→succeeded、Step、clientRunRef、Idempotency-Key 冲突、归档阻断 |
| Workspace WebSocket smoke | `node apps/api/scripts/workspace-ws-smoke.mjs` | 通过：101、snapshot、事件 replay、游标去重、`after=NaN`、Origin/认证/404 门禁 |
| API full suite | `npm --workspace apps/api run test` | 通过：env0、onboarding、workspace session/run、workspace websocket、products、sync、mapper |
| Web typecheck | `npm --workspace apps/web run typecheck` | 通过 |
| Web unit tests | `npm --workspace apps/web run test` | 通过：13 files / 41 tests |
| Web production build | `npm --workspace apps/web run build` | 通过 |
| Real browser E2E | `npm run test:e2e:chrome:workspace` | 通过：临时 PostgreSQL + `ALLOW_IN_MEMORY=false` API + Vite + Chrome/CDP；session 持久化、Run/Step 成功、7 条事件回放、断线/重连、WS handshake、桌面/移动截图 |
| Diff hygiene | `git diff --check` | 通过 |

> 复核说明：本轮 API 全量 smoke 已在清理残留测试进程后完整通过；真实浏览器脚本使用临时 PostgreSQL 数据库和独立 Chrome profile，验证了前端真实入口、持久化、断线重连与事件回放。该证据仍不替代独立 Worker/Pi Runtime、发布级恢复和人工视觉签核。

## Workspace 关键覆盖

- Run 首次创建先返回 `queued`，随后受控 Runtime 推进到 `succeeded`；Step 同步到 `succeeded`。
- 相同 `clientRunRef` 返回既有 Run；同一 `Idempotency-Key` 不同指纹返回 `IDEMPOTENCY_CONFLICT`。
- 事件 GET 按 `after` 游标读取；WS smoke 覆盖 101、snapshot、`run.queued`、`run.succeeded`、游标 replay 无重复、`after=NaN`、Origin 403、未认证 401、未知 Run 404。
- 归档 session 后禁止新 Run；未授权账号 scope 不返回 session/run。

## 未关闭门禁

- 当前 Runtime 是 API 进程内受控实现，不等同于独立 Worker/Pi Runtime；未覆盖 lease、超时、取消、重试、unknown 和观测指标。
- 已执行真实 PostgreSQL migration/复读 smoke，并由真实浏览器脚本验证 session/Run 持久化；发布级迁移回滚、Testcontainers 和恢复演练仍未覆盖。
- 已生成 Chrome/CDP `1440x900` 与 `390x844` 截图，且自动化验证断线/重连和事件回放；独立人工视觉签核与偏差记录仍待完成。
- `S4-VS6B` 的 Confirmation/Outbox、confirm/cancel/retry/recover 留待后续切片。

## 回滚边界

停止新 Run enqueue，关闭 Workspace API/WS 订阅，保留 Session/Run/Step/事件历史；迁移回滚前先确认没有后续数据依赖。
