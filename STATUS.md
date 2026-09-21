# XianyuSellerAgent 项目状态

## 2026-09-21 增量修复

- OpenAI API 主备配置切片：`/settings` 正式 OpenAI API 面板已严格对齐 SellerAgent 双卡片视觉；每张卡片支持测试连通性与保存，Model 下拉按展开时 provider `/models` 动态读取。真实 PostgreSQL smoke 与 Chrome/CDP E2E 已通过 UI → API → 数据库 → Agent；Agent 输出验证为 `PRIMARY_V1_REPLY` → `PRIMARY_V2_REPLY` → `BACKUP_REPLY`，PostgreSQL 重启后仍命中备用。视觉证据和逐项偏差记录见 `docs/evidence/stage5/S4-VS7A/`；切片仍保持 `READY_FOR_REVIEW`。
- 自动回复 Agent 设置与动态联调：设置页 Tab 已改为“自动回复 Agent”，配置通过独立 `AutoReplyAgentSettingsService` 持久化；买家 Agent 使用四个只读工具并在每条入站消息前读取最新管理员配置，支持 Prompt、循环/工具上限、上下文、回复长度、分段、防抖、已支付订单策略和 simulate/live（live 仍受环境变量买家白名单约束）。真实 push→tool call→生成→模拟出站→消息/`auto_reply_runs` 落库 E2E 3/3 通过；Chrome/CDP 设置页 E2E 通过；当前仍为 simulate 验证，真实闲鱼发送与发布级恢复未关闭。
- 自动回复模型接入：复用 Workspace 的 `API_KEY/BASE_URL/MODEL/MODEL_TIMEOUT_MS` 环境变量和同一个 OpenAI-compatible `ModelClient`；配置完整时走 `ModelAutoReplyGenerator`，缺少配置时保留模板生成，Provider 失败安全落库为失败且不创建 outbound；新增模型上下文裁剪、成功装配和 503 失败回归测试。
- 在线聊天 CSRF：API 重启后旧页面的 token 失效时，前端刷新 `/api/v1/auth/session` 后仅重试原 mutation 一次并保留 `Idempotency-Key`；Web 38 个测试文件 / 117 个用例、类型检查、构建通过。
- 自动回复白名单：真实 push 缺少 `senderName` 且本地会话尚无昵称时，先按 `externalConversationRef` 补全闲鱼买家身份并持久化，再进入白名单门禁；新增回归测试覆盖 allowlist 通过与 `auto_reply_runs.status=persisted`。真实买家 push 仍待外部触发，不能用历史同步替代。
- 历史/push 竞态：若页面历史同步先按 external ref 落库，后续真实 push 即使消息已存在也会继续进入幂等自动回复处理；新增回归覆盖 `history import → same push → persisted` 与重复 push 单次出站。
- 消息重复落库修复：统一历史同步与实时 push 的外部消息号选择，优先稳定 `.PNM`，避免闲鱼 push 的内部 UUID 绕过 `(conversation_id, external_message_ref)` 唯一约束；新增 parser、历史同步和真实原始 push→自动回复幂等回归。API 全量测试、Web 117 项测试、类型检查和构建通过。

- 项目阶段：5
- 阶段状态：进行中（账号管理、商品、卡券已具备主体链路；S4-VS3 仍待真实环境人工复核；下一批优先切片调整为在线聊天、Workspace 工作台和 Settings API Key 配置）
- 最近一次通过门禁：S4-VS-DASHBOARD 全链路复核 / 2026-09-20（PASS；项目整体仍处于阶段 5 进行中）
- 当前目标：完成 `S4-VS5A` 独立复审后推进 `S4-VS5B/C`；并行收尾 `S4-VS6B`、`S4-VS7A` 的真实 PostgreSQL、浏览器视觉和独立评审门禁，以及既有账号/商品/卡券真实环境门禁，不再把受控证据冒充发布级完成
- 多 Agent 协作状态：已启用独立 worktree、登记表和全局 merge lock 强制规则；当前活动登记见 `docs/agent-worktree-registry.md`，主工作区禁止直接开发
- 已完成范围：阶段 0 范围门禁；阶段 1 架构与模块边界；阶段 2 数据模型、数据库表设计、关系基数、状态机、API envelope、幂等、鉴权、敏感交付、迁移边界；阶段 5 账号登录方法选择、真实 QR 适配器、Cookie 登录、账号资料同步、登录会话持久化、AuthGate 会话门禁、Vite 默认代理、账号列表真实读取和 Chrome/CDP 控制环境 E2E；S4-VS2 商品列表/详情只读首片、003_catalog 迁移、Memory/Postgres scope-aware 查询、真实 PostgreSQL smoke 和 Chrome/CDP 商品 E2E
- 未完成范围：在线聊天 `S4-VS5B/C`、Workspace `S4-VS6B`、Settings API Key `S4-VS7A` 已完成首片并保持 `READY_FOR_REVIEW`；订单交付 `S4-VS4B/C`；订单只读列表 `S4-VS4A` 的真实闲鱼读取与 PostgreSQL 落库已通过，交付动作仍后置；Dashboard 全状态截图、独立视觉签核与 rollback 仍开放；VS5A 保持 `PARTIALLY_VERIFIED`，待独立复审确认生产部署拓扑后关闭 `S5-RISK-021`；`S4-VS6A` 已完成真实 PostgreSQL、WS 和 Chrome/CDP 首链路复核并保持 `PARTIALLY_VERIFIED`，尚未满足独立 Worker/Pi Runtime、发布级恢复和人工视觉签核；商品/卡券剩余写入与库存门禁；`S4-ENV-RECOVERY`、`S4-EXT-ACCOUNT`、`S4-ENV-RUNTIME`；完整迁移/回滚/Testcontainers、Redis/MinIO 恢复和逐状态视觉回归。账号密码登录依赖独立浏览器运行时，当前明确不可用。
- 未解决风险：除既有项目风险外，OpenAI 主备切换的 `S5-RISK-031/P2`（fallback 专用审计未暴露）与 `S5-RISK-032/P1`（迁移 024 的发布级 rollback/兼容窗口）保持开放；`S5-RISK-028/P2` 已部分缓解但仍待独立视觉签核。
- 待复审问题：S3-R5 为超出当前范围的实现审计；S3-R6 设计范围已澄清；S1-I004 保持 P2 跟进项；阶段 4 计划门禁已通过
- 下一步：推进 `S4-VS5B/C`、`S4-VS6B`；并完成 `S4-VS7A` 的真实 PostgreSQL、Chrome/CDP 双 viewport、403/409 跨层 E2E、迁移回滚和三轮独立复审。VS5A 的真实 Redis/PostgreSQL、跨进程广播、重启恢复和 Chrome/CDP 断线证据已归档，待独立复审确认生产部署拓扑。商品同步、卡券首页等既有首片证据继续保留，但不替代真实外部账号、持久化和人工视觉门禁

## 当前证据
- `2026-09-20 自动回复链路切片`：按设计文档收敛为“入站规范化/事实先落库 → 幂等回放 → 风险优先意图 → 商品/订单/会话分层上下文 → 可回答性与策略门禁 → 受事实约束的生成 → 输出安全校验 → Noop 模拟投递 → AI 出站消息与 `auto_reply_runs` 落库 → 脱敏审计回读”；`npm --workspace apps/api run test:auto-reply:e2e`、`npm --workspace apps/api run test:auto-reply:postgres`、`npm run db:migrate`、`npm run typecheck`、`npm test`、`npm run build`、`npm run compose:config`、`git diff --check` 均通过。真实闲鱼发送调用次数为 0；本切片仅验证 dry-run，不关闭在线聊天发送/附件/撤回、真实模型 Provider、Outbox Worker 或发布级回滚风险。
- `2026-09-21 自动回复模型 Provider 接入`：`npm --workspace apps/api run test:auto-reply:unit` 18/18、`npm --workspace apps/api run test:auto-reply:e2e`、`npm --workspace apps/api run test:auto-reply`、`npm --workspace apps/api run build`、`npm run typecheck:api` 通过；受控 fetch 证明模型请求使用共享环境配置并将 AI 回复落库，显式关闭后仍走模板，503 仅落失败 run 且不产生 outbound。真实 Provider、live 发送、Outbox/unknown 恢复和离线评测仍未完成。
- `2026-09-19 S4-VS2 商品同步入口修复`：商品页从普通 `/products` 入口加载管理员可见账号，默认选择可用账号并将 `accountId` 写回列表查询与同步请求；Chrome/CDP fixture 验证 29 件同步商品可落库，列表总数由 1 增至 30。

- `SellerAgent/npm test`：已通过，`mock API contract flow passed`；
- `SellerAgent/npm run build`：已通过，TypeScript 检查和 Vite production build 通过；
- `git diff --check`：当前工作树已通过；仅有换行格式提示，无 diff 空白错误；
- `docs/02-data-api.md`：v0.4，状态 PASS，覆盖字段级 schema、PK/FK、唯一约束、关系基数、状态机、P0 API、FirstRun bootstrap、消息 handoff、幂等、安全和迁移；
- `docs/02-database-schema.md`：v0.1，状态 PASS，覆盖 PostgreSQL 表清单、列类型、默认值、PK/FK、唯一/部分唯一索引、跨表约束、迁移顺序和回滚边界；
- `docs/05-review-log.md`：S2-R1、S2-R2、S2-R3 均 PASS，S2-I001 至 S2-I005 已关闭；
- `docs/03-frontend-design.md`：v0.1，阶段 3 组件树、状态边界与 stockAlert/inventoryStatus 契约已同步；
- `docs/03-component-contract.md`：v0.1，补充模块树、组件职责矩阵、canonical ViewModel、路由/API、数据流、移动端对等性和 DoD；独立设计复审 PASS；
- `docs/04-plan.md`：v0.1，阶段 4 主体功能优先的 ENV-0 与 S4-VS1 至 S4-VS4 纵向切片计划、依赖、DoD、测试、视觉基线和回滚边界；计划门禁 PASS；
- `npm --workspace apps/api run test`：已通过，`env0 smoke passed`、`onboarding cookie login smoke passed`；覆盖 health、bootstrap、Session/CSRF、幂等重放/冲突、账号创建、Cookie 登录、资料同步、登录状态和账号列表读取；
- `npm --workspace apps/web run test`：已通过，覆盖账号 API adapter、QR 状态机和组件相关单元/契约测试；
- `2026-09-20 S4-VS4A 订单列表只读切片复验`：保留 seller origin/referer、`type=json/valueType=string/spm_cnt` 与标准 body，移除会触发权限拒绝的 `idle_site_biz_code` 请求头；真实 active 凭证返回 5 条订单，Chrome/CDP 触发 refresh 后 PostgreSQL 落库复读成功，`S4-VS4A` 只读范围通过，交付预览/发货/取消/重试仍属于 `S4-VS4B/C` 后置范围。详见 `docs/evidence/stage5/S4-VS4A/test-baseline.md`。
- `2026-09-20 S4-VS4A 订单列表界面修订`：合入 `8ad36cd`；移除 `orders-page-title`，筛选区仅保留订单号/买家昵称/商品名称关键词搜索与“全部/待付款/待发货/待收货/待评价/退款中”单一状态筛选，表格改为六个业务列并保留操作列、查看详情按钮和详情抽屉，买家昵称增加姓名悬浮提示，表格改为自适应高度 + 内部滚动 + 分页。订单 Chrome/CDP E2E 覆盖账号切换、搜索、筛选、tooltip、详情抽屉、分页、内部滚动、本地/闲鱼刷新和账号隔离；详情抽屉内容本轮不改，真实 seller 订单权限已在 `374b3ef` 修复后通过真实复验。
- `2026-09-20 S4-VS4A 订单字段与头像聚合修订`：`d403e75` + `465f723` 已在 merge lock 内以 `490e145` 合入 `master`；订单缺失昵称/头像/商品名称时按账号从本地会话与商品表聚合，列表移除用户 ID/商品 ID，昵称保留姓名 hover，头像 URL 有值时渲染真实头像、无值仅保留空圆形占位；商品列同步显示本地商品/会话缩略图，无法聚合时提示“商品已删除”而不暴露商品 ID；搜索严格按订单号、昵称、商品名称。主线 `npm run typecheck`、`npm test`（Web 37 个测试文件 / 115 个用例）、`npm run build`、`npm run db:migrate`（019/020）、PostgreSQL 订单 smoke、Chrome/CDP 订单 E2E、`docker compose config --quiet` 和 `git diff --check` 均通过；真实外部 seller 权限结论仍按 `S4-VS4A` 既有风险单独保持，不与受控 fixture 证据混淆。
- `2026-09-20 S4-VS4A 订单状态筛选边界修订`：修复“待发货/待评价”筛选条件，`待发货` 固定为 `paymentStatus=paid + deliveryStatus=pending`，`待收货` 固定为 `paymentStatus=paid + orderStatus=open + deliveryStatus=delivered`，`待评价` 固定为 `paymentStatus=paid + orderStatus=completed + deliveryStatus=delivered + afterSalesStatus=none`；单元测试与 Chrome/CDP E2E 均验证待评价不混入待发货、待收货或已退款订单。该异常项已修复，但作为状态机回归关注项保留，后续不得回退为仅按 `orderStatus=completed` 判断。
- `2026-09-20 S4-VS-DASHBOARD 全链路复验`：`npm --workspace apps/api run test:dashboard`、`test:dashboard:postgres`、API 全量测试、`npm run typecheck`、`npm run build` 与 `ALLOW_SHARED_E2E=1 REQUIRE_XIANYU_ORDER_SYNC=1 npm run test:e2e:chrome:dashboard:fullchain` 均通过；真实 Chrome/CDP → Live API → PostgreSQL/Redis → 闲鱼资料/商品/IM/订单 → 商品与订单落库 → Dashboard/Orders 页面回读闭环通过，证据位于 `docs/evidence/stage5/S4-VS-DASHBOARD/`。
- `2026-09-20 Dashboard 默认模式修复`：根因是 `App.tsx` 仅读取 `VITE_DASHBOARD_MODE`，而根脚本只设置 `VITE_API_MODE=live`，导致未设置 Dashboard 覆盖时回退 mock。已合入 `6522286`：Dashboard 默认继承 `VITE_API_MODE`，仍支持显式 `VITE_DASHBOARD_MODE=mock`；`npm run typecheck:web`、`npm run test:web`（37 files / 110 tests）、`npm run build:web`、显式 mock Chrome E2E 与未设置 Dashboard 覆盖的真实 Chrome/CDP → API → PostgreSQL/Redis → 闲鱼 fullchain 均通过。
- `npm --workspace apps/web run typecheck`、`npm --workspace apps/web run test`、`npm --workspace apps/web run build`：已通过；Workspace adapter、Run cursor 去重、页面状态边界已接入，当前 web 测试为 13 files / 41 tests。
- `S4-VS6A` 专项复核：`npm --workspace apps/api run build`、`node apps/api/scripts/workspace-smoke.mjs`、`node apps/api/scripts/workspace-ws-smoke.mjs` 均已通过，覆盖 queued→succeeded、Step、clientRunRef、Idempotency-Key 冲突、WS snapshot/replay、`after=NaN`、Origin 403、未认证 401、未知 Run 404。
- `npm --workspace apps/api run test`：已通过；覆盖 env0、onboarding、Workspace session/run、Workspace WebSocket、products、products-sync、mapper smoke。
- `npm run test:e2e:chrome:workspace`：已通过真实浏览器首链路；临时 PostgreSQL 迁移 001–015、`ALLOW_IN_MEMORY=false` API、Vite、Chrome/CDP 均真实启动，session/Run 持久化成功，断线重连后事件回放 7 条且无错误 banner，生成 `artifacts/real-verify/S4-VS6A/screenshots/` 桌面/移动截图。
- `docker compose config --quiet`：已通过；`docker compose up -d --build` 已启动 API、Worker、PostgreSQL、Redis、MinIO；`pg_isready`、Redis `PONG`、容器内 health/ready 通过，并完成账号写入、列表读取及 API 重启后的持久化复读；完整迁移回滚/Testcontainers 仍未覆盖；
- `npm run verify`：已通过；包含类型检查、API smoke、前端 4 个测试文件/15 个测试、构建、本机 Chrome/CDP E2E、1440×900 与 390×844 截图生成、Compose 配置和 diff 检查。
- `npm run test:e2e:chrome`：已通过；未认证 `/accounts` 先停留在 AuthGate 且不渲染账号业务面，注入 bootstrap session cookie 后完成账号列表、登录方式选择、无旧创建弹窗、无模拟二维码、Cookie 登录、服务端资料回传和页面可见持久化结果；不安装或执行 Playwright。
- `docs/evidence/stage5/S4-VS1/test-baseline.md`：已补充 Cookie 登录、资料同步、登录会话落库、当前 Chrome 参考项目登录态前置条件，以及受控 E2E 与真实外部验收的边界；
- `docs/13-account-login-slice.md`：新增账号登录切片实现说明、路由/数据流、迁移、测试证据、Chrome 登录态复核步骤和当前门禁结论；
- `docs/evidence/stage5/S4-VS1/screenshots/`：已由最新 Chrome/CDP 受控 E2E 重新生成 `accounts-desktop-1440x900.png` 与 `accounts-mobile-390x844.png`；
- `npm run test:products:postgres`：已通过真实 PostgreSQL 商品迁移、管理员账号范围、商品列表/详情读取和测试数据清理；
- `npm run test:e2e:chrome:products`：已通过本机 Chrome/CDP 真实 API + MemoryStore 商品列表 → 详情 → 刷新后持久化可见链路；生成 `docs/evidence/stage5/S4-VS2/screenshots/` 桌面/移动证据；
- `docs/evidence/stage5/S4-VS2/test-baseline.md`：已记录商品首片范围、迁移/API/组件边界、实际验证命令、证据与回滚边界；
- `SellerAgent/npm test`、`SellerAgent/npm run build`、`git diff --check`：仅作为原型健康检查，不作为阶段 3 组件设计证据；
- 高保真原型和现有源码：仅作为视觉与背景参考，不作为阶段 3 组件拆分依据；正式前端账号页已独立按 design token 重建壳层与账号切片。
- 以上受控证据不证明真实闲鱼 APP 扫码成功或真实外部 Cookie 验证；阶段 5 的剩余门禁必须按 `docs/13-account-login-slice.md` 的人工复核步骤关闭。
- Vite 默认代理证据：未设置 `VITE_API_PROXY_TARGET` 时，`GET /api/v1/auth/session` 经 Vite 返回 HTTP 200 canonical envelope；未认证业务读取被 API 返回 401，AuthGate 不渲染账号业务面。

- canonical 设计同步：FirstRun 使用 `POST /api/v1/auth/bootstrap`；消息人工接管使用 `POST /api/v1/conversations/{id}/handoff`，恢复 AI 使用 `POST /api/v1/conversations/{id}/release`；统一字段为 `BootstrapAdminInput/Output`、`HandoffConversationInput`、`ReleaseConversationInput`、`ConversationHandlingOutput`，状态字段为 `handlingMode`，版本字段为 `expectedVersion`。

- 2026-09-20 `S4-VS5A` 真实恢复与浏览器证据：`npm --workspace apps/api run test:messages:infra` 通过双 API 实例 Redis 跨进程广播、Redis 重启恢复、PostgreSQL 重启后的消息读回/写入；`npm run test:e2e:chrome:messages` 通过 Chrome/CDP 连接、强制断线、重连期间写入、cursor 补回和时间线去重，并生成匹配高保真宽度的 `messages-desktop-1896x900.png`、`messages-reconnecting-1896x900.png`、`messages-mobile-390x844.png`。
- 2026-09-20 `S4-VS5A` 主线门禁：`npm run typecheck`、`npm test`（API smoke + Workspace smoke + Web 15 files / 51 tests）、`npm run build`、上述真实基础设施 smoke、聊天 Chrome/CDP E2E 和 `git diff --check` 均通过；切片仍保持 `PARTIALLY_VERIFIED`，不宣称外部闲鱼账号验收或发布级恢复闭环。
- 2026-09-20 `S4-VS5A` 外部凭证回读：复用 PostgreSQL 中现有登录态，账号 `19cf…` 返回 3 个真实会话，首会话历史 4 条（含文本与图片）；账号 `6f0…` 返回 1 个真实会话，首会话历史 20 条且仍有更多游标（含 inbound/outbound/system）。数据库复核 `duplicate_external_refs=0`；本轮未发送任何真实闲鱼消息，也未重复执行 Cookie 登录。
- 2026-09-20 账号列表分页与工具栏修订：账号 API/MemoryStore/PostgresStore 新增服务端分页、搜索、状态/连接筛选和统一分页元数据；账号页新增分页控件、空态占满可用区域并居中、表格最大高度与内部滚动，移除表格操作列和工具栏“共 x 个账号”统计。提交 `383d1c8`，已在 merge lock 内以 `8b7c398` 合入 `master`；`npm run verify` 全部通过。账号删除后端接口保留，当前列表 UI 不再暴露操作按钮。
- 2026-09-20 账号操作列回归修订：恢复账号表格“操作”列、切换账号、扫码授权/重新授权和删除账号；分页底部按商品管理页对齐为“共 N 个账号 / 分页控件 / 第 N / M 页”三段式，保留表格最大高度与内部滚动。提交 `e2f2258`、`c91e875`、`68205cd`，已在 merge lock 内以 `ed0f8eab` 合入 `master`；账号表格回归测试、全量 verify 与真实 Chrome/CDP 切换/删除路径均通过。
- 2026-09-20 聊天 composer UI 修复：按产品指定交互重做底部输入区，接入闲鱼官方图片表情标记、附件菜单/预览/移除、Ctrl+V 粘贴图片、Enter/Shift+Enter、最大高度 128px、文本或附件单一发送按钮；Web 18 files / 58 tests、`npm run build`、`npm run test:e2e:chrome:messages` 均通过。E2E 仅使用隔离 fixture，不代表真实闲鱼写入验收。
- 2026-09-20 `S4-VS5A` 真实已读链路：`npm --workspace apps/api run test:xianyu-im-read` 通过 8/8，覆盖紧凑/批量/嵌套 40103 解析、缺少消息 ID 的会话回退、`/r/MessageStatus/read` 上报、WebSocket 回调与 ACK；`npm --workspace apps/api run test:messages:infra` 同时验证 `read_status` 持久化、Redis 跨进程 `chat.message.updated`、Redis/PostgreSQL 重启恢复。该回执验证为受控/合成事件，不宣称已完成外部闲鱼线上 40103 实时验收。
- 2026-09-20 `S4-VS7A` Settings API Key 首片：Settings branch 已接入 `/settings` 正式路由、明确账号选择、CredentialStore panel 与 create/update/rotate/enable/disable/revoke；服务端使用 `accounts.credential_refs` / `credential_values`、AES-256-GCM、fingerprint、Idempotency-Key、expectedVersion、scope 与审计摘要，API 默认 `canReveal=false`。已通过 `npm --workspace apps/api run build`、`node apps/api/scripts/credential-store-smoke.mjs`、`npm --workspace apps/web run typecheck`、`npm --workspace apps/web run test -- --run`（26 files / 88 tests）、`npm --workspace apps/web run build`、`git diff --check`；当前 smoke 使用 MemoryStore，未关闭真实 PostgreSQL migration 018、Chrome/CDP 视觉和独立评审门禁。
- 本轮提交：当前 `master` HEAD（`fix(聊天): 接入闲鱼真实已读回执`）；提交前已在 merge lock 内重跑 typecheck、全量测试、构建、真实 Redis/PostgreSQL 恢复和 Chrome/CDP 消息 E2E。

## S4-VS3 卡券首页（已合入 master，待人工复核）

- 原独立 worktree：`F:\ChenHai\Project\XianYuAgent-s4-vs3`，分支 `feature/s4-vs3-coupons`；本次以 merge commit 合入 `master`，临时 worktree 与分支随后删除。
- 实现：批次列表、搜索/类型筛选（变更即生效）、当前页全选、批量删除、创建/编辑/复制、启用/禁用、库存/`stockAlert`、首批库存、导入库存、绑定/解绑、双栏商品关联、图片原图预览、作废、DELETE 软作废、管理员受控正文预览/复制、403/404/409/网络错误状态。
- 后端：`apps/api/migrations/013_coupons.sql` + `014_coupon_card_metadata.sql`、Memory/Postgres store、`purpose=text/data/api/image` 校验、列表安全元数据摘要、PATCH/PUT 编辑、scope 校验、加密正文存储、审计摘要。
- 前端：`apps/web/src/features/coupons/`，通过 `/coupons` 正式路由接入，表格视觉保持平台样式，仅参考旧项目字段和操作。
- 验证：已完成类型检查、单测、构建、API smoke、Chrome/CDP E2E、桌面/移动截图；Chrome/CDP 使用 MemoryStore/stub，真实 PostgreSQL/Redis/MinIO 仍需人工浏览器复核。
- 2026-09-20 工具栏修订已通过合并后门禁并合入 `master`：`19c6798`（`merge: 合入卡券列表工具栏修订`），移除首页 KPI 卡片，将搜索/筛选/新建/刷新及条件批量操作统一到列表工具栏，并移除查询/重置筛选按钮。
- 2026-09-20 空态与顺序修订已通过合并后门禁并合入 `master`：`5a9f3cb`（`merge: 合入卡券工具栏与空态修订`），将“新建卡券”置于工具栏末尾，移除 `共 N 张` 统计，并保留居中的“暂无卡券批次 / 当前账号范围内没有匹配的批次，可调整筛选或创建新批次。”空态。
- 2026-09-20 新建卡券弹窗修订已合入当前开发分支：按参考项目对齐字段标签、默认值、API 参数快捷插入、无物流凭证开关、图片配置、备注校验和多规格说明；移除对接价格输入与是否可对接复选框，保留当前批次接口所需的账号/交付/库存字段。组件单测、Web 全量单测、类型检查和构建通过；Chrome/CDP 卡券 E2E 在现有绑定输入选择器处失败，未影响新建弹窗断言之前的链路。
- 2026-09-20 商品表格空态修订已通过合并后门禁并合入 `master`：`c641d29`（`merge: 合入商品表格空态与工具栏修订`），空表格/加载失败提示占满列表剩余区域并居中，工具栏移除 `共 0 件`，分页底部统计保留；Web/API 构建、Vitest、商品 Chrome/CDP E2E 与 diff 检查通过。
- 门禁：代码已合入 `master`，人工审核仍需按 `docs/evidence/stage5/S4-VS3/test-baseline.md` 执行并回写结论。

## S4-VS7A Settings API Key（首片实现，真实证据已补，待发布级复核）

- 实现边界：`/settings` 选择明确 `accountId` 后管理模型 API Key 的 CredentialRef；列表仅返回 provider、alias、status、version、fingerprint、metadata 和 `canReveal=false`，不提供 reveal。
- 后端：新增 `apps/api/migrations/018_credential_store.sql`、`credential-crypto.ts`、`credential-store.ts` 与 `/api/v1/credentials` CRUD/rotate/enable/disable/revoke；写入带 `Idempotency-Key` 和 `expectedVersion`，服务端按账号 scope 校验并写审计摘要。
- 前端：新增 `apps/web/src/features/settings/`，接入正式 `/settings` 路由、账号选择、CredentialStore panel、创建/编辑/轮换/启用/禁用/撤销、loading/empty/error/submitting/saved 状态与移动端底部设置导航。
- 受控验证：API build、credential-store smoke（AES-256-GCM 加解密、创建/列表、轮换、版本冲突、禁用、撤销及撤销后禁止启用）、Web typecheck、26 files / 88 tests、Web build、`git diff --check` 已通过。
- 真实增量验证：临时 PostgreSQL 已执行迁移 `001`–`018`，`credential_values.ciphertext` 真实落库且不等于明文；Chrome/CDP 已通过 `/settings`、403/409、create/rotate/disable/revoke 与 secret redaction，并生成 `1440×900` / `390×844` 截图；证据见 `docs/evidence/stage5/S4-VS7A/`。
- 未关闭门禁：018 的发布级 rollback / 已有 volume 回退演练、旧 `auth.account_credentials` 双读单写兼容迁移与正式 merge lock 复核仍开放。因此状态保持 `READY_FOR_REVIEW`，不标记 `PASS`。

## 未完成切片索引（2026-09-19）

| 切片 | 状态 | 当前边界 | 下一证据 |
| --- | --- | --- | --- |
| `S4-VS2A` 商品草稿与基础信息 | `PLANNED` | create/detail/PATCH、账号 scope、`expectedVersion`、草稿保留 | 真实 PostgreSQL 写入/复读、403/404/409、Chrome/CDP 桌面/移动 |
| `S4-VS2B` SKU / 多规格与库存 | `PLANNED` | SKU 增删改、校验、并发和逐项结果 | PostgreSQL 并发集成、部分成功与移动端 |
| `S4-VS2C` 商品素材与对象存储 | `PLANNED` | AssetRef、上传/替换/删除、失败重试、MinIO | MinIO 持久化/重启复读、过期/403/失败截图 |
| `S4-VS2D` 受控发布 | `PLANNED` | Policy → Confirmation → Idempotency → Outbox | worker/unknown/timeout/人工恢复与真实页面状态 |
| `S4-VS2E` 商品外部同步真实验收 | `PARTIALLY_VERIFIED` | 真实账号、Cookie、分页、字段映射和数量口径 | 当前已登录 Chrome + 真实闲鱼账号人工复核 |
| `S4-VS3A/B` 卡券明细、素材、库存锁定消耗 | `PLANNED` | CouponItem bulk 操作、素材、reserve/consume/release | PostgreSQL/Redis/MinIO 并发集成、敏感字段裁剪 |
| `S4-VS4A` 订单列表只读 | `PASS` | 订单列表/详情/refresh、四套状态（含待发货/待评价边界）、账号 scope、关键词、分页、桌面/移动；昵称/商品标题与缩略图聚合、缺失商品提示、真实 seller 订单读取与 PostgreSQL refresh 落库 | 交付预览、库存锁、发货/取消/重试转入 `S4-VS4B/C` |
| `S4-VS4B/C` 订单交付 | `PLANNED` | delivery-preview、发货/取消/重试/unknown 恢复 | 四套状态、库存锁、Outbox、DeliveryRecord |
| `S4-VS5A` 在线聊天读取与实时连接 | `PARTIALLY_VERIFIED` | 会话列表、消息时间线、MemoryStore/PostgreSQL HTTP/WS、Redis 跨进程广播与重启恢复、cursor 重连去重、Chrome/CDP 双 viewport 断线视觉证据；本轮补齐搜索、全部/未读筛选、独立滚动、整行选择、头像/商品缩略图和 `016_conversation_media.sql` | 独立复审、生产部署拓扑确认；发送/附件/撤回仍属 `S4-VS5B` |
| `S4-VS5B` 在线聊天发送/附件/撤回 | `PLANNED` | 文本发送、图片上传、失败重试、撤回 | PostgreSQL/对象存储、幂等、unknown/timeout、脱敏 |
| `S4-VS5C` 人工接管与 AI 恢复 | `PLANNED` | handoff/release、版本冲突、审计 | 非法转换、403/409、桌面/移动状态 |
| `S4-VS6A` Workspace 会话与 Run 首链路 | `PARTIALLY_VERIFIED` | AgentSession/Run/Step、Memory/Postgres Store、受控 Runtime、clientRunRef、WS 游标补事件、真实 PostgreSQL/Chrome/CDP 首链路、前端 Workspace 页面 | 独立 Worker/Pi Runtime、发布级恢复、人工视觉签核与完整状态回归 |
| `S4-VS6B` Workspace Confirmation/Outbox | `PLANNED` | confirm/cancel/retry/recover、unknown 恢复 | Policy、幂等、租约、审计、真实 Runtime |
| `S4-VS7A` Settings API Key 配置 | `READY_FOR_REVIEW` | 正式 `/settings`、CredentialRef API、AES-256-GCM 加密、创建/编辑/轮换/启停/撤销、脱敏 metadata、Web/API 定向验证 | PostgreSQL migration 018 加密复读与回滚、真实 403/409 跨层 E2E、1440×900/390×844 视觉证据、三轮独立复审 |
| `S4-VS-DASHBOARD` 仪表盘高保真界面 | `PARTIALLY_VERIFIED` | `/dashboard` 正式 feature、桌面/移动独立 MobileFrame、KPI/趋势/健康度/商品排行/最近处理/风险抽屉；Web 32 files / 102 tests、build、真实 Chrome/CDP + PostgreSQL/Redis + 闲鱼商品/订单全链路通过 | 当前 feature 使用 `/api/v1/dashboard/snapshot`；旧 `/order-trend` 兼容接口、全状态截图、独立视觉签核与 rollback 仍开放 |
| `S4-ENV-RECOVERY` | `BLOCKED` | 迁移回滚、Testcontainers、Redis/MinIO 重启恢复 | 发布级恢复演练和旧数据兼容证据 |
| `S4-EXT-ACCOUNT` | `BLOCKED` | 真实 APP 扫码、Cookie、资料同步 | 真实外部账号人工验收 |
| `S4-ENV-RUNTIME` | `PLANNED` | Pi Runtime 健康、超时、重试、取消和观测 | 独立运行时验证；不以页面/API smoke 代替 |

切片状态说明：`PASS` 仅表示所有适用测试、视觉、持久化、回滚和独立评审均通过；当前新增切片均未达到 `PASS`。`S4-VS3` 代码虽已合入，但其人工真实环境审核仍保持 `READY_FOR_REVIEW`。

## 长期决策摘要

- 阶段 0 不提前开发真实后端；
- SellerAgent 原型 + design token 是阶段 3 前的临时视觉基线；
- `knowledge`、`review` 入口直接删除；
- Pi Runtime 采用独立服务；首期生产允许 Docker Compose；
- CredentialStore 直接存项目数据库，管理员拥有绝对管理权限，但凭证不得暴露给闲鱼买家；
- `unknown` 作为 `externalOutcome`，不作为 OutboxStatus；
- 幂等作用域为 `adminId + accountId + route + Idempotency-Key`，默认保留 30 天；
- 鉴权基线为 SameSite=Lax、CSRF 双提交、WebSocket Origin allowlist、Session 空闲 30 分钟/绝对 8 小时、登录和密码变更后轮换；
- 卡券正文、夸克链接、提取码仅按 `buyer_deliverable`、订单已支付、商品与账号匹配、策略通过和审计完成后交付。

## 阶段边界

阶段 4 计划门禁已关闭并完成优先级重排。阶段 5 已完成 S4-VS1 账号管理人工放行，S4-VS2 商品与 S4-VS3 卡券具备主体链路；下一批进入 S4-VS5 在线聊天、S4-VS6 Workspace、S4-VS7A Settings API Key。账号/商品/卡券遗留的真实外部、持久化和视觉门禁继续登记和复核，不因优先级调整而宣称全部 PASS。

## Git 提交记录

- 阶段 0：`38862e5`（`feat: 阶段0文档产出`）
- 阶段 1：`cfc756b`（docs(阶段1): 完成架构与模块边界）
- 阶段 2：`076a969`（docs(阶段2): 完成数据库表设计与数据契约）
- 阶段 3：`66fd989`（docs(阶段3): 完成前端信息架构与状态契约）
- 阶段 3 门禁重开：`6c5533e`（docs(阶段3): 重开组件门禁并补充详细契约）
- 阶段 3 组件契约复审关闭：`bcf47b5`（docs(阶段3): 完成组件契约复审并关闭门禁）
- 阶段 4 主体功能纵向切片计划：`f55f7dc`（docs(阶段4): 编排主体功能纵向切片计划）
- 阶段 4 计划提交哈希回写：`3e0a0aa`（docs(阶段4): 回写主体切片计划提交哈希）
- 阶段 5 前端账号只读首片：`f72f688`（feat(阶段5): 落地账号管理前端只读切片）
- 阶段 5 路由骨架：`e2740a7`（feat(阶段5): 补充页面路由骨架）
- 阶段 5 测试门禁：`5c8f9e5`（test(验证): 建立阶段五前端测试门禁）
- 阶段 5 ENV-0 后端运行时：`d134f9d`、`2567714`、`50cbe0b`（基础运行时、bootstrap Cookie 重放、幂等竞争与异常清理）
- 阶段 5 账号真实读取链路与 ENV-0 部署骨架：`65b48d6`（feat(阶段5): 接通账号真实读取链路与ENV0部署骨架）
- 阶段 5 账号详情与连接状态读取：`2de5ff7`（feat(阶段5): 接通账号详情与连接状态读取）
- 阶段 5 账号登录会话状态机：`325161f`（feat(阶段5): 落地账号登录会话状态机）
- 2026-09-19 阶段5 S4-VS1 更新：二维码登录前后端闭环已接通；真实模式已验证二维码生成、轮询与取消，前端已展示二维码并自动轮询。人工扫码成功及外部闲鱼账号凭证落库仍需人工验收；风控 `verification_required` 保留为可恢复状态。
- 本轮提交：`c04b189`（`feat(阶段5): 接通闲鱼二维码登录与凭证校验`）。
- 本轮前端提交：`7cf0c0e`（`feat(阶段5): 完成账号管理前端与Chrome端到端验证`）。
- 本轮账号登录提交：`9388056`（`feat(阶段5): 完成账号登录与Chrome复核链路`）。
- 2026-09-19 二维码首开竞态已修复：保留 StrictMode，前端 QR controller 增加 in-flight 去重、弹窗增加一次性自动启动保护；Chrome/CDP E2E 断言首开仅发送 1 个二维码创建请求，前端并发回归测试已补齐。
- 2026-09-19 二维码 creating 卡死已修复：移除 StrictMode 开发期 cleanup 对有效请求的误失效，Chrome/CDP E2E 现在同时断言二维码区域实际渲染。
- 2026-09-19 本轮运行时统一：本地 dev 默认使用 PostgreSQL/Redis/MinIO，MemoryStore 仅限显式测试；Compose API/Worker 使用 `full` profile，避免与本地 API 竞争 `8080`。`/healthz`/`/readyz` 增加 `storage` 诊断字段。验证：`npm run verify`、真实本地 dev `storage=postgres`、PostgreSQL 管理员登录与账号列表读取均通过。
- 2026-09-19 人工裁决：S4-VS1 账号管理审核通过；账号列表及账号信息可正常加载。现存页面 UI 缺陷标记为非阻塞后续项，切换至 S4-VS2 商品管理。
- 2026-09-19 S4-VS2 商品列表/详情只读首片完成：003_catalog、统一商品 API、前端 Products feature、PostgreSQL smoke 和 Chrome/CDP E2E 均通过；商品写入、同步、素材、SKU、发布仍未宣称完成。
- 2026-09-19 S4-VS2 商品同步首片完成：`POST /api/v1/products/sync`、MTOP 脱敏 mapper、Memory/PostgreSQL 幂等 Upsert、本地草稿跳过、商品页同步按钮和 Chrome/CDP fixture E2E 均通过；提交 `edecc3e`。真实发布仍未接入。
- 2026-09-19 S4-VS2 商品同步入口修复完成：普通 `/products` 自动选择可用账号并携带 `accountId` 查询/同步，Chrome/CDP fixture 验证 29 件同步商品可见；本轮已单独提交。真实闲鱼外部验收仍待人工执行。
- 2026-09-19 S4-VS2 商品同步 Compose 回归修复：PostgreSQL 外部商品 Upsert 补齐部分唯一索引冲突谓词，真实 19 件账号同步由 500 恢复为 200 并落库；多账号无 query 时改为要求显式选择，避免静默同步到返回 0 件的错误账号。当前 Compose 两个账号实测为 0/19 件，用户所说 29 件仍待确认目标账号与统计口径。
- 2026-09-19 当前切片：账号管理新增软删除与全局账号上下文；商品页移除重复账号选择，新增“同步闲鱼 / 刷新本地 / 发布商品”三项动作。发布入口只创建本地草稿，不调用真实闲鱼发布接口。
- 验证证据：`npm run typecheck`、`npm test`、`npm run test:products:postgres`、`npm run test:e2e:chrome`、`npm run test:e2e:chrome:products`、`npm run compose:config`、`git diff --check` 均通过。
- 范围边界：账号上下文采用认证后前端壳层的 localStorage 持久化；删除账号采用软删除，撤销 scope/credential，保留历史商品与审计记录；真实闲鱼 APP 扫码和真实发布仍未完成外部验收。
- 2026-09-19 文档切片拆分提交：`d2ba0c3`（`docs(阶段5): 拆分未完成纵向切片`）；已同步更新阶段 4 计划、阶段 5 状态矩阵、数据/API 契约、组件 owner、风险、决策和评审记录。验证：`git diff --check`、风险号唯一性与 Markdown 风险表列数检查通过；未重复执行代码 E2E（本轮仅文档变更）。
- 2026-09-19 优先级重排提交：`56b6260`（`docs(阶段5): 重排聊天工作台与凭证切片`）；已将下一批切片调整为 `S4-VS5A/B/C`、`S4-VS6A/B`、`S4-VS7A`，并同步补齐 canonical API、账号级 CredentialStore、BusinessLinkVM、clientRunRef/Idempotency-Key 和风险/评审记录。验证：`git diff --check`、新风险号唯一性、canonical 路径和状态一致性检查通过；未执行代码 E2E（本轮仅文档变更）。
- 2026-09-19 `S4-VS6A` 首链路实现：新增 `015_workspace_agent.sql`、Workspace Store/Service/受控 Runtime、canonical session/run API、raw WebSocket cursor smoke，以及 `/workspace` 前端页面和 controller。API 全量 smoke 与 Web 单测/构建通过；状态保持 `PARTIALLY_VERIFIED`，未将受控 MemoryStore/Runtime 证据冒充生产级 Worker、Pi Runtime、真实 PostgreSQL 或视觉 E2E。
- 2026-09-19 多 Agent 协作规范提交：`9e1684c`（`docs(协作): 建立多agent worktree与合并锁规则`）；登记状态回写提交为 `1b39e6c`、`b278617`，已通过人工审核并在 merge lock 内以 `e9aaf782` 合入 `master`，随后完成 worktree/分支清理登记。
