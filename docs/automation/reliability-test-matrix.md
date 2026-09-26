# 商品自动化可靠性测试矩阵（2026-09-22）

目标不是验证接口 200，而是验证状态、批量卡券项、外部结果和持久化边界。每项都必须断言可观察结果与副作用调用顺序。

| 流程 | 正常 | 失败/恢复 | 重复/幂等 | 超时/未知 | 持久化失败 | 权限/隔离 |
| --- | --- | --- | --- | --- | --- | --- |
| 付款后自动发货 | 已付款、规则启用、按订单数量预留→发卡→提交批量卡券项；autoConfirm 开关决定是否确认发货 | 发卡失败释放预留；可交付项不足不发卡；确认失败进入人工复核 | WS 重放同 execution key 不二次发卡；不同输入同 key 返回冲突 | 发卡未知释放预留并返回 unknown；确认未知不重复发卡且进入 manual_review | 配置版本冲突、审计写失败、事务回滚后重试不产生孤儿配置/批量项 | 商品、卡券批次、订单必须同账号；无 scope 返回 403 |
| 拍下未付款自动改价 | 仅未付款事件触发；元转分；固定改价与 AI 模式互斥（当前配置只允许 fixed） | 外部拒绝返回 failed；不写成功状态；文本失败不回滚已成功改价 | 事件重放不二次改价；刷新订单列表不产生执行键 | 外部 unknown 保留 unknown，等待查询/人工恢复 | 配置保存失败不改变旧版本；改价结果落库失败需可重放而不伪造成功 | 账号隔离；跨账号订单/商品拒绝 |
| 评价后发送赠品 | `BUYER_RATE_SELLER` 事实先持久化，再按赠品批次和数量预留→发卡→提交批量卡券项 | 发卡失败/未知释放预留项；事实保留；人工复核不重新提醒 | 同评价事件只产生一份赠品；同 key 不同 eventId 冲突 | 外部未知不盲重试；预留超时可回收 | 评价事实写失败时禁止消费批量项；批量配置事务回滚 | 赠品卡券配置与发货配置隔离；跨账号禁止 |
| 超时未评价求评价 | 只处理已发货、未评价、有会话且达到 4320分钟/1440分钟 窗口；只发文本；计数受上限约束 | 单订单发送失败隔离，不影响其他订单；下次调度可重试 | 同订单同提醒次数 execution key 幂等；超过 maxReminders 跳过 | 入队后执行前二次读取，期间评价则跳过；消息 unknown 保留 unknown | 调度状态写失败不能增加提醒次数；消息已发时重放不重复发送 | 账号 scope、会话归属、订单归属都需校验 |

## 最低测试集

1. `product-automation.test.ts`：默认配置、字段边界、批次账号/生命周期校验、版本冲突、批量全回滚、幂等冲突。
2. `product-automation-workflows.test.ts`：四流程分别覆盖成功、失败、预留释放、unknown/manual_review、重复事件、输入指纹冲突、提醒执行前二次校验。
3. `product-automation-api-smoke.mjs`：真实 HTTP Session/CSRF/Idempotency，单商品读写、批量读写、403/404/409/422，以及保存后重新 GET。
4. `product-automation-postgres-smoke.mjs`：应用 `031_product_automation.sql`，验证事务回滚、重启后配置复读、账号隔离和版本冲突。

## 当前证据状态

4. `product-automation-trigger.test.ts`：订单刷新触发、IM 显式评价信封、提醒 Worker、幂等、账号边界、审计故障隔离、事实持久化失败阻断、`externalProductRef → productId` 关联。
5. `product-automation-entry-smoke.mjs`：真实 `createApp` 装配链路，订单刷新 API → 自动化触发结果、IM 事件 → 评价入口、提醒 Worker；默认未配置外部 MTOP 时断言 `blocked/AUTOMATION_EXECUTION_NOT_CONFIGURED`。
6. `product-automation-postgres-smoke.mjs`：应用 `031_product_automation.sql`，验证事务回滚、重启后配置复读、账号隔离和版本冲突。

## 当前证据状态

- 已实现：MemoryStore/PostgresStore 契约、迁移、配置服务、四流程可注入执行服务、订单刷新/IM/提醒 Worker 入口。
- 已验证：配置/工作流/入口/商品关联 13 项定向测试、API smoke、真实应用装配跨层 smoke、PostgreSQL migration/重启复读及商品关联 smoke、TypeScript build。
- 未完成：闲鱼真实支付/评价事件字段解析与发卡、确认发货、改价、消息发送 MTOP 写适配器；生产默认明确阻断，不得将入口 smoke 当作真实外部写入验收。
- 未通过这些命令前，不得将本切片标记为 READY_FOR_MERGE；外部闲鱼真实账号写入仍需人工批准和受控环境。
