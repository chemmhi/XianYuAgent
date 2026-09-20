# S4-VS5A 在线聊天读取与实时连接

状态：`PARTIALLY_VERIFIED`

## 已实现

- `GET /api/v1/conversations?accountId=...`：管理员 Session + 账号 scope 校验，会话列表返回 `conversationId`、未读数、最后消息摘要与 `handlingMode`。
- `GET /api/v1/conversations/{id}/messages`：会话归属校验、历史时间线、`latestCursor` 与增量游标。
- `WS /api/v1/conversations/{id}/events?cursor=...`：Session、Origin allowlist、账号范围与会话归属校验；握手后先回放 cursor 之后事件，再接收实时事件。
- 事件 ID、消息 ID 和 cursor 在前端 controller 中去重；断线重连使用最新 cursor。
- 迁移 `015_messages.sql`：`messages.conversations`、`messages.messages`、`messages.events`。

## 实际验证命令

```text
npm run typecheck:api
npm run typecheck:web
npm --workspace apps/web run test
npm --workspace apps/api run build
node apps/api/scripts/messages-smoke.mjs
npm --workspace apps/api run test:messages:infra
```

截至 2026-09-19，本地结果：

- API TypeScript：通过；
- Web TypeScript：通过；
- Web Vitest：13 个测试文件 / 41 个测试通过；
- `messages-smoke.mjs`：通过，覆盖历史读取、cursor=0 回放、cursor=1 增量补事件、WS connected 事件、403 scope、404 conversation。
- `test:messages:infra`：通过真实 PostgreSQL + Redis 容器双 API 实例验证跨进程事件广播；执行 Redis 重启后仍收到新事件；执行 PostgreSQL 重启后消息读回与写入恢复。

## 尚未验证 / 阻塞

- 已在真实 PostgreSQL + Redis 容器上执行 `015_messages.sql` 迁移、双 API 实例事件广播、Redis 重启恢复、PostgreSQL 重启后的消息读回/写入恢复。仍未完成 Chrome/CDP 双 viewport、断线人工操作和视觉证据。
- 尚未完成 Chrome/CDP `1440×900` 与 `390×844` 截图、断线人工操作和视觉偏差记录。
- 当前首片仍为只读，发送、附件、撤回、handoff/release 不在本次范围。

## 回滚

关闭 WebSocket upgrade 入口后保留会话、消息与事件游标，页面降级为历史只读查询；不删除历史消息。
