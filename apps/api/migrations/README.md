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
- `018_orders.sql`：建立 `orders.orders` 订单只读事实表及账号/状态索引；订单刷新按 `(account_id, order_no)` 幂等 upsert，交付记录仍由后续 VS4B/C 迁移承接。
- `019_order_display_fields.sql`：为订单补充可选 `buyer_nickname` 字段；订单读取会按账号从本地会话与商品表聚合缺失的昵称和商品名称，前端不再用买家姓名或商品 ID 回退展示。
- `020_order_buyer_avatar.sql`：为订单补充可选 `buyer_avatar_url` 字段，支持订单头像持久化并与本地会话头像聚合。
- `018_credential_store.sql`：为 S4-VS7A 建立账号级 `accounts.credential_refs` 与 `accounts.credential_values`；仅支持 `api_key/model_client`，保存 provider/alias/status/version/last_rotated_at 与 AES-256-GCM 密文、key_version、checksum、metadata_json。API 默认只读 CredentialRef 脱敏投影，不返回明文。
- `025_auto_reply_inbound_inbox.sql`：建立自动回复入站 inbox，提供持久化队列状态、重试/死信字段与账号/消息幂等约束。
- `026_auto_reply_inbound_alias_quarantine.sql`：建立 history/live 外部消息引用别名表与解析失败隔离表。
- `027_auto_reply_inbound_lease_expiry.sql`：为入站 inbox 补充显式租约过期时间和索引，支持多 worker 竞争 claim 与旧 worker fencing。
- `029_product_xianyu_updated_at.sql`：为商品保存闲鱼侧更新时间，并支持显式按闲鱼更新时间排序；不再把本地 `updated_at` 当作闲鱼更新时间。
- `030_product_xianyu_list_rank.sql`：保存闲鱼商品列表返回顺序，支持商品目录按闲鱼页面顺序展示；未出现在最近一次同步结果中的商品排名置空并排在末尾。
- `029_coupon_batch_sequence.sql`：为卡券批次增加从 1 开始的业务编号；UUID `id` 继续作为内部主键和外键，API `batchId`/`id` 对外返回该序号，作废/删除后的序号可被新批次回收。
- `031_product_automation.sql`：建立商品级四类自动化配置表，按商品唯一保存规范化 JSON、账号归属、版本和摘要；批量保存使用应用事务，卡券批次仍通过现有 `coupon_batches` 校验账号与 `buyer_deliverable` 范围。
- `033_coupon_reservations.sql`：增加卡券 reservation 与 reservation item 审计表；reserve 使用批次/卡券行锁，commit/release/lease expiry 保持幂等并支持失败重试重开。

## 031 商品自动化迁移纪律

- Apply：确认 `003_catalog.sql`、账号范围和 `013_coupons.sql` 已应用后执行；SQL 可重复执行，新增表不修改既有商品/卡券数据。
- Verify：检查每个 `product_id` 至多一条配置、`config_version > 0`、账号与商品一致；执行 API smoke 验证首次读取默认版本 `1`、保存后复读和批量事务回滚。
- Rollback：先停止自动化配置写入和 Worker 读取，保留配置表与审计；应用回退到默认关闭行为，不删除已产生的订单/卡券交付历史。待确认无旧版本依赖后再按 contract → switch → verify 处理，不直接删除配置表。
- `031_auto_reply_repair_state.sql`：建立自动回复 repair runtime 的会话状态、审核记录和发送后结果回读基础表；保留旧 `auto_reply_runs` 兼容读取。
- `032_auto_reply_inbound_source_ordering.sql`：为入站 inbox 保存 live push 可提取的 source event id/sequence，兼容缺失序列的旧消息并支持 repair runtime 审计回放。
- `033_auto_reply_review_lifecycle.sql`：为 Outcome Review 补充 resolved/closed 生命周期时间戳，支持 worker/reconcile 审计回读。
- `034_auto_reply_send_outbox.sql`：为自动回复 live sender 补充 payload、外部消息引用、租约与本地出站消息回写字段，支持 requestId 幂等和崩溃恢复。
- `035_auto_reply_policy_registry.sql`：建立账号级自动回复 repair PolicyConfig 版本注册表；ACTIVE 指针唯一、历史版本可回滚，策略 JSON/hash 保持不可变。

迁移执行顺序以完整文件名的字典序为准，数字前缀在历史目录中允许重复（例如 `031_auto_reply_*` 与 `031_product_automation.sql`）；新增迁移应优先使用唯一前缀，并确保 SQL 幂等且依赖在完整文件名顺序下成立。

## 029 coupon batch sequence 迁移纪律

- Apply：先执行 `029_coupon_batch_sequence.sql`，再发布读取 `sequence_id` 的 API；迁移会创建全局 sequence、回填旧批次、校准下一值并建立唯一约束。
- Verify：确认非作废批次的 `sequence_id` 全部非空且唯一，空表首条为 `1`，新建批次按最小可用序号分配，删除/作废后下一批次可回收该序号；通过卡券 API smoke 覆盖数字 URL、旧 UUID URL 兼容、明细/商品关联映射和创建时间倒序。
- Rollback：保留 UUID 主键、外键和 `sequence_id` 列，先回退 API 到 UUID 输出/解析，再停用序号读写；不要删除审计历史或重建 UUID 外键。序号回收只影响作废记录的对外编号，不改变内部 UUID。

VS5A 回滚边界：先关闭 `/api/v1/conversations/{id}/events` 实时订阅入口，保留历史会话、消息与事件游标；若迁移需要回退，按 expand/backfill/verify/switch/contract 顺序先停止新读流量，再保留表结构用于审计和离线恢复，不直接删除消息历史。

## S4-VS7A credential store 迁移纪律

- Apply：在目标 PostgreSQL 上按顺序执行 `018_credential_store.sql`，确认 `accounts.accounts` 已存在且管理员账号 scope 可用；重复执行必须保持幂等。
- Verify：检查 `credential_refs` 与 `credential_values` 的 1:1 外键、`UNIQUE (account_id, kind, purpose)`、status/version/checksum 约束；通过真实 PostgreSQL 创建/列表/轮换/禁用/启用/撤销复读验证 ciphertext 不等于明文，API 响应不含 `apiKey`。
- Rollback：先停止 `/api/v1/credentials` 新写入并保留旧 CredentialRef、密文和审计；确认没有依赖 018 表的应用版本后，再按 contract → switch → verify 逆序回退。不得直接删除历史审计、旧密文或账号绑定凭证；轮换失败必须保留旧密文引用。
- 当前证据边界：`node apps/api/scripts/credential-store-smoke.mjs` 覆盖 MemoryStore 行为；`node apps/api/scripts/credential-store-postgres-smoke.mjs` 已在临时 PostgreSQL 上覆盖 migration `001`–`018`、ciphertext/key_version/checksum 复读与 API 脱敏。发布级 rollback、已有 volume 回退、旧 `auth.account_credentials` 双读单写兼容和恢复演练仍需单独证据。
