# 自动回复 Agent 修复 Checklist（历史兼容快照）

> 当前阶段门禁与切片卡片请以 [`../auto-replay/repair-agent/06-stage-gates.md`](../auto-replay/repair-agent/06-stage-gates.md) 和 [`../auto-replay/repair-agent/templates/vertical-slice-card.md`](../auto-replay/repair-agent/templates/vertical-slice-card.md) 为准；本文仅保留历史 checklist。

> 目标：按照依赖顺序逐项关闭 [`risk-register.md`](./risk-register.md) 中的开放风险。
> 当前阶段：`DOCUMENTED / PLAN_PENDING_REVIEW / NOT READY FOR LIVE`
> 规则：每个勾选项都必须附代码提交、测试命令、结果摘要、证据路径和回滚方式；未完成的项不能通过改状态或 UI 文案“伪关闭”。

**当前执行门禁：暂停业务代码修改，等待用户审核 [`modification-plan.md`](./modification-plan.md) 及 D-01～D-05。**

## 使用方式

- 每次只推进一个纵向切片，先更新风险登记，再改代码，再补测试和证据。
- 没有完成前置项时，不得跳到 live 发送或扩大模型权限。
- 任何设计疑问先回到 `risk-register.md` 的 D-01～D-05 讨论，不在实现中隐式拍板。
- 失败路径优先于 happy path：超时、取消、崩溃、重复投递、未知结果、越权和事实缺失都要有测试。

## Phase 0：冻结边界与决策（前置门禁）

- [ ] **CHK-0001 冻结 Intent → Policy 矩阵**
  **实现位置**：新增自动回复 policy 配置/版本化 schema；对照 `apps/api/src/auto-reply.ts` 和 `docs/agent/auto-reply/design.md`。
  **依赖**：D-01、D-02。
  **测试**：策略矩阵契约测试、价格/库存/发货/售后/投诉/跨商品边界案例。
  **验收**：每个 intent 都有 `allowed / handoff / clarify / fail` 结论、所需事实和禁止承诺；配置有 version/digest。
  **回滚**：保留旧规则作为 shadow-only fallback，live 默认关闭。

- [ ] **CHK-0002 冻结 Provider 与数据出境策略**
  **实现位置**：`apps/api/src/openai-settings.ts`、provider resolver、部署配置。
  **依赖**：D-03、D-04。
  **测试**：host allowlist、内网地址、重定向、PII 出站 contract test。
  **验收**：每个 provider 的允许 host、数据区域、是否可发送原始正文和留存周期可审计。
  **回滚**：仅允许本地/固定 provider，禁用账号级自定义 host。

- [ ] **CHK-0003 冻结 live 发布门禁与一键禁用**
  **实现位置**：runtime config、listener/orchestrator、运营开关。
  **依赖**：D-05。
  **测试**：simulate/shadow/canary/live 状态转换和 kill switch。
  **验收**：没有 Outbox、unknown 恢复和人工接管证据时，live 请求在服务端被拒绝。
  **回滚**：`enabled=false` + 停止 listener；历史 run/message/audit 保留。

- [ ] **CHK-0004 建立最小评测/观测基线**
  **实现位置**：脱敏回放集、指标/trace 摘要、失败样本归档和 runbook。
  **依赖**：D-05。
  **测试**：基线回放、shadow 指标、敏感字段扫描、告警触发。
  **验收**：在 Batch 1 开始前就能量化误回复、漏 handoff、unknown、重复发送、延迟和成本；后续每批都必须回归。
  **回滚**：关闭 shadow/模型实验开关，继续使用 simulate 和人工处理。

## Phase 1：结构化 Intent 与安全预检

- [ ] **CHK-0101 引入结构化 LLM Intent 分类器**
  **实现位置**：新建 `AutoReplyIntentClassifier` adapter；保留 `RuleBasedIntentClassifier` 作为预检/回退，不直接决定发送。
  **关联风险**：AR-INT-001、AR-INT-003。
  **测试**：schema 解析、非法输出、低置信度、多意图、上下文指代、模型超时。
  **验收**：输出包含 `intent/confidence/risk/needs*`；服务端拒绝未知 intent、越权字段和伪造高置信度。

- [ ] **CHK-0102 建立确定性安全预检**
  **实现位置**：`apps/api/src/auto-reply.ts` 前置 pipeline。
  **关联风险**：AR-INT-002、AR-MOD-002。
  **测试**：凭证索取、Prompt injection、退款/投诉、空消息、系统消息、人工模式。
  **验收**：命中硬风险时不调用工具、不调用生成模型、不产生 AI 出站消息。

- [ ] **CHK-0103 实现置信度/冲突 policy gate**
  **实现位置**：policy evaluator；将阈值与策略版本写入 run 摘要。
  **关联风险**：AR-INT-003。
  **测试**：低置信度、多 intent 冲突、事实缺失、澄清路径。
  **验收**：不满足门槛时只能 `clarify/handoff/failed`，不得走普通自动回复。

- [ ] **CHK-0104 记录 intent 评测与人工抽检基线**
  **实现位置**：`tests/fixtures/auto-reply-intents`、评测脚本和结果归档。
  **关联风险**：AR-EVAL-001。
  **测试**：可重复离线命令。
  **验收**：至少覆盖正常、口语、错别字、多意图、注入、售后、事实缺失样本；输出 precision/recall、handoff 漏放率和置信度分布。

## Phase 2：上下文、Prompt 与隐私边界

- [ ] **CHK-0201 固定结构化 Prompt schema 与 response schema**
  **实现位置**：`apps/api/src/auto-reply-agent-config.ts`、`auto-reply-agent.ts`。
  **关联风险**：AR-MOD-003。
  **测试**：JSON schema、非法 JSON、多余字段、空 segments、长字段和 wire API 双栈回归。
  **验收**：系统提示、用户模板、解析器对同一个 schema 达成一致；解析失败不发送。

- [ ] **CHK-0202 加入模板 lint 与占位符契约校验**
  **实现位置**：`apps/api/src/auto-reply-agent-settings.ts`、配置保存 API。
  **关联风险**：AR-MOD-004。
  **测试**：未知占位符、重复占位符、缺失 `{{context}}`、旧配置迁移。
  **验收**：配置保存时拒绝未知变量；运行时不允许静默透传未渲染占位符。

- [ ] **CHK-0203 建立不可信字段分层与 PII 脱敏**
  **实现位置**：`toInitialContext`、tool result serializer、provider client、audit/trace serializer。
  **关联风险**：AR-MOD-002、AR-PROV-002。
  **测试**：注入 payload、手机号/地址/订单敏感字段、日志/trace 扫描。
  **验收**：不可信字段以 data 区域传入；系统规则不受其覆盖；外部 payload 和持久化 trace 不包含禁止字段。

- [ ] **CHK-0204 Provider host allowlist 与内网阻断**
  **实现位置**：`apps/api/src/openai-settings.ts`、HTTP transport。
  **关联风险**：AR-PROV-001。
  **测试**：localhost、127.0.0.1、RFC1918、IPv6 loopback、DNS rebinding、跨 host redirect。
  **验收**：非 allowlist host 在保存和调用两层均拒绝；拒绝原因稳定且可审计。

## Phase 3：工具预算、数据匹配与事实来源

- [ ] **CHK-0301 统一 tool schema、validator 与执行上限**
  **实现位置**：`apps/api/src/auto-reply-agent-config.ts`、`auto-reply-agent.ts`。
  **关联风险**：AR-DATA-003。
  **测试**：边界值、schema 生成与 validator 快照。
  **验收**：同一常量驱动 schema、参数校验、执行和审计。

- [ ] **CHK-0302 把全表扫描改成有范围的聚合查询**
  **实现位置**：Store 查询接口、`getBuyerConversations/getBuyerOrders/listShopProducts`。
  **关联风险**：AR-DATA-002。
  **测试**：大数据量、分页、超时取消、总行数/token/wall-clock budget。
  **验收**：每轮 run 有 query budget；超限返回可解释的 partial context，不继续猜测。

- [ ] **CHK-0303 消除重名商品静默兜底**
  **实现位置**：`findProduct`、`getProductInfo`。
  **关联风险**：AR-DATA-001。
  **测试**：重名、同标题跨账号、失效 external ref、澄清/转人工。
  **验收**：无唯一商品引用时返回 `AMBIGUOUS_PRODUCT`，不得取第一条。

- [ ] **CHK-0304 为工具结果加事实 provenance 与 freshness**
  **实现位置**：tool result schema、context digest、policy validator。
  **关联风险**：AR-MOD-001、AR-DATA-001。
  **测试**：过期商品、订单状态变化、缺失字段、来源 digest。
  **验收**：回复只能引用当前账号/当前买家/当前商品范围内、未过期的事实；来源不可验证时 handoff。

## Phase 4：回复事实校验与分段安全

- [ ] **CHK-0401 建立回复事实/承诺校验器**
  **实现位置**：生成后 pipeline；新增 price/inventory/order/delivery/after-sales validators。
  **关联风险**：AR-MOD-001、AR-INT-002。
  **测试**：正确事实、冲突事实、编造数字、模糊承诺、敏感承诺。
  **验收**：任何未被事实引用支持的关键断言都阻断发送并进入 handoff/failed。

- [ ] **CHK-0402 固定 segments 上限、长度和完整性校验**
  **实现位置**：`resolveReplySegments`、reply schema。
  **关联风险**：AR-SEND-003。
  **测试**：空段、重复段、顺序错乱、超段数、超长、尾部丢失。
  **验收**：全文信息完整；段数和单段长度有硬上限；失败时不继续发送后续段。

- [ ] **CHK-0403 对高风险回复强制澄清或转人工**
  **实现位置**：policy validator 与 handoff service。
  **关联风险**：AR-INT-002、AR-CON-003。
  **测试**：售后/投诉/退款、价格谈判、交付承诺、订单争议。
  **验收**：策略矩阵中的 handoff 场景不生成 AI 出站消息，且产生可查询的人工任务。

## Phase 5：Outbox、幂等、并发与未知发送恢复

- [ ] **CHK-0501 建立 send ledger + Outbox 数据模型**
  **实现位置**：新增 migration、Store、delivery worker。
  **关联风险**：AR-SEND-001、AR-SEND-002。
  **测试**：迁移、唯一键、重启、重复 enqueue、不同 account/conversation 隔离。
  **验收**：run、reply group、segment、idempotency key 和外部 ref 可追踪；发送意图先落库再出站。

- [ ] **CHK-0502 收紧外部发送成功/失败/未知判定**
  **实现位置**：`apps/api/src/auto-reply.ts`、`apps/api/src/xianyu-im.ts`。
  **关联风险**：AR-SEND-002。
  **测试**：明确成功、业务失败、HTTP/网关失败、空 ref、超时、连接断开。
  **验收**：没有明确 external ref 的响应不得标记 `known_success`。

- [ ] **CHK-0503 实现 segment 级幂等与 partial_send/send_unknown**
  **实现位置**：Outbox worker、send ledger、状态机。
  **关联风险**：AR-SEND-003。
  **测试**：第二段失败、未知结果、worker 重启、重复执行、人工 reconcile。
  **验收**：只重试未知段；已确认段不重复发送；后续段在前段失败/未知时停止。

- [ ] **CHK-0504 实现 conversation lease/version 与发送前原子检查**
  **实现位置**：AutoReplyService、Redis/PostgreSQL lease、conversation version。
  **关联风险**：AR-CON-001。
  **测试**：双 worker、人工接管、连续 push、旧 run 发送前检查、lease 过期。
  **验收**：同一会话最多一个 active sender；人工模式或新版本消息出现后旧 run 不得出站。

- [ ] **CHK-0505 实现 stale-run reaper 与安全恢复**
  **实现位置**：worker scheduler、run lease/heartbeat、运营告警。
  **关联风险**：AR-CON-002。
  **测试**：进程 kill、网络分区、数据库重启、reaper 重复执行。
  **验收**：卡住 run 可恢复/转 unknown/handoff；不会被无限重放。

- [ ] **CHK-0506 建立 reconcile worker 与人工复核入口**
  **实现位置**：delivery reconcile、管理员 API/消息页联动。
  **关联风险**：AR-SEND-001、AR-CON-003。
  **测试**：外部已发/未发/未知、人工确认后关闭、重复 reconcile。
  **验收**：unknown/partial_send 有明确下一步，不要求人工盲目重发。

## Phase 6：状态、事件、Trace 与审计

- [ ] **CHK-0601 统一 run 状态机与页面展示语义**
  **实现位置**：领域枚举、Store mapper、`activity.md`、Agent Dynamics adapter。
  **关联风险**：AR-OBS-002。
  **测试**：raw status/decision/senderOutcome 映射、unknown/partial_send 页面回归。
  **验收**：`persisted` 不再被解释为外部已送达；展示文案和 API 枚举一致。

- [ ] **CHK-0602 收敛 run mutation 与 event append 事务**
  **实现位置**：`apps/api/src/store-postgres.ts`、MemoryStore 契约。
  **关联风险**：AR-OBS-001。
  **测试**：PostgreSQL 故障注入、事务回滚、补偿重建、事件 sequence 单调性。
  **验收**：要么状态与事件同事务，要么缺失事件可检测、可补偿并在查询中告警。

- [ ] **CHK-0603 持久化脱敏 Agent trace 与成本/延迟摘要**
  **实现位置**：`onTrace` adapter、run event payload、observability metrics。
  **关联风险**：AR-PROV-002。
  **测试**：provider/model/config digest、tool count、loop count、terminal reason、敏感字段扫描。
  **验收**：可复盘“用了什么配置/工具/耗时/结果”，但不保存 Prompt 原文、Cookie、Token 或 CoT。

- [ ] **CHK-0604 完成人工 handoff 事件、通知和恢复闭环**
  **实现位置**：handoff service、audit/event API、消息页。
  **关联风险**：AR-CON-003。
  **测试**：handoff 产生、运营领取、处理后关闭、关闭后新消息策略。
  **验收**：高风险消息不会静默丢失；管理员可看到原因、证据和下一步。

## Phase 7：测试、评测与发布门禁

- [ ] **CHK-0701 恢复可复现依赖与自动回复定向测试**
  **实现位置**：锁文件、CI/本地测试说明。
  **关联风险**：AR-EVAL-003。
  **测试**：`npm --workspace apps/api run test:auto-reply:unit` 及其集成测试。
  **验收**：明确记录依赖版本、命令、通过数、失败证据；不能用未启动的测试作为通过证据。

- [ ] **CHK-0702 建立离线回放/红队评测流水线**
  **实现位置**：脱敏 fixtures、评测脚本、结果归档。
  **关联风险**：AR-EVAL-001。
  **测试**：意图、注入、事实一致性、工具预算、长回复、未知发送模拟。
  **验收**：每次模型/Prompt/策略变更都有可比对指标和人工抽检样本。

- [ ] **CHK-0703 补齐真实 PostgreSQL、worker、网关 push 与浏览器证据**
  **实现位置**：集成/E2E harness、证据目录。
  **关联风险**：AR-SEND-001、AR-EVAL-002。
  **测试**：真实 push → run → outbox → external adapter → message/run/event 回读；覆盖 persisted、handoff、failed、send_unknown、partial_send。
  **验收**：每条路径保存命令、输入、输出、trace/request ID、截图或日志摘要；FakeSocket 只能作为补充证据。

- [ ] **CHK-0704 执行 simulate → shadow → canary → live 发布门禁**
  **实现位置**：发布配置、指标告警、kill switch、runbook。
  **关联风险**：AR-EVAL-002、D-05。
  **测试**：每级放量、自动禁用、回滚和 reconcile 演练。
  **验收**：低于误回复/漏 handoff/unknown/重复发送/延迟阈值时自动停止；live 只对批准范围开放。

- [ ] **CHK-0705 完成交付前总门禁**
  **实现位置**：仓库验证脚本和文档状态。
  **测试**：typecheck、unit、integration/contract、真实 E2E、构建、Compose smoke、`git diff --check`。
  **验收**：所有未执行项明确写出阻塞原因、影响范围和替代证据；状态只能标记 `IMPLEMENTED / VERIFIED / PARTIALLY_VERIFIED / BLOCKED`。

## 修复顺序摘要

1. 先完成 Phase 0 的 D-01～D-05 决策。
2. 先修 Phase 1～4 的“不能错误生成/不能错误承诺”，再修 Phase 5 的 live 发送闭环。
3. Phase 5 未完成前只允许 `simulate`，且 `persisted` 不得当作真实送达。
4. Phase 6 保证可审计和可恢复，Phase 7 再决定是否扩大流量。

## 每个切片的完成记录模板

```text
Slice:
Risk IDs:
Checklist IDs:
Code commit:
Migration:
Tests and exact commands:
Evidence paths:
Known limitations:
Rollback switch / procedure:
Reviewer:
Status: IMPLEMENTED | VERIFIED | PARTIALLY_VERIFIED | BLOCKED
```
