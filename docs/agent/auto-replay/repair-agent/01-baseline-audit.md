# 当前基线审计

## 已确认事实

1. apps/api/src/auto-reply.ts 当前在生成候选回复后直接发送、写出站消息、更新为 persisted 并记录审计。
2. apps/api/src/auto-reply-agent.ts 当前只有模型/工具循环和 reply|handoff 输出，没有独立的 reviewer/evaluator。
3. apps/api/src/domain.ts 当前没有 review_pending、reviewing、resolved、needs_followup、unresolved 等业务解决状态。
4. docs/agent/auto-reply/activity.md 和 Agent Dynamics 当前更接近传输/运行完成视图，容易把 persisted 误读为业务完成。
5. 规则分类器对未命中消息有 general 兜底，缺少结构化 clarify、awaiting_user 和目标恢复协议。
6. 旧设计和风险文档存在“高风险/售后默认 handoff”的旧语义，与本轮“低拒绝、低 handoff”约束不一致，必须以新 policy 文档为准并登记迁移。

## 主要缺口

| 缺口 | 影响 | 修复落点 |
| --- | --- | --- |
| 业务路由散落在规则/Prompt/分支 | 难以审计、回滚和调参 | 02-target-architecture.md、03-domain-policy-contract.md |
| 发送后没有结果审核 | 只能证明消息落库，不能证明问题解决 | 04-data-api-contract.md、AR-VS-07 |
| 信息不完整没有澄清状态 | 容易误答或过早 handoff | AR-VS-02 |
| 目标、生命周期和情绪没有统一状态 | 无法引导流程或抑制强推 | AR-VS-01、04、05 |
| 推荐资格未集中门控 | 售后/负面情绪下可能误推荐 | AR-VS-06 |
| 指标混淆传输完成与业务解决 | 运营判断失真 | AR-VS-07、08 |

## 当前已具备能力

- 入站幂等、上下文读取、只读工具和 simulate/live 基础配置；
- 商品、订单、会话分层事实读取；
- 运行记录、事件和 Agent Dynamics 查询入口；
- 发送安全预检和敏感内容拦截的基础实现；
- 独立 worktree、评审日志、风险登记和阶段门禁约束。

## 审计结论

用户关于 Observe 没有充分发挥作用的判断准确但不完整：当前 Observe 更像执行过程观察，缺少对原始目标是否解决的业务结果审核。因此修复不是删除原链路，而是在 Observe 之后增加可持久化、可重试、可审计的 Outcome Review，并将澄清、生命周期、情绪和推荐纳入同一状态/策略闭环。

## 证据边界

本文件记录的是代码和现有文档的静态基线，不把文档规划、页面可打开、HTTP 200、mock 或单次发送成功升级为业务问题已解决。真实解决率必须通过后续消息、领域事实、人工覆盖和回放集验证。
