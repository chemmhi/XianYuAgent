# 自动回复链路切片（2026-09-20）

## 目标与边界

本切片验证闲鱼入站消息从平台适配器进入当前项目后，经过安全决策和上下文组装，生成一条可解释的 AI 回复，并通过可替换发送器完成模拟投递或受控真实投递，最后把入站消息、出站 AI 消息和脱敏运行证据写入项目存储。

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
| 回复投递 | simulate 只记录调用并返回 `simulated`；live 通过 `XianyuImService.sendExternalText` 投递，且不重复写本地 human 出站消息 |
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

受控真实发送配置：

```env
AUTO_REPLY_SEND_MODE=live
AUTO_REPLY_TEST_BUYER_NAMES=["一只橘喵喵亮晶晶"]
```

白名单按 JSON 数组解析（同时兼容旧的逗号分隔字符串）；不配置白名单时，live 模式会在启动阶段失败，不会默认放开全部买家。自动化测试应显式覆盖 `AUTO_REPLY_SEND_MODE=simulate`，避免触发真实发送。

2026-09-21 真实 live smoke 已在白名单买家“一只橘喵喵亮晶晶”的现有会话上执行：入站事件完成意图识别、商品/通用上下文加载、回复生成、闲鱼真实发送和 PostgreSQL 落库；结果为 `status=persisted`、`decision=replied`、`senderOutcome=known_success`，外部消息引用已回读，AI 出站消息 `source=ai`。测试产生的入站事件与 AI 出站消息作为审计证据保留。

PostgreSQL 真实回读使用同一编排器和 `021_auto_reply_runs.sql` 迁移；若数据库或闲鱼外部凭证不可用，必须将结果标记为部分验证/阻塞，不能把 MemoryStore smoke 当成发布级证据。

## 回滚

停止 `AutoReplyService` 注入或将 `enabled=false`，保留历史入站消息、AI 出站消息和审计；删除/回退迁移前先停止自动回复写入并完成表数据备份/验证，不能物理删除消息历史。
