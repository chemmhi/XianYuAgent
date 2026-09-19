# XianyuSellerAgent 阶段 2 数据库表设计

- 文档版本：v0.1
- 日期：2026-09-19
- 状态：PASS（数据库逻辑 schema、表关系、索引、约束、迁移与回滚边界已冻结）
- 适用阶段：阶段 2 设计；本阶段不创建真实数据库、迁移脚本或生产数据。
- 目标数据库：PostgreSQL 17+；本地与首期生产允许通过 Docker Compose 运行。

## 1. 设计约定

- 表名、列名使用 `snake_case`；枚举值使用稳定小写字符串。
- 主键统一 `uuid`；时间统一 `timestamptz`，按 UTC 写入；金额统一 `bigint` 最小货币单位。
- JSON 配置使用 `jsonb`，必须有 `schema_version` 或 `config_version`；不把 JSON 当作关系约束的替代品。
- 除审计表外，业务表默认包含 `created_at`、`updated_at`、`version`、`deleted_at`、`created_by`、`updated_by`。
- 外键默认 `ON DELETE RESTRICT`；历史业务记录不物理删除，使用状态或 `deleted_at` 归档。
- 账号隔离：所有账号业务表必须存在 `account_id`，查询必须从服务端 Session 注入账号范围；`auth`、`observability` 表按主体和资源引用隔离。
- 敏感字段：`credential_values.ciphertext`、`coupon_items.content_ciphertext` 只保存应用层加密密文；明文不落日志、Trace、Replay、Prompt 或测试快照。

## 2. 表清单与归属

| Schema | 表 | 归属模块 | 说明 |
| --- | --- | --- | --- |
| `auth` | `admins`、`sessions`、`account_scopes`、`account_login_sessions` | auth | 管理员、会话、账号授权和平台登录会话 |
| `accounts` | `accounts`、`credential_refs`、`credential_values` | accounts / credential-store | 账号连接与系统凭证 |
| `products` | `products`、`product_skus`、`asset_refs` | products | 商品、SKU、商品素材 |
| `coupons` | `coupon_batches`、`coupon_items`、`coupon_asset_refs`、`coupon_bindings` | coupons | 卡券批次、库存、素材和商品绑定 |
| `orders` | `orders`、`delivery_records` | orders | 订单状态与交付尝试 |
| `messages` | `conversations`、`messages` | messages | 会话与消息，包含撤回结果 |
| `workspace` | `agent_sessions`、`runs`、`steps`、`task_contexts`、`confirmations` | workspace | Agent 会话、运行、步骤与人工确认 |
| `execution` | `idempotency_records`、`outbox_jobs` | execution | 幂等和可靠外部动作 |
| `observability` | `audit_events`、`trace_spans`、`health_snapshots` | observability | 审计、追踪和健康快照 |

## 3. 表级设计

### 3.1 身份与账号

| 表 | 关键列（类型 / 默认 / 可空） | 主键与外键 | 唯一索引 / 普通索引 | 关键检查 |
| --- | --- | --- | --- | --- |
| `auth.admins` | `id uuid`；`email text`；`password_hash text`；`display_name text null`；`role text default 'admin'`；`quota_json jsonb default '{}'`；`status text default 'active'`；`last_login_at timestamptz null` | PK `id` | UQ `lower(email)` | `status in ('active','disabled')` |
| `auth.sessions` | `id uuid`；`admin_id uuid`；`issued_at`；`last_seen_at`；`expires_at`；`revoked_at timestamptz null`；`revoke_reason text null` | PK；FK `admin_id -> auth.admins.id` | IDX `(admin_id, expires_at)` | 空闲 30 分钟、绝对 8 小时由服务层校验 |
| `auth.account_scopes` | `id uuid`；`admin_id uuid`；`account_id uuid`；`scope text`；`status text default 'active'`；`expires_at timestamptz null`；`revoked_at timestamptz null` | PK；FK admin/account | UQ `(admin_id, account_id, scope)`；IDX `(account_id, scope, status)` | `status in ('active','revoked','expired')`；仅 active 且未过期的授权可生效 |
| `auth.account_login_sessions` | `id uuid`；`account_id uuid null`；`provisional_account_ref text null`；`login_method text`；`status text`；`started_at`；`completed_at null`；`failure_code null`；`qr_token_ref null` | PK；可空 FK `account_id -> accounts.accounts.id` | IDX `(provisional_account_ref, status)`、`(account_id, status)` | `created -> waiting -> scanned -> succeeded/expired/failed/cancelled`；成功后回填 account_id |
| `accounts.accounts` | `id uuid`；`platform text`；`seller_ref text`；`display_name text null`；`status text`；`last_connected_at timestamptz null` | PK | UQ `(platform, seller_ref)` | `status in ('pending','connected','degraded','disconnected','expired','disabled')` |

### 3.2 CredentialStore

| 表 | 关键列 | 主键与外键 | 唯一索引 / 普通索引 | 关键检查 |
| --- | --- | --- | --- | --- |
| `accounts.credential_refs` | `id uuid`；`account_id uuid`；`kind text`；`purpose text`；`label text null`；`status text`；`last_rotated_at null` | PK；FK account | UQ `(account_id, kind, purpose)` | `status in ('active','disabled','rotating','revoked')` |
| `accounts.credential_values` | `credential_ref_id uuid`；`ciphertext bytea`；`key_version int`；`checksum text`；`metadata_json jsonb default '{}'` | PK/FK `credential_ref_id -> credential_refs.id` | IDX `checksum` | API 默认不返回明文；管理员显式读取仍写 AuditEvent |

### 3.3 商品与素材

| 表 | 关键列 | 主键与外键 | 唯一索引 / 普通索引 | 关键检查 |
| --- | --- | --- | --- | --- |
| `products.products` | `id uuid`；`account_id uuid`；`external_product_ref text null`；`title text`；`description text null`；`category_code text null`；`attributes_json jsonb default '{}'`；`default_reply_template text null`；`ai_prompt text null`；`config_version int default 1`；`price_minor bigint null`；`status text` | PK；FK account | UQ partial `(account_id, external_product_ref)`；IDX `(account_id, status, updated_at)` | `status in ('draft','ready','publishing','published','failed','archived')` |
| `products.product_skus` | `id uuid`；`product_id uuid`；`sku_code text`；`external_sku_ref text null`；`price_minor bigint`；`status text` | PK；FK product | UQ `(product_id, sku_code)` | 金额 `>= 0` |
| `products.asset_refs` | `id uuid`；`product_id uuid`；`storage_key text`；`mime_type text`；`checksum text null`；`status text` | PK；FK product | UQ `(product_id, storage_key)` | 归档不删除历史引用 |

### 3.4 卡券与绑定

| 表 | 关键列 | 主键与外键 | 唯一索引 / 普通索引 | 关键检查 |
| --- | --- | --- | --- | --- |
| `coupons.coupon_batches` | `id uuid`；`account_id uuid`；`purpose text`；`delivery_scope text`；`quark_url text null`；`extract_code_ciphertext bytea null`；`total_count int`；`status text` | PK；FK account | IDX `(account_id, status)` | `delivery_scope in ('system_only','operator_only','buyer_deliverable')` |
| `coupons.coupon_items` | `id uuid`；`batch_id uuid`；`content_ciphertext bytea`；`status text`；`reserved_until timestamptz null`；`consumed_at timestamptz null` | PK；FK batch | IDX `(batch_id, status)`；partial UQ consumed allocation | `available -> reserved -> consumed`；reserved 超时才可释放 |
| `coupons.coupon_asset_refs` | `id uuid`；`coupon_batch_id uuid`；`storage_key text`；`mime_type text`；`checksum text null`；`caption text null`；`status text` | PK；FK batch | UQ `(coupon_batch_id, storage_key)` | 素材与正文分离 |
| `coupons.coupon_bindings` | `id uuid`；`coupon_batch_id uuid`；`product_id uuid`；`priority int default 0`；`status text`；`expires_at null` | PK；FK batch/product | UQ `(coupon_batch_id, product_id)`；IDX `(product_id, status)` | 解绑只改状态，不删交付历史 |

### 3.5 订单与交付

| 表 | 关键列 | 主键与外键 | 唯一索引 / 普通索引 | 关键检查 |
| --- | --- | --- | --- | --- |
| `orders.orders` | `id uuid`；`account_id uuid`；`order_no text`；`product_id uuid`；`buyer_ref text null`；`payment_status text`；`order_status text`；`delivery_status text`；`after_sales_status text`；`paid_at null`；`cancelled_at null`；`closed_at null`；`refund_requested_at null` | PK；FK account/product | UQ `(account_id, order_no)`；IDX `(account_id, payment_status, delivery_status)` | 四套状态机独立维护；退款中禁止再次交付 |
| `orders.delivery_records` | `id uuid`；`order_id uuid`；`delivery_type text`；`status text`；`attempt int default 1`；`idempotency_scope text`；`coupon_item_id uuid null`；`tracking_ref text null`；`delivered_at null`；`failure_code null` | PK；FK order/coupon item | UQ partial `coupon_item_id` for successful coupon delivery；IDX `(order_id, attempt)` | `delivery_type in ('manual','no_logistics','coupon_only','mixed')` |

### 3.6 消息与工作区

| 表 | 关键列 | 主键与外键 | 唯一索引 / 普通索引 | 关键检查 |
| --- | --- | --- | --- | --- |
| `messages.conversations` | `id uuid`；`account_id uuid`；`external_conversation_ref text`；`buyer_ref text null`；`status text` | PK；FK account | UQ `(account_id, external_conversation_ref)` | 关闭后仍可读历史 |
| `messages.messages` | `id uuid`；`conversation_id uuid`；`direction text`；`body_type text`；`body_text text null`；`asset_ref text null`；`external_message_ref text null`；`status text`；`recalled_at null`；`recall_reason null`；`external_outcome text null` | PK；FK conversation | UQ partial `(conversation_id, external_message_ref)`；IDX `(conversation_id, created_at)` | `pending|sent|failed|recalled`；撤回写幂等记录 |
| `workspace.agent_sessions` | `id uuid`；`account_id uuid`；`title text`；`status text default 'active'`；`summary text null`；`last_active_at`；`archived_at null` | PK；FK account | IDX `(account_id, status, last_active_at)` | `active -> archived`；归档后只读 |
| `workspace.runs` | `id uuid`；`account_id uuid`；`route text`；`status text`；`requested_by uuid`；`client_run_ref text null`；`completed_at null`；`failure_code null` | PK；FK account/admin | UQ partial `(account_id, client_run_ref)`；IDX `(account_id, status, created_at)` | 仅状态机迁移 |
| `workspace.steps` | `id uuid`；`run_id uuid`；`step_no int`；`kind text`；`status text`；`attempt int default 1`；`parent_step_id uuid null`；`external_outcome text null` | PK；FK run/self | UQ `(run_id, step_no, attempt)`；IDX `(run_id, status)` | `expired` 不属于 StepStatus，确认过期由 confirmations 记录 |
| `workspace.task_contexts` | `id uuid`；`run_id uuid`；`schema_version int`；`context_json jsonb`；`redacted_summary text null` | PK/FK run | UQ `run_id` | 只允许兼容 schema 迁移 |
| `workspace.confirmations` | `id uuid`；`run_id uuid`；`step_id uuid`；`status text`；`expires_at`；`requested_by uuid`；`confirmed_at null`；`confirmed_by null`；`reason null` | PK；FK run/step/admin | partial UQ active `(step_id)` | `active -> confirmed|expired|rejected|cancelled` |

### 3.7 执行、审计与观测

| 表 | 关键列 | 主键与外键 | 唯一索引 / 普通索引 | 关键检查 |
| --- | --- | --- | --- | --- |
| `execution.idempotency_records` | `id uuid`；`scope text`；`key text`；`request_fingerprint text`；`status text`；`response_envelope jsonb null`；`trace_id text null`；`expires_at` | PK | UQ `(scope, key)`；IDX `(expires_at)` | 同 key 不同指纹必须冲突 |
| `execution.outbox_jobs` | `id uuid`；`scope text`；`aggregate_type text`；`aggregate_id uuid`；`operation text`；`status text`；`attempt int default 0`；`available_at`；`locked_at null`；`lease_owner null`；`last_error_code null`；`external_outcome text null`；`idempotency_key text` | PK | UQ `(scope, idempotency_key)`；IDX `(status, available_at)` | 单个 Outbox 不使用 `partially_succeeded` |
| `observability.audit_events` | `id uuid`；`actor_type text`；`actor_id uuid null`；`account_id uuid null`；`action text`；`target_ref text`；`request_id text`；`trace_id text`；`payload_digest text`；`reason text null` | PK | IDX `(account_id, created_at)`、`(trace_id)` | 只追加写入，不更新/物理删除 |
| `observability.trace_spans` | `id uuid`；`trace_id text`；`span_id text`；`operation text`；`status text`；`started_at`；`ended_at`；`error_code null`；`redacted_attributes jsonb null` | PK | UQ `(trace_id, span_id)`；IDX `(trace_id)` | 不保存凭证明文或卡券正文 |
| `observability.health_snapshots` | `id uuid`；`component text`；`status text`；`observed_at`；`details_json jsonb default '{}'` | PK | IDX `(component, observed_at)` | 仅健康摘要，不保存业务敏感数据 |

## 4. 跨表约束

1. **账号隔离**：跨账号查询必须通过 `account_scopes` 授权；服务层必须拒绝客户端自带的更高 `account_id`。
2. **并发控制**：所有更新检查 `version`；CouponItem 分配使用事务 + 行级锁；Outbox 使用租约 (`lease_owner`, `locked_at`) 防止重复执行。
3. **交付唯一性**：成功的 `coupon_only` / `mixed` 交付必须唯一锁定 CouponItem；失败或未知结果不覆盖历史 DeliveryRecord。
4. **审计完整性**：凭证查看/轮换/撤销、卡券正文读取、预览/交付、取消/重试、确认/恢复全部写 AuditEvent。
5. **敏感脱敏**：应用日志、Trace、错误 envelope、Replay 和测试快照只能保存摘要、哈希或资源 ID。

## 5. 迁移顺序与回滚

| 迁移编号 | 内容 | 前置 | 回滚策略 |
| --- | --- | --- | --- |
| `001_auth_accounts` | admins、sessions、accounts、account_scopes、account_login_sessions | 无 | 仅回滚空表；有业务数据时采用向前兼容迁移 |
| `002_credentials` | credential_refs、credential_values | 001 | 先禁写，再回滚应用；密文不逆向解密 |
| `003_catalog` | products、product_skus、asset_refs | 001 | 保留旧列，回滚应用读取旧列 |
| `004_coupons` | coupon_batches、coupon_items、coupon_asset_refs、coupon_bindings | 001/003 | 先停止库存写入，保留已交付记录 |
| `005_orders_messages` | orders、delivery_records、conversations、messages | 001/003/004 | 向前修复优先，禁止物理删除订单和消息 |
| `006_workspace_execution` | agent_sessions、runs、steps、task_contexts、confirmations、idempotency_records、outbox_jobs | 001/005 | 停止新任务，等待租约过期后回退应用 |
| `007_observability` | audit_events、trace_spans、health_snapshots、索引与约束加固 | 全部 | 审计/追踪表只追加，回滚只撤销非关键索引 |

迁移采用 expand → backfill → verify → switch → contract；每次迁移必须可重复执行或具备可靠回滚说明。不可逆变更前必须完成数据库备份、读写验证和恢复演练。

| `013_product_sync` | products.source、last_synced_at、source_payload_digest、来源索引 | 003_catalog | 外部商品同步元数据；`local` 草稿与 `xianyu` 外部商品分离，禁止同步删除本地草稿 |

### 5.1 阶段 5 迁移实现偏差与后续切片门禁

- 阶段 5 已落地实现使用 `003_catalog.sql`、`013_product_sync.sql`、`013_coupons.sql` 和 `014_coupon_card_metadata.sql`；其中两个 `013` 文件属于历史并行实现，本轮不直接重命名，避免破坏已合入代码和已有 PostgreSQL volume。
- `013_coupons.sql` / `014_coupon_card_metadata.sql` 的真实执行顺序、重复执行行为、旧数据兼容和回滚必须在 `S4-ENV-RECOVERY` 中验证；文档编号并行不等于发布级迁移已通过。
- 后续 `S4-VS2C`、`S4-VS3A/B`、`S4-VS4B/C` 新增字段或表时，必须使用新的单调编号，不得继续占用 `013`；每个迁移都要记录 apply、verify、rollback、已有 volume 处理和恢复后读写结果。
- `S4-VS7A` 不新增 Settings/API Key 平行表，继续使用现有账号绑定的 `accounts.credential_refs` / `credential_values`；全局 provider key 不属于本片范围，必须另立 schema、权限和迁移评审。
- 在 `CouponItem` reserve/consume/release、DeliveryRecord 唯一性或 AssetRef 对象存储 contract 未完成真实集成验证前，只能保留设计契约，不能把本表中的结构当作已完成 DDL 或生产可回滚证据。

## 6. 阶段 2 验收证据

- 表级覆盖：身份、账号、凭证、商品、卡券、订单、消息、AgentSession、Run/Step、Confirmation、Idempotency、Outbox、审计与观测；
- 约束覆盖：PK/FK、唯一索引、部分唯一索引、空值/默认值、状态检查、版本并发、软删除、账号隔离；
- 迁移覆盖：编号、依赖顺序、expand/backfill/switch/contract、备份、验证和回滚边界；
- 与 `docs/02-data-api.md` 的字段、状态、路由和敏感边界保持一致；
- 本文是设计契约，不代表已经执行真实 DDL 或迁移；真实 DDL、容器数据库和集成测试属于阶段 5/6 纵向切片。
