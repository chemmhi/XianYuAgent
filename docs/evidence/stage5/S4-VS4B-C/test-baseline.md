# S4-VS4B/C 订单交付基线（2026-10-05）

## 已完成

- `POST /api/v1/orders/{orderNo}/delivery-preview`：支付、售后、账号 scope、商品关联、卡券批次和 deliveryType 校验；预览不消费卡券、不写 DeliveryRecord。
- `POST /api/v1/orders/{orderNo}/deliver`：`manual`、`no_logistics`、`coupon_only`、`mixed` 四种模式进入 `OrderDeliveryService`，写入 `DeliveryRecord`，复用 execution Outbox 与 Idempotency-Key。
- `POST /api/v1/orders/{orderNo}/retry`：失败记录可重试；`unknown` 先调用权威订单状态读取，确认已发货才回写成功，未知时不盲目重放。
- `POST /api/v1/orders/{orderNo}/cancel`：未完成交付记录可取消并保留审计。
- Workspace：订单发货、重试、取消先生成 Confirmation，确认后调用同一订单交付服务。

## 受控证据

- `npm run test:order-delivery`：通过；覆盖 MemoryStore、HTTP route、DeliveryRecord、Outbox、幂等和 Workspace Confirmation。
- `npm run test:orders`：通过；订单只读/刷新回归未受影响。
- `node --import tsx --test scripts/workspace-commands.test.ts`：9/9 通过。
- `npm run test:workspace-platform`：通过。
- `npm run build`：通过。

## 仍开放的发布门禁

- PostgreSQL migration `047_order_delivery_records.sql` 的真实实例 smoke 与重启复读。
- 明确闲鱼测试账号下的真实确认发货、卡券发送、超时/unknown、人工恢复和取消演练。
- Orders/Workspace 桌面 1440×900 与移动 390×844 浏览器视觉证据。

## 2026-10-05 增量复核

- `apps/api/migrations/047_order_delivery_records.sql` 已补齐 `coupon_item_id` 外键与成功记录部分唯一索引。
- `OrderDeliveryService` 已修复重复 `Idempotency-Key` 在订单已完成后被预览门禁拦截的问题；重放返回原 `DeliveryRecord`，跨订单复用返回 `IDEMPOTENCY_CONFLICT`。
- Memory/PostgreSQL DeliveryRecord 更新均改为保留未传入字段；成功卡券交付会记录 `couponItemId`，并由数据库唯一索引防止重复成功消费。
- Workspace 发货 Confirmation 生成前会先执行交付预览，明显缺少物流引用或交付配置时直接返回可解释校验错误。
- 新增 `npm run test:order-delivery:postgres`，覆盖迁移存在性、DeliveryRecord、CouponItem 唯一性、Outbox、幂等重放和重启复读；本环境执行结果为 `ECONNREFUSED 127.0.0.1:5432`，因此 PostgreSQL 证据仍未关闭。
