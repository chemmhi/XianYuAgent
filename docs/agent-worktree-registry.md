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
| `status` | `PLANNED` / `REGISTERED` / `IN_PROGRESS` / `READY_FOR_REVIEW` / `READY_FOR_MERGE` / `MERGING` / `MERGED` / `CLEANED` / `BLOCKED` |
| `merge_commit` | 合并提交哈希；未合并填写 `-` |
| `cleaned_at` | worktree 清理时间；未清理填写 `-` |
| `notes` | 审核、阻塞、环境、冲突、回滚或其他说明 |

## 当前登记

| agent_id | slice_id | branch | worktree | owner | created_at | status | merge_commit | cleaned_at | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `root` | `s4-vs6a-workspace` | `feature/s4-vs6a-workspace` | `F:\ChenHai\Project\XianYuAgent-s4-vs6a-workspace` | Codex `/root` | `2026-09-19 04:19:53 +08:00` | `READY_FOR_REVIEW` | `-` | `-` | Workspace AgentSession/Run/Step 首链路、受控 Runtime、API/WS smoke、前端 Workspace 已完成；当前结论 `PARTIALLY_VERIFIED`，Confirmation/Outbox 留在 S4-VS6B，独立 Worker/Pi Runtime/真实 Postgres/浏览器证据待后续 |

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
2. 开始写入代码或文档后改为 `IN_PROGRESS`。
3. 人工审核通过后改为 `READY_FOR_MERGE`；未通过保持 `READY_FOR_REVIEW` 或改为 `BLOCKED`。
4. 只有持有 merge lock 的 agent 能写入 `MERGING`、`MERGED`、`CLEANED`、`merge_commit` 和 `cleaned_at`。
5. 每次更新登记表后运行 `git worktree list --porcelain`，确保表格与 Git 实际状态一致。
