# 多 Agent 协作：Worktree、PR 与 Merge Lock

2026-11-06 起，按用户最新要求，所有变更只能通过 GitHub Pull Request（PR）合入 `main`。本规范替代此前本地合并后推送主分支的交付方式；历史登记与提交记录保留原事实。

## 1. 分支与工作区

- 每个实现 agent 使用独立 worktree 和功能分支，默认分支前缀为 `codex/`。
- 业务代码、测试、配置和正式文档均在功能分支修改；不得直接在 main 工作区开发或回写文档。
- 一个切片由一个 agent 负责写入，其他 agent 只读评审，不同时编辑同一切片。
- main 工作区用于快进同步 GitHub 已合并结果、合后验证和清理。
- 发现未登记改动时停止同步或清理，保留改动，不覆盖或强制恢复。

## 2. 登记与审核

开始修改前，在 [worktree 登记表](agent-worktree-registry.md) 记录 agent、切片、分支、路径、owner、时间、状态、合并提交与清理信息。登记本身也是功能分支变更。

交付前核对范围、适用测试、数据与权限边界、失败与回滚说明。未执行的测试、环境限制及外部未知结果必须如实记录。只改文档时核对事实、链接、命令和差异，不将文档检查称为应用端到端测试。

审核完成且交付获用户授权后，将状态更新为 `READY_FOR_MERGE`。这不代替 GitHub 配置的 PR 审核、状态检查或讨论解决要求；未满足保护规则时不得合入。

## 3. 标准交付流程

### 3.1 创建独立工作区

```powershell
git fetch origin
git worktree add <独立工作区路径> -b codex/<切片名> origin/main
```

工作区路径和分支名均需替换为实际值。不要复制其他任务的未提交修改。

### 3.2 验证与提交

在功能工作区中执行适用检查，并确认提交范围：

```powershell
git status --short
git diff --check
git add <本次文件>
git commit -m "<type>(<scope>): <中文摘要>"
git push -u origin codex/<切片名>
```

不得提交凭证、Cookie、Token、密码、私有采集档案或临时调试资料。

### 3.3 创建和合并 PR

1. 在 GitHub 创建从功能分支到 `main` 的 PR，说明问题、最终行为、验证结果和限制。
2. 将 PR 关联到当前任务，记录其 URL 与 head SHA。
3. 完成审核和必要修正；修正提交推送到同一功能分支。
4. 确认 PR head 仍是已验证版本，满足当前保护规则，再通过 GitHub 合并。
5. 记录 GitHub 返回的 merge commit 和 PR URL。不得用本地 merge 后 push main 代替。

API 合并应携带预期 head SHA，避免未审核的新提交被一并合入。冲突在功能分支解决、复验并推送，再更新 PR；不得降低保护或强推 main。

### 3.4 同步与合后验证

在确认干净的本地 main 工作区执行：

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git status --short
git diff --check
```

核对本地提交与 GitHub 合并结果，执行受影响的合后检查。登记回写、修复和回滚也必须另走功能分支 PR，不得直接提交并推送 main。生产部署继续从 `origin/main` 获取同一 SHA，经既有 Actions 和统一脚本执行。

## 4. 全局 Merge Lock

Merge Lock 仅协调共享同一 Git common dir 的本地 agent，不能代替 GitHub 分支保护，也不能阻止其他设备提交 PR。GitHub 负责 main 合入规则及提交一致性。

### 4.1 位置与归属

```powershell
$gitCommonDir = (git rev-parse --git-common-dir).Trim()
$lockDir = Join-Path $gitCommonDir "agent-merge.lock"
New-Item -ItemType Directory -Path $lockDir
```

用原子目录创建竞争锁。已有锁时读取 owner 并等待，不得仅因超时删除。锁内记录 `agent_id`、`branch`、`worktree`、`acquired_at` 和 `pid`。

### 4.2 锁内操作

1. 核对待合入 PR、预期 head SHA、审核与验证证据。
2. 通过 GitHub 合并 PR；保护规则拒绝时修正原因，不使用管理员绕过。
3. 在干净的本地 main 工作区快进同步并执行合后验证。
4. 保存合并 SHA、PR URL 和结果；需要修改登记文档时通过后续 PR。
5. 只释放自己持有的锁，使用 `try/finally` 或等价机制处理异常。

stale lock 只能在确认原进程、任务及合并均已结束后恢复，并记录原 owner、依据、时间与执行人。

## 5. 状态与清理

```text
REGISTERED → IN_PROGRESS → READY_FOR_REVIEW → READY_FOR_MERGE
           → MERGING → MERGED → CLEANED
```

未通过验证、权限不足或 GitHub 门禁未满足时，记录阻塞原因，不伪造成功状态。保留必要现场及其他 agent 的工作。

确认 PR 已合入、验证通过、worktree 干净且无在用服务后，才清理分支和 worktree。应用管理的 worktree 优先使用归档工具保留可恢复快照。未合并或仍由负责人使用的工作区不得删除。

## 6. main 保护与版本标签

- main 必须通过 PR 合入；禁止直接推送、强推和删除，管理员同样适用。
- 不通过本地改写 main、临时关闭保护或管理员绕过完成交付。
- 当前 PR 门禁以 GitHub 实际配置为准，不声称存在未配置的审核人数或状态检查。
- 正式 tag 指向 main 中已合并且完成适用验证的提交；使用带说明的 Git tag。
- 回滚通过 revert PR 完成，不删除历史或强推 main；外部副作用另按业务补偿方案处理。
