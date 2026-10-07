# Workspace Runtime 故障证据与修复

## 生产只读证据

- 目标 Run：`38f9b119-e344-4217-8107-7ca48da95907`；查询时服务器 SHA `cd03b1e8`。通过 `ssh server-prod` 在生产 PostgreSQL 只读查询 `workspace.run_events`、`workspace.runs`、`workspace.confirmations`、`coupons.coupon_batches` 和 `coupons.coupon_bindings`；未执行生产写入。
- Run 共 2534 条事件：`reasoning.delta` 2063、`assistant.delta` 343、`stream.started` 10、`tool.result` 13、`workspace.execution.summary` 13；`context.compacted` 为 0。工具与摘要原始事件存在，但前端旧投影和原生推理增量造成展示冗余。
- 商品搜索在序号 19830 与 20556 重复；`pi_skill_exec` 在 19833、20061、20720、21064、21198 重复；卡券读取在 20559、21067 重复。确认事件 20440 后，20441 记录批次 `18` 创建成功。21692 的 `workspace_prepare_write` 返回 `coupon operation requires batchId`；21920 第二张卡的写入计划成功，随后 21926/21927 为 `RUNTIME_FAILED`。Run 当前 `failed`，确认卡总数 1 且已确认。
- 两次 `pi_skill_exec` 的 `content` 长度均为 2001 且末尾是省略号；两次 `workspace_read` 的 `data` 被序列化成长度 2001 的字符串且末尾是省略号。限长来自 `ac5f6cd` 的 `outputLimit ?? 2_000`，没有找到对应业务要求。
- 同账号的 `03 PPT Master` 展示编号 `18` 有三个历史 voided 批次和 09:43:30 创建的一个 active 批次；当前 active 批次的商品关联数为 0。原始任务仍未完成。
- `043_workspace_confirmations.sql` 的 `(run_id, step_id)` 唯一约束禁止同一 Run/Step 再建第二张确认卡，与 21920 后失败的位置吻合；生产日志未给出数据库异常原文，因此这是由事件顺序和 schema 支持的原因判断，不冒充直接错误堆栈。

## 修复边界

- 工具 `content/data`、Skill 标准输出与超级管理员商品查询返回完整数据；`pi_skill_exec` 不再把所有长参数一律当作秘密替换，公开链接可原样回传。仅上下文压缩摘要在模型预算内提取任务目标、结果和关键标识，持久化原始工具事件仍保留完整结果。
- 确认后把领域服务真实结果回交 Agent，Runtime 忙碌时排队续跑；断线重连从持久化事件恢复批次 ID 和已完成节点。模型上下文超限时压缩并重试。
- 049 迁移允许单 Run 顺序多次确认，仍保持同 Run 同时只有一张 active 卡；空更新和缺少关联商品参数在计划阶段阻断。
- 前端按事件序号展示工具调用、结果摘要及下一轮摘要，隐藏工具轮次的临时回答，不保存模型原生推理增量。

## 验证

- `npm run typecheck`、`npm run build`、`npm run test:web`：通过，Web 93 files / 373 tests。
- API 定向单测：`pi-runtime-stream.test.ts`、`workspace-context.test.ts`、`workspace-commands.test.ts`、`pi-skills.test.ts` 通过，覆盖完整工具结果、续跑竞态、413 压缩重试、结果回传和参数校验。
- `node apps/api/scripts/workspace-confirmation-postgres-smoke.mjs`：隔离 PostgreSQL 迁移 001-049、同 Run 双确认及回读通过。
- `npm run test:e2e:chrome:workspace:pi`：真实 PostgreSQL/API/Vite/Chrome/CDP 通过；模型连续 3 次请求，真实商品工具返回 2500 字符描述，UI 呈现 4 条执行摘要、1 个工具事件和最终回复。
- `npm run test:e2e:chrome:workspace`：真实 PostgreSQL/API/Vite/Chrome/CDP 重连流程通过，生成桌面及移动截图。
- `npm test` 首轮在既有 `auto-reply-smoke.mjs` 等待默认 300 秒发送延迟时中止。查明 `AUTO_REPLY_AGENT_SEND_DELAY_SECONDS` 默认值后，以 `npm exec -- cross-env AUTO_REPLY_AGENT_SEND_DELAY_SECONDS=0 npm test` 重跑全量 API/Web：通过；仅测试进程覆盖延迟，生产默认配置未改。
- `npm --workspace apps/api run test:model-client`：34/34 通过，已将新增上下文和 Skill 输出回归纳入标准 API 测试入口。
