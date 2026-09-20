# ENV-0 migrations

这些 SQL 保留阶段 2 逻辑迁移编号：

- `001_auth_accounts.sql`：管理员、Session、账号、账号范围、登录会话。
- `003_catalog.sql`：商品、SKU 与商品素材引用；首个商品只读切片使用该迁移。
- `006_workspace_execution.sql`：ENV-0 所需幂等记录与 Outbox foundation。
- `007_observability.sql`：ENV-0 所需最小审计和健康快照。
- `008_login_session_expiry.sql`：为账号登录会话补充过期时间和查询索引，支持 waiting/expired/cancelled 轮询状态。
- `009_account_credentials.sql`：为账号保存管理员可管理的闲鱼 Cookie、Token、设备标识和校验状态；买家链路不提供该接口。

阶段 2 设计中的 `002_credentials`、`004_coupons`、`005_orders_messages` 仍属于后续纵向切片，不能在账号首片之前伪造为空实现。Compose 会按文件名顺序执行当前首片所需的最小集合；新增后续迁移时保持原编号和 expand/backfill/verify/switch/contract 回滚纪律。
- `010_login_session_verification_required.sql`：为二维码风控人工验证保留独立的 `verification_required` 登录会话状态。
- `015_messages.sql`：建立 `messages.conversations`、`messages.messages` 与 `messages.events`，支持 VS5A 历史读取、事件游标和 WebSocket 断线补偿；当前只读首片不包含发送/接管写入。

VS5A 回滚边界：先关闭 `/api/v1/conversations/{id}/events` 实时订阅入口，保留历史会话、消息与事件游标；若迁移需要回退，按 expand/backfill/verify/switch/contract 顺序先停止新读流量，再保留表结构用于审计和离线恢复，不直接删除消息历史。
