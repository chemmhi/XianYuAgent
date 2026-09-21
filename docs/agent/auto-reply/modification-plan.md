# 自动回复 Agent 修改计划（待审核）

> 状态：`APPROVED_FOR_BATCH_1_NODE_1 / REMAINING_BATCHES_PENDING_REVIEW`
> 生成日期：`2026-09-21`
> 当前分支只包含风险/计划文档，不包含业务代码修改。
> 计划审核通过后，后续每个切片仍需独立 worktree、独立提交、定向验证和回滚证据。

## 1. 当前结论

可以直接修改代码。用户已批准第 1 节点的 7 项推荐方案，因此允许开始第 1 节点实现；Intent、模型、Outbox/live 等后续节点仍按本计划分批推进，不提前放行。

第 1 节点批准范围：`inbound inbox`、解析隔离、原子幂等、同会话串行、external ref alias、时间戳质量、buyerRef/conversationRef 白名单边界。

第 1 节点完成前，仍禁止进入 Intent 节点和 live 发送。

## 2. 待你确认的决策

请逐项给出“同意默认建议 / 调整为……”：

| 决策 | 默认建议 | 不确认的后果 |
| --- | --- | --- |
| D-01 价格/库存/发货 | 只引用已验证事实；议价、库存不确定、时效承诺默认转人工 | 无法冻结 policy gate，不能安全放开模型分类后的自动回复 |
| D-02 售后/退款/投诉 | 一律转人工；Agent 不做承诺、退款或订单修改 | 无法确定高风险 intent 集合和人工 SLA |
| D-03 Provider host | 固定 allowlist，阻断 localhost/内网/IP 重定向；默认不允许账号任意自定义 host | 无法关闭 SSRF/数据驻留风险 |
| D-04 原始买家正文出站 | 默认脱敏/结构化摘要；原始正文仅在显式授权且 provider 合规时发送 | 无法冻结 Prompt/PII 边界 |
| D-05 live 开放时机 | simulate → shadow → canary → live；Outbox/unknown/reconcile/人工接管未完成前禁止 live | 不能建立真实发送证据和回滚门禁 |

## 3. 分批修改计划

| 批次 | 默认 owner | 计划范围 | 主要风险 | 交付物 | 禁止放量条件 | 必须证据 |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 0 | 产品/架构 + 安全 | 冻结 policy、provider、数据出境和 live 门禁 | AR-INT-002/003、AR-PROV-001/002、AR-EVAL-002 | 决策记录、schema、feature flag、拒绝路径 | D-01～D-05 未确认；默认仍为 simulate | 决策记录、配置契约、拒绝路径测试 |
| Batch 0A | QA/观测 | 建立最小评测/观测基线，并贯穿后续所有批次 | AR-EVAL-001/002/003、AR-PROV-002 | 脱敏回放集、指标、trace 摘要、告警/runbook | 无法量化误回复、漏 handoff、unknown、重复发送或延迟 | 基线回放、敏感字段扫描、shadow 指标和告警演练 |
| Batch 1 | 自动回复领域 | 结构化 LLM Intent + 确定性安全预检 + 置信度 gate | AR-INT-001/002/003 | classifier adapter、policy evaluator、离线 intent 评测 | 低置信度/硬风险仍能进入生成 | schema/拒答/多意图测试、shadow 对比和人工抽检 |
| Batch 2 | AI 平台/安全 | Prompt schema、模板 lint、PII 脱敏、Provider allowlist | AR-MOD-002/003/004、AR-PROV-001 | schema/serializer、配置校验、出站拦截 | 非法输出可发送；敏感字段可出站或落 trace | provider egress、PII、注入、非法输出测试 |
| Batch 3 | 数据/后端 | 工具预算、范围查询、商品消歧、事实 provenance | AR-DATA-001/002/003、AR-MOD-001 | bounded query、取消、provenance、ambiguous product path | 超预算继续猜测；重名商品静默取第一条 | 大数据量、取消、重名、跨账号/买家测试 |
| Batch 4 | 自动回复领域 | 回复事实/策略校验、segments 限制 | AR-MOD-001、AR-SEND-003 | reply validator、segment schema/limits | 未被事实支持的关键断言可发送；段失败仍继续发送 | 事实冲突、承诺扫描、段失败/完整性测试 |
| Batch 5 | 平台/交付 | Outbox、send ledger、segment 幂等、unknown/partial_send、reconcile | AR-SEND-001/002/003 | migration、worker、reconcile API/runbook | 任一发送一致性或 unknown 恢复缺口存在；live 必须关闭 | 崩溃注入、空 ref、超时、重试、reconcile 回放 |
| Batch 6 | 平台/运营 | conversation lease/version、stale-run reaper、人工 handoff 闭环 | AR-CON-001/002/003 | lease、heartbeat、reaper、handoff queue/notice | 并发可能乱序；卡住 run 无恢复；handoff 无 owner/SLA | 双 worker、进程 kill、人工接管和恢复 E2E |
| Batch 7 | 后端/观测 | run/event 事务、脱敏 trace、动态页状态映射 | AR-OBS-001/002、AR-PROV-002 | transaction/compensation、trace summary、adapter tests | 状态与事件可分离丢失；persisted 可被展示成真实送达 | PostgreSQL 故障注入、事件补偿、状态映射回归 |
| Batch 8 | 发布/QA | 全量评测与发布门禁 | AR-EVAL-001/002/003 | 回放集、红队集、真实链路证据、canary runbook | 任一 required test 未执行或阈值未达标 | typecheck/unit/integration/E2E/build/diff check、放量和回滚记录 |

## 4. 每批固定执行流程

1. 在 `docs/agent-worktree-registry.md` 登记独立 worktree 和 slice。
2. 先补/更新契约与失败测试，再写最小实现。
3. 运行与风险匹配的单测、集成/契约测试和真实链路验证。
4. 更新 `risk-register.md` 的状态、证据和剩余风险。
5. 完成 `git diff --check`，标记 `READY_FOR_REVIEW`；未经审核不合并、不扩大 live 范围。

> 计划排序说明：Batch 0A 的最小评测/观测基线必须先于 Batch 1，并在所有批次持续回归；Batch 5 的 Outbox、send ledger、unknown/partial_send 和 reconcile 是 live 的硬门禁，不是上线后的优化项。结构化 Intent 可以与 Prompt/PII 安全并行推进，但不能先于发送一致性恢复而开放 live。

## 5. 不会直接做的事情

- 不会因为“使用大模型分类”就移除确定性安全预检。
- 不会在 Outbox、unknown 恢复和 reconcile 完成前打开 live 发送。
- 不会把 `simulate`、FakeSocket、API 200 或单元测试当作真实闲鱼发送证据。
- 不会默认把原始买家正文、订单敏感字段或 Token 写入 Prompt、日志、trace 或事件 payload。
- 不会在你未确认 D-01～D-05 前把有争议的业务边界写死进代码。

## 6. 已确认决策

```text
审核状态：第 1 节点已批准；后续批次仍需逐节点讨论
D-01：同意默认建议
D-02：同意默认建议
D-03：同意默认建议
D-04：同意默认建议
D-05：同意默认建议
第 1 节点：7 项推荐方案全部同意
```

## 7. 后续审核结果栏

```text
审核人：
审核日期：
D-01：同意默认 / 调整：
D-02：同意默认 / 调整：
D-03：同意默认 / 调整：
D-04：同意默认 / 调整：
D-05：同意默认 / 调整：
批准开始批次：
附加约束：
```
