# 迁移执行记录

本目录记录阶段 5 新增迁移的 apply、verify、回滚边界和已有 PostgreSQL volume 处理方式。迁移脚本实际位于 `apps/api/migrations/`，本文件不替代 SQL。

## 043_workspace_confirmations.sql

- 归属切片：WS-VS-02 / `S4-VS6B` 商品发布确认子片。
- 前置：`006_workspace_execution.sql`、`001_auth_accounts.sql`、`034_auto_reply_send_outbox.sql`。
- 内容：创建 `workspace.confirmations`，增加 Run/Step/Account/Admin 外键、`(run_id, step_id)` 唯一约束、active step 部分唯一索引、状态和版本检查、运行查询与过期索引。
- Apply：`npm run db:migrate`；脚本使用 `CREATE TABLE/INDEX IF NOT EXISTS`，可重复执行。
- Verify：`node apps/api/scripts/workspace-confirmation-postgres-smoke.mjs`；临时 PostgreSQL 数据库执行 `001`–`043`，确认、取消、Outbox 入队和 Store 重开复读均通过。
- 已有 volume：不能依赖 Compose `initdb` 重新执行；必须在目标数据库执行 `npm run db:migrate`，并记录 `workspace.confirmations`、索引和约束存在后再开放确认写入。
- Rollback：应用先回退到不创建 Confirmation 的版本，保留历史确认、Run/Step、Outbox 和审计；不要在有数据的共享数据库直接 `DROP TABLE`。DDL 回滚待 `S4-ENV-RECOVERY` 的备份、恢复和兼容窗口演练后执行。

## 044_workspace_coupon_confirmations.sql

- 归属切片：WS-VS-03 / `S4-VS6B` 新增卡券确认子片。
- 前置：`043_workspace_confirmations.sql`、现有 `coupons` 域迁移和 `CouponService`。
- 内容：扩展 `workspace.confirmations.action` 检查约束，允许 `coupon_create`；不新增第二套卡券表，也不复制卡券正文。
- Apply：`npm run db:migrate`；脚本先删除旧 action check，再创建兼容 `product_publish | coupon_create` 的约束，可重复执行。
- Verify：`node apps/api/scripts/workspace-coupon-postgres-smoke.mjs`；临时 PostgreSQL 执行 `001`–`044`，确认、CouponBatch、Outbox 成功和 Store 重开复读均通过。
- 已有 volume：必须在目标数据库显式执行 `npm run db:migrate`，并确认 action check 已包含 `coupon_create` 后再开放新增卡券确认写入；不依赖 Compose `initdb` 重放历史迁移。
- Rollback：应用先停止新的 `coupon_create` Confirmation 写入并回退 API，保留历史 Confirmation、CouponBatch、Run/Step、Outbox 和审计；DDL 回滚待 `S4-ENV-RECOVERY` 完成兼容窗口演练后执行。

## 045_workspace_agent_settings_confirmations.sql

- 归属切片：WS-VS-04 / `S4-VS6B` 自动回复 Agent 配置修改子片。
- 前置：`044_workspace_coupon_confirmations.sql`、`022_auto_reply_agent_settings.sql`、`023_auto_reply_agent_account_scope.sql` 和 `AutoReplyAgentSettingsService`。
- 内容：扩展 `workspace.confirmations.action` 检查约束，允许 `agent_settings_update`；不新增配置表，也不复制 Prompt 或 Credential。
- Apply：`npm run db:migrate`；脚本先删除旧 action check，再创建兼容 `product_publish | coupon_create | agent_settings_update` 的约束，可重复执行。
- Verify：`node apps/api/scripts/workspace-agent-settings-postgres-smoke.mjs`；临时 PostgreSQL 执行 `001`–`045`，配置版本、Confirmation、Outbox 成功和 Store 重开复读均通过。
- 已有 volume：必须在目标数据库显式执行 `npm run db:migrate`，并确认 action check 已包含 `agent_settings_update` 后再开放 Workspace 配置写入；不依赖 Compose `initdb` 重放历史迁移。
- Rollback：应用先停止新的 `agent_settings_update` Confirmation 写入并回退 API，保留历史配置版本、Confirmation、Run/Step、Outbox 和审计；DDL 回滚待 `S4-ENV-RECOVERY` 完成兼容窗口演练后执行。
