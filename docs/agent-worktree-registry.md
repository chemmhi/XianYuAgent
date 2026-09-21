# Agent Worktree 登记表

- 生效日期：2026-09-19
- 维护责任：持有 merge lock 的主 agent 负责在合并区间内更新
- 规范来源：[`docs/15-multi-agent-collaboration.md`](./15-multi-agent-collaboration.md)

## 字段定义

| 字段 | 说明 |
| --- | --- |
| `agent_id` | 稳定的 agent 名称或编号，不能在同一任务中重复 |
| `slice_id` | 唯一任务切片编号 |
| `branch` | Git 分支名 |
| `worktree` | worktree 绝对路径 |
| `owner` | 负责人或委派主体 |
| `created_at` | 创建时间，含时区 |
| `status` | `PLANNED` / `REGISTERED` / `READY_FOR_REVIEW` / `READY_FOR_MERGE` / `MERGING` / `MERGED` / `CLEANED` / `BLOCKED` |
| `merge_commit` | 合并提交哈希；未合并填写 `-` |
| `cleaned_at` | worktree 清理时间；未清理填写 `-` |
| `notes` | 审核、阻塞、环境、冲突、回滚或其他说明 |

## 当前登记

| agent_id | slice_id | branch | worktree | owner | created_at | status | merge_commit | cleaned_at | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `root` | `s4-vs-dashboard-hifi` | `codex/dashboard-hifi` | `F:\ChenHai\Project\XianYuAgent-dashboard-hifi` | Codex `/root` | `2026-09-20 00:00:00 +08:00` | `MERGED` | `ba925a3` | `-` | 仪表盘高保真前端、Dashboard snapshot API、PostgreSQL/Redis 聚合复读与真实 Chrome/CDP/闲鱼全链路已合入 master；状态保持 `PARTIALLY_VERIFIED`，全状态视觉签核与 rollback 仍开放。 |
| `root` | `dashboard-live-default` | `fix/dashboard-live-default` | `F:\ChenHai\Project\XianYuAgent-dashboard-live-default` | Codex `/root` | `2026-09-20 00:00:00 +08:00` | `MERGED` | `6522286` | `-` | 修复 Dashboard 未设置 `VITE_DASHBOARD_MODE` 时错误回退 mock；默认继承 `VITE_API_MODE=live`，显式 mock 覆盖保留。Web typecheck/test/build、mock E2E 与默认 live fullchain 已通过。 |
| `root/integration_audit` | `integration-e2e-audit` | `codex/integration-e2e-audit` | `F:\ChenHai\Project\XianYuAgent-integration-e2e-audit` | Codex `/root` delegated agent | `2026-09-20 23:30:00 +08:00` | `MERGED` | `ba925a3` | `-` | `374b3ef` 修复订单 MTOP 权限头；`555070d` 补充严格全链路、显式共享库写入保护、会话回收和双 viewport 证据；真实订单 5 条读取并落库复读成功。 |
| `root` | `s4-vs6a-workspace-e2e` | `fix/s4-vs6a-workspace-e2e` | `F:\ChenHai\Project\XianYuAgent-e2e-workspace-fix` | Codex `/root` | `2026-09-20 10:55:00 +08:00` | `CLEANED` | `c8c2e60` | `2026-09-20 11:03:00 +08:00` | 连续消息线程中文文案、真实 Chrome E2E selector/断言与桌面/移动截图已合入 master；真实 PostgreSQL/API/Vite/Chrome 验收通过。Git worktree 与分支已清理，同名目录含非 Git 内容，未删除。 |
| `root` | `s4-vs6a-pi` | `feature/s4-vs6a-pi-env` | `F:\ChenHai\Project\XianYuAgent-s4-vs6a-pi` | Codex `/root` | `2026-09-20 10:20:00 +08:00` | `CLEANED` | `e7d2a681` | `2026-09-20 10:52:00 +08:00` | Git worktree 与 feature 分支已清理；同名目录仍含非 Git 内容，未删除。Pi/env runtime、Workspace 消息流与 ChatGPT 风格连续两栏 UI 已合入 master；真实 `.env` provider、API/Web 回归与构建均通过；结论仍为 `PARTIALLY_VERIFIED` |
| `root` | `s4-vs6a-workspace` | `feature/s4-vs6a-workspace` | `F:\ChenHai\Project\XianYuAgent-s4-vs6a-workspace` | Codex `/root` | `2026-09-19 04:19:53 +08:00` | `MERGED` | `99649cd` | `-` | Workspace AgentSession/Run/Step 首链路、真实 PostgreSQL/Chrome/CDP/WS 复核已完成并合入 master；当前结论 `PARTIALLY_VERIFIED`，Confirmation/Outbox、独立 Worker/Pi Runtime、发布级恢复和人工视觉签核留在后续门禁 |
| `root/workspace_ux_fix` | `s4-vs6a-workspace-ux` | `feature/s4-vs6a-workspace-ux` | `F:\ChenHai\Project\XianYuAgent-workspace-ux` | Codex `/root` | `2026-09-20 11:20:00 +08:00` | `CLEANED` | `833eb69` | `2026-09-20 11:30:34 +08:00` | 自动标题、历史消息回读、连续消息聚合、对话区居中限宽与真实 Pi Chrome E2E 已合入 master；Git worktree 元数据已 prune，目录因含非 Git 内容未删除；保持 `PARTIALLY_VERIFIED` |
| `root` | `s4-vs5a-chat-read` | `feature/s4-vs5a-chat-read` | `F:\ChenHai\Project\XianYuAgent-s4-vs5a-chat-read` | Codex `/root` | `2026-09-19 00:00:00 +08:00` | `CLEANED` | `a13b68f` | `2026-09-20 10:25:17 +08:00` | VS5A worktree/branch 已清理并合入 `master`；真实 Redis/Postgres/Chrome/CDP 证据已归档，首片保持 `PARTIALLY_VERIFIED` |
| `root` | `s4-vs5a-chat-session-ui` | `feature/s4-vs5a-chat-session-ui` | `F:\ChenHai\Project\XianYuAgent-s4-vs5a-chat-session-ui` | Codex `/root` | `2026-09-20 00:00:00 +08:00` | `CLEANED` | `1efaecf` | `2026-09-20 12:36:30 +08:00` | 在线聊天会话列表适配已在 merge lock 内以 `--no-ff` 合入 `master`；主线 typecheck、全量测试、构建和 diff 检查通过，临时 worktree/分支已清理。 |
| `root` | `remove-page-chrome` | `feature/remove-page-chrome` | `F:\ChenHai\Project\XianYuAgent-remove-page-chrome` | Codex `/root` | `2026-09-20 00:00:00 +08:00` | `CLEANED` | `b38fafd` | `2026-09-20 17:34:00 +08:00` | 页面顶部清理已合入 master；消息页高度适配已补充于 `795ee39`。Git worktree 与分支已清理，目录因含非 Git 内容保留。 |
| - | - | - | - | - | - | - | - | - | 主工作区 `master` 受保护；活动 agent 见上表 |

| `root` | `products-pagination` | `fix/products-pagination` | `F:\ChenHai\Project\XianYuAgent-products-pagination` | Codex `/root` | `2026-09-20 00:00:00 +08:00` | `CLEANED` | `3219f85f10cc151dd2761afa066a2ee60be8580f` | `2026-09-20 18:04:00 +08:00` | 已在 merge lock 内合入并完成主线 typecheck、Web 79 项测试、构建与商品 Chrome E2E；API smoke 仍受 127.0.0.1:18872 端口占用阻塞。Git worktree 元数据与分支已清理，目录因含非 Git 内容保留。 |
| `root` | `products-columns` | `fix/products-columns` | `F:\ChenHai\Project\XianYuAgent-products-columns` | Codex `/root` | `2026-09-20 18:38:05 +08:00` | `CLEANED` | `19763b8e543e986d0d6b691f1a4d344a1f9f3eaf` | `2026-09-20 18:48:19 +08:00` | 六列表格、闲鱼创建/更新时间排序与关联卡券展示；双端类型检查、单测、构建与商品 Chrome E2E 已通过。Git worktree 元数据与分支已清理，目录因含非 Git 内容保留。 |
| `root` | `coupons-toolbar` | `fix/coupons-toolbar` | `F:\ChenHai\Project\XianYuAgent-coupons-toolbar` | Codex `/root` | `2026-09-20 18:51:55 +08:00` | `CLEANED` | `19c6798` | `2026-09-20 19:00:37 +08:00` | 用户已明确授权直接合入 master；合并后 master typecheck、Vitest、前后端 build、Chrome/CDP E2E 与 diff 检查均通过；Git worktree 元数据与分支已清理，目录因保留非 Git 内容未删除。 |
| `root` | `accounts-pagination-toolbar` | `fix/accounts-pagination-toolbar` | `F:\ChenHai\Project\XianYuAgent-accounts-pagination` | Codex `/root` | `2026-09-20 19:17:59 +08:00` | `CLEANED` | `8b7c398` | `2026-09-20 19:34:14 +08:00` | 用户已明确要求完成后合入 master；提交 `383d1c8` 在 merge lock 内以 `--no-ff` 合入。账号列表服务端分页/搜索/筛选，分页 UI、空态居中、移除操作列与共计统计、表格最大高度和内部滚动。合并后 `npm run verify` 全部通过；Git worktree 元数据与分支已清理，目录因含非 Git 内容保留。 |
| `root` | `accounts-restore-actions` | `fix/accounts-restore-actions` | `F:\ChenHai\Project\XianYuAgent-accounts-restore-actions` | Codex `/root` | `2026-09-20 20:37:00 +08:00` | `CLEANED` | `ed0f8eab97eb973175e9104df702f08569b7b152` | `2026-09-20 20:50:00 +08:00` | 恢复账号表格操作列及切换/扫码授权/删除账号操作；分页对齐商品管理三段式样式；补充账号表格回归测试与 Chrome/CDP 操作流断言。Web/API typecheck、87 项 Web 测试、全量 build、账号/卡券 Chrome/CDP E2E、Compose 配置和 diff 检查均通过；已在 merge lock 内以 `--no-ff` 合入 master。Git worktree 元数据与分支已清理，目录因非 Git junction/内容保留。 |
| `root` | `coupons-toolbar-empty-state` | `fix/coupons-toolbar-empty-state` | `F:\ChenHai\Project\XianYuAgent-coupons-toolbar-followup` | Codex `/root` | `2026-09-20 19:09:44 +08:00` | `CLEANED` | `5a9f3cb` | `2026-09-20 19:23:44 +08:00` | 用户已明确要求完成后合入 master；`5a9f3cb` 已以 `--no-ff` 合入 `master`；主线 typecheck、Vitest 23/83、Web/API build、Coupons Chrome/CDP E2E 与 `git diff --check` 均通过。Git worktree 元数据与分支已清理，目录因保留非 Git 内容未删除。 |
| `root` | `coupons-create-modal` | `feature/s4-vs4a-orders-list` | `F:\ChenHai\Project\XianYuAgent-coupons-create-modal` | Codex `/root` | `2026-09-20 00:00:00 +08:00` | `MERGED` | `8a4c509` | `-` | 新建卡券弹窗按参考项目对齐；删除对接价格输入框与是否可对接复选框，保留兼容字段；组件测试、typecheck、Web 全量测试、build 与 diff 检查通过。Chrome/CDP E2E 已验证新建弹窗字段，后续在既有绑定商品选择器处失败。 |
| `root` | `coupons-reference-exact` | `fix/coupons-reference-exact` | `F:\ChenHai\Project\XianYuAgent-coupons-exact` | Codex `/root` | `2026-09-20 21:57:30 +08:00` | `MERGED` | `cf13b32` | `-` | 按参考项目精确同步卡券类型条件字段、控件类型、默认值、帮助文案与图片上传交互；保留当前项目样式，删除对接价格与是否可对接。目标 worktree 因保留截图改动暂不清理。 |
| `root` | `coupons-reference-merge-final` | `codex/merge-coupons-reference-final` | `F:\ChenHai\Project\XianYuAgent-coupons-merge-final` | Codex `/root` | `2026-09-20 22:04:05 +08:00` | `MERGED` | `cf13b32` | `-` | 干净合并 worktree，仅用于冲突隔离与主线验证；Chrome E2E 生成的两张卡券证据截图存在并行改动，暂不强制清理。 |

| `root` | `products-empty-state` | `codex/products-empty-state` | `F:\ChenHai\Project\XianYuAgent-products-empty-state` | Codex `/root` | `2026-09-20 19:35:00 +08:00` | `MERGED` | `c641d29` | `-` | 商品管理表格空态/失败态居中展示，移除工具栏“共0件”统计；Vitest、typecheck、Web/API build、商品 Chrome/CDP E2E（含空态/失败态布局）与 diff 检查已通过。 |
| `root` | `orders-fetch` | `fix/orders-fetch` | `F:\ChenHai\Project\XianYuAgent-orders-fix` | Codex `/root` | `2026-09-20 21:45:00 +08:00` | `MERGED` | `3c21d46` | `-` | 已补完整 Cookie snapshot、按域/路径分离 MTOP signing/request Cookie、QR 登录快照持久化、Set-Cookie 旋转回写与旧扁平 header 回退；已以 `--no-ff` 合入 `master`。API 全量 smoke、Web Vitest、typecheck/build、订单 Chrome/CDP E2E、diff check 均通过；真实外部闲鱼订单验证仍需有效账号 Cookie 快照。 |
| `root` | `orders-display-fields` | `fix/orders-display-fields` | `F:\ChenHai\Project\XianYuAgent-orders-display-fields` | Codex `/root` | `2026-09-20 23:00:00 +08:00` | `CLEANED` | `490e145` | `2026-09-20 23:47:00 +08:00` | 独立复核通过；提交 `d403e75`、`465f723` 已在 merge lock 内以 `--no-ff` 合入 `master`。订单列表从本地会话/商品表聚合昵称、头像和商品名称；列表移除 buyerId/itemId，保留昵称 hover 姓名、真实头像/空圆占位；搜索只按订单号、昵称、商品名称；保留详情抽屉、分页与屏幕高度自适应。主线 typecheck、全量测试、build、迁移、PostgreSQL smoke、Chrome/CDP E2E、Compose 配置和 diff check 均通过。Git worktree 元数据与分支已清理，目录因保留非 Git 证据内容而保留。 |
| `root` | `orders-ui` | `fix/orders-ui` | `F:\ChenHai\Project\XianYuAgent-orders-ui` | Codex `/root` | `2026-09-20 23:00:00 +08:00` | `CLEANED` | `8ad36cd` | `2026-09-20 23:59:00 +08:00` | 订单列表界面修订已在 merge lock 内以 `--no-ff` 合入 `master`：移除页面标题，筛选区收敛为关键词搜索 + 单状态筛选，保留操作列、查看详情按钮和详情抽屉，新增买家姓名悬浮提示、表格内部滚动与分页；Web/API typecheck、全量测试、build、Compose 配置、Chrome/CDP 订单 E2E 和 diff check 均通过。详情抽屉内容及真实 seller 权限问题留待后续复核；Git worktree 元数据、分支与残留目录已清理。 |
| `root` | `settings-feature-slice` | `feature/settings-feature-slice` | `F:\ChenHai\Project\XianYuAgent-settings-feature-slice` | Codex `/root` | `2026-09-20 20:45:00 +08:00` | `CLEANED` | `6d99306` | `2026-09-20 21:52:18 +08:00` | Settings API Key 首片已合入 `master`；已通过 typecheck、API/Web 测试、构建、Chrome/CDP E2E、隔离 PostgreSQL 018 密文复读、Compose 配置和 diff 检查；发布级 rollback、旧明文凭证兼容迁移仍开放。Git worktree 元数据与分支已清理，残留非 Git 内容已移至 `F:\ChenHai\Project\XianYuAgent-settings-feature-slice.cleaned-20260920`。 |
| `root` | `settings-route-restore` | `fix/settings-route-restore` | `F:\ChenHai\Project\XianYuAgent-settings-route-fix` | Codex `/root` | `2026-09-20 23:59:00 +08:00` | `CLEANED` | `397e437` | `2026-09-20 00:35:00 +08:00` | 独立复审通过；已在 merge lock 内以 `--no-ff` 合入 `master`；主线 typecheck、Web Vitest、build 与 Settings Chrome/CDP E2E 均通过；worktree 与分支已清理。 |
| `root/prototype_audit` | `settings-docs-evidence` | `docs/settings-slice-evidence` | `F:\ChenHai\Project\XianYuAgent-settings-docs` | Codex `/root` | `2026-09-20 20:59:57 +08:00` | `READY_FOR_REVIEW` | `-` | `-` | 已同步 STATUS、stage5 progress、review log、risk register 与 migrations README；已完成 API/Web 定向验证，真实 PostgreSQL/视觉/独立三轮评审仍开放。 |
| `root/csrf_send_fix` | `chat-csrf-recovery` | `codex/csrf-send-fix` | `F:\ChenHai\Project\XianYuAgent-csrf-send-fix` | Codex `/root` delegated agent | `2026-09-21 10:35:00 +08:00` | `MERGED` | `91b0e87` | `-` | 修复 API 重启后前端旧 CSRF token 导致在线聊天发送 403：刷新 `/api/v1/auth/session` 后仅重试一次并保留幂等键；Web 回归测试通过。 |
| `root/listener_ready` | `auto-reply-buyer-identity` | `codex/listener-allowlist` | `F:\ChenHai\Project\XianYuAgent-listener-allowlist` | Codex `/root` delegated agent | `2026-09-21 10:43:00 +08:00` | `MERGED` | `e86af0f` | `-` | 修复真实 push 缺少 senderName 且本地会话无昵称时白名单误跳过：按稳定 externalConversationRef 补全闲鱼买家身份并持久化；新增回归测试通过。 |
| `root/listener_ready` | `auto-reply-push-history-race` | `codex/push-history-race` | `F:\ChenHai\Project\XianYuAgent-push-race` | Codex `/root` delegated agent | `2026-09-21 10:55:00 +08:00` | `MERGED` | `bb1e47e` | `-` | 修复历史同步先落库后真实 push 被重复判定而跳过自动回复；push 即使 `created=false` 也进入幂等 `AutoReplyService.processInbound`，新增重复 push 不重复出站回归。 |
| `root/listener_ready` | `auto-reply-smoke-race` | `codex/auto-reply-smoke-race` | `F:\ChenHai\Project\XianYuAgent-auto-reply-smoke-race` | Codex `/root` delegated agent | `2026-09-21 10:59:00 +08:00` | `MERGED` | `b59f026` | `-` | 更新自动回复 smoke 断言以匹配新的幂等语义：重复 push 返回同一 run、AI 出站保持单条、无真实发送；完整 API/Web 测试、构建和 Compose 配置通过。 |
| `root` | `message-dedupe-fix` | `fix/message-dedupe` | `F:\ChenHai\Project\XianYuAgent-message-dedupe-fix` | Codex `/root` | `2026-09-21 12:00:00 +08:00` | `CLEANED` | `1b459a4` | `2026-09-21 11:45:00 +08:00` | 统一历史同步与实时 push 的规范消息号，补 parser、历史导入和原始 push 幂等回归；独立根因/UI 复核通过，定向与全量测试通过；worktree 与分支已清理。 |
| `root` | `auto-reply-ai` | `feat/auto-reply-ai` | `F:\ChenHai\Project\XianYuAgent-auto-reply-ai` | Codex `/root` | `2026-09-21 12:10:00 +08:00` | `MERGED` | `baf7e4d78327d52ba11fe8c73fd40cf8b13836d1` | `-` | 独立复审通过并在 merge lock 内合入；master 上模型单测 18/18、自动回复 E2E 1/1、API 全量 19/19、Web 39/39、构建、Compose 配置和 diff check 均通过。 |

## 主工作区

| 类型 | branch | worktree | 规则 |
| --- | --- | --- | --- |
| 受保护主工作区 | `master` | `F:\ChenHai\Project\XianYuAgent` | 不登记为 agent 开发 worktree；只允许锁内合并、验证、登记回写和清理 |

## 历史登记

| agent_id | slice_id | branch | worktree | owner | created_at | status | merge_commit | cleaned_at | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `root` | `docs-multi-agent-collaboration` | `docs/multi-agent-collaboration` | `F:\ChenHai\Project\XianYuAgent-multi-agent-docs` | Codex `/root` | `2026-09-19 00:00:00 +08:00` | `CLEANED` | `e9aaf782` | `2026-09-19 04:15:00 +08:00` | 分支提交 `b278617` 已在全局 merge lock 内以 `--no-ff` 合入 `master`；worktree 已删除，分支已删除 |
| `root` | `coupons-modal-polish` | `fix/coupons-modal-polish` | `F:\ChenHai\Project\XianYuAgent-coupons-modal-polish` | Codex `/root` | `2026-09-21 11:02:19 +08:00` | `READY_FOR_MERGE` | `-` | `-` | master 已恢复干净；独立 review 无阻塞问题；feature 提交 `5e7f19c` 待在 merge lock 内以 `--no-ff` 合入 |

## 登记维护规则

1. 创建 worktree 后立即新增一行，至少填完 `agent_id`、`slice_id`、`branch`、`worktree`、`owner`、`created_at` 和 `REGISTERED`。
2. 开始写入代码或文档后改为 `READY_FOR_REVIEW`。
3. 人工审核通过后改为 `READY_FOR_MERGE`；未通过保持 `READY_FOR_REVIEW` 或改为 `BLOCKED`。
4. 只有持有 merge lock 的 agent 能写入 `MERGING`、`MERGED`、`CLEANED`、`merge_commit` 和 `cleaned_at`。
5. 每次更新登记表后运行 `git worktree list --porcelain`，确保表格与 Git 实际状态一致。
