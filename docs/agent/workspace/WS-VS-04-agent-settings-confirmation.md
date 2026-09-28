# Workspace 修改自动回复 Agent 配置确认垂直切片

- 切片编号：WS-VS-04
- 日期：2026-09-28
- 状态：VERIFIED
- 目标：让 Workspace 通过管理员确认修改当前账号的自动回复 Agent 运行配置，并保留版本、审计和可复读结果。

## 用户路径

1. 管理员在 `/workspace` 当前账号会话中输入“修改自动回复配置”“启用自动回复”或“关闭自动回复”，可附带启停、发送模式、循环次数、超时、历史条数、回复长度和发送延迟等运行参数。
2. 服务端按 `adminId + accountId` scope 解析安全配置字段，读取当前配置版本并生成脱敏 Confirmation Manifest。
3. Run/Step 进入 `waiting_confirmation`，Workspace 显示“修改配置 · 需要管理员确认”；Prompt 原文、Credential、Cookie 和原始指令正文不进入 Workspace Message、Run Event 或前端 summary。
4. 管理员点击“确认继续”后，服务端校验 `agent.settings.update.confirm` Policy、Confirmation version 和配置 `expectedVersion`，复用 `AutoReplyAgentSettingsService.update` 写入账号级配置。
5. 配置写入成功后，Workspace Outbox 记录 `agent_settings_update` 的 `succeeded / known_success`，Run/Step 进入 `succeeded`，并回传新配置版本。
6. 若 Settings 在确认前已被其他操作更新，服务端返回 `VERSION_CONFLICT`，Confirmation 保持 `active`，管理员刷新后再确认；取消动作不会写配置或 Outbox。

## 本切片范围

- Workspace 修改自动回复 Agent 配置指令识别与中文键值解析。
- 仅开放安全运行参数：`enabled`、`sendMode`、`maxLoops`、`maxToolCalls`、`toolTimeoutMs`、`totalTimeoutMs`、`maxHistory`、`maxReplyLength`、`replySegmentDelayMs`、`sendDelaySeconds`。
- 复用现有 `AutoReplyAgentSettingsService`、账号 scope、配置校验、版本控制、摘要审计和运行时读取路径。
- `agent.settings.update.confirm` Policy、Confirmation / Cancel / Retry / Outbox API 和前端确认卡复用 WS-VS-02/03 的入口。
- 配置写入成功后的 Run Event、AuditEvent、版本回显和 PostgreSQL 关闭/重开复读。

## 不在本切片

- 不通过 Workspace 修改 `systemPrompt` 或 `userPromptTemplate`，不把 Prompt 原文带入确认卡或 Workspace 可见数据。
- 不修改 OpenAI API Key、Provider、CredentialStore、Policy Gateway、Runtime/Outbox 管理配置；这些保持 Settings 独立 owner。
- 不直接改写闲鱼外部状态，不调用商品发布 Worker，也不处理订单交付。
- 不把本地配置写入结果解释为外部消息已经发送；本片只确认账号级 Agent 配置已持久化。

## 状态与安全边界

```text
Run:  queued -> running -> waiting_confirmation -> executing -> succeeded
Confirmation: active -> confirmed | cancelled | expired | rejected
Step: running -> waiting_confirmation -> executing -> succeeded | cancelled
Outbox: pending -> processing -> succeeded
```

- Confirmation 使用 `version` 做乐观锁；配置 `expectedVersion` 在确认前再次校验，避免覆盖 Settings 页面或其他操作的新版本。
- Manifest 只包含 `accountId`、`expectedVersion`、安全字段名/值、`changedFields`、`requiresLocalExecution` 和 `redacted=true`。
- Prompt、Credential、Cookie 和原始用户指令不进入 Workspace Message、Run Event、前端 ViewModel、Outbox payload 或审计 payload。
- 所有读取和写入复核管理员账号 scope、Run/Session 归属和当前账号归属。

## API 与迁移

- 继续复用：`GET /api/v1/workspace/runs/{id}/confirmation`、`POST /api/v1/workspace/runs/{id}/confirm`、`POST /api/v1/workspace/runs/{id}/cancel`、`POST /api/v1/workspace/runs/{id}/retry`、`GET /api/v1/execution/outbox?runId={id}`。
- 配置真实 owner 仍为 `GET/PATCH /api/v1/settings/agent` 背后的 `AutoReplyAgentSettingsService`；Workspace 只负责编排、确认和结果回显。
- 新增 `apps/api/migrations/045_workspace_agent_settings_confirmations.sql`，将 Confirmation action check 扩展为 `product_publish | coupon_create | agent_settings_update`，兼容已执行 043/044 的数据库。
- 迁移可重复执行；真实 PostgreSQL 临时数据库已执行完整 `001`–`045` 顺序并通过 Confirmation、配置行、Outbox 和 Store 重开复读。
- 回滚采用应用先行：停止新的 `agent_settings_update` Confirmation 写入并回退 API；保留历史 Confirmation、配置版本、Run/Step、Outbox 和审计。DDL 回滚待 `S4-ENV-RECOVERY` 完成备份、恢复和兼容窗口演练后执行。

## 验证证据

### 单元与 API

- `node --import tsx --test apps/api/scripts/workspace-native-read.test.ts apps/api/scripts/workspace-confirmation.test.ts apps/api/scripts/workspace-coupon.test.ts apps/api/scripts/workspace-agent-settings.test.ts`：16/16 通过。
- `node apps/api/scripts/workspace-agent-settings-smoke.mjs`：Memory HTTP 链路通过，确认、配置版本更新、Outbox `succeeded` 和原始指令脱敏均通过。
- 覆盖配置版本冲突：确认前外部更新配置时返回 `VERSION_CONFLICT`，Confirmation 保持 `active`，Run 保持 `waiting_confirmation`。

### PostgreSQL 持久化

- `node apps/api/scripts/workspace-agent-settings-postgres-smoke.mjs`：PASS。
- 证据：Confirmation `confirmed`；配置 `configVersion=1`、`enabled=false`、`maxLoops=6`、`sendDelaySeconds=12`；Run/Step `succeeded`；Outbox `succeeded`；关闭并重开 Store 后复读一致。

### 真实浏览器

- `node apps/web/scripts/e2e-workspace-agent-settings.mjs`：PASS。
- 路径：真实 Chrome/CDP → Vite `/workspace` → PostgreSQL API → Agent Settings Confirmation Card → Confirm/Cancel → `/api/v1/settings/agent` 读回。
- 桌面截图：`artifacts/real-verify/S4-VS-WS-VS-04/screenshots/workspace-agent-settings-desktop-1440x900.png`
- 移动截图：`artifacts/real-verify/S4-VS-WS-VS-04/screenshots/workspace-agent-settings-mobile-390x844.png`
- UI 验证确认卡标题为“修改配置 · 需要管理员确认”，明确显示“Prompt 原文不会显示”；确认后 Outbox 显示“已完成”，取消路径最终显示“已取消”。

### 构建与卫生

- `npm run typecheck:api`
- `npm run typecheck:web`
- `npm run build:api`
- `npm run build:web`
- `npm --workspace apps/web run test -- --run src/features/workspace`
- `git diff --check`

## 评审结论

- 业务/验收：PASS；修改自动回复 Agent 运行参数、确认、取消、配置持久化、版本回显和 Outbox 成功状态均从 `/workspace` 用户入口完成。
- 架构/数据流：PASS；Workspace 复用 `AutoReplyAgentSettingsService`，Settings 保持配置 owner，Policy → Confirmation → expectedVersion → SettingsService → Outbox 顺序可复核。
- 质量/安全/运维：PASS（受控环境）；Memory、PostgreSQL、HTTP、Chrome/CDP 和双 viewport 证据通过，Prompt 和原始指令未进入 Workspace 可见数据；CredentialStore、外部 Worker、unknown/recovery 和发布级迁移回滚继续保持独立后续门禁。

## 下一切片门禁

WS-VS-04 已 VERIFIED。Workspace 当前提出的原生读、商品发布确认、新增卡券确认和自动回复配置修改路径均已补齐；后续如需修改 Provider、Credential、Policy Gateway 或 Runtime，必须单独建立新的垂直切片。
