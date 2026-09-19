# ENV-0 migrations

这些 SQL 保留阶段 2 逻辑迁移编号：

- `001_auth_accounts.sql`：管理员、Session、账号、账号范围、登录会话。
- `006_workspace_execution.sql`：ENV-0 所需幂等记录与 Outbox foundation。
- `007_observability.sql`：ENV-0 所需最小审计和健康快照。
- `008_login_session_expiry.sql`：为账号登录会话补充过期时间和查询索引，支持 waiting/expired/cancelled 轮询状态。

阶段 2 设计中的 `002_credentials`、`003_catalog`、`004_coupons`、`005_orders_messages` 仍属于后续纵向切片，不能在账号首片之前伪造为空实现。Compose 会按文件名顺序执行当前首片所需的最小集合；新增后续迁移时保持原编号和 expand/backfill/verify/switch/contract 回滚纪律。
