# S4-VS4A 订单列表切片验证基线

- 日期：2026-09-20
- 范围：`/orders` 前端只读列表切片（筛选、分页、四套状态、只读详情抽屉、移动端卡片化）
- 非目标：`delivery-preview`、发货/取消/重试、库存锁定、DeliveryRecord、Outbox 和真实闲鱼订单同步后端。

## 已实现

- `apps/web/src/features/orders/`：`OrdersPage`、`OrderSyncToolbar`、`OrderFilters`、`OrderTable`、`OrderDetailDrawer`、状态边界、controller、API adapter、mock fixture。
- `apps/web/src/app/App.tsx`：正式接入 `/orders` 路由，移除 Placeholder 页面。
- 四套状态独立呈现：支付、订单、发货、售后；列表不返回卡券正文或买家可交付敏感内容。
- 桌面表格对齐现有 Products/Coupons 壳层；移动端改为卡片化订单流和底部详情抽屉。

## 已验证

- `npm --workspace apps/web run typecheck`：通过。
- `npm --workspace apps/web run test`：25 个测试文件、88 个用例通过；新增订单 API/controller 测试覆盖筛选序列化、账号隔离、四态映射、403/404/网络错误。
- `npm --workspace apps/web run build`：通过。
- `npm run build`：API + Web 生产构建通过。
- `git diff --check`：通过。

## 阻塞与未覆盖

- `apps/api` 当前没有订单 migration/store/service/route；正式 `/api/v1/orders`、`/api/v1/orders/{orderNo}`、`POST /api/v1/orders/refresh` 尚未落地，因此 live API、PostgreSQL 持久化复读和真实 Chrome/CDP 订单 E2E 尚未执行。
- 当前验证不能宣称订单切片整体完成；状态为 `PARTIALLY_VERIFIED`，需先补后端只读契约，再执行 1440×900 / 390×844 视觉截图、空态/403/刷新/详情/分页 E2E 与独立视觉复审。

## 回滚

- 回滚 `apps/web/src/app/App.tsx` 对 `OrdersPage` 的路由接入，即可恢复原 `/orders` Placeholder；删除 `apps/web/src/features/orders/` 不影响现有账号、商品、卡券、聊天和 Workspace 切片。

