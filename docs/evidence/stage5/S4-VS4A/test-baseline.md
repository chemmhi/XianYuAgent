# S4-VS4A 订单列表切片验证基线

- 日期：2026-09-20
- 范围：`/orders` 订单只读列表界面修订：账号 scope、订单号/买家昵称/商品名称关键词、单一业务状态筛选、六列表格、买家姓名悬浮提示、表格内部滚动、分页、详情抽屉、本地刷新、闲鱼刷新、桌面/移动响应式。
- 非目标：`delivery-preview`、发货/取消/重试、库存锁定、DeliveryRecord、Outbox、买家交付正文和订单写动作。
- 结论：`PARTIALLY_VERIFIED/BLOCKED（S4-VS4A 只读订单列表切片）`；受控前后端、PostgreSQL、Chrome/CDP 和参考项目响应解析均通过，但真实 seller 订单接口对当前账号返回 `PERMISSION_EXCEPTION::无权限访问`，因此不能宣称真实闲鱼订单读取已通过；`S4-VS4B/C` 继续保持后置。

## 实现边界

- 前端：`apps/web/src/features/orders/` 按 api/controller/types/components 拆分；正式接入 `/orders`；移除 `orders-page-title`，筛选区仅保留关键词搜索和“全部/待付款/待发货/待收货/待评价/退款中”单一状态下拉；桌面六列加操作列在 1440×900 内展示，表格区域内部滚动并保留分页，买家昵称通过原生悬浮提示展示可用买家姓名，移动端回退为卡片流与底部详情抽屉。
- 后端：`OrderService`、MemoryStore/PostgresStore、账号 scope、分页/筛选、只读详情与 refresh；API 为 `GET /api/v1/orders`、`GET /api/v1/orders/{orderNo}`、`POST /api/v1/orders/refresh`。
- 数据库：`apps/api/migrations/018_orders.sql` 创建 `orders.orders`，包含四态约束、`(account_id, order_no)` 唯一约束、账号/商品外键和列表索引。
- 闲鱼：`XianyuMtopClient.fetchOrdersAll` + mapper 只读拉取；请求按 Ydisks seller 工作台契约发送 `rowsPerPage/orderIds/queryCode/orderSearchParam`，并使用 seller origin/referer、`valueType=string`；不发送会触发 `PERMISSION_EXCEPTION::无权限访问` 的 `idle_site_biz_code` 请求头；解析 `data.module.items` 与 `commonData/buyerInfoVO/priceVO/rightVO`；金额统一为分、时间统一 ISO UTC；凭证失效、权限拒绝和业务失败映射为可识别错误，不返回 Cookie/Token/原始 payload。

## 已验证

- `npm run db:migrate`：PostgreSQL 实际应用 `018_orders.sql`。
- `npm run typecheck`：API + Web 通过。
- `npm test`：API 全部 smoke 通过；Web 34 个测试文件 / 105 个用例通过。
- `npm run build`：API + Web production build 通过。
- `npm --workspace apps/api run test:orders`：未认证 401、账号 scope/403、关键词/四态筛选、详情 404、refresh 成功/错误边界通过。
- `npm --workspace apps/api run test:orders:postgres`：真实 PostgreSQL create/list、HTTP `/orders`、refresh upsert、API 重启后复读和测试数据清理通过。
- `npm run test:e2e:chrome:orders`：真实 Vite + live API + MemoryStore + headless Chrome/CDP 通过，覆盖账号切换、六列表头、单一状态筛选、关键词搜索、买家姓名悬浮提示、详情抽屉、分页、表格内部滚动、本地刷新不触发闲鱼、闲鱼 refresh upsert 和账号隔离。
- 视觉证据：`docs/evidence/stage5/S4-VS4A/screenshots/orders-desktop-1440x900.png`、`orders-mobile-390x844.png`；桌面列完整可见，移动端无横向溢出。
- 受控参考响应：`apps/api/scripts/xianyu-order-mapper-smoke.mjs` 解析 `data.module.items` 下的真实 seller 结构，金额、状态、分页断言通过。
 - 受控请求契约：`apps/api/scripts/xianyu-order-request-smoke.mjs` 断言 `rowsPerPage/orderIds/queryCode/orderSearchParam`、seller origin/referer、`type=json`、`valueType=string`、`spm_cnt`，并确认 `idle_site_biz_code` 未发送且返回订单可进入 `fetchOrdersAll`。
 - 历史失败复验：旧实现携带 `idle_site_biz_code: COMMONPRO` 时，真实 active 凭证返回 `MTOP_PERMISSION_DENIED / PERMISSION_EXCEPTION::无权限访问`；该失败已保留为回归证据。
 - 最新实闲鱼读取：移除该请求头后，PostgreSQL 中现有 active 凭证的 `fetchOrdersAll` 真实返回 5 条订单；Chrome/CDP 触发 `POST /api/v1/orders/refresh` 后，订单写入 PostgreSQL 并在 `/orders` 页面可见。未伪造订单数据，未输出凭证或原始 payload。
 - 受控请求契约：`apps/api/scripts/xianyu-order-request-smoke.mjs` 断言 `rowsPerPage/orderIds/queryCode/orderSearchParam`、seller origin/referer、`type=json`、`valueType=string`、`spm_cnt`，并确认 `idle_site_biz_code` 未发送且返回订单可进入 `fetchOrdersAll`。
 - 历史失败复验：旧实现携带 `idle_site_biz_code: COMMONPRO` 时，真实 active 凭证返回 `MTOP_PERMISSION_DENIED / PERMISSION_EXCEPTION::无权限访问`；该失败已保留为回归证据。
 - 最新实闲鱼读取：移除该请求头后，PostgreSQL 中现有 active 凭证的 `fetchOrdersAll` 真实返回 5 条订单；Chrome/CDP 触发 `POST /api/v1/orders/refresh` 后，订单写入 PostgreSQL 并在 `/orders` 页面可见。未伪造订单数据，未输出凭证或原始 payload。
 - 本轮“当前状态”是前端对既有支付/订单/发货/售后 canonical 字段的展示投影；下拉选项映射回现有四态查询字段，未改变后端订单记录模型。买家昵称与实名字段目前仍共用既有 `buyerName` 契约，后续可在订单详情/数据契约切片中补充分离字段。
- `git diff --check`：通过。

## 评审与风险边界

- 业务/验收复核：PASS；前端只读入口、四态独立展示、账号隔离、空/错/403/详情/分页状态均有覆盖。
- 架构/数据流复核：PASS；迁移、Store、Service、HTTP route、闲鱼 mapper 职责分离，PostgreSQL 重启复读通过。
- 质量/视觉复核：受控浏览器与截图 PASS；真实外部只读读取 BLOCKED（当前账号权限拒绝），截图与 E2E 证据已归档。
- 当前仍开放：补充完整浏览器 Cookie/Jar 或可访问 seller 订单的真实账号、真实订单非空业务场景、交付预览、发货、取消、重试、库存锁、Outbox、DeliveryRecord 和发布级回滚/Testcontainers。

## 回滚

- 应用回滚：回退 `fd8f560`（后端订单只读链路）与 `ee4712d`（前端订单列表切片）对应提交即可恢复订单页 Placeholder。
- 数据库回滚：保留 `018_orders.sql` 的 expand 结果；回退应用后不删除历史订单表，按项目迁移回滚纪律由后续发布门禁决定。
