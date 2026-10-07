# Workspace Skill 执行闭环修复计划（2026-10-07）

## 目标
修复本地 Workspace 复合任务在完成商品定位后陷入 Skill 文档检索循环、未执行实际网盘命令、最终以 `MODEL_TOOL_LOOP_EXCEEDED` 失败的问题。

## 本轮范围
1. **Skill 文档可发现性**：让 Workspace 能读取 Skill 包内 `references/*.md`，并在检索结果中返回来源文件、可执行命令和分页游标。
2. **执行状态门禁**：检索到可执行命令后停止继续搜索；连续无命中、重复语义搜索或超过检索预算时转执行、向用户请求必要输入，或明确终止。
3. **安装前置闭环**：区分“Skill 已安装但 CLI 需安装检查”和“Skill 尚未安装”；禁止把 shell 命令伪装成 `pi_skill_exec`，同时提供受控的安装检查路径。
4. **循环保护**：补充跨参数/语义级无进展检测，避免只依赖完全相同参数指纹。
5. **事件语义**：工具轮次中的模型文本不得标记为 `final_answer`；最终答复只在无工具调用且 Run 进入终态时产生。
6. **回归与真实链路**：补充 API 单测、Skill 适配集成测试、前端事件投影测试和 Workspace Chrome/CDP + PostgreSQL E2E。

## 设计约束
- 不改变现有 Confirmation、Outbox、商品搜索和卡券服务的数据边界。
- 不让模型猜测未文档化命令；所有 `pi_skill_exec` 参数必须来自可读文档或结构化 Skill 命令索引。
- 不执行真实生产写操作；E2E 使用隔离夹具和测试 PostgreSQL。
- 保留现有旧事件兼容读取能力。
- 不删除现有测试，不使用 `skip`、`.only`、弱化断言或无关重构。

## 交付切片
### Slice A：Skill 文档/命令检索契约
- `pi_skill_read` 支持受控的 `filePath`，仅允许 `SKILL.md` 或包内 `references/*.md`。
- `pi_skill_search` 支持来源文件、分页游标和命令索引结果。
- 安装检查使用明确的 manager API，不让模型传 shell 命令；setup 只能执行 manifest 显式声明且 allowlist 命中的脚本；如需验证 CLI 运行时，必须由 manifest 显式声明只读 `preflightCommand`/`preflightArgs` 探针。
- 读取/搜索返回稳定 cursor、来源文件与可验证的命令 evidence，拒绝路径穿越、超大文件和不可信绝对路径泄露。

### Slice B：Runtime 无进展状态机
- 引入 discovery/execution phase 记录。
- 同语义查询、不同参数改写、连续 No Match 和连续只读检索纳入预算。
- `pi_skill_exec` 的 `search/browse/list/get/help` 仍属于 discovery，`share`/其他非只读命令才进入 execution。
- 阶段、no-progress 预算和已见证据从历史事件恢复；新证据、登录成功或写入成功才清零。
- 获取命令证据后强制优先执行；达到预算时转 `pending_user_action` 或明确失败，并写入独立 error code/telemetry。

### Slice C：流式事件与前端投影
- 中间模型文本标记为 `assistant_progress`/`phase=draft`，只有无工具终态或持久化终态事件才是 `final_answer`。
- 只有最终无工具回复写入 `final_answer`。
- 重连和历史投影隐藏复用结果、重复摘要和中间进度。

### Slice D：回归与 E2E
- 覆盖 `search -> reference read -> pi_skill_exec`。
- 覆盖 varying-query no-progress loop。
- 覆盖安装前置状态、未登录状态和等待用户输入状态。
- 覆盖 UI 只显示真实工具结果与最终答复。
- 通过真实 Workspace API、测试数据库和 Chrome/CDP 入口验证持久化结果。
- target E2E 严格断言结构化 `commandEvidence`、`pi_skill_exec search`/`share` 各执行一次、无 `MODEL_TOOL_LOOP_EXCEEDED`，且只显示一条终态答复。

## 验收门禁
- P0/P1：本地目标 Run 的故障链有回归测试，且不再出现“38 次 Skill 搜索、0 次 Skill 执行”的行为。
- `pi_skill_search` 可获取 `references/file-share.md` 的真实命令片段，且分页可继续读取。
- Windows 路径下默认多文件检索也必须发现 `references/**/*.md`，不能只在显式 `filePath` 下成立。
- 语义无进展循环在有限轮次内停止，并返回明确原因；不得依赖第三次完全相同参数才终止。
- 工具轮次不再持久化 `messageType=final_answer` 的中间增量。
- UI 按 `phase/messageType` 投影，兼容旧 `assistant.delta`，且同一 Run 只显示一条终态答复。
- API 定向测试、Web 测试、类型检查、构建、Chrome/CDP Workspace E2E 和 `git diff --check` 真实执行并通过。
- 独立 agent 至少完成两轮审核；若有 P0-P2 问题，修复后重新测试和复审，直到明确 PASS（第一轮已 NOT PASS，下一轮必须针对 P0 逐项给出证据）。

## 回滚
- 代码通过单一中文 Conventional Commit 提交，可独立回退。
- 无数据库迁移；若发现兼容性问题，回退应用提交即可。
- 不重放历史失败 Run 的外部写操作。

## 第二轮根因修复与复审（2026-10-07）
- 第一轮真实 Run 仍在上下文压缩后丢失 `workspace_product_search` 返回的内部商品 ID，模型第三次重复搜索并触发 `MODEL_TOOL_LOOP_EXCEEDED`；独立 reviewer 第一轮结论为 NOT PASS。
- 修复 `workspace_product_search` 输出：正文显式保留 `productId`，结构化数据补充单结果顶层 `productId`，并保留 `data.items[].id`。
- 修复 Workspace checkpoint/compaction：从早期商品搜索结果提取 `productId/title/externalProductRef` 稳定事实，压缩前注入模型摘要并在重连历史中优先复用。
- 新增运行时回归：大结果触发 `context.compacted` 后直接进入 `workspace_prepare_write`，商品搜索仅执行一次、准备写入执行一次、Run 进入 `waiting_confirmation`，无 `MODEL_TOOL_LOOP_EXCEEDED`。
- 独立 reviewer 第二轮结论：PASS；API 定向测试 73/73、API TypeScript `--noEmit`、`git diff --check` 均通过。
- 真实 IAB 复测发现另一层症状：Skill 写入后模型再次选择同参商品搜索，导致缓存被清掉后第三次保护触发。补充系统规则要求已有 `productId` 直接复用，并在同一 Run 的 Skill 写入后保留 `workspace_product_search` 缓存；新增回归验证搜索只执行一次且复用结果。
- 独立 reviewer 第三轮结论：PASS；API 定向测试 74/74、API TypeScript、`git diff --check` 与 Workspace Chrome/CDP + PostgreSQL Skill E2E 均通过。

## 第四轮真实 IAB 根因修复与复审（2026-10-07）
- 真实 IAB 复测继续暴露 `pi_skill_read` 在 `share` 写入后重复调用；根因是文档读取 replay cache 与 attempts 被所有 Skill 写入无差别清空。
- 仅对非只读 `pi_skill_exec` 写入保留当前 Run 的 `workspace_product_search`、`pi_skill_read`、`pi_skill_search` 结果及重复计数；安装、授权、登录成功仍完整清空，避免旧文档/权限状态复用。
- 新增回归覆盖 `read → share → read` 缓存复用和 `read ↔ share` 交替第 5 轮停止；确认读取真实执行 1 次、分享写入执行 1/2 次、`MODEL_TOOL_LOOP_EXCEEDED` 保护仍有效。
- 独立 reviewer 最终复审：PASS；定向 63/63、扩展 102/102、TypeScript `--noEmit`、`git diff --check` 全部通过。
