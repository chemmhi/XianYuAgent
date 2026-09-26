# 自动回复 Agent 风险登记（历史兼容快照）

> 当前修复域风险以 [`../auto-replay/repair-agent/07-risk-register.md`](../auto-replay/repair-agent/07-risk-register.md) 为准；本文保留既有 AR-* 编号和历史证据，供兼容引用。

> 版本：`2026-09-21`
> 范围：闲鱼实时买家消息 → 自动回复资格检查 → 意图识别 → 上下文/工具 → 模型生成 → 发送 → 落库 → Agent 动态查询。
> 状态：`OPEN / PARTIALLY_MITIGATED / BLOCKED / CLOSED-GUARDRAIL`

这份登记记录当前实现中已经确认的问题，不把“设计文档计划”当成“代码已具备”。修复顺序以 [`repair-checklist.md`](./repair-checklist.md) 为准；每次关闭风险时必须补充代码、测试、真实链路证据和回滚说明。

## 级别定义

| 级别 | 含义 | 处理要求 |
| --- | --- | --- |
| S0 | 可能直接造成错误对外承诺、重复/错发消息、凭证或隐私泄露 | live 发送前必须关闭；仅允许 `simulate` / `shadow` |
| S1 | 会造成事实错误、任务丢失、无法恢复或不可审计 | 进入近期修复批次；没有补偿/回滚不得放量 |
| S2 | 资源放大、可观测性缺口、维护性缺口 | 在扩大流量前关闭或设置硬门禁 |
| S3 | 文档、体验或长期治理问题 | 纳入持续改进，不阻塞受控 simulate |

## 需要先讨论的业务/架构决策

这些问题会直接改变策略矩阵或数据边界，在编码前需要人工确认：

| 决策 ID | 需要确认的选择 | 当前默认建议 | 影响 |
| --- | --- | --- | --- |
| D-01 | 价格、库存、发货时效是否允许自动承诺 | 只允许引用已验证事实；涉及议价、库存不确定或时效承诺一律 `handoff` | 决定 Intent policy、事实校验和 live 放量范围 |
| D-02 | 售后、退款、投诉、争议是否一律转人工 | 默认一律 `handoff`，Agent 只做解释性信息，不执行承诺/操作 | 决定高风险意图集合与人工接管 SLA |
| D-03 | Provider `baseUrl` 是否允许账号级自定义 | 默认仅允许固定 allowlist；不允许任意公网、内网或本地地址 | 决定 SSRF、数据驻留和部署配置 |
| D-04 | 是否允许将原始买家正文发送到外部模型 | 默认不直接发送；优先脱敏/结构化摘要，必要时按账号显式授权 | 决定 Prompt schema、PII 处理和审计字段 |
| D-05 | live 发送何时开放 | 默认先完成 simulate → shadow → 小范围 canary，并保留一键禁用 | 决定 Outbox、白名单、回滚和真实 E2E 门禁 |

## 风险总览

## 节点 1：网关 push → 解析 → 入站幂等落库

以下条目是用户已确认、允许进入实现的具体问题；它们比上面的领域级风险更接近代码和失败路径。

### AR-NODE1-001（S1）协议确认早于持久化，处理失败后没有可靠重放

- **现象**：`xianyu-im.ts` 在 `handleIncoming` 中先响应 frame 的 `mid`，再执行解析、落库和自动回复触发；失败只打 `push_handler_failed` 日志。
- **风险**：网关认为事件已消费，但本地可能没有消息或 run；仅靠日志无法恢复。
- **代码位置**：`apps/api/src/xianyu-im.ts:246,390-428`。
- **批准方案**：增加 `inbound_inbox`，先落最小脱敏 envelope，再异步处理；支持 `received/processed/ignored/failed/dead_letter`、重试和告警。
- **关闭条件**：故障注入覆盖解析失败、DB 失败、自动回复入口失败、进程重启；所有失败可重试或进入死信。

### AR-NODE1-002（S1）frame 处理并发导致同一会话乱序

- **现象**：`socket.on('message', ...)` 对每个 frame `void` 启动异步处理，没有同会话串行队列。
- **风险**：新消息可能先落库/先触发自动回复，旧消息晚到；上下文和回复顺序不稳定。
- **代码位置**：`apps/api/src/xianyu-im.ts:246`。
- **批准方案**：`accountId + externalConversationRef` 维度串行；跨会话有限并发；队列有上限、超时和恢复。
- **关闭条件**：双 frame、双 worker、重连和慢 profile lookup 测试下，同会话顺序稳定。

### AR-NODE1-003（S1）解析失败静默丢弃

- **现象**：缺少 conversation ref、message ref 或 sender ref 时，`parsePushPayload` 返回 `undefined`，调用方无业务记录。
- **风险**：协议变化、特殊消息或坏 payload 会静默消失，无法统计和回放。
- **代码位置**：`apps/api/src/xianyu-im.ts:487-508`。
- **批准方案**：解析返回 `message/ignored/quarantined` 结构；quarantine 保存脱敏摘要和稳定错误码。
- **关闭条件**：每类解析失败都可查询、可告警，且不把异常 payload 当作“无新消息”。

### AR-NODE1-004（S1）消息去重先查后插，并发下仍可能唯一键冲突

- **现象**：`MessageService.importExternalMessage` 先查询再插入；PostgreSQL `createMessage` 也不是原子 upsert。
- **风险**：重复 push 并发时一个请求可能以唯一约束错误结束，后续没有稳定 replay 结果。
- **代码位置**：`apps/api/src/messages.ts:173-180`、`apps/api/src/store-postgres.ts:413-443`、`apps/api/migrations/015_messages.sql:33-40`。
- **批准方案**：数据库 `INSERT ... ON CONFLICT DO NOTHING RETURNING`，冲突后读取已有消息并返回 `created=false/replayed=true`。
- **关闭条件**：重复 push 只产生一条消息和一个会话事件，不产生未处理异常。

### AR-NODE1-005（S1）history/live 外部消息引用可能不一致

- **现象**：当前只从多个候选值中选一个 canonical ref；没有 external ref alias 关系。
- **风险**：历史接口和实时 push 若分别只提供不同类型 ID，可能被当成两条消息并重复触发自动回复。
- **代码位置**：`apps/api/src/xianyu-im.ts:498-507,647-658`。
- **批准方案**：增加 external ref alias，canonical ref 与来源 ref 分离保存，命中 alias 时复用同一消息。
- **关闭条件**：同一平台消息的 history/live 两种 envelope 均只生成一个本地消息和一个 run。

### AR-NODE1-006（S1）无效时间戳被伪造成当前时间

- **现象**：无效时间戳会回退到 `Date.now()`。
- **风险**：旧消息可能被排序为最新消息，影响上下文、接管窗口和自动回复顺序。
- **代码位置**：`apps/api/src/xianyu-im.ts:799`；历史归一化见 `apps/api/src/xianyu-im-service.ts:396-417`。
- **批准方案**：保存 `occurredAt=null`、`receivedAt=now` 和 `timestampQuality`，不以当前时间冒充平台时间。
- **关闭条件**：无效时间消息不会改变业务排序或被错误当作新消息触发。

### AR-NODE1-007（S1）买家身份补全失败导致合法消息被错误跳过

- **现象**：push 缺少昵称且 profile lookup 失败时，仍可能以空昵称进入白名单判断。
- **风险**：合法买家被 `TEST_BUYER_NOT_ALLOWLISTED` 跳过，且当前没有稳定的“身份未解析”状态。
- **代码位置**：`apps/api/src/xianyu-im-service.ts:275-285`。
- **批准方案**：白名单主键使用稳定 `buyerRef/conversationRef`，昵称仅作辅助；身份未解析写入显式状态，不静默等同未命中。
- **关闭条件**：buyerRef 已确认但昵称服务暂时失败时，不会错误归类；live 仍受身份策略保护。

### A. 意图识别与业务策略

#### AR-INT-001（S0）规则分类器把复杂意图压缩成首个正则命中

- **问题**：`RuleBasedIntentClassifier` 只按固定规则顺序返回首个命中；没有多意图、否定、上下文指代、置信度校准或真正的置信度门禁。未命中的非空消息默认 `general + replied`。
- **影响**：买家同时询价/投诉/售后时可能被误判为低风险并自动回复；新表达、错别字、口语和跨轮指代容易漏检。
- **证据**：`apps/api/src/auto-reply.ts:66-86`；调用与门禁位于 `apps/api/src/auto-reply.ts:211-233`。
- **当前状态**：`OPEN`；设计文档已经要求结构化 Intent，但实现仍是规则分类。
- **目标**：采用“服务端确定性安全预检 + 大模型结构化分类 + policy gate”的混合方案；LLM 不能单独决定是否发送。
- **依赖**：D-01、D-02；离线评测集；结构化 schema 与阈值配置。
- **验证**：意图单测、对抗/多意图数据集、离线 precision/recall、shadow 对比旧规则、人工抽检。
- **是否需讨论**：需要，确认各意图的自动回复/转人工矩阵。

#### AR-INT-002（S1）价格、发货、库存等高风险意图策略不一致

- **问题**：代码将 `price`、`availability`、`delivery` 直接判为 `replied`，而设计文档把价格、交付和人工承诺列为需要确认的高风险边界；`cross_product` 又直接 handoff，未按业务相关性做澄清/推荐。
- **影响**：可能产生未经卖家确认的价格、库存或时效承诺，也可能错失安全的商品推荐机会。
- **证据**：`apps/api/src/auto-reply.ts:75-82`；`docs/agent/auto-reply/design.md:52-57,157-175`。
- **当前状态**：`PENDING_DECISION`。
- **目标**：冻结 Intent → required facts → allowed decision 的策略矩阵，并在代码中作为版本化配置执行。
- **依赖**：D-01、D-02、AR-INT-001。
- **验证**：策略矩阵契约测试、价格/库存/发货边界案例、无事实时必须 handoff。
- **是否需讨论**：需要。

#### AR-INT-003（S1）没有独立的安全预检与置信度拒答门

- **问题**：当前只在分类后按 `decision` 分支；未命中规则时 `confidence=0.7` 仍可进入生成，分类器返回的高置信度是硬编码数字而不是校准结果。
- **影响**：模型或规则不确定时仍可能对外说话；无法解释“为什么自动回复”。
- **证据**：`apps/api/src/auto-reply.ts:81-85,211-235`。
- **当前状态**：`OPEN`。
- **目标**：在调用模型前执行确定性预检；低于阈值、多意图冲突、事实范围不明时只允许澄清或 handoff。
- **依赖**：AR-INT-001、AR-INT-002。
- **验证**：阈值/冲突矩阵测试、失败安全断言、shadow 误放行率报表。
- **是否需讨论**：阈值可由系统默认，策略边界需讨论。

### B. 模型、Prompt 与输出安全

#### AR-MOD-001（S0）模型输出缺少事实一致性与业务策略校验

- **问题**：当前只检查空回复、长度和少量敏感词；不能验证价格、库存、发货时间、订单状态、售后承诺是否来自当前账号/当前商品/当前买家事实。
- **影响**：模型可能“看似合理”地编造价格、库存、订单进度或承诺退款。
- **证据**：`apps/api/src/auto-reply.ts:235-247,367-369`；上下文构造 `apps/api/src/auto-reply.ts:281-285`。
- **当前状态**：`OPEN`。
- **目标**：回复先经过结构化事实引用、policy validator、敏感承诺检测；验证失败只 handoff/failed，不发送。
- **依赖**：AR-INT-002、AR-DATA-001、AR-MOD-003。
- **验证**：事实篡改/缺失/冲突测试、订单与商品 fixture、模型输出 property-based 测试。
- **是否需讨论**：D-01、D-02。

#### AR-MOD-002（S0）Prompt injection 与 PII 出站边界不足

- **问题**：原始买家消息、历史、商品、订单字段会进入模型；当前没有强结构化不可信字段隔离、PII 脱敏、字段最小化或外部 provider 数据边界。
- **影响**：买家可通过文本改变系统规则；买家正文、订单信息或内部标识可能出站到第三方模型。
- **证据**：`apps/api/src/auto-reply.ts:281-285`；`apps/api/src/auto-reply-agent.ts:142-152`。
- **当前状态**：`OPEN`。
- **目标**：模型只接收版本化 JSON schema；不可信字段统一包裹为 data；敏感字段做脱敏/摘要；审计只保留 digest 与计数。
- **依赖**：D-03、D-04；Provider allowlist；脱敏工具。
- **验证**：prompt injection corpus、PII scanner、出站 payload contract test、日志/trace 脱敏检查。
- **是否需讨论**：需要。

#### AR-MOD-003（S1）Prompt 契约冲突，结构化输出不稳定

- **问题**：系统提示要求纯文本/不要 JSON，而生成器追加要求 JSON `{text, segments}`；两者冲突，解析失败时又回退到纯文本。
- **影响**：分段、字段完整性和停止条件不稳定，导致回复不可预测。
- **证据**：`apps/api/src/auto-reply-agent-config.ts:22-29`；`apps/api/src/auto-reply-agent.ts:95-99,122-126`。
- **当前状态**：`OPEN`。
- **目标**：固定单一 response schema，服务端严格解析；不合法输出不发送并进入可重试/转人工状态。
- **依赖**：AR-INT-001、AR-MOD-001。
- **验证**：schema contract test、非法 JSON/多余字段/超长字段测试、不同 provider wire API 回归。
- **是否需讨论**：默认方案可直接实施，若要兼容纯文本 provider 需确认。

#### AR-MOD-004（S2）Prompt 模板占位符没有契约校验

- **问题**：运行时只替换 `{{context}}`，模板中未知占位符会静默原样发送。
- **影响**：配置错误可能把控制标记、未渲染变量或错误指令发给模型。
- **证据**：`apps/api/src/auto-reply-agent.ts:250-252`；`apps/api/src/auto-reply-agent-settings.ts:73-77`。
- **当前状态**：`OPEN`。
- **目标**：保存配置时校验允许占位符、禁止未识别变量，并保存 config version/digest。
- **验证**：配置 API 校验、模板 lint、旧配置兼容迁移测试。
- **是否需讨论**：不需要，按白名单占位符执行。

### C. 上下文、工具与数据边界

#### AR-DATA-001（S1）商品标题兜底可能命中重名商品

- **问题**：商品查找在 `itemRef/externalProductRef` 失败后按标题取第一条匹配。
- **影响**：模型拿到错误商品价格、描述或库存，后续回复全部建立在错误事实之上。
- **证据**：`apps/api/src/auto-reply.ts:317-323`；工具路径 `apps/api/src/auto-reply-agent.ts:186-197`。
- **当前状态**：`OPEN`。
- **目标**：无唯一引用时返回 `AMBIGUOUS_PRODUCT`，要求澄清或 handoff；不按标题静默取第一条。
- **验证**：重名商品 fixture、跨账号/跨商品查询测试。
- **是否需讨论**：只需确认澄清文案，技术方向明确。

#### AR-DATA-002（S1）工具查询可能放大数据库和模型资源消耗

- **问题**：会话、订单、商品允许最多 100/1000 页扫描；每轮 tool loop 可重复触发，工具 timeout 只包住等待，不一定取消底层查询。
- **影响**：单条消息可放大 DB 读、模型 token 和响应延迟，形成资源耗尽风险。
- **证据**：`apps/api/src/auto-reply-agent.ts:164-223`；`apps/api/src/auto-reply.ts:325-339`。
- **当前状态**：`OPEN`。
- **目标**：改为服务端聚合/按 buyerRef 的索引查询；设置总页数、总行数、token、wall-clock budget；超时可取消并返回明确 partial context。
- **验证**：大数据量性能测试、查询取消测试、预算超限失败安全测试。
- **是否需讨论**：不需要，预算数值可先采用保守默认并通过配置调整。

#### AR-DATA-003（S2）工具 schema 上限与 validator 上限不一致

- **问题**：工具 schema 宣称 `max=20`，参数 validator 允许到 50；模型可利用不一致放大结果。
- **影响**：配置和审计显示的预算不是真实预算，容易出现超量响应。
- **证据**：`apps/api/src/auto-reply-agent-config.ts` 工具 schema；`apps/api/src/auto-reply-agent.ts:240-247`。
- **当前状态**：`OPEN`。
- **目标**：单一 schema source of truth，生成、校验、执行和测试共享同一上限常量。
- **验证**：schema/validator 一致性测试和边界值测试。
- **是否需讨论**：不需要。

### D. 并发、状态机与人工接管

#### AR-CON-001（S0）会话并发与人工接管竞态

- **问题**：同一会话的初次接管窗口由进程内协调，分类后到发送前仍没有数据库锁、conversation version 或原子的人接管检查；旧 `debounceMs` 已不再参与运行时决策。
- **影响**：多实例部署、重连、人工接管或连续消息可能产生乱序、过时回复或越过人工模式。
- **证据**：`apps/api/src/auto-reply.ts` 的 `pendingInitialWindows`、`isAgentTakeoverActive`、`waitForHumanReplyOrDelay` 及 `docs/agent/auto-reply/design.md` 的接管窗口约束。
- **当前状态**：`PARTIALLY MITIGATED`。
- **目标**：同一会话使用 DB/Redis lease 或版本号；发送前再次原子校验 handlingMode、最新入站版本和 run ownership。
- **验证**：已覆盖单进程初次窗口聚合、接管后立即处理、人工回复取消并重开窗口、服务重建恢复、分段发送中止；双 worker 并发、跨进程 lease 和原子发送前校验仍待补齐。
- **是否需讨论**：不需要，选择与现有 Redis/PostgreSQL 基础设施一致的方案即可。

#### AR-CON-002（S1）run 卡住后没有 lease、heartbeat 和 stale-run reaper

- **问题**：run 状态可以停在 `received/classified/generated/simulated`，重复 push 会直接复用旧 run，没有恢复或人工告警机制。
- **影响**：任务永久卡住，后续消息可能被错误跳过，运营无法区分处理中与失联。
- **证据**：`apps/api/src/auto-reply.ts:182-196`；状态定义见 `docs/agent/auto-reply/activity.md:63-82`。
- **当前状态**：`OPEN`。
- **目标**：run owner/lease/heartbeat/stale timeout/reaper；重复触发时可安全接管或明确返回处理中。
- **验证**：进程崩溃注入、租约过期恢复、重复 push、跨实例恢复测试。
- **是否需讨论**：不需要。

#### AR-CON-003（S1）人工接管只有判断，没有完整操作闭环

- **问题**：代码遇到 `handlingMode=human` 或高风险意图会 handoff，但缺少明确的人工接管事件、队列/通知、恢复和 SLA 状态契约。
- **影响**：风险消息虽然不自动发送，但可能无人跟进，运营无法闭环。
- **证据**：`apps/api/src/auto-reply.ts:228-232`；`docs/06-risk-register.md:173-175`。
- **当前状态**：`OPEN`。
- **目标**：handoff 形成可查询、可通知、可恢复的人工任务；人工处理后能关闭/抑制自动回复。
- **验证**：handoff API/事件、消息页联动、人工接管后续 push 回归。
- **是否需讨论**：D-02 需要确认 SLA 与通知方式。

### E. 发送、幂等与外部一致性

#### AR-SEND-001（S0）外部发送与本地落库非事务，缺少 Outbox / ledger / reconcile

- **问题**：代码先调用外部发送，再创建本地出站消息；崩溃或数据库失败会形成“平台已发、本地无记录”，未知结果也没有可恢复状态。
- **影响**：重复发送、漏记、无法人工确认真实状态；当前 `persisted` 不能证明买家已收到。
- **证据**：`apps/api/src/auto-reply.ts:254-267`；`apps/api/src/xianyu-im.ts:181-205`；`docs/agent/auto-reply/design.md:211-223`。
- **当前状态**：`OPEN`，是 live 前硬阻塞。
- **目标**：引入 outbox、send ledger、稳定幂等键、`send_unknown/partial_send`、外部状态查询和 reconcile worker。
- **验证**：发送前崩溃、发送后 DB 失败、超时/断线/重复重试、真实/受控 provider 回放。
- **是否需讨论**：D-05。

#### AR-SEND-002（S0）外部发送成功判定过宽，external ref 可能为空

- **问题**：`ExternalAutoReplySender` 只要 `sendExternal` 不抛异常就返回 `known_success`；闲鱼响应没有明确失败 reason 或 externalMessageRef 时也可能被当成成功。
- **影响**：未知发送结果被错误标成成功，后续重试策略和审计全部失真。
- **证据**：`apps/api/src/auto-reply.ts:56-63`；`apps/api/src/xianyu-im.ts:759-775`。
- **当前状态**：`OPEN`。
- **目标**：只有明确平台确认码 + 非空稳定外部消息引用才算 `known_success`；其余进入 `unknown` 或 `known_failure`。
- **验证**：空 ref、非 200、业务错误、连接断开、重复响应 fixture。
- **是否需讨论**：不需要。

#### AR-SEND-003（S1）分段回复缺少最大段数、单段边界和 segment 级幂等

- **问题**：设计要求多段顺序、`partial_send/send_unknown` 和每段幂等，但实现循环只依赖 `segments.length`，没有最大段数/单段限制/独立幂等键/发送前恢复。
- **影响**：模型可能产生过多消息；任一段失败后重放可能重复前段。
- **证据**：`apps/api/src/auto-reply.ts:251-265`；设计要求见 `docs/agent/auto-reply/design.md:211-223`。
- **当前状态**：`OPEN`。
- **目标**：引入 `replyGroupId + segmentIndex` ledger，限制总段数/单段长度，失败后只重试未知段并停止后续段。
- **验证**：多段成功、第二段失败、未知结果、重放和乱序测试。
- **是否需讨论**：默认限制可先按配置；若要业务例外需讨论。

### F. Provider、配置与网络安全

#### AR-PROV-001（S0）Provider baseUrl 只校验协议，缺少 host allowlist/内网阻断

- **问题**：配置只检查 `http/https`，没有限制域名、IP、localhost、内网地址、重定向或数据驻留。
- **影响**：SSRF、凭证泄露、将买家数据发送到未批准服务商或内网地址。
- **证据**：`apps/api/src/openai-settings.ts:220-225`。
- **当前状态**：`OPEN`。
- **目标**：固定 allowlist、DNS/IP 解析阻断私网和 loopback、禁用不安全重定向、按 provider 记录区域与数据策略。
- **验证**：配置 API、DNS rebinding/内网地址、重定向、代理和拒绝路径测试。
- **是否需讨论**：D-03。

#### AR-PROV-002（S1）Agent trace 未生产落库，缺少 provider/model/config/tool-call 审计

- **问题**：Agent 只通过 `onTrace` 回调暴露内存 trace，生产装配未保证持久化；运行记录没有 loop/tool/terminal reason 等完整摘要。
- **影响**：发生错误回复或成本异常时无法复盘，也无法证明实际使用的 provider/config。
- **证据**：`apps/api/src/auto-reply-agent.ts:99-126`；`apps/api/src/app.ts:128-151`；设计要求见 `docs/agent/auto-reply/design.md:247-255`。
- **当前状态**：`OPEN`。
- **目标**：保存脱敏的 provider/model/config digest/tool-call names/counts/terminal reason，不保存 Prompt 原文或 CoT。
- **验证**：trace 落库、脱敏、跨重启查询、失败路径和 cost/latency 指标测试。
- **是否需讨论**：只需确认留存周期与可见角色。

### G. 运行记录、事件一致性与可观测性

#### AR-OBS-001（S1）run 更新与 run event 写入处于独立事务窗口

- **问题**：更新 `auto_reply_runs` 后再单独追加 `auto_reply_run_events`，第二步失败会出现主表有状态、事件缺失。
- **影响**：动态页时间线不完整，审计和吞吐统计失真。
- **证据**：`apps/api/src/store-postgres.ts:446-477`；`docs/agent/auto-reply/activity.md:90-102,259-283`。
- **当前状态**：`OPEN`。
- **目标**：同事务写 mutation + event，或提供可重试补偿与缺失告警；查询层明确暴露不完整时间线。
- **验证**：PostgreSQL 故障注入、事务回滚、补偿重建、详情 API 回归。
- **是否需讨论**：不需要，需在实现前选定同事务或补偿方案并记录。

#### AR-OBS-002（S2）运行状态语义与真实外部结果容易被误读

- **问题**：`simulated/persisted` 状态、`senderOutcome` 和外部平台真实收件状态之间没有强制一致性约束；当前文档已提醒不能把 `persisted` 当作买家已收到。
- **影响**：运营和页面可能把本地持久化误认为真实发送成功。
- **证据**：`apps/api/src/auto-reply.ts:264-267`；`docs/agent/auto-reply/activity.md:63-82,227-228`；`docs/06-risk-register.md:171-180`。
- **当前状态**：`PARTIALLY_MITIGATED`。
- **目标**：统一状态机，明确 `outbox_pending/sending/known_success/unknown/partial_send` 与展示文案。
- **验证**：状态映射契约、动态页 E2E、未知发送结果演练。
- **是否需讨论**：不需要。

### H. 测试、评测与发布门禁

#### AR-EVAL-001（S1）缺少真实模型评测集、回放集与置信度校准

- **问题**：目前主要是定向单测和受控 E2E；没有覆盖口语、多意图、指代、错别字、恶意注入、事实缺失和长回复的离线集。
- **影响**：无法量化误回复、漏 handoff、事实错误和成本/延迟回归。
- **证据**：`docs/06-risk-register.md:173-175`；`docs/agent/auto-reply/design.md:305-315`。
- **当前状态**：`OPEN`。
- **目标**：建立脱敏回放集、标签规范、离线指标、shadow 指标和人工抽检门槛。
- **验证**：可重复评测命令、版本化结果、阈值门禁、失败样本归档。
- **是否需讨论**：需确认业务可接受误报/漏报阈值。

#### AR-EVAL-002（S1）没有 live 真实链路证据和可回滚放量门禁

- **问题**：现有证据集中于 simulate、FakeSocket 或受控调用；没有可复现的真实买家 push → 模型 → 外部发送 → 落库归档，且 live 仍依赖白名单配置。
- **影响**：无法证明发送层、网关、数据库和重试策略在真实环境下闭环。
- **证据**：`docs/06-risk-register.md:179-182`；`docs/agent/auto-reply/design.md:314-319`。
- **当前状态**：`BLOCKED`，直到 AR-SEND-001/002、AR-CON-001/002 和 D-05 完成。
- **目标**：建立 simulate → shadow → canary → live 四级门禁、指标阈值、自动禁用和人工回滚。
- **验证**：每级都有真实或受控证据、放量审批记录、回滚演练。
- **是否需讨论**：D-05。

#### AR-EVAL-003（S2）自动回复定向测试当前受环境依赖阻塞

- **问题**：尝试执行 `npm --workspace apps/api run test:auto-reply:unit` 时，仓库缺少可解析的 `node_modules/tsx`，测试文件未启动。
- **影响**：当前不能宣称自动回复测试通过；回归证据不完整。
- **证据**：2026-09-21 执行记录；环境缺少 `node_modules/tsx`。
- **当前状态**：`BLOCKED`。
- **目标**：恢复依赖或提供锁定的可复现测试环境后重新执行并归档结果。
- **验证**：定向单测、集成、真实 PostgreSQL、Chrome/CDP 和 `git diff --check`。
- **是否需讨论**：不需要，但必须在交付中保留阻塞原因。

## I. 编排、澄清、生命周期与结果闭环

### AR-ORCH-001（S0）业务路由散落在硬编码分支和 Prompt 中

- **问题**：当前分类器和流程分支可能将某些 intent 直接映射为 replied 或 handoff，无法按版本化策略、生命周期和事实动态调整。
- **影响**：策略变更需要改代码；容易误拒绝、误转人工或误推荐，且无法审计实际命中规则。
- **目标**：由 SignalExtractor 提出候选信号，PolicyEngine 根据版本化策略、领域事实和 ConversationState 产出 ActionPlan；代码不保留业务路由分支。
- **修复切片**：AR-VS-00、AR-VS-01、AR-VS-03。
- **验证**：策略版本切换、规则命中审计、无散落路由扫描、跨账号/跨订单边界测试。

### AR-ORCH-002（S0）信息不完整时缺少澄清和等待状态

- **问题**：未命中规则的非空消息可能被当作 general + replied，模型输出协议也没有 clarify/awaiting_user。
- **影响**：Agent 可能生成泛化回复，无法恢复原目标，也无法量化澄清率和重开率。
- **目标**：增加 clarification plan、pendingQuestions、awaiting_user、目标恢复和有限澄清轮数；普通不确定问题优先澄清，不默认 handoff。
- **修复切片**：AR-VS-02。
- **验证**：模糊消息、买家补充、明确新目标、重复消息、超时、并发和真实 E2E。

### AR-ORCH-003（S1）缺少生命周期目标和下一步动作状态

- **问题**：当前 Agent 主要识别问题类型，未持久化 discovery、未付款、已付款待发货、待收货、待评价等阶段，也没有 targetStage/observedStage 区分。
- **影响**：Agent 只能回答当前问题，无法稳定引导下单、付款、收货和评价；模型可能把建议误当成已完成。
- **目标**：订单事实投影 observedStage，PolicyEngine 生成 targetStage、primaryGoal、successCriteria 和 nextAction。
- **修复切片**：AR-VS-01、AR-VS-04。
- **验证**：订单状态组合、阶段推进/回退、多订单歧义、状态回读和跨层 E2E。

### AR-ORCH-004（S1）情绪、跑题和推荐缺少统一门控

- **问题**：当前实现没有结构化 topicRelation、emotionSnapshot、recommendationEligible；cross_product 还可能被直接视为高风险 handoff。
- **影响**：负面情绪下继续推荐或催评价，跑题无法拉回，相关替代商品也可能被错误拒绝。
- **目标**：情绪只调整语气和升级阈值；售后未解决、澄清等待和负面情绪禁止推荐；相关替代商品由推荐资格策略决定。
- **修复切片**：AR-VS-05、AR-VS-06。
- **验证**：跑题拉回、新目标切换、负面情绪拦截、推荐冷却、跨账号候选隔离和推荐理由回读。

### AR-ORCH-005（S1）发送后没有业务结果审核

- **问题**：persisted 只表示本地记录已保存，当前没有 Outcome Review、resolutionStatus、follow-up 或问题重开机制。
- **影响**：发送完成率被误读为问题解决率，无法判断买家是否真正进入下一阶段或是否需要继续跟进。
- **目标**：异步观察发送结果、买家后续消息和领域事实，区分 transportStatus、goalProgress、resolutionStatus；无证据不自动 resolved。
- **修复切片**：AR-VS-03、AR-VS-07、AR-VS-08。
- **验证**：明确确认、重复追问、否定、无后续消息、事实变化、审核超时、人工覆盖、进程重启和真实数据库回读。

## 已关闭但必须保留回归门禁

以下问题已有专项修复，但不能因为“已关闭”就从后续测试中移除：

- 重复 push / 历史同步竞态：必须保持“历史同步不触发，后续真实 push 可幂等进入自动回复”的契约。
- 跨账号商品/订单查询：必须持续验证 account scope、buyer scope 和外部引用解析。
- 模拟发送误触发真实闲鱼发送：`simulate` 测试必须断言外部发送调用数为 0。
- 敏感内容进入运行记录：事件、audit、trace 只能保存脱敏摘要和 digest。
- listener 启动、重连和 push parser：真实网关证据仍未完成，不能把 FakeSocket 当作 live 验收。

## 风险关闭定义

一条风险只有同时满足以下条件才可标记 `CLOSED`：

1. 代码或迁移已落地，且没有只改文档/测试的假关闭；
2. 单元 + 集成/契约 + 与风险匹配的真实链路验证已执行；
3. 失败路径、重试/取消、审计和回滚有证据；
4. 文档、状态机、页面映射和告警口径同步更新；
5. `git diff --check` 通过，且未留下未处理错误或未解释的开关。
