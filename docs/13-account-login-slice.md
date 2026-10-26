# S4-VS1 账号登录切片实现说明

## 2026-10-27 验证重试文案简化

按用户要求，将账号行、验证结果页的“我来重试”统一简写为“重试”，相应引导说明与原有测试定位同步。仅替换文案，不改状态机、重试处理函数、按钮禁用条件、权限或 30 秒人工期限；无需新增模块、数据库与后端集成测试。验证模块 7 个测试文件、70/70（含真实 Chrome 的 React/Provider/iframe 集成）通过，Web 类型检查及生产构建通过，应用源码与测试脚本无旧按钮文案。独立 Agent `verification_intermediate_visual_review` 只读审核 PASS，无 P0–P2；提示异常 Toast 也可能有“重试”，自动化需按账号行/验证面板/Toast 限定定位。后端/平台端到端流程未重复执行；本轮没有修改该流程。

## 2026-10-26 账号概览与商品描述输入框修订

状态：实现与全部本轮验证通过，独立数据流/视觉审核通过（含边界与反馈重试因果检查）。完成子分支验证与提交后，先本地合入 main，再推送 origin main。输入为用户账号表、当前账号卡片及商品发布描述框截图；没有额外设计稿，沿用主题、共享 Button 与现有抽屉。修前：AccountRecord 无 aiEnabled，Web 缺值默认为 false；设置页独立读取 AutoReplyAgentSettingsService；当前账号卡片误用昵称末字；操作列 wrap；发布 composer 和共享 textarea 同时提供边框/聚焦环。生产只读确认目标有 im 异常标记且 transport 仍持续 connected，不能仅改 unknown 文案后保留误导。

目标与模块：HTTP账号presenter仅投影自动回复boolean/null、独立消息连接；设置默认值与保存结果由同一服务负责，不另存开关或暴露提示词。独立纯连接投影供HTTP与Memory过滤使用，固定SQL表达式对应PostgreSQL过滤；保留风险/授权优先级与15秒心跳阈值。Web表移除凭证引用，账号状态说明功能异常原因，消息列明确连接对象；操作当前/切换/授权/删除和验证入口同排，窄屏在表内横向滚动。当前卡片显示完整账号身份与同一状态；发布composer只保留外框及focus/invalid提示，不改其他输入控件。

边界与门禁：开关默认真/假、保存后往返设置/账号页、跨账号/管理员隔离、删除中墓碑不拖垮整页、配置读取错误不伪报关闭；消息心跳新鲜/刚好过期/未来、pending/disconnected/degraded及风险/过期/停用优先级、Memory/PG筛选与DTO一致；当前账号不在搜索结果、长名、四按钮、桌面/窄屏；描述框普通/hover/focus/invalid/disabled与其他textarea不受影响。先补修前失败回归，执行Node/Vitest/构建、真实React→HTTP→隔离PG设置持久化与页面往返、真实Chrome几何/边框与IAB核对，独立数据流和视觉审核后才提交。失败尝试、风险与独审在本节追加。无迁移/生产数据修改；回滚本次原子提交。只提交本轮源码/测试/本现有文档，遵循子分支提交→本地合main→push，不提交截图/调试/凭证。

### 本轮实现与证据

- `account-overview.ts` 为列表与详情添加自动回复投影。设置服务增加同权限的批量开关查询，PostgreSQL 只读 ID/has_config/enabled，不加载提示词，不产生每账号一次的 N+1；有权限且未配置时沿用同一服务默认值，保存的 false 不被默认值覆盖，无权限/删除中返回 null，读取失败不伪报关闭。
- `account-connection.ts` 统一详情、连接接口与 Memory 筛选；固定 SQL 表达式用于 PG 筛选。账号功能异常和消息连接独立：新鲜心跳可以是“部分功能异常 / 消息已连接”，不清除领域风险或异常来源。安全验证、授权过期、停用优先；15 秒阈值严格比较，未来/非法时间不能当在线。说明仅映射已知来源，未知来源显示原因未记录，不回显诊断值或凭证。
- 表格改为六列，移除凭证引用；当前/切换、授权、删除及验证入口最多四按钮单行。完整昵称显示在当前账号卡片，表格长名省略且可查看 title；筛选其他账号不会改变当前账号身份。390px 窄屏改页面纵向滚动、表内横向滚动，按钮可滚入视口。
- 描述框删除局部 textarea 内框及自身焦点环；外层保留 1px 边框、聚焦蓝环、错误红框及 ARIA 错误关联。共享 textarea 的其他使用位置保持自身边框。

### 成功与失败记录（均保留，不把失败当通过）

| 尝试 | 观察与处理 | 复验 |
| --- | --- | --- |
| 设置默认值测试初次 | 配置解析还读取 process.env；只改传入 env 不能覆盖该默认值。修正隔离测试环境的设置/恢复，没有修改生产默认配置逻辑。 | true/false 默认值与保存后 GET 设置、列表、详情一致。 |
| Chrome 初次搜索 | SearchField 的实际 role 是 searchbox，旧 textbox 定位失败。修正测试定位。 | 真实搜索可操作。 |
| Chrome 搜索第二次 | 真实 PG 返回 UUID ILIKE 类型错误，发现既有 `a.id ILIKE` 缺陷。修为 `a.id::text ILIKE`，仍使用参数绑定，并补 HTTP 搜索 UUID 回归。 | Memory/PG 搜索与页面筛选通过。 |
| 基础设施中断 | 用户中断后的 Docker 未运行导致 ECONNREFUSED。恢复本地原容器后重跑，不把服务未就绪算作产品成功。 | 隔离 PG 测试通过。 |
| 首轮视觉审查 | 手机 KPI 把列表挤出视口（P1）；长账号名覆盖相邻列、筛选框压缩（P2）。分别修页面滚动、账号单元宽度和移动工具栏分行。 | 新增真实几何/可达断言；独立查看新截图，问题均关闭。 |
| 风险回归旧断言 | 旧测试把 degraded 一律当 unknown，与新鲜消息心跳的独立投影冲突。仅改连接筛选预期，保留所有风险不被普通 connected 清除、仅本来源新成功恢复的断言。 | Memory/隔离 PG 风险与支付原子性回归通过。 |
| 描述框样式取样 | 焦点动画中立即读取会取得过渡值。改为等待实际动画完成再取样。 | 普通/hover/focus/invalid/窄屏均为内框 0px、内阴影 none；外框有效。 |
| 原反馈 E2E 第一次 | 密码的过期 label 定位失败。按实际可访问角色 textbox/密码修正测试。 | 后续重跑越过该步骤。 |
| 原反馈 E2E 第二次 | 恢复后正常自动刷新清除排队错误，脚本再点该 toast 时元素已移除。把“重新加载”验收放在故障仍存在时；恢复后确认列表和错误清理，而非要求过期错误一直留在页面。未改反馈业务代码。 | 最终增强版 PASS，见下方门禁。 |
| TEMP 输出迁移首次 | 原账号 E2E 在旧仓库目录已存在时提前截图，从未创建新 TEMP 目录，出现 ENOENT；将递归创建输出目录移至首张截图前。 | 补创建目录后，账号/商品/反馈三个既有 E2E 在 TEMP 输出下均 PASS。 |

### 已执行门禁与独立审核

| 门禁 | 结果与范围 |
| --- | --- |
| `npm --workspace apps/api run test:account-overview` | PASS，21/21；包括 Memory/PG、权限与过期 scope、保存 true/false/默认、批量去重/空批次、删除墓碑、读取故障、风险与支付保护。PG 风险测试从硬编码开发库改为既有 testDatabase 唯一隔离库，after 清理。 |
| SQL 与 JS 投影一致性 | PASS，210 组状态/transport/时间边界组合；只读事务固定 now 对比。 |
| `npm run test:api` | PASS，Node 分组总计 456/456，全部既有 smoke 通过。外部边界为既有受控 adapter，不代表真实闲鱼所有交易验收。 |
| `npm run test:web` | PASS，115 文件，589/589。 |
| `npm run build` / `npm run compose:config` | PASS，API/Web 类型检查与生产构建、Compose 静态配置。 |
| `npm --workspace apps/web run test:e2e:chrome:account-overview` | PASS，真实 React→HTTP/Session/CSRF→隔离 PG：设置开关保存关/开往返、切换与筛选、1440/390、四按钮 32px 同排/无溢出、长名和表格可达、描述框各态及另一公共 Cookie textarea 聚焦外框 1px。禁用 CSS 由原 DOM 设置 disabled 后取样，React prop 传递另由静态渲染断言覆盖；不是完整发布中状态 E2E。 |
| 原 Chrome 账号/商品/反馈 E2E | PASS；登录→账号搜索/切换/删除/退出，商品同步→草稿创建/详情/编辑/重载/账号切换；反馈流程通过真实重载请求（隔离 API 故障时阻塞 pageSize=20 响应，点击后观察 loading 与 500 响应）以及恢复后列表恢复/Toast 清除。修正密码输入控件定位。测试默认输出写到 TEMP，未覆盖提交仓库中的历史证据。均为本地受控测试账号。 |
| IAB 实页 | PASS；通过本地隔离 Memory API 登录，实际 DOM 显示完整名称、六列、自动回复已启用；实际输入描述后确认 textarea 边框 0px/阴影 none、外框 1px。未触发真实验证码或发布商品，结束后关闭临时标签和服务。 |
| 数据流独审 `account_overview_arch_review` | PASS，无 P0–P2；独立复跑账号 21/21、删除窗 3/3，审核批量授权、默认值、错误传播、SQL 绑定与风险隔离库；增量发现反馈测试重试可能命中旧 Toast 的 P2，补充 gate/loading/真实 500 因果断言后独审关闭。未重复浏览器或生产验收。 |
| 视觉独审 `verification_intermediate_visual_review` | PASS，无 P0–P2；实际查看最新四张桌面/手机截图与几何 JSON，关闭上述 P1/P2，确认描述框焦点/错误/禁用、公共 textarea 边界。未自行重跑浏览器。 |

原始截图、失败输出、JSON 等仅存在本机 TEMP，既有 Chrome 脚本默认输出也改至 TEMP（可用 E2E_EVIDENCE_DIR 覆盖），不提交。历史受跟踪截图被脚本写入后已先备份 TEMP，再仅还原本轮生成的截图 diff；其他历史采集文件未动。本轮没有调整验证码轨迹、30 秒人工窗口、自动回复发送策略、真实账号授权或发货逻辑，没有数据库迁移。残留风险：已记录的历史功能异常仍需对应来源成功才恢复，本轮只准确呈现；不能据 UI 修复宣称外部服务故障已修复。回滚通过 revert 本次提交、正常重新发布完成，严禁强推 main。

- 文档版本：v0.3
- 更新日期：2026-09-19
- 适用范围：阶段 5 的账号登录纵向切片（QR、Cookie、账号列表持久化与资料同步）
- 正式前端：`apps/web/`
- 视觉参考：`SellerAgent/` 与 `xianyu-admin-design-style/assets/design-tokens.json`；高保真目录不是正式前端源码目录

## 1. 切片目标

本切片把“添加闲鱼账号”从占位创建改为真实登录入口。登录成功后由服务端完成账号识别、凭证保存、登录会话落库、闲鱼资料同步，前端再通过账号列表 API 读取并展示结果。

核心不变量：

1. 不允许先创建没有有效登录态的占位账号。
2. QR 成功前允许只有临时登录会话；拿到闲鱼返回的 `unb` 后才创建或更新正式账号。
3. 昵称、备注、头像和平台用户 ID 来自闲鱼资料接口或受控 adapter，不在前端硬编码。
4. CredentialStore 只对管理员后台可见和可操作，不得进入闲鱼买家可见的消息、订单交付或外部响应。
5. `verification_required`、超时、失败和取消保持为独立状态，不得伪造为 `succeeded`。

## 2. 登录方式与路由

| 方式 | 前端入口 | 服务端路由 | 当前状态 |
| --- | --- | --- | --- |
| 管理员会话门禁 | `App` → `AuthGate` | `GET /api/v1/auth/session`、`POST /api/v1/auth/password-login`、`POST /api/v1/auth/bootstrap` | 已接入正式前端根布局；未认证、首次初始化、会话检查失败均阻断业务页面；通过同源 `/api` 访问 |
| QR 扫码 | `AccountLoginModal` → `QrLoginView` | `POST /api/v1/auth/qr-sessions`、`GET /api/v1/auth/qr-sessions/{id}`、`POST /api/v1/auth/qr-sessions/{id}/renew`、`POST /api/v1/auth/qr-sessions/{id}/cancel` | 真实二维码生成、轮询、取消和续期已接通；真实 APP 扫码成功待人工验收 |
| 已有账号重新授权 | 账号详情或连接状态入口 | `POST/GET /api/v1/accounts/{id}/login-sessions` 及其状态、取消、续期接口 | 支持账号范围校验和登录会话持久化 |
| 手动 Cookie | `CookieLoginForm` | `POST /api/v1/auth/cookie-login` | 受控 adapter、内存 smoke 和 Chrome/CDP E2E 已通过；真实外部 Cookie 验证待人工验收 |
| 账号密码 | `PasswordLoginForm` | `POST /api/v1/accounts/password-login` | 入口保留，但后端明确返回 `PASSWORD_LOGIN_UNAVAILABLE`；依赖独立浏览器运行时，不能伪造成功 |
| 账号列表 | `AccountsPage` | `GET /api/v1/accounts` | 从服务端账号记录读取，成功登录后刷新 |

QR 仍提供历史兼容字段 `id`，正式前端统一归一化为 `qrSessionId`。二维码图片由闲鱼登录接口返回的 `codeContent` 生成，不再使用模拟 SVG 图片。

## 3. 账号登录数据流

### 3.1 QR 扫码

1. 管理员在 `apps/web` 的“添加闲鱼账号”入口选择扫码。
2. 前端调用 `POST /api/v1/auth/qr-sessions`；新账号场景不传 `accountId`，服务端创建带 `provisionalAccountRef` 的临时 `AccountLoginSession`。
3. `XianyuQrLoginAdapter` 服务端调用闲鱼登录页、二维码生成和二维码状态查询接口，向前端返回真实 `qrImageDataUrl`。
4. 前端按 `pollAfterMs` 轮询状态，显示 waiting、scanned、verification_required、succeeded、expired、failed、cancelled。
5. 闲鱼确认登录后，服务端读取 `unb` 和 Cookie，创建或更新账号，保存 CredentialStore，调用资料接口同步 `displayName`、`remark`、`avatarUrl`、`platformUserId`，再把登录会话更新为 `succeeded`。
6. 前端收到成功状态后重新请求 `GET /api/v1/accounts`，页面展示数据库/Store 中的账号记录。

### 3.2 Cookie 登录

1. 管理员在 Cookie 表单粘贴完整 Cookie；前端只通过同源 API 提交，不回显 Cookie。
2. 服务端创建无正式账号 ID 的登录会话，调用闲鱼 `verifyLogin` 校验登录态。
3. 校验成功后从 Cookie 提取 `unb`，创建或更新账号，保存 Cookie 凭证，并调用资料接口获取昵称、备注、头像和平台用户 ID。
4. 服务端在同一登录流程中将登录会话更新为 `succeeded`，返回账号摘要与会话状态。
5. 前端刷新账号列表，验证账号信息来自 API，而不是表单输入或本地 mock。

### 3.3 AuthGate 与 Vite 代理

1. `apps/web/src/app/App.tsx` 只创建一个带 `credentials: 'include'` 的 HTTP transport，并同时交给 `AuthGate` 与账号 API adapter，避免认证请求和业务请求使用不同基址。
2. `AuthGate` 在渲染正式管理台前先请求 `GET /api/v1/auth/session`，按 `checking`、`bootstrap-required`、`login-required`、`error`、`authenticated` 分支渲染；未进入 `authenticated` 时不得展示账号、商品或订单页面。
3. `apps/web/vite.config.ts` 始终注册 `/api` 代理，未设置 `VITE_API_PROXY_TARGET` 时默认转发到 `http://127.0.0.1:8080`；这修复了本地开发环境中浏览器请求 `/api/v1/auth/session` 直接落到 Vite 404 的问题。
4. API 不在默认端口时，必须显式设置 `VITE_API_PROXY_TARGET` 或 `VITE_API_BASE_URL`，并在验证记录中写出实际目标地址。

## 4. 数据持久化与迁移

本轮新增迁移：

- `apps/api/migrations/011_account_profile.sql`：补充账号资料字段，包括 `remark`、`avatar_url`、`platform_user_id`。
- `apps/api/migrations/012_login_session_admin.sql`：为登录会话补充 `admin_id`、可空 `account_id`、`provisional_account_ref` 及必要索引，支持“先登录、后建账号”。

Memory store 已通过受控 smoke 验证完整链路。PostgreSQL 迁移文件与 Compose 配置已存在；当前 Docker Compose 已启动 API、Worker、PostgreSQL、Redis、MinIO，容器内 health/ready、`pg_isready` 和 Redis `PONG` 均通过，并完成账号写入、列表读取及 API 重启后的持久化复读。完整迁移回滚、Testcontainers 和发布级恢复演练仍未覆盖，不能据此宣称生产发布门禁全部关闭。

## 5. 已执行验证

根目录可复现命令：

```text
npm run typecheck
npm test
npm run build
npm run test:e2e:chrome
npm run verify
```

本轮（Vite proxy / AuthGate 增量）结果：

| 命令或检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | PASS | API 与 Web 类型检查均通过。 |
| `npm test` | PASS | API `env0 smoke passed`、`onboarding cookie login smoke passed`；Web 4 个测试文件、15 个测试通过。 |
| `npm run build` | PASS | API TypeScript 构建与 Vite production build 均通过。 |
| `npm run compose:config` | PASS | Compose 配置可解析；不代表容器已实际启动。 |
| `git diff --check` | PASS | 仅有换行格式提示，无 diff 空白错误。 |
| 默认 Vite 代理 `GET /api/v1/auth/session` | PASS | 未设置 `VITE_API_PROXY_TARGET` 时，经 Vite 代理返回 HTTP 200 canonical envelope；`data.bootstrapRequired=true`。 |
| `npm run test:e2e:chrome` | PASS | 未认证 `/accounts` 先停留在 `AuthGate` 且不渲染账号业务面；注入 bootstrap session cookie 后，账号列表、登录方式选择、无旧创建弹窗、无模拟二维码、Cookie 登录、资料回显和页面持久化结果均通过。 |
| `npm run verify` | PASS | 类型检查、API smoke、Web 4 个测试文件/15 个测试、构建、Chrome/CDP E2E、Compose 配置和 diff 检查全部通过。 |

专项实现证据：

- `apps/api/src/xianyu-qr-login.ts`：真实模式包含 h5 token 初始化、登录参数解析、真实二维码生成、轮询、取消、超时和 `verification_required` 分支；未把风控挑战改写为 `succeeded`。
- `apps/api/src/xianyu-mtop.ts`：真实 Cookie 复用、token 轮换、资料接口调用和失效/风控错误分类集中在服务端 adapter；前端不直连闲鱼平台。
- `npm --workspace apps/web run test`：账号 API adapter、AuthGate API contract、QR 状态机和 QR 视图测试通过。
- 最新 `npm run test:e2e:chrome` 已重新生成 `docs/evidence/stage5/S4-VS1/screenshots/accounts-desktop-1440x900.png`、`accounts-mobile-390x844.png`；截图来自 AuthGate 门禁通过后的已认证账号页面，但仍属于受控 harness 视觉证据，不等价于真实外部平台验收。
- 受控 harness 使用 stub adapter 和内存 store，只证明跨层请求、会话和页面状态编排，不等价于真实闲鱼 APP 扫码、外部 Cookie 验证或 PostgreSQL/Redis 持久化。

## 6. 真实环境人工复核前置条件

参考项目 `http://localhost:9000/accounts` 必须在**当前已经打开且已登录的 Chrome 浏览器**中打开。不要使用新建 Chrome profile、无痕窗口或另一台浏览器，否则参考项目持有的闲鱼登录 Cookie 不会被复用，页面会表现为未登录或要求重新授权。

人工复核顺序：

1. 在当前已登录 Chrome 中打开 `http://localhost:9000/accounts`，确认参考项目仍显示已登录账号。
2. 在同一个 Chrome 会话中保留该页面或登录态，再启动本项目正式前端 `apps/web`。
3. 用真实闲鱼 APP 扫描本项目生成的二维码，观察 waiting → scanned → succeeded 或 verification_required 的真实转移。
4. 成功后确认账号列表中的昵称、备注、头像和平台用户 ID 来自闲鱼返回值；确认登录会话与凭证记录已落库。
5. 若闲鱼返回人脸/验证码挑战，记录 `verification_required` 和 `verificationUrl`，不得手工改写为成功。

这项 Chrome 前置条件只针对参考项目的登录态复用；本项目正式实现仍由服务端 adapter 管理闲鱼 Cookie，不读取浏览器 localStorage，也不把浏览器 Cookie 直接暴露给买家。

## 7. 当前门禁结论

| 检查项 | 结论 | 说明 |
| --- | --- | --- |
| `/api` Vite 代理与本地 404 修复 | PASS | 默认目标 `http://127.0.0.1:8080` 已生效；代理请求 `GET /api/v1/auth/session` 返回 200，未认证业务读取被 API 返回 401。 |
| AuthGate 会话门禁接入 | PASS（受控 E2E） | 已挂到 `App` 根布局；未认证 `/accounts` 不渲染业务面，注入 bootstrap session cookie 后才放行账号页面。 |
| 登录方式选择与职责拆分 | PASS | `AccountLoginModal`、`LoginMethodSelector`、`CookieLoginForm`、`PasswordLoginForm`、QR 子模块职责分离 |
| 受控 Cookie 登录闭环 | PASS（受控 harness） | API/onboarding smoke 与 Chrome/CDP E2E 均通过；真实外部 Cookie 验证仍待人工复核。 |
| 真实 QR 生成与状态轮询 | PARTIAL PASS | 服务端真实模式探针通过；真实 APP 扫码成功及外部凭证落库待人工复核 |
| 真实浏览器登录态复用 | PENDING | 必须在当前已登录 Chrome 打开 `http://localhost:9000/accounts` 后执行人工验收 |
| PostgreSQL/Redis 容器持久化 | PARTIAL PASS | Compose 已启动；API/Worker/PostgreSQL/Redis/MinIO 健康，账号写入后列表读取且 API 重启后仍可复读；迁移回滚、Testcontainers 和发布级恢复仍待补证 |
| 账号密码登录 | NOT IMPLEMENTED | 后端显式返回不可用，不允许将入口误报为完成 |
