# 多 Agent 协作与 Worktree / Merge Lock 规范

- 生效日期：2026-09-19
- 适用范围：本仓库所有 AI agent、人工协作者、子 agent、自动化合并流程
- 规范状态：强制执行
- 登记文件：[`docs/agent-worktree-registry.md`](./agent-worktree-registry.md)

## 1. 协作目标

本规范用于保证多个 agent 并行开发时：

1. 每个 agent 的代码、测试和文档修改位于独立 worktree，不污染主工作区。
2. 每个任务切片有唯一负责人、分支、worktree 和状态，能够审计、复现和回滚。
3. 合并到 `master` 时只有一个 agent 能够修改主工作区，避免并行 merge、冲突和状态覆盖。
4. 合并、验证、登记回写和清理形成完整闭环，未经过人工审核的切片不得合入。

## 2. 强制规则

### 2.1 独立 worktree

- 任何 agent 开始写代码、测试、迁移、配置或交付文档前，必须拥有独立 worktree 和独立 feature 分支。
- 禁止 agent 直接在 `master` 主 worktree 编码或提交。
- 主 worktree 只允许执行：获取 merge lock、合并、合并后验证、更新登记/状态文档、发布门禁和清理。
- 一个纵向切片只能由一个 agent 负责写入；其他 agent 只能通过评审、复现和意见记录参与。
- agent 被中断或失败时，必须保留其 worktree 和登记状态，不得用 `git reset --hard` 覆盖其未交付修改。

### 2.2 登记义务

agent 开始任务前必须在 [`docs/agent-worktree-registry.md`](./agent-worktree-registry.md) 登记：

- `agent_id`：稳定的 agent 名称或编号
- `slice_id`：唯一任务切片
- `branch`：Git 分支名
- `worktree`：绝对路径
- `owner`：负责人
- `created_at`：创建时间，使用 `YYYY-MM-DD HH:mm:ss` 和时区
- `status`：登记状态
- `merge_commit`：合并提交，未合并时填写 `-`
- `cleaned_at`：清理时间，未清理时填写 `-`
- `notes`：阻塞、评审、环境或回滚说明

登记写入后才能进入 `IN_PROGRESS`。状态变化必须与代码实际状态一致，不得预先填写 `MERGED` 或 `PASS`。

### 2.3 主工作区保护

- `master` worktree 视为受保护工作区，禁止直接修改业务代码。
- 主工作区出现未登记修改时，合并流程必须停止并报告，不能覆盖、隐藏或强制清理。
- 评审、测试和合并应尽量在 agent worktree 先完成；主工作区只执行合并后的最终验证。

## 3. 标准流程

### 3.1 创建 worktree

在主工作区执行以下命令创建独立 worktree：

```powershell
git fetch --all --prune
$sliceId = "s4-vs5a-chat-read"
$worktree = "F:\ChenHai\Project\XianYuAgent-$sliceId"
$branch = "feature/$sliceId"
git worktree add $worktree -b $branch master
git worktree list --porcelain
```

创建后立即写入登记表，确认 `branch`、`worktree`、`created_at` 与 `git worktree list --porcelain` 一致。

### 3.2 开始开发

agent 必须在自己的 worktree 执行：

```powershell
git status --short
git branch --show-current
git diff --check
```

随后按切片卡片执行需求、测试、文档、证据和回滚设计。完成实现后状态只能先改为 `READY_FOR_REVIEW`，不能直接改为 `MERGED`。

### 3.3 人工审核

审核至少确认：

1. 目标行为、输入输出、边界和禁止范围符合切片契约。
2. 受影响测试真实执行，不能只做 API 200、页面可打开或 smoke。
3. 对前端切片完成真实浏览器、持久化和视觉证据复核（适用时）。
4. 风险、评审问题、STATUS 和决策记录已同步。
5. 明确回滚提交、数据库迁移回滚和外部副作用回滚路径。

审核通过后，审核人将登记状态改为 `READY_FOR_MERGE`，并在 review log 留下可追溯结论。未通过时保持 `READY_FOR_REVIEW` 或改为 `BLOCKED`。

## 4. 全局 merge lock

### 4.1 锁位置与原子创建

merge lock 必须位于所有 worktree 共享的 Git common dir，不得放在某个 worktree 内：

```powershell
$gitCommonDir = (git rev-parse --git-common-dir).Trim()
$lockDir = Join-Path $gitCommonDir "agent-merge.lock"
New-Item -ItemType Directory -Path $lockDir
```

`New-Item -ItemType Directory` 的原子创建结果是锁竞争判定依据：

- 创建成功：当前 agent 获得锁。
- 目录已存在：其他 agent 持有锁，当前 agent 必须等待，不得继续 merge。

锁目录内必须写入 `owner.json` 或等价文本，至少包含：

```json
{
  "agent_id": "root",
  "branch": "docs/multi-agent-collaboration",
  "worktree": "F:\\ChenHai\\Project\\XianYuAgent-multi-agent-docs",
  "acquired_at": "2026-09-19 00:00:00 +08:00",
  "pid": 0
}
```

真实流程中 `acquired_at` 与 `pid` 必须使用当前值；示例中的 `pid: 0` 仅表示字段格式。

### 4.2 获取、使用和释放

获取锁后必须在同一锁区间完成：

1. 检查主工作区 `git status --short`，确认没有未登记修改。
2. 检查待合并分支、审核状态和切片证据。
3. 执行 `git diff --check` 及适用测试。
4. 在主 worktree 执行 `git merge --no-ff <branch>`。
5. 执行合并后验证，并更新 `STATUS.md`、review log、risk register、decision log 和登记表。
6. 记录 merge commit hash、验证命令和结果。
7. 只有上述步骤完成后才释放锁。

推荐使用 `try/finally` 或等价的清理流程，确保正常完成和异常退出时都尝试释放锁。释放动作只能删除当前 agent 自己持有的锁。

### 4.3 stale lock 恢复

- 发现锁存在时，先读取 owner 信息并联系/确认持有者状态。
- 不能仅因等待超时就强制删除锁。
- 只有确认进程已退出、worktree 无人在执行 merge，且登记记录没有正在进行的合并时，才能人工执行 stale lock recovery。
- 恢复动作必须记录：原 owner、确认依据、恢复时间、执行人和后续验证。
- 恢复后重新获取锁，不能直接沿用旧 owner 信息。

## 5. 合并与清理

合并完成后，主 agent 必须：

```powershell
git status --short
git diff --check
git worktree list --porcelain
```

然后更新登记表：

1. `status` 改为 `MERGED`。
2. 写入 `merge_commit`。
3. 完成验证和人工审核记录后，将 worktree 状态改为 `CLEANED`。
4. 执行 `git worktree remove <worktree>`。
5. 删除已合并分支：`git branch -d <branch>`。
6. 写入 `cleaned_at`。

未合并、`IN_PROGRESS`、`READY_FOR_REVIEW` 或 `BLOCKED` 的 worktree 不得删除。删除 worktree 前必须确认未遗留未提交修改；如需保留现场，应先转存补丁或明确由负责人继续持有。

## 6. 状态机

```text
PLANNED
  -> REGISTERED
  -> IN_PROGRESS
  -> READY_FOR_REVIEW
  -> READY_FOR_MERGE
  -> MERGING
  -> MERGED
  -> CLEANED
```

异常分支：

- `IN_PROGRESS -> BLOCKED`：环境、依赖、权限或关键设计无法继续。
- `READY_FOR_REVIEW -> IN_PROGRESS`：审核发现问题，需要修复。
- `READY_FOR_MERGE -> BLOCKED`：合并前门禁失败或主工作区不干净。
- `MERGING -> BLOCKED`：冲突、验证失败或锁区间内异常；保留现场，禁止强行完成。

## 7. 冲突与回滚

- 冲突必须在持有 merge lock 的 agent worktree 或临时合并 worktree 中解决，不得直接覆盖另一 agent 的提交。
- 无法安全解决时，退出 merge lock，登记为 `BLOCKED`，记录冲突文件、影响范围和待决策事项。
- 合并后验证失败时优先执行可逆回滚，保留失败证据；不得通过删除测试、修改断言或强推覆盖历史来“修复”结果。
- 数据库迁移、外部 API 写入、消息发送和文件上传等不可逆副作用必须在切片文档中预先写明补偿或回滚方案。

## 8. 禁止事项

- 禁止直接在 `master` worktree 修改代码。
- 禁止多个 agent 同时编辑同一切片或共用一个 worktree。
- 禁止绕过 merge lock 直接 merge、rebase 后推送 master 或修改主工作区。
- 禁止删除未登记、未审核、`IN_PROGRESS` 或 `BLOCKED` 的 worktree。
- 禁止用 `git reset --hard`、强制推送或覆盖式复制隐藏其他 agent 改动。
- 禁止把未执行的测试、Mock、smoke、页面可打开或 API 200 描述成完整验收。

## 9. 当前启用记录

本规范于 2026-09-19 启用。本轮规范已通过人工审核并在 merge lock 内合入 `master`；当前活动 worktree 与历史清理记录详见 [`docs/agent-worktree-registry.md`](./agent-worktree-registry.md)。后续任何 agent 开始任务前，必须先创建并登记自己的 worktree。
