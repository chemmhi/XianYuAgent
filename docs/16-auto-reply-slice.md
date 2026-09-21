# 自动回复链路切片（2026-09-20）

## 目标与边界

本切片验证闲鱼入站消息从平台适配器进入当前项目后，经过安全决策和上下文组装，生成一条可解释的 AI 回复，并在受控 `simulate` 模式下把入站消息、出站 AI 消息和脱敏运行证据写入项目存储。代码保留白名单限定的 `live` 投递路径，但该路径不属于当前自动化验收门禁。

默认配置仍为 `simulate`，测试和回归不会调用真实闲鱼发送接口。`live` 只能通过环境变量显式开启，且必须同时配置非空 `AUTO_REPLY_TEST_BUYER_NAMES` 白名单；本切片不承担设置页策略保存、真实模型 Provider 接入、Outbox Worker 执行、人工接管 API 或前端自动回复 UI。

## 设计链路

本切片不把“监听→识别→上下文→生成→回复→落库”当作无条件直通流水线，而采用 **事实先落库、风险先门禁、上下文分层、可回答性约束、输出安全校验、可替换投递器、审计回读** 的闭环。这样可以避免重复事件、跨账号串上下文、凭空编造商品事实和把高风险问题自动回复给买家。

```text
XianyuImClient push event
  -> XianyuImService.handleExternalEvent
  -> 入站规范化（账号/会话/消息类型/时间/外部引用）
  -> MessageService.importExternalMessage（外部消息幂等落库）
  -> AutoReplyService.processInbound
       -> 幂等回放检查（admin + inboundMessage）
       -> 输入预检（inbound / text / enabled / 非空）
       -> 风险优先意图识别（intent + confidence + risk flags）
       -> 分层上下文构建（会话历史 + 当前商品事实 + 订单状态 + 处理模式）
       -> 可回答性与策略门禁（human mode / 高风险 / 已支付订单 / 缺少事实）
       -> 回复计划与生成（当前为可替换模板生成器，禁止越权事实）
       -> 输出安全校验（控制字符 / 长度 / 凭证与系统提示词泄露）
       -> AutoReplySender（默认 simulate；live 仅对环境变量白名单买家调用闲鱼发送）
       -> 出站 AI 消息事实落库（source=ai，合成 external ref）
       -> auto_reply_runs + AuditEvent（只保留脱敏摘要与 digest）
       -> 结果回读 / 监控 / 人工接管入口
```

消息来源边界必须保持明确：`listMessages` 只是通过闲鱼 IM WebSocket 请求历史消息并导入本地，**不会**调用自动回复；只有网关帧中的 `body.syncPushPackage` 经 `XianyuImClient.handleIncoming` 解析后触发 `onEvent`，才允许进入 `XianyuImService.handleExternalEvent` 和自动回复。闲鱼可能把请求响应与 `syncPushPackage` 放在同一帧，客户端必须先完成 pending 请求，再继续解析同帧 push，不能在完成请求后提前 `return` 丢弃买家消息。

监听生命周期：应用在 `listen()` 完成后扫描所有 active 管理员的 `connected` 闲鱼账号并后台启动 IM listener；登录成功、凭证保存/验证和管理员会话恢复也会触发同一启动逻辑。自动回复不依赖管理员打开会话页面。

## 意图与策略

- 安全意图优先级：Prompt Injection、凭证请求、退款/售后、投诉、跨商品索取 > 普通商品问题。
- 普通问题：价格、库存、发货、一般咨询，进入回复生成。
- 商品问题优先使用当前账号范围内的商品事实；无法确认商品、价格或库存时只能给出“待确认”回复或转人工，不允许猜测。
- 通用上下文只用于理解会话连续性和买家身份，不得覆盖商品、订单和策略事实。
- 会话 `handlingMode=human`、高风险意图、或存在已支付订单且策略禁止 AI 回复时，状态为 `handoff`，不生成、不发送、不写 AI 出站消息。
- 入站外部消息按 `(conversationId, externalMessageRef)` 幂等；自动回复运行按 `(adminId, inboundMessageId)` 幂等。

## 落库证据

- `messages.messages`：原始入站消息与 AI 出站消息。
- `messages.auto_reply_runs`：只保存意图、决策、状态、风险标签、上下文/回复摘要哈希、发送结果和消息引用，不保存 Prompt、凭证或原始敏感正文。
- `observability.audit_events`：动作 `auto_reply.processed`，只写脱敏 payload digest。

## 测试验收

| 阶段 | 断言 |
| --- | --- |
| 监听 | `XianyuImService.handleExternalEvent` 接收入站适配器事件并幂等导入消息 |
| 意图 | 安全问题识别为 price/availability/delivery/general；退款、投诉、凭证请求、Prompt Injection、跨商品请求转人工 |
| 上下文 | 读取最近对话；按账号和商品引用加载商品；按账号/买家加载订单摘要 |
| 生成 | 模板生成器使用商品安全字段；输出做控制字符、长度和敏感内容校验 |
| 回复投递 | simulate 只记录调用并返回 `simulated`；live 发送器仅有 callback 委托单测，尚无真实闲鱼发送或应用级 live E2E 证据 |
| 落库 | AI 出站消息 `source=ai`、合成 external ref、`auto_reply_runs.status=persisted`；重复事件不产生重复消息 |

可复现命令：

```bash
npm --workspace apps/api run test:auto-reply:unit
npm --workspace apps/api run test:auto-reply
npm --workspace apps/api run test:auto-reply:e2e
npm run db:migrate
npm --workspace apps/api run test:auto-reply:postgres
npm run typecheck
npm test
npm run build
npm run compose:config
git diff --check
```

## 证据等级与缺口

当前仓库的“E2E”是受控跨层验证，不是完整生产链路验收：

- `test:auto-reply:e2e` 使用 `FakeSocket`、stub credential、`MemoryStore` 和 `AUTO_REPLY_SEND_MODE=simulate`，覆盖 push 事件解析、入站幂等、意图/上下文/订单隔离、AI 出站落库和重复事件不重复发送；断言闲鱼发送 endpoint 调用数为 `0`。
- `test:auto-reply:postgres` 使用真实 PostgreSQL 和 `021_auto_reply_runs.sql`，但直接调用 `handleExternalEvent`，发送器仍为 `simulate`；它只证明消息与运行记录在 API 重启后可回读。
- `test:auto-reply:unit` 覆盖分类器、模板生成器、白名单配置和 `ExternalAutoReplySender` 的 callback 委托；没有覆盖真实 `sendByReceiverScope` 响应、外部消息回执或发送失败/unknown 恢复。
- `test:xianyu-im-gateway` 覆盖历史响应不触发 `onEvent`，以及“响应 + 同帧 `syncPushPackage`”仍能 ACK 并触发 `onEvent`；`probe:xianyu-im-gateway` 可用真实凭证只读监听网关，永不调用 `handleExternalEvent` 或发送消息。
- WebSocket listener 已按官方同步协议处理 `syncExtraType`：收到同步状态提示后请求 `/r/SyncStatus/getState`，再用返回的 `body` 调 `/r/SyncStatus/ackDiff`；连接建立时不再伪造初始 `ackDiff`。
- 2026-09-21 的 PostgreSQL 凭证只读探针已连上 `wss://wss-goofish.dingtalk.com/`，完成 `/reg`、`/r/SyncStatus/ackDiff` 和 `/r/MessageManager/listUserMessages`，回读 20 条历史消息并观察到 `/s/vulcan` 同步帧；探针期间没有新的买家消息，因此 `onEventCount=0`，这不是完整真实买家 push E2E 证据。
- 2026-09-21 已完成一次人工真实链路验证：买家“一只橘喵喵亮晶晶”发送文本后，卖家账号产生 `xianyu:push:*` 入站事件，`auto_reply_runs` 为 `decision=replied/status=persisted/sender_outcome=known_success`，并落库一条 `source=ai` 的出站消息；同一消息在买家账号上的回显被 `TEST_BUYER_NOT_ALLOWLISTED` 正确跳过。该证据证明真实 push→自动回复→live 发送→落库闭环，但仍不是可重复的自动化 live smoke。
- 当前没有浏览器入口驱动的真实买家 push→自动回复闭环、真实 live 发送、跨进程 Worker 或发布级恢复的自动化证据；已有的真实 WebSocket/凭证探针只证明连接与历史读取，不足以把上述命令标记为“完整 E2E”或生产级验收。

截至 2026-09-21，仓库已有一次人工 live 证据，但仍没有可重复命令、固定输出或归档文件证明 `AUTO_REPLY_SEND_MODE=live` 已完成自动化真实发送 smoke。后续人工 live 复核仍需单独归档：脱敏输入与账号范围、外部消息引用、`auto_reply_runs`/`messages`/`audit_events` 回读、失败或 unknown 处理，以及清理结果。

未纳入自动化门禁的受控真实发送配置：

```env
AUTO_REPLY_SEND_MODE=live
AUTO_REPLY_TEST_BUYER_NAMES=["一只橘喵喵亮晶晶"]
```

白名单按 JSON 数组解析（同时兼容旧的逗号分隔字符串）；不配置白名单时，live 模式会在启动阶段失败，不会默认放开全部买家。自动化测试应显式覆盖 `AUTO_REPLY_SEND_MODE=simulate`，避免触发真实发送。

PostgreSQL 真实回读使用同一编排器和 `021_auto_reply_runs.sql` 迁移；若数据库或闲鱼外部凭证不可用，必须将结果标记为部分验证/阻塞，不能把 MemoryStore smoke 当成发布级证据。

## 回滚

停止 `AutoReplyService` 注入或将 `enabled=false`，保留历史入站消息、AI 出站消息和审计；删除/回退迁移前先停止自动回复写入并完成表数据备份/验证，不能物理删除消息历史。
