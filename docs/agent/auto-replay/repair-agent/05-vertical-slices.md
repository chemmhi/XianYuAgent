# 修复垂直切片

每个切片都覆盖数据库/状态、后端策略、API、管理端可见结果、测试、证据、回滚和独立评审。切片严格按 AR-VS-00 到 AR-VS-09 串行，不允许把多个未验证切片一次性实现。

## 总表

| 切片 | 结果 |
| --- | --- |
| AR-VS-00 | 范围、策略、验收指标和基线锁定 |
| AR-VS-01 | ConversationState、Objective、Policy Kernel |
| AR-VS-02 | 澄清与 awaiting_user 闭环 |
| AR-VS-03 | 发送前 Pre-send Review |
| AR-VS-04 | 生命周期引导 |
| AR-VS-05 | 跑题拉回与情绪门控 |
| AR-VS-06 | 店内推荐 |
| AR-VS-07 | 发送后 Outcome Review |
| AR-VS-08 | 真实链路集成与发布准备 |
| AR-VS-09 | 发布、回滚与交接 |

## AR-VS-00：范围、策略与基线锁定

- 目标：固化无硬编码路由和仅终极敏感信息明确拒绝。
- 输出：拒绝矩阵、继续帮助矩阵、生命周期/目标/指标定义、需求到验收到测试追踪表。
- 禁止：不改业务代码、不开放 live、不把 Prompt 当作已实现行为。
- 验收：业务、架构、质量三轮评审确认策略可审计、指标可回读、风险可追踪。
- 回滚：仅回退文档策略版本，代码不受影响。

## AR-VS-01：ConversationState、Objective 与 Policy Kernel

- 目标：建立跨消息状态和版本化策略的最小可运行内核。
- 数据/API：新增状态、目标、版本和审计字段，保留旧 run 兼容读写。
- 后端：实现 StateReducer、PolicyEngine、ActionPlan，路由层不得自行写状态。
- 测试：创建/更新、乐观锁、重复消息、跨账号拒绝、迁移复读、策略回滚。
- 非目标：不实现澄清、生命周期引导和推荐动作。
- 回滚：停止写新字段，保留旧 run 读路径。

## AR-VS-02：澄清与 awaiting_user 闭环

- 目标：信息不足时先问最小问题，下一条消息到达后恢复原目标。
- 数据/API：pendingQuestions、expectedAnswerType、sourceMessageId、clarificationRound 和澄清事件。
- 策略：一次最多一个问题；超时保持等待；超过上限优先可选项或有限帮助，不默认 handoff。
- 测试：模糊问题→澄清→补充→继续原目标；重复、并发、超时、目标切换、跨账号隔离。
- 回滚：关闭 clarify flag，回到安全普通回答，保留历史事件。

## AR-VS-03：发送前 Pre-send Review

- 目标：发送前确认目标覆盖、事实引用、允许动作和敏感边界。
- 数据/API：ReviewRecord、goalCoverage、factRefs、policyVersion、reviewDecision。
- 策略：确定性校验优先；失败最多一次修订，之后优先澄清或安全帮助。
- 测试：无事实价格/库存/订单断言、事实冲突/过期、错误账号/商品、敏感部分拒绝。
- 非目标：不判断发送后是否解决。
- 回滚：保留最低安全拦截，不回退到无校验直发。

## AR-VS-04：生命周期引导

- 目标：按订单事实引导下单、付款、发货、收货和评价。
- 数据/API：记录 observedStage、targetStage、nextAction、successCriteria 和事实引用。
- 策略：阶段由事实投影；不把文案建议当作已完成。
- 测试：五阶段映射、回退、多订单歧义、评价请求受售后/情绪门控。
- 非目标：不执行付款、发货、改价、退款等写操作。
- 回滚：关闭阶段动作，保留事实回答和澄清。

## AR-VS-05：跑题拉回与情绪门控

- 目标：处理邻近话题、新目标和负面情绪，避免强行拉回或强推。
- 数据/API：topicRelation、emotionSnapshot、强度、置信度和事件。
- 策略：adjacent 简答后回主线；连续跑题或明确新目标时切换；负面情绪禁止推荐/评价。
- 测试：跑题、连续跑题、新目标、困惑、犹豫、焦虑、愤怒、并发和人工接管竞态。
- 回滚：关闭情绪驱动动作，保留中性话术和事实引导。

## AR-VS-06：店内推荐

- 目标：只在相关、合适、事实新鲜且情绪允许时推荐当前账号商品。
- 数据/API：资格、候选、理由、事实引用、曝光和冷却记录。
- 策略：模型只能在 PolicyEngine 授权候选中排序；一次最多 2–3 个；无候选时追问偏好。
- 测试：替代商品、商品不适配、售后/投诉/负面/澄清期间禁止推荐、账号隔离、冷却。
- 非目标：不执行商品修改、下单或营销写操作。
- 回滚：关闭 recommendationAllowed，保留回答和澄清。

## AR-VS-07：发送后 Outcome Review

- 目标：区分消息已发送、目标已推进和问题已解决。
- 数据/API：resolutionStatus、review lease、重试、人工覆盖和拆分指标。
- 策略：观察发送结果、后续消息和最新领域事实；无证据保持 pending/awaiting；重复追问或否定进入 follow-up/unresolved。
- 前端：详情展示 transport、resolution、nextAction 三层状态，不能把 persisted 当完成。
- 测试：pending→reviewing→resolved/needs_followup/unresolved、无后续、超时、重启、人工覆盖、真实回读。
- 回滚：停止 worker，保留发送结果，resolution 回到 pending，不删事件。

## AR-VS-08：真实链路集成与发布准备

- 范围：迁移、旧数据复读、API 鉴权、账号 scope、worker lease、重试、Chrome/CDP、simulate→shadow→canary、日志指标告警。
- 证据：真实入口→API→数据库→Agent Dynamics；固定桌面/移动截图；迁移回滚和旧数据读取。
- 禁止：页面可打开、HTTP 200 或 mock 不能替代真实跨层验收。
- 回滚：关闭 flags，回到上一策略版本，保留兼容读路径和审计。

## AR-VS-09：发布、回滚与交接

- 输出：发布清单、环境变量、迁移/备份/恢复、canary 停止条件、误答/误推荐/误推进/unknown/review_failed runbook、版本和风险清单。
- 通过条件：无未接受 P0/P1；适用测试、E2E、视觉、迁移、回滚和告警演练 PASS；问题完成修复→复验→复审；文档同步。
