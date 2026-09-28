# Workspace 新增卡券确认垂直切片

- 切片编号：WS-VS-03
- 日期：2026-09-28
- 状态：VERIFIED
- 目标：让 Workspace 识别新增卡券指令，在管理员确认后复用当前卡券域创建批次，并完整记录本地执行结果。

## 用户路径

1. 管理员在 `/workspace` 当前账号会话中输入“新增卡券”“创建卡券”或“新建卡券”，可附带名称、类型、内容、API 配置或图片地址。
2. 服务端按 `adminId + accountId` scope 解析指令，生成只包含账号、名称、类型、配置状态和数量的脱敏 Confirmation Manifest。
3. Run/Step 进入 `waiting_confirmation`，Workspace 显示“新增卡券 · 需要管理员确认”；卡券正文只保留在服务端创建边界，不进入 Workspace Message、Run Event 或前端 instruction summary。
4. 管理员点击“确认继续”后，服务端校验 `coupon.create.confirm` Policy、Confirmation version 和幂等键，复用 `CouponService.create` 创建卡券批次；`data` 类型随后复用 `CouponService.importItems` 导入每行数据。
5. 本地创建完成后，Workspace Outbox 记录 `coupon_create` 的 `succeeded / known_success`，Run/Step 进入 `succeeded`，并回传脱敏结果。
6. 管理员点击“取消动作”后，Confirmation 变为 `cancelled`，Run/Step 变为 `cancelled`，不会创建卡券批次，也不会写入 Outbox。

## 本切片范围

- Workspace 新增卡券指令识别，支持固定文字、批量数据、API 接口和图片四类目的。
- 中文键值指令解析，例如：`新增卡券；名称：会员资料包；类型：批量数据；内容：A-001\nB-002`。
- 复用现有 `CouponService.create` 和 `CouponService.importItems`，保持卡券批次、元数据和审计的既有数据 owner。
- `coupon.create.confirm` Policy、Confirmation / Cancel / Retry / Outbox API 和前端确认卡复用 WS-VS-02 的状态机与入口。
- 本地创建成功后的 Run Event、AuditEvent 和 Outbox 结果回显。

## 不在本切片

- 不调用闲鱼商品发布 Worker，也不改变商品发布的 `pending` 外部执行语义。
- 不暴露卡券正文、API Key、Cookie、图片原始 payload 或 Pi 原始响应。
- 不实现卡券编辑、批量删除、消费/核销、MinIO 生命周期或订单交付。
- 不把卡券创建结果解释为外部平台状态变化；本片只确认本地卡券域写入成功。

## 状态与安全边界

```text
Run:  queued -> running -> waiting_confirmation -> executing -> succeeded
Confirmation: active -> confirmed | cancelled | expired | rejected
Step: running -> waiting_confirmation -> executing -> succeeded | cancelled
Outbox: pending -> processing -> succeeded
```

- Confirmation 使用 `version` 做乐观锁；过期 Confirmation 在读取时收敛为 `expired`，重复确认被拒绝。
- Outbox 作用域固定为 `workspace:${adminId}:${accountId}`，幂等键为 `workspace-confirm:${confirmationId}`。
- Manifest 只包含 `accountId`、`title`、`label`、`purpose`、`itemCount`、`configured` 和 `redacted=true`。
- 卡券正文只在服务端调用 `CouponService` 的边界出现；Workspace Message、Run Event、前端 summary 和 Confirmation Card 均不包含正文。
- 所有读取和写入复核管理员账号 scope、Run/Session 归属和当前账号归属。

## API 与迁移

- 继续复用：`GET /api/v1/workspace/runs/{id}/confirmation`、`POST /api/v1/workspace/runs/{id}/confirm`、`POST /api/v1/workspace/runs/{id}/cancel`、`POST /api/v1/workspace/runs/{id}/retry`、`GET /api/v1/execution/outbox?runId={id}`。
- 新增 `apps/api/migrations/044_workspace_coupon_confirmations.sql`，将 Confirmation action check 扩展为 `product_publish | coupon_create`，兼容已执行 043 的数据库。
- 迁移可重复执行；真实 PostgreSQL 临时数据库已执行完整 `001`–`044` 顺序并通过确认、批次、Outbox 写入与 Store 重开复读。
- 回滚采用应用先行：先停止新的 `coupon_create` Confirmation 写入并回退 API；保留历史 Confirmation、Run/Step、CouponBatch、Outbox 和审计。DDL 回滚待 `S4-ENV-RECOVERY` 完成备份、恢复和兼容窗口演练后执行，不在有数据的共享数据库直接删除历史表或批次。

## 验证证据

### 单元与 API

- `node --import tsx --test apps/api/scripts/workspace-native-read.test.ts apps/api/scripts/workspace-confirmation.test.ts apps/api/scripts/workspace-coupon.test.ts`：13/13 通过。
- `node apps/api/scripts/workspace-coupon-smoke.mjs`：Memory HTTP 链路通过，确认、取消、批次创建、data 导入、Outbox `succeeded` 和正文脱敏均通过。

### PostgreSQL 持久化

- `node apps/api/scripts/workspace-coupon-postgres-smoke.mjs`：PASS。
- 证据：Confirmation `confirmed`；Run/Step `succeeded`；CouponBatch 已创建；Outbox `succeeded`；关闭并重开 Store 后复读一致；正文保持 `redacted=true`。

### 真实浏览器

- `node apps/web/scripts/e2e-workspace-coupon.mjs`：PASS。
- 路径：真实 Chrome/CDP → Vite `/workspace` → PostgreSQL API → Confirmation Card → Confirm/Cancel → CouponBatch / Outbox 状态回显。
- 桌面截图：`artifacts/real-verify/S4-VS-WS-VS-03/screenshots/workspace-coupon-desktop-1440x900.png`
- 移动截图：`artifacts/real-verify/S4-VS-WS-VS-03/screenshots/workspace-coupon-mobile-390x844.png`
- UI 验证确认卡标题为“新增卡券 · 需要管理员确认”，并明确显示“正文不会显示在 Workspace”；取消路径最终显示“已取消”。

### 构建与卫生

- `npm run typecheck:api`
- `npm run typecheck:web`
- `npm run build:api`
- `npm run build:web`
- `npm --workspace apps/web run test -- --run src/features/workspace`：4 files / 17 tests 通过。
- `git diff --check`

## 评审结论

- 业务/验收：PASS；新增卡券指令、确认、取消、本地批次创建、data 导入和 Outbox 成功状态均从 `/workspace` 用户入口完成。
- 架构/数据流：PASS；Workspace 只负责编排和确认，卡券写入复用 `CouponService`，Policy → Confirmation → Idempotency → CouponService → Outbox 顺序可复核。
- 质量/安全/运维：PASS（受控环境）；Memory、PostgreSQL、HTTP、Chrome/CDP 和双 viewport 证据通过，卡券正文未进入 Workspace 可见数据；外部商品发布 Worker、unknown/recovery 和发布级迁移回滚继续保持独立后续门禁。

## 下一切片门禁

WS-VS-03 已 VERIFIED。当前切片完成充分验证后，才允许进入“修改配置”切片；本切片不提前实现 Settings/Agent 配置写入。
