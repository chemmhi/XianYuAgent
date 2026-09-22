# 商品自动化配置架构

## 模块边界

### 前端

- `ProductsPage`：商品列表、选择状态、批量入口；
- `ProductAutomationDrawer`：单商品四类规则配置；
- `CouponSelectorDialog`：卡券搜索、选择、左右移动与保存；
- `ProductAutomationController`：加载、保存、提交中、错误与版本冲突状态；
- `ProductAutomationApi`：仅负责自动化配置 API 适配与视图模型转换。

### 后端

- 路由层：鉴权、账号/商品范围校验、错误映射；
- 应用服务：规则读取、保存、批量保存、版本控制；
- 领域层：四类规则校验、默认值、互斥约束、幂等策略；
- 仓储层：商品级自动化规则与版本审计持久化；
- 执行层：复用现有 automation center / scheduler / action executor，不复制第三方调用。

## 数据与接口

建议接口：

```text
GET  /api/v1/products/:id/automation
PUT  /api/v1/products/:id/automation
POST /api/v1/products/automation/batch
POST /api/v1/products/:id/automation/preview
```

保存请求必须携带 `If-Match-Version` 与 `Idempotency-Key`。批量保存按商品逐项返回成功/失败结果，不能因为单个商品失败而伪造全部成功。

## 外部动作安全边界

- 发卡成功后才能确认发货；
- 外部结果未知禁止自动确认发货，进入人工复核；
- 卡券库存消费与恢复必须保持幂等；
- 延迟求评价任务执行前再次核验评价状态；
- 账号级自动确认关闭时只能发卡，不确认发货。

## 回滚

- 规则写入失败不改变旧版本；
- 版本冲突返回 409，由前端重新读取；
- 迁移提供 down/回退说明；
- 代码切片按独立 Git 提交回滚，不删除历史测试与证据。
