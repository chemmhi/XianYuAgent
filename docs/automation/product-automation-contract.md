# 商品自动化后端契约（2026-09-22）

本契约冻结商品级四类自动化规则的配置边界，供前端、Worker 和外部闲鱼适配器联调。卡券正文不进入本接口；规则只保存卡券批次选择和执行参数。

## 资源模型

`ProductAutomationConfigRecord` 字段：

- `id`：内部 UUID；首次读取但未保存时返回虚拟值 `virtual:{productId}`。
- `productId`、`accountId`：商品及账号归属，服务端从商品关系推导，不信任客户端覆盖。
- `configVersion`：乐观锁版本，初始为 `1`，成功更新后加一。
- `configDigest`：服务端对规范化配置计算的摘要。
- `config`：四条规则对象。
- `createdAt`、`updatedAt`：UTC ISO 时间。

默认规则：

```json
{
  "paidAutoDelivery": {
    "enabled": false,
    "couponBatchIds": [],
    "autoConfirm": false,
    "maxAttempts": 3,
    "retryBackoffSeconds": 30
  },
  "unpaidAutoReprice": {
    "enabled": false,
    "mode": "fixed",
    "targetPriceMinor": 0,
    "maxAttempts": 3,
    "retryBackoffSeconds": 30
  },
  "reviewGift": {
    "enabled": false,
    "couponBatchIds": [],
    "maxAttempts": 3,
    "retryBackoffSeconds": 30
  },
  "reviewReminder": {
    "enabled": false,
    "firstDelayHours": 72,
    "repeatIntervalHours": 24,
    "maxReminders": 1,
    "message": "如果使用满意，欢迎给个好评，谢谢支持～"
  }
}
```

## HTTP API

所有接口都需要管理员 Session；非 GET 请求还需要 CSRF 和 `Idempotency-Key`。

### 读取单商品规则

`GET /api/v1/products/{productId}/automation`

返回 `data` 为 `ProductAutomationConfigRecord` 与 `product={id,accountId,title}`。无已保存规则时返回默认配置，版本为 `1`，不会隐式写库。

### 保存单商品规则

`PUT/PATCH /api/v1/products/{productId}/automation`

请求头：`If-Match-Version: <configVersion>`；请求体必须为 `{ "config": { ... } }`。

- 版本冲突：`409 AUTOMATION_VERSION_CONFLICT`。
- 商品不存在或不在当前管理员账号范围：`404 NOT_FOUND`。
- 卡券批次不存在、跨账号、已作废/关闭、或 `deliveryScope` 不是 `buyer_deliverable`：分别返回 `404`、`403`、`409`、`422`。
- 规则参数超界、提醒文本为空、批次 ID 非字符串：`422 VALIDATION_FAILED`。

### 批量保存规则

`POST /api/v1/products/automation/batch`

请求体：

```json
{
  "productIds": ["uuid-1", "uuid-2"],
  "expectedConfigVersions": { "uuid-1": 1, "uuid-2": 1 },
  "config": { "...": "与单商品接口相同" }
}
```

批量写入在 Postgres 单事务内执行，任一商品不存在、跨账号或版本冲突时整体回滚；MemoryStore 先完成全部校验再提交，保持相同的全有或全无语义。商品数量限制为 1–100。

## 执行契约

`AutomationWorkflowService` 通过 `AutomationExecutionPort` 注入外部副作用，禁止路由直接调用闲鱼写接口。

- 付款后自动发货：先 `reserveCoupon`，再 `sendCoupon`，成功后 `commitCoupon`，仅当 `autoConfirm=true` 才调用 `confirmShipment`。明确发卡失败才 `releaseCoupon`；网络超时/结果不确定时保留 reservation 并转入 `manual_review`，避免未知结果后重复发卡。确认发货未知或失败同样进入 `manual_review`，不得再次发卡。
- 拍下未付款自动改价：只处理 `paymentStatus=unpaid`；价格使用分；外部返回 `unknown` 时结果为 `unknown`，绝不伪造成功。改价成功后文本发送失败不回滚改价，文本未知进入 `manual_review`。
- 评价后发送赠品：先 `persistReviewFact` 再申请赠品库存；评价事实已存在时跳过。明确赠品发送失败才释放预留库存；网络超时/结果不确定时保留 reservation 并转入 `manual_review`，评价事实不会被清除，避免未知结果后的重复赠品。
- 超时未评价求评价：执行前读取订单，必须满足已发货、未评价、有会话；达到首次/重复间隔且未超最大次数。消息发送前再次 `readOrder`，若期间已评价或不再满足条件则跳过。

所有流程执行键均按账号+订单+规则生成并做输入指纹校验；同键同输入返回原结果，同键不同输入返回 `409 IDEMPOTENCY_CONFLICT`。同一执行键的并发调用共享 in-flight Promise，避免两个 Worker 同时发卡或改价。

## 事件入口与默认阻断

本切片已提供真实应用装配边界，并将真实闲鱼写操作收敛到独立适配器：

- `OrderService.refresh` 完成订单 upsert 后调用 `ProductAutomationWorker.processOrderRefresh`；已付款订单进入付款后发货触发点，未付款订单进入自动改价触发点。
- 外部订单 upsert 会在同账号范围内用 `item.productId` 或 `products.external_product_ref = item.itemId` 回填 `order.productId`；无法关联商品时才会返回 `PRODUCT_LINK_MISSING` 并跳过自动化，禁止跨账号猜测商品。
- `XianyuImService.handleExternalEvent` 在消息落库后调用 `ProductAutomationTrigger.onImEvent`。IM 传输本身不是订单/评价协议，只有上游适配器显式写入 `raw.productAutomation={kind:'review_created',orderNo,eventId}` 才会触发评价赠品；普通聊天文本永远不会被当作评价事实。
- `ProductAutomationWorker.pollReviewReminders` 提供按账号扫描已发货订单的调度入口，调用方负责分钟级 cron/worker 周期。
- 生产装配已接入 `XianyuProductAutomationExecutionAdapter`，复用闲鱼 MTOP、IM 和卡券 reservation 存储；但默认仍为 `simulate + 未确认`，入口统一返回 `blocked/PRODUCT_AUTOMATION_LIVE_MODE_REQUIRED`，不调用外部写操作。只有显式 live 模式、人工确认和持久化商品标题白名单同时满足时，才允许真实执行；当前白名单初始仅包含 `2026年奥维高清地图骗局`。

当前仍未完成真实账号、订单和 IM 会话的 live mutation 验收；MTOP/IM 契约测试、白名单零副作用测试、Memory/Postgres reservation 并发/过期测试已通过。没有明确的测试账号、订单号和人工确认前，不执行真实发货、改价或发消息。

受控真实测试入口为 `npm --workspace apps/api run test:product-automation:live-order`，必须同时提供 `PRODUCT_AUTOMATION_LIVE_TEST=1`、`PRODUCT_AUTOMATION_LIVE_CONFIRM_TEXT="I UNDERSTAND REAL XIANYU MUTATION"`、`PRODUCT_AUTOMATION_EXECUTION_MODE=live`、`PRODUCT_AUTOMATION_LIVE_CONFIRMED=true`、`ADMIN_ID`、`ACCOUNT_ID`、`ORDER_NO` 和 `PRODUCT_AUTOMATION_LIVE_ACTION`；脚本会再次读取本地商品主数据并确认标题精确等于白名单值。
