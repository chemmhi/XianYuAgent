# Workspace 商品发布确认垂直切片

- 切片编号：WS-VS-02（映射阶段 5 `S4-VS6B` 商品发布确认子片）
- 日期：2026-09-28
- 状态：VERIFIED
- 目标：让 Workspace 识别商品发布指令，生成脱敏确认卡，并在管理员确认后可靠地进入执行 Outbox。

## 用户路径

1. 管理员在 `/workspace` 当前账号会话中输入 `发布商品 <productId>`，也支持 `上架商品` 加商品 UUID、标题或外部商品引用。
2. 服务端按 `adminId + accountId` scope 读取商品，生成只包含商品 ID、账号 ID、标题、状态、价格、分类和外部引用的 Confirmation Manifest。
3. Run/Step 进入 `waiting_confirmation`，Workspace 显示“商品发布确认”卡片；卡片不展示 Credential、Cookie、卡券正文或闲鱼原始响应。
4. 管理员点击“确认继续”后，服务端校验 Policy、确认版本和请求幂等键，状态迁移为 `confirmed` / `executing`，并写入 `execution.outbox_jobs`。
5. 管理员点击“取消动作”后，Confirmation 变为 `cancelled`，Run/Step 变为 `cancelled`，不会创建 Outbox。

## 本切片范围

- Workspace 商品发布指令识别和当前账号 scope 商品解析。
- `workspace.confirmations` 迁移、MemoryStore/PostgreSQL CRUD、过期读取和乐观锁版本。
- Confirmation / Cancel / Retry / Outbox API 与前端 Controller、Confirmation Card、Outbox Panel。
- `product.publish.confirm` Policy reference、审计事件、Run Event 和 Idempotency-Key。
- 确认后可靠入队；Outbox 保持 `pending`，等待后续独立 Worker/真实闲鱼外部执行切片。

## 不在本切片

- 不伪造闲鱼商品已发布成功，不直接调用真实外部发布接口。
- 不实现新增卡券、修改 Agent 配置、商品 SKU/素材编辑或订单交付。
- 不把 `externalOutcome=unknown` 当作成功，也不允许未知结果盲目重放。

## 状态与安全边界

```text
Run:  queued -> running -> waiting_confirmation -> executing
Confirmation: active -> confirmed | cancelled | expired | rejected
Step: running -> waiting_confirmation -> executing | cancelled
```

- Confirmation 使用 `version` 做乐观锁；过期 Confirmation 在读取时收敛为 `expired`。
- Outbox 作用域固定为 `workspace:${adminId}:${accountId}`，幂等键为 `workspace-confirm:${confirmationId}`。
- 所有读取和写入均复核管理员账号 scope、Run/Session 归属和当前商品账号归属。
- 前端只接收脱敏 Manifest；CredentialStore、Cookie、卡券正文和外部原始 payload 不进入 Workspace message、Run event 或 ViewModel。

## API

- `GET /api/v1/workspace/runs/{id}/confirmation`
- `POST /api/v1/workspace/runs/{id}/confirm`，body：`{ expectedVersion }`
- `POST /api/v1/workspace/runs/{id}/cancel`，body：`{ expectedVersion }`
- `POST /api/v1/workspace/runs/{id}/retry`
- `GET /api/v1/execution/outbox?runId={id}`

写请求必须携带 `Idempotency-Key` 和 CSRF token；同一确认重复提交复用原 Outbox 结果，版本不一致返回冲突。

## 迁移与回滚

- 新增 `apps/api/migrations/043_workspace_confirmations.sql`，包含 Confirmation 表、`(run_id, step_id)` 唯一约束、active step 部分唯一索引、状态/版本检查和过期查询索引。
- 迁移可重复执行；真实 PostgreSQL 临时数据库已执行完整 `001`–`043` 顺序并通过写入、确认、复读。
- 回滚采用应用先行：停止新的确认写入并回退 API；保留已确认记录、Run/Step 历史和 Outbox，待 `S4-ENV-RECOVERY` 完成后再评估 DDL 回滚，不在共享环境直接删除有数据的表。

## 验证证据

### 单元与 API

- `node --import tsx --test apps/api/scripts/workspace-confirmation.test.ts`：5/5 通过。
- `node --import tsx --test apps/api/scripts/workspace-native-read.test.ts apps/api/scripts/workspace-confirmation.test.ts`：10/10 通过。
- `node apps/api/scripts/workspace-confirmation-smoke.mjs`：MemoryStore HTTP 链路通过，覆盖确认、取消、Outbox 入队和 Idempotency replay。

### PostgreSQL 持久化

- `node apps/api/scripts/workspace-confirmation-postgres-smoke.mjs`：PASS。
- 证据：Confirmation `confirmed`、version `2`；Run `executing`；Step `executing`；Outbox `pending`；关闭并重开 Store 后复读一致。

### 真实浏览器

- `node apps/web/scripts/e2e-workspace-confirmation.mjs`：PASS。
- 路径：真实 Chrome/CDP → Vite `/workspace` → PostgreSQL API → Confirmation Card → Confirm/Cancel → 页面 Outbox/状态回显。
- 桌面截图：`artifacts/real-verify/S4-VS-WS-VS-02/screenshots/workspace-confirmation-desktop-1440x900.png`
- 移动截图：`artifacts/real-verify/S4-VS-WS-VS-02/screenshots/workspace-confirmation-mobile-390x844.png`

### 构建与卫生

- `npm run typecheck:api`
- `npm run typecheck:web`
- `npm run build:api`
- `npm run build:web`
- `npm --workspace apps/web run test -- --run src/features/workspace`
- `git diff --check`

## 评审结论

- 业务/验收：PASS；商品发布指令、确认、取消、Outbox pending 和状态回显均从 `/workspace` 用户入口完成。
- 架构/数据流：PASS；Workspace 复用 Store，按管理员和账号 scope 隔离，Policy → Confirmation → Idempotency → Outbox 顺序可复核。
- 质量/安全/运维：PASS（受控环境）；Memory、PostgreSQL、HTTP、Chrome/CDP 和双 viewport 证据通过，外部闲鱼发布 Worker 与发布级恢复仍保持独立后续门禁。

## 下一切片门禁

WS-VS-02 已 VERIFIED，允许进入下一条 Workspace 原生写入切片（新增卡券或修改配置）。商品真实外部发布 Worker、unknown/recovery 和发布级迁移回滚不得被本切片的 `pending` 结果替代。
