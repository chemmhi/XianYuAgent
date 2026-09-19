# S4-VS2 商品管理首片验证基线

- 验证日期：2026-09-19
- 本次范围：当前管理员账号范围内的商品只读列表、筛选/分页、商品详情、PostgreSQL 持久化读取、正式 `/products` 页面和本机 Chrome/CDP 端到端链路。
- 明确不在本次范围：商品创建/编辑、SKU 写入、素材上传、闲鱼商品同步/拉取、发布确认、Policy、Confirmation、Idempotency、Outbox。

## 代码与数据边界

- 迁移：`apps/api/migrations/003_catalog.sql`，创建 `products.products`、`products.product_skus`、`products.asset_refs`，包含账号外键、状态约束、金额非负约束、外部商品引用部分唯一索引和列表索引。
- 后端：`ProductService` 只读编排；`MemoryStore` 与 `PostgresStore` 均按管理员账号 scope 过滤；商品列表和详情不暴露闲鱼原始响应。
- API：`GET /api/v1/products`、`GET /api/v1/products/{id}`；支持 `keyword`、`accountId`、`status`、`sortBy`、`sortOrder`、`page`、`pageSize`；未登录、越权、非法分页和不存在商品分别返回统一错误 envelope。
- 前端：`apps/web/src/features/products/` 按 `api / controller / components / types` 拆分；`ProductsPage` 不直接持有 HTTP、数据库或外部适配器逻辑。

## 已实际执行的命令

| 层级 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | 通过 |
| API 单元/契约 smoke | `npm run test:api` | 通过：env0、onboarding、products read slice |
| Web 单元/适配器测试 | `npm run test:web` | 通过：7 files / 21 tests |
| PostgreSQL 真实持久化 | `npm run test:products:postgres` | 通过：真实 PostgreSQL、重复执行 003 迁移、列表/详情读取、清理测试管理员/账号/商品 |
| Chrome/CDP 端到端 | `npm run test:e2e:chrome:products` | 通过：真实 API + MemoryStore，商品列表 → 详情 → 刷新后仍可见 |
| 账号回归 E2E | `npm run test:e2e:chrome` | 通过：账号登录切片未回归 |
| 构建 | `npm run build` | 通过：API TypeScript + Vite production build |
| Compose 配置 | `npm run compose:config` | 通过 |
| 差异检查 | `git diff --check` | 通过 |

## 证据文件

- 桌面截图：`screenshots/products-desktop-1440x900.png`
- 移动截图：`screenshots/products-mobile-390x844.png`
- API 内存 smoke：`apps/api/scripts/products-smoke.mjs`
- API PostgreSQL smoke：`apps/api/scripts/products-postgres-smoke.mjs`
- Chrome/CDP E2E：`apps/web/scripts/e2e-products-chrome.mjs`

## 结论与回滚

- 结论：S4-VS2 的“商品列表 + 商品详情只读首片”通过；完整商品管理切片仍未完成，不能宣称商品编辑、素材、SKU、同步或发布已完成。
- 回滚：删除 `003_catalog.sql` 对应的业务代码与路由，停止 `/products` 真实 API 调用，保留既有账号切片和历史迁移；数据库回滚前先确认没有后续商品数据依赖，不能直接删除已有审计或账号数据。
- 未关闭风险：真实闲鱼商品同步协议、对象存储、商品写入状态机、发布确认/Outbox 和发布级迁移回滚仍按 `docs/06-risk-register.md` 跟踪。
