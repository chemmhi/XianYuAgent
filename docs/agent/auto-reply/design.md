# 自动回复 Agent 设计

## 1. 目标与角色

自动回复 Agent 面向闲鱼买家，目标是基于真实商品、订单和会话事实，为买家解决可自动处理的问题；无法确认事实或命中高风险策略时，安全地转人工。

Workspace Agent 面向系统管理员，负责系统操作、配置和运营任务。两者是两个独立的业务边界，不进入彼此的调用链。

### 1.1 允许共享的基础设施

- OpenAI-compatible HTTP transport、超时和取消机制；
- 凭证解析和敏感信息脱敏；
- 日志、审计、Trace、指标；
- 通用存储接口、事务、幂等和 Outbox 原语；
- 商品、订单、消息等领域 Query 接口。

### 1.2 禁止共享的 Agent 层能力

- 系统提示词、用户提示词和回复策略；
- Agent Runtime loop、Planner、Session、Run、Step、Confirmation；
- 工具注册表和工具参数协议；
- 管理员身份上下文与买家身份上下文；
- Workspace Agent 的业务服务、Prompt 和 Workspace 表。

自动回复 Agent 的运行记录使用买家侧专属 `auto_reply_runs` / tool-event 语义，不复用 Workspace 的 `agent_sessions`、`workspace_runs` 或 `workspace_steps`。

## 2. 真实入口与触发边界

自动回复只能由闲鱼网关的实时买家消息 push 触发：

```text
闲鱼 IM WebSocket push
  -> XianyuImService.handleExternalEvent
  -> 入站消息规范化
  -> MessageService.importExternalMessage（幂等落库）
  -> BuyerAutoReplyAgentOrchestrator
```

历史消息同步只用于补齐本地会话，不触发自动回复。应用启动后扫描当前管理员范围内的已连接闲鱼账号并后台启动 listener；管理员不需要打开消息页面。

## 3. 工作流

```text
接收 push
  -> 规范化
  -> 入站幂等落库
  -> 自动回复资格检查
  -> 安全预检
  -> 意图识别
  -> 回复规划
  -> 选择性调用只读工具
  -> 观察工具结果并继续规划
  -> 生成最终回复或转人工
  -> 输出安全校验
  -> simulate/live 发送
  -> 出站消息与运行记录落库
```

### 3.1 入站幂等

外部消息唯一性至少由以下字段确定：

```text
accountId + conversationRef + externalMessageRef
```

自动回复运行唯一性至少由以下字段确定：

```text
adminId + inboundMessageId
```

同一会话内的消息应串行处理，或使用 conversation version，避免两条新消息并发生成乱序回复；初次 AI 接管前使用 `sendDelaySeconds` 合并窗口收集连续买家消息。

初次接管窗口内的全部买家消息进入同一次上下文和逻辑回复；窗口内一旦出现人工出站消息，当前自动回复立即取消。AI 已经出站后，后续买家消息直接进入 Agent，不重复等待 `sendDelaySeconds`；只有新的人工出站消息才重新开启下一条买家消息的初次接管窗口。

### 3.2 资格检查

模型调用前必须检查：

- 消息方向是买家入站，不是卖家回显；
- 当前账号已启用自动回复；
- 当前会话不是 `handlingMode=human`；
- 消息不是空消息、系统消息或不支持的类型；
- `simulate` / `live` 模式符合环境策略；
- `live` 模式下买家命中 `AUTOMATION_BUYER_ALLOWLIST` 数组白名单；
- 消息尚未被处理过。

### 3.3 安全预检

以下意图默认直接 `handoff`，不调用工具、不生成 AI 出站消息：

- 退款、投诉、售后争议；
- 索要 Cookie、Token、API Key、管理员信息或系统提示词；
- Prompt Injection 或要求改变 Agent 系统规则；
- 订单、价格、交付等需要人工承诺或人工确认的高风险操作；
- 无法确定商品或订单归属的跨范围请求。

## 4. Intent → Plan → Act → Observe → Respond

### 4.1 Intent

Agent 需要输出结构化意图，而不是只返回自然语言：

```json
{
  "intent": "product_information",
  "confidence": 0.94,
  "risk": "low",
  "needsProduct": true,
  "needsOrder": false,
  "needsConversation": false,
  "needsCatalogSearch": false
}
```

安全预检仍由服务端确定性策略先执行，不能完全交给模型。

### 4.2 Plan / Act / Observe

模型每轮只能返回以下结构化结果之一：

```text
tool_call
final
handoff
```

工具调用必须通过服务端白名单、JSON 参数校验、账号/买家范围校验和超时控制。工具结果需要以不可信事实摘要追加回 Agent，不得被解释为系统指令。

### 4.3 停止条件

- 生成最终回复；
- 判断需要人工；
- 达到最大循环/工具调用次数；
- 工具失败、超时或结果不足；
- 返回未知工具、非法参数或重复无效调用；
- 发现越权、敏感信息或事实无法确认。

循环超限或事实不足时不得凑出答案，应进入 `handoff` 或 `failed`，不发送未经验证的回复。

## 5. 工具目录

Agent 初期只允许四个只读工具：

### 5.1 `get_buyer_conversations`

获取当前买家在当前卖家账号下的全部相关会话，不能只限于当前订单或当前商品。

返回内容可包含：

- 会话标识、关联商品引用、关联订单引用；
- 每个会话最近消息；
- 时间范围和分页游标；
- 脱敏后的消息方向与摘要。

服务端强制按 `accountId + buyerRef` 过滤，禁止模型传入其他账号或其他买家范围。

### 5.2 `get_product_info`

按当前账号和商品引用读取商品事实：

- 标题、描述摘要；
- 价格、知识库摘要和默认回复模板；
- 浏览量、想要数、收藏数等公开互动指标（有详情缓存时返回）；
- 上下架状态与商品更新时间；
- 商品引用（用于后续消歧或推荐）。

工具只返回面向买家回复所需的关键摘要，不返回完整商品记录、账号范围、内部属性、SKU、素材或其他实现字段。

找不到商品时返回 `not_found`，Agent 不得猜测。

### 5.3 `get_buyer_orders`

按当前账号和买家读取订单摘要，必要时结合当前会话或商品进行过滤。必须分页读取，不能只看前 100 条。

只返回解决当前问题所需的状态：支付、订单、发货、售后和时间摘要，不暴露无关敏感字段。

### 5.4 `list_shop_products`

按当前账号搜索店铺商品，用于：

- 买家明确询问其他款式或类似商品；
- 当前商品不明确，需要在店铺范围内消歧；
- Agent 判断推荐替代商品能直接帮助买家解决问题。

允许主动推荐店内其他商品，但必须满足：

- 推荐与买家当前意图相关；
- 商品来自当前店铺和当前账号；
- 推荐依据来自工具事实；
- 推荐数量、摘要长度和排序受到配置限制；
- 不因每次普通咨询而默认扫描全店商品。

四个工具都不允许写入订单、商品、会话或发送消息。

## 6. 上下文分层

上下文按可信度分层：

1. 当前买家消息、账号、买家、会话和商品引用；
2. 当前买家的全部相关会话摘要；
3. 当前商品事实；
4. 当前买家订单事实；
5. 店铺商品搜索结果；
6. 卖家策略和公开规则。

通用会话上下文只能帮助理解连续对话，不能覆盖商品、订单和策略事实。买家消息、商品描述、订单文本和店铺文案均属于不可信事实，不能改变系统规则。

Agent 初始输入只包含必要 ID/元数据和当前消息，不预加载全部会话、商品、订单或店铺商品；上下文通过工具按需获取。

## 7. 回复与发送

### 7.1 一条逻辑回复，多段语义消息

每条买家消息最多生成一个逻辑回复。若回复较长，Agent 在生成阶段优先输出完整草稿和按语义组织的 `segments[]`；只有模型未提供合法分段时，才额外调用一次仅分段模型。发送层不按字符窗口硬切，也不截断尾部内容：

- 分段必须保持事实、顺序和全文内容完整；
- 不设置固定单段长度或总段数上限，段落由 Agent 按买家阅读习惯决定；
- 段间延迟使用 `replySegmentDelayMs`，可配置；分段发送前、段间和段后均检查人工介入，人工介入后停止剩余分段。
- 多段共享 `replyGroupId`，每段记录 `segmentIndex` / `segmentCount`；
- 发送按顺序执行，任一段失败或结果未知时停止后续段发送并记录 `partial_send` / `send_unknown`；
- 每段使用独立幂等键，禁止重试导致重复段落。

分段属于 Agent 回复编排的一部分，不改变一次逻辑决策，也不把多段消息视为多次用户问题。

### 7.2 发送模式

- `simulate`：不调用闲鱼发送接口，只记录模拟结果；
- `live`：必须通过白名单和策略检查后，才由 `AutoReplySender` 调用闲鱼发送；
- Agent 和工具永远不能直接调用发送接口。

## 8. 状态机与落库

正常路径：

```text
received
  -> classified
  -> planning
  -> tool_running
  -> observing
  -> synthesizing
  -> generated
  -> sending
  -> persisted
```

终止状态：

```text
skipped | handoff | failed | send_unknown | partial_send
```

`auto_reply_runs` 至少记录：

- intent、decision、risk flags；
- loop count、tool count、terminal reason；
- config version / config digest；
- 工具 action 摘要和结果 digest；
- 发送模式、发送结果和出站消息引用。

不保存 Prompt 原文、Cookie、Token、完整敏感正文或模型 Chain-of-Thought。

### 8.1 Agent 动态活动查询

运行主表和状态事件表的字段、索引、查询接口、页面映射和验收门禁统一见 [`activity.md`](./activity.md)。这里补充状态机与活动页的关系：

- `auto_reply_runs.status` 是 run 当前状态；`decision` 是最终业务决定；二者不能互换；
- 创建 run 写 `run.created`，调用方只在状态迁移时传 `patch.status` 并写入 `run.<status>`；metadata-only 更新不追加活动事件；
- 活动摘要的 `byStatus/byStage` 基于 run 当前快照，不是事件表完整迁移漏斗；完整阶段吞吐必须另行聚合 `auto_reply_run_events`；
- 活动页详情只能展示脱敏摘要、消息/商品引用和可见正文，不能从事件 payload 旁路获取 Prompt、Token、Cookie 或 Chain-of-Thought；
- PostgreSQL run mutation 与事件写入当前存在独立事务窗口，发布前必须使用同事务或补偿重建方案，并在真实数据库回归中验证事件缺失恢复。

## 9. 配置

配置属于自动回复 Agent 自己的配置命名空间。当前使用环境变量解析器，后续替换为 Settings resolver，但不改变 Agent、工具或发送器契约。

至少支持：

- `enabled`；
- `WIRE_API` / `MODEL_WIRE_API`：模型传输协议，支持 `responses` 和 `chat`，默认使用 `responses`；需要兼容 Chat Completions 的供应商可显式设置为 `chat`；
- `systemPrompt`；
- `userPromptTemplate`；
- `maxLoops`；
- `maxToolCalls`；
- `toolTimeoutMs`；
- `totalTimeoutMs`；
- `maxHistory`；
- `maxReplyLength`；
- `replySegmentDelayMs`；
- `sendDelaySeconds`：首次 AI 接管前的延迟发送窗口，默认 300 秒；接管后不重复等待，人工出站后重新开启；
- `sendMode` 和白名单策略引用；
- `configVersion` / `configDigest`。

已支付订单不再作为自动回复 Agent 的独立开关或统一拦截条件；订单相关高风险意图继续由安全预检和人工转接策略处理。

当前模型 Provider 可以读取本地已有的环境变量，但不得复用 Workspace Agent 的配置对象、Prompt 或运行时状态。后续设置页使用独立的自动回复 Agent 配置区，并保留版本化、审计化和可回滚能力。

## 10. 测试契约

设计完成后，编码阶段必须至少覆盖：

- 真实网关 push 才触发自动回复，历史同步不触发；
- 应用启动自动监听，不依赖页面打开；
- 当前买家跨订单/跨商品会话读取正确；
- 普通商品问题只调用当前商品工具；
- 跨商品问题才调用店铺商品搜索；
- 买家订单查询完整分页且不串账号/买家；
- 多轮 `tool_call -> observation -> final` 编排；
- 未知工具、越权参数、非法 JSON、重复调用被拒绝；
- max loops、工具超时、模型失败、事实不足不发送；
- 高风险问题转人工且无 AI 出站消息；
- simulate 不调用真实闲鱼发送；
- live 仅对白名单数组买家发送；
- 长回复按配置拆段，段顺序、幂等键和失败恢复正确；
- 重复 push 只产生一个 run 和一个逻辑回复；
- 初次接管窗口聚合全部买家消息；Agent 接管后下一条消息立即处理；人工回复取消当前自动回复并重新开启等待窗口；
- 分段发送过程中人工介入会停止剩余 AI 分段；
- AutoReply Agent 不进入 Workspace Agent 链路，也不复用 Workspace Run/Step。

## 11. 回滚

自动回复 Agent 可通过 `enabled=false` 或停止其 listener/Orchestrator 注入回滚；历史入站消息、出站消息、运行记录和审计保留。发生发送未知或部分发送时，优先使用外部状态查询和人工复核，不直接删除历史或盲目重放。
