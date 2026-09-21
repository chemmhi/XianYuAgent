# 阶段 5 执行进度：在线聊天 / Workspace / Settings API Key 优先队列

- 日期：2026-09-21
- 阶段状态：进行中；账号、商品、卡券已具备主体链路，S4-VS3 仍待真实环境人工审核；下一批优先切片为在线聊天、Workspace 和 Settings API Key。
- 当前唯一目标：按 `docs/04-plan.md` 逐片推进 `S4-VS5A/B/C`、`S4-VS6A/B`、`S4-VS7A`，不把 mock、MemoryStore、fixture、API 200 或页面可打开当作完整交付。

## 状态矩阵

| 切片 | 当前状态 | 已有证据 | 未完成门禁 |
| --- | --- | --- | --- |
| `S4-VS1` 账号管理 | `PASS`（人工放行范围内） | 账号列表、Cookie 登录、QR 受控流程、Chrome/CDP 和截图 | 真实 APP 扫码/外部 Cookie 与发布级恢复仍由横向门禁承接 |
| `S4-VS2` 商品列表/详情与同步首片 | `PASS`（首片范围） | PostgreSQL smoke、MTOP mapper、Chrome/CDP fixture E2E | 完整写入、SKU、素材、发布、真实外部账号验收仍未完成 |
| `S4-VS2A` 商品草稿基础信息 | `PLANNED` | 已有 Product VM / route / store 基础 | 真实 create/detail/PATCH、版本冲突、403/404、桌面/移动 E2E |
| `S4-VS2B` SKU / 多规格 | `PLANNED` | 阶段 2/3 已冻结 `SkuVM` 边界 | SKU 约束、并发、部分成功、持久化复读 |
| `S4-VS2C` 商品素材 / MinIO | `PLANNED` | `AssetRef` 契约已写入数据文档 | MinIO contract、失败/过期/删除/重启恢复、截图 |
| `S4-VS2D` 受控发布 | `PLANNED` | Policy/Confirmation/Outbox 设计已存在 | worker、幂等、unknown/timeout、人工恢复、审计 |
| `S4-VS2E` 商品外部同步真实验收 | `PARTIALLY_VERIFIED` | 受控 MTOP mapper、Memory/Postgres、fixture E2E | 当前已登录 Chrome + 真实闲鱼账号、分页和数量口径复核 |
| `S4-VS3` 卡券首页 | `READY_FOR_REVIEW` | API smoke、Chrome/CDP、桌面/移动截图、代码已合入 master | 真实 PostgreSQL/Redis/MinIO、逐状态人工浏览器审核、迁移整理 |
| `S4-VS3A/B` 卡券明细/素材/库存锁 | `PLANNED` | `CouponItem`、`CouponAssetRef`、`InventoryLockVM` 契约已冻结 | bulk-save/delete、MinIO、reserve/consume/release、敏感交付边界 |
| `S4-VS4A` 订单列表只读 | `PASS` | 订单 API、四态（含待发货/待评价边界）、账号 scope、关键词搜索、单状态筛选、六列 + 操作列、详情抽屉、分页、内部滚动、昵称/商品标题与缩略图聚合、桌面/移动截图、真实 seller 订单读取与 PostgreSQL refresh 落库 | 交付预览、库存锁、发货/取消/重试转入 `S4-VS4B/C` |
| `S4-VS4B/C` 订单交付 | `PLANNED` | delivery mode 契约已冻结 | 交付预览、库存锁、发货/取消/重试、unknown/Outbox/DeliveryRecord |
| `S4-VS5A` 在线聊天读取与实时连接 | `PARTIALLY_VERIFIED` | canonical HTTP/WS、MemoryStore/PostgreSQL + `015_messages.sql` + `016_conversation_media.sql`、双 API 实例 Redis 跨进程广播、Redis/PostgreSQL 重启恢复、cursor 去重、Chrome/CDP 双 viewport 断线视觉证据、搜索/未读/独立滚动/选择/头像/商品缩略图交互 | 独立复审、生产部署拓扑确认；发送/附件/撤回进入 `S4-VS5B` |
| `S4-VS5B` 在线聊天发送/附件/撤回 | `PLANNED` | Message 状态机和发送/图片/撤回 API 已冻结 | 持久化、对象存储、幂等、unknown/timeout、脱敏 |
| `S4-VS5C` 人工接管与 AI 恢复 | `PLANNED` | handoff/release、版本和审计契约已冻结 | 非法转换、403/409、页面禁用、移动端 |
| `S4-VS6A` Workspace 会话与 Run 首链路 | `PARTIALLY_VERIFIED` | AgentSession/Run/Step、Memory/Postgres Store、受控 Runtime、前端 `/workspace`、clientRunRef、WS cursor replay、真实 PostgreSQL/Chrome/CDP 首链路 | 独立 Worker/Pi Runtime、发布级恢复、人工视觉签核与完整状态回归 |
| `S4-VS6B` Workspace Confirmation/Outbox | `PLANNED` | Confirmation/Outbox/恢复 API 已冻结 | Policy、幂等、租约、cancel/retry/recover |
| `S4-VS7A` Settings API Key 配置 | `READY_FOR_REVIEW` | OpenAI 主备配置、动态 provider `/models`、思考程度元数据、API Key 等长脱敏回显、真实 PostgreSQL + Chrome/CDP UI→DB→Agent、更新无重启生效、主失败切备用、重启后待测试并主动测试回显、双 viewport 截图 | fallback 审计可查询化、迁移 024 发布级 rollback/兼容窗口、三轮独立评审；本片不做 reveal |
| `S4-VS-DASHBOARD` 仪表盘高保真界面 | `PARTIALLY_VERIFIED` | `/dashboard` 正式 feature、桌面/移动独立组合、KPI/趋势/健康度/商品排行/最近处理/风险抽屉、Web 单测/构建、真实 Chrome/CDP + PostgreSQL/Redis + 闲鱼全链路、双 viewport 截图 | 旧 `/order-trend` 兼容接口、全状态截图、独立视觉签核与 rollback |
| `S4-ENV-RECOVERY` | `BLOCKED` | Compose/健康检查/部分持久化已有证据 | 完整迁移回滚、Testcontainers、Redis/MinIO 重启和发布级恢复 |
| `S4-EXT-ACCOUNT` | `BLOCKED` | 真实模式 QR 探针与受控 Cookie 链路 | 真实 APP 扫码、外部 Cookie、`loginuser.get` 资料同步 |
| `S4-ENV-RUNTIME` | `PLANNED` | 独立 Runtime 架构决策已存在 | 健康、超时、重试、取消、不可用和观测 |

## 已落地与已验证

- `apps/api/` 已具备统一 envelope、HttpOnly Session、CSRF 双提交、幂等、账号 scope、最小审计、Memory/Postgres store 和独立 Worker。
- `apps/web` 已按 feature/controller/ViewModel/state boundary 接入账号、商品、卡券首片；Products/Coupons 的桌面/移动截图已生成。
- `npm run verify`、商品 PostgreSQL smoke、商品/卡券 Chrome/CDP E2E 和 Compose 配置检查已有历史通过记录；这些记录只覆盖对应首片和受控环境。
- `docs/04-plan.md`、`docs/02-data-api.md`、`docs/03-component-contract.md`、`docs/06-risk-register.md`、`docs/09-decision-log.md` 已同步新增切片、依赖、回滚、状态和风险映射。
- `S4-VS7A` 当前实现已在独立 worktree 完成首片代码：`apps/api` 提供 `/api/v1/credentials` 及 rotate/enable/disable/revoke，CredentialRef 只返回脱敏 metadata；`apps/web` 提供 `/settings`、明确 `accountId` 选择、CredentialStore panel 与编辑/轮换/启停/撤销交互。`npm --workspace apps/api run build`、`node apps/api/scripts/credential-store-smoke.mjs`、`npm --workspace apps/web run typecheck`、`npm --workspace apps/web run test -- --run`（26 files / 88 tests）、`npm --workspace apps/web run build`、`git diff --check` 已通过；上述证据尚未替代真实 PostgreSQL、浏览器视觉和独立复审。

## 当前阻断与执行规则

- `S4-VS3` 的 `READY_FOR_REVIEW` 不得改成 `PASS`，直到按 `docs/evidence/stage5/S4-VS3/test-baseline.md` 在真实 PostgreSQL/Redis/MinIO 环境完成浏览器人工审核并回写截图、偏差和结论。
- 基础域已成型不等于所有门禁关闭；商品/卡券的真实外部、持久化和视觉收尾继续保留在风险矩阵中，但不阻塞 `S4-VS5A`、`S4-VS6A`、`S4-VS7A` 的切片启动。
- 未通过 `S4-ENV-RECOVERY` 前，所有新写入切片只能在明确的测试数据库/容器证据下推进，不得宣称发布级可回滚。
- 未通过 `S4-EXT-ACCOUNT` 前，fixture/受控 adapter 的商品同步和账号登录结果只能标记为 `PARTIALLY_VERIFIED`。
- 所有前端切片必须固定 `1440×900` 和 `390×844`，覆盖适用的 loading/empty/error/forbidden/disabled/submitting/success/partial-success/unknown 状态。
- 每个切片必须完成业务/验收、架构/数据流、质量/安全/运维三轮评审；未执行的评审写 `READY_FOR_REVIEW` 或 `BLOCKED`，不得用计划代替结论。

## 下一步顺序

1. `S4-VS5A` → `S4-VS5B` → `S4-VS5C`：在线聊天读取、发送/附件、接管/恢复 AI。
2. `S4-VS6A` → `S4-VS6B`：Workspace 会话/Run，再做 Confirmation/Outbox/恢复。
3. `S4-VS7A`：合并后完成 fallback 审计可查询化、迁移 024 发布级 rollback/兼容窗口和三轮独立复审；不把当前受控证据直接升级为 PASS。
4. `S4-VS4A` → `S4-VS4B` → `S4-VS4C`：订单只读、交付预览、交付动作后置。
5. 横向独立执行 `S4-ENV-RECOVERY`、`S4-EXT-ACCOUNT`、`S4-ENV-RUNTIME`，每项都保留真实环境证据和回滚结果。

## Git / 证据记录

### 2026-09-20：S4-VS4A 订单列表界面修订

- `8ad36cd` 已在 merge lock 内以 `--no-ff` 合入 `master`；`fix/orders-ui` 的独立 worktree 已完成主线验证前的代码交付。
- 本轮通过 `npm run typecheck`、`npm test`（API smoke + Web 36 个测试文件 / 107 个用例）、`npm run build`、`npm run compose:config`、`node --check apps/web/scripts/e2e-orders-chrome.mjs` 和 `git diff --check`。
- Chrome/CDP 订单 E2E 覆盖账号切换与隔离、六列表头、关键词搜索、单状态筛选、买家姓名 tooltip、详情抽屉、分页、表格内部滚动、本地刷新和闲鱼刷新；桌面/移动截图已归档至 `docs/evidence/stage5/S4-VS4A/screenshots/`。
- 详情抽屉内容本轮保持不变；真实 seller 订单读取已在移除错误 `idle_site_biz_code` 请求头后通过，订单交付动作继续后置。

### 2026-09-20：S4-VS4A 订单字段与头像聚合修订

- `d403e75`、`465f723` 已在 merge lock 内以 `490e145` 合入 `master`；新增 `buyerNickname` / `buyerAvatarUrl` / `itemImageUrl` 契约、019/020 迁移，并按账号从本地会话/商品表聚合缺失昵称、头像、商品名称和商品缩略图。
- 订单列表移除用户 ID、商品 ID 副文本；头像 URL 渲染真实头像，无头像不显示昵称首字；昵称继续保留姓名 hover；商品无本地匹配时显示“商品已删除”提示；搜索只命中订单号、昵称和商品名称。
- 合并后主线通过 `npm run typecheck`、`npm test`（37 files / 115 tests）、`npm run build`、`npm run db:migrate`、`npm --workspace apps/api run test:orders:postgres`、`npm run test:e2e:chrome:orders`、`docker compose config --quiet` 和 `git diff --check`。
- 详情抽屉内容按用户更正保持不变；真实外部 seller 权限与订单交付动作继续按既有风险和 `S4-VS4B/C` 后置范围处理。

### 2026-09-20：S4-VS4A 订单状态筛选边界修订

- 修复“待发货/待评价”筛选异常：`待发货 = paymentStatus=paid + deliveryStatus=pending`；`待收货 = paymentStatus=paid + orderStatus=open + deliveryStatus=delivered`；`待评价 = paymentStatus=paid + orderStatus=completed + deliveryStatus=delivered + afterSalesStatus=none`。
- `apps/web/src/features/orders/order-status.test.ts` 固定了四字段组合和已退款排除；`apps/web/scripts/e2e-orders-chrome.mjs` 验证请求参数及页面结果不混入待发货/待收货订单。
- 该“待评价”异常项当前已修复，但作为后续状态机回归关注点保留；详情抽屉内容仍不在本轮修改范围。

### 2026-09-20：S4-VS-DASHBOARD 与订单全链路复验

- `npm --workspace apps/api run test:dashboard`、`npm --workspace apps/api run test:dashboard:postgres`、`npm --workspace apps/api run test`、`npm run typecheck`、`npm run build` 均通过。
- `ALLOW_SHARED_E2E=1 REQUIRE_XIANYU_ORDER_SYNC=1 npm run test:e2e:chrome:dashboard:fullchain` 通过真实 Chrome/CDP → Live API → PostgreSQL/Redis → 闲鱼资料/商品/IM/订单 → 商品与订单落库 → Dashboard/Orders 页面回读；外部订单 5 条，PostgreSQL 复读 58 条，桌面/移动证据已归档。
- 全链路脚本要求 `E2E_DATABASE_URL` 或显式 `ALLOW_SHARED_E2E=1`，并在结束时回收浏览器会话，避免无意写入共享开发库。
- Dashboard 模式修复已合入 `6522286`：当 `VITE_DASHBOARD_MODE` 未设置时继承 `VITE_API_MODE`，根脚本的 `VITE_API_MODE=live` 不再落回 mock；显式 `VITE_DASHBOARD_MODE=mock` 的受控 E2E 仍通过，并断言不请求 `/api/v1/dashboard/snapshot`。

### 2026-09-20：S4-VS5A 真实恢复与浏览器证据

- `npm run typecheck`、`npm test`、`npm run build` 和 `git diff --check` 均通过；API smoke 覆盖消息/Workspace，Web Vitest 通过 15 files / 50 tests。
- `npm --workspace apps/api run test:messages:infra` 通过双 API 实例 Redis 跨进程广播、Redis 重启恢复、PostgreSQL 重启后的消息读回与写入。
- `npm run test:e2e:chrome:messages` 通过 Chrome/CDP 1440×900 与 390×844：连接、强制断线、重连期间写入、cursor 补回、自动重连和时间线去重；证据位于 `docs/evidence/stage5/s4-vs5a-chat-read/screenshots/`。
- 同一证据还覆盖了当前账号上下文不显示账号选择器、用户/商品/消息搜索、全部/未读筛选、头像与商品缩略图、会话整行选择，以及左栏与消息区独立滚动。
- 复用 PostgreSQL 中已有登录态完成真实闲鱼凭证回读：账号 `19cf…` 返回 3 个会话、首会话 4 条历史消息；账号 `6f0…` 返回 1 个会话、首会话 20 条历史消息且 `hasMore=true`。未重复登录、未发送真实消息，数据库 `duplicate_external_refs=0`。
- 当前结论保持 `S4-VS5A = PARTIALLY_VERIFIED`；独立复审与生产部署拓扑确认仍未关闭 `S5-RISK-021`，不宣称外部闲鱼账号验收或发布级恢复闭环。

### 2026-09-19：S4-VS6A 首链路实现（PARTIALLY_VERIFIED）

- 已实现：`workspace.agent_sessions`、`workspace.runs`、`workspace.steps`、`workspace.task_contexts`、`workspace.run_events` 迁移；Memory/Postgres Store；服务端 Run/Step 状态迁移；`clientRunRef` 业务去重与 `Idempotency-Key` 独立；canonical session/run API；只读 WebSocket snapshot + cursor replay；前端 Workspace session list、composer、Run/Step timeline、重连和错误状态。
- 已执行：`npm --workspace apps/api run build`、`node apps/api/scripts/workspace-smoke.mjs`、`node apps/api/scripts/workspace-ws-smoke.mjs`、`npm --workspace apps/web run typecheck`、`npm --workspace apps/web run test`、`npm --workspace apps/web run build`、`git diff --check`。
- 已覆盖：API session/run smoke、Run terminal、Step terminal、事件游标、重复 `clientRunRef`、幂等冲突、归档阻断、WS 101/snapshot/replay/无重复、`after=NaN`、Origin/认证/404 门禁。
- 未关闭：独立 Worker/Pi Runtime、发布级迁移回滚/恢复、人工视觉签核与完整状态回归、Confirmation/Outbox（留在 `S4-VS6B`）。真实 PostgreSQL migration/复读、Chrome/CDP 桌面/移动截图和自动化断线恢复已完成。
- 回滚边界：停止新 Run enqueue、关闭 Workspace 路由和 WS 订阅，保留 Session/Run/Step/事件历史；迁移回滚前必须先确认没有后续数据依赖。

- API 全量 `npm --workspace apps/api run test`：清理残留测试进程后完整通过，覆盖 env0、onboarding、Workspace、products、products-sync、mapper smoke。
- 真实浏览器 `npm run test:e2e:chrome:workspace`：临时 PostgreSQL + `ALLOW_IN_MEMORY=false` API + Vite + Chrome/CDP 通过；session/Run 持久化、断线重连、7 条事件回放、WS handshake 和桌面/移动截图均有证据。
- 现有提交与验证记录保留在 `STATUS.md`；本轮同步更新 Workspace 实现与阶段证据文档，未将受控 Runtime 证据升级为独立 Worker/Pi Runtime 或发布级恢复证据。
- 阶段 5 证据目录统一为 `docs/evidence/stage5/<slice-id>/`；尚未执行的切片不得提前创建“通过”截图、测试输出或回滚记录。

### 2026-09-20：S4-VS6A 证据复核

- Workspace API build、HTTP session/run smoke、raw WebSocket smoke、API 全量 smoke、Web typecheck/test/build 和 `git diff --check` 已复核通过。
- 真实浏览器复核已通过：临时 PostgreSQL、Chrome/CDP、断线/重连、事件回放和桌面/移动截图均可复现。
- 当前结论维持 `S4-VS6A = PARTIALLY_VERIFIED`；实现与文档进入 `READY_FOR_REVIEW`，剩余门禁为独立 Worker/Pi Runtime、发布级恢复、人工视觉签核与 `S4-VS6B` Confirmation/Outbox。

### 2026-09-20：S4-VS7A Settings API Key 首片实现

- 已实现：`/settings` 正式路由；账号级 `CredentialRefVM`；`GET/POST/PATCH /api/v1/credentials` 与 `rotate/enable/disable/revoke`；`expectedVersion`、`Idempotency-Key`、账号 scope、审计摘要和 AES-256-GCM 应用层加密；前端 CredentialStore panel、创建/编辑/轮换/启用/禁用/撤销及 loading/empty/error/submitting/saved 状态。
- 已执行：`npm --workspace apps/api run build`、`node apps/api/scripts/credential-store-smoke.mjs`（加密/解密、创建、列表、轮换、版本冲突、禁用、撤销、撤销后禁止启用）；`npm --workspace apps/web run typecheck`、`npm --workspace apps/web run test -- --run`（26 files / 88 tests）、`npm --workspace apps/web run build`、`git diff --check`。
- 当前结论：`S4-VS7A = READY_FOR_REVIEW`。已补真实 PostgreSQL `001`–`024` migration 与 OpenAI 配置密文复读、Chrome/CDP `/settings` 用户路径、403/409 跨层断言和 `1440×900` / `390×844` 截图；`9be12d8` 已合入 `master`，证据见 `docs/evidence/stage5/S4-VS7A/`。仍开放 fallback 审计可查询化、迁移 024 发布级 rollback、旧 `auth.account_credentials` 双读单写兼容迁移与独立签核。
- 回滚边界：先停止 `/api/v1/credentials` 新写入，保留旧凭证引用和审计；迁移回退前确认没有 018 表依赖，按 expand/verify/switch/contract 顺序处理，不删除历史审计或旧密文。

### 2026-09-21：S4-VS7A OpenAI API 主备配置增量复核

- 已新增 OpenAI-compatible 主配置 / 备用配置模型；`024_openai_model_configs.sql` 解除每账号只能有一个 `model_client` 的旧约束，角色写入 `credential_values.metadata_json`，API Key 继续由 CredentialStore 加密保存。
- 正式 `/settings` OpenAI API 面板严格沿用 SellerAgent 的深色侧栏、设置分类、双列卡片、规则时间线和移动端底部导航；每张配置卡片都有“测试连通性”和“保存”。
- Model 下拉只在展开时调用 provider `/models`；主、备按 configId 隔离模型列表，provider 返回空列表、请求中、失败和重复展开均有明确状态。
- `npm --workspace apps/api run test:postgres:openai` 已在真实 PostgreSQL 通过；`npm --workspace apps/web run test:e2e:chrome:settings:openai` 使用真实 Chrome/CDP + PostgreSQL 通过 UI → API → DB → Agent、更新无重启生效、主失败切备用和重启复读。
- Agent 输出证据：`PRIMARY_V1_REPLY` → 更新后 `PRIMARY_V2_REPLY` → 主配置 401 后 `BACKUP_REPLY`；E2E 同时确认密钥不进入 API 响应、URL、DOM 输入或 localStorage。
- `.env` 中第二套 DeepSeek 真实配置保持注释态；测试进程仅临时加载该配置完成 `/models` 与文本生成 HTTP 200 验证，未改写 `.env`，因此主/备位置互换时两套真实配置均有连接证据。
- 视觉证据已更新至 `docs/evidence/stage5/S4-VS7A/screenshots/`，逐项偏差记录见 `docs/evidence/stage5/S4-VS7A/visual-diff.md`。
- 当前结论仍为 `READY_FOR_REVIEW`：发布级 migration rollback、旧凭证兼容迁移、fallback 专用审计事件和 merge lock 后独立签核未关闭。
