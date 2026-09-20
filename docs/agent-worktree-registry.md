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
| `root` | `accounts-pagination-toolbar` | `fix/accounts-pagination-toolbar` | `F:\ChenHai\Project\XianYuAgent-accounts-pagination` | Codex `/root` | `2026-09-20 19:17:59 +08:00` | `READY_FOR_REVIEW` | `-` | `-` | 提交 `383d1c8`；账号列表服务端分页/搜索/筛选，分页 UI、空态居中、移除操作列与共计统计、表格最大高度和内部滚动。类型检查、Web 84 项测试、API 全量 smoke、双端构建、Chrome/CDP E2E 与 diff-check 已通过。 |
| `root` | `coupons-toolbar-empty-state` | `fix/coupons-toolbar-empty-state` | `F:\ChenHai\Project\XianYuAgent-coupons-toolbar-followup` | Codex `/root` | `2026-09-20 19:09:44 +08:00` | `CLEANED` | `5a9f3cb` | `2026-09-20 19:23:44 +08:00` | 用户已明确要求完成后合入 master；`5a9f3cb` 已以 `--no-ff` 合入 `master`；主线 typecheck、Vitest 23/83、Web/API build、Coupons Chrome/CDP E2E 与 `git diff --check` 均通过。Git worktree 元数据与分支已清理，目录因保留非 Git 内容未删除。 |

## 主工作区

| 类型 | branch | worktree | 规则 |
| --- | --- | --- | --- |
| 受保护主工作区 | `master` | `F:\ChenHai\Project\XianYuAgent` | 不登记为 agent 开发 worktree；只允许锁内合并、验证、登记回写和清理 |

## 历史登记

| agent_id | slice_id | branch | worktree | owner | created_at | status | merge_commit | cleaned_at | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `root` | `docs-multi-agent-collaboration` | `docs/multi-agent-collaboration` | `F:\ChenHai\Project\XianYuAgent-multi-agent-docs` | Codex `/root` | `2026-09-19 00:00:00 +08:00` | `CLEANED` | `e9aaf782` | `2026-09-19 04:15:00 +08:00` | 分支提交 `b278617` 已在全局 merge lock 内以 `--no-ff` 合入 `master`；worktree 已删除，分支已删除 |

## 登记维护规则

1. 创建 worktree 后立即新增一行，至少填完 `agent_id`、`slice_id`、`branch`、`worktree`、`owner`、`created_at` 和 `REGISTERED`。
2. 开始写入代码或文档后改为 `READY_FOR_REVIEW`。
3. 人工审核通过后改为 `READY_FOR_MERGE`；未通过保持 `READY_FOR_REVIEW` 或改为 `BLOCKED`。
4. 只有持有 merge lock 的 agent 能写入 `MERGING`、`MERGED`、`CLEANED`、`merge_commit` 和 `cleaned_at`。
5. 每次更新登记表后运行 `git worktree list --porcelain`，确保表格与 Git 实际状态一致。
