# 阶段 5 执行进度：S4-VS1 至 S4-VS4 切片索引

- 日期：2026-09-19
- 阶段状态：进行中；S4-VS1 已获人工放行，S4-VS2 只读/同步首片已完成受控验证，S4-VS3 已合入但仍待真实环境人工审核，后续切片已完成拆分但尚未实现。
- 当前唯一目标：按 `docs/04-plan.md` 逐片推进未完成工作，不把 mock、MemoryStore、fixture、API 200 或页面可打开当作完整交付。

## 状态矩阵

| 切片 | 当前状态 | 已有证据 | 未完成门禁 |
| --- | --- | --- | --- |
| `S4-VS1` 账号管理 | `PASS`（人工放行范围内） | 账号列表、Cookie 登录、QR 受控流程、Chrome/CDP 和截图 | 真实 APP 扫码/外部 Cookie 与发布级恢复仍由横向门禁承接 |
| `S4-VS2` 商品列表/详情与同步首片 | `PASS`（首片范围） | PostgreSQL smoke、MTOP mapper、Chrome/CDP fixture E2E | 完整写入、SKU、素材、发布、真实外部账号验收仍未完成 |
| `S4-VS2A` 商品草稿基础信息 | `PLANNED` | 已有 Product VM / route / store 基础 | 真实 create/detail/PATCH、版本冲突、403/404、桌面/移动 E2E |
| `S4-VS2B` SKU / 多规格 | `PLANNED` | 阶段 2/3 已冻结 `SkuVM` 边界 | SKU 约束、并发、部分成功、持久化复读 |
| `S4-VS2C` 商品素材 / MinIO | `PLANNED` | `AssetRef` 契约已写入数据文档 | MinIO contract、失败/过期/删除/重启恢复、截图 |
| `S4-VS2D` 受控发布 | `PLANNED` | Policy/Confirmation/Outbox 设计已存在 | worker、幂等、unknown/timeout、人工恢复、审计 |
| `S4-VS2E` 商品外部同步真实验收 | `PARTIALLY_VERIFIED` | 受控 MTOP mapper、Memory/Postgres、fixture E2E | 当前已登录 Chrome + 真实闲鱼账号、分页和数量口径复核 |
| `S4-VS3` 卡券首页 | `READY_FOR_REVIEW` | API smoke、Chrome/CDP、桌面/移动截图、代码已合入 master | 真实 PostgreSQL/Redis/MinIO、逐状态人工浏览器审核、迁移整理 |
| `S4-VS3A/B` 卡券明细/素材/库存锁 | `PLANNED` | `CouponItem`、`CouponAssetRef`、`InventoryLockVM` 契约已冻结 | bulk-save/delete、MinIO、reserve/consume/release、敏感交付边界 |
| `S4-VS4A/B/C` 订单与交付 | `PLANNED` | 订单 API、四态、delivery mode 契约已冻结 | 只读、预览、库存锁、交付动作、unknown/重试/取消 |
| `S4-ENV-RECOVERY` | `BLOCKED` | Compose/健康检查/部分持久化已有证据 | 完整迁移回滚、Testcontainers、Redis/MinIO 重启和发布级恢复 |
| `S4-EXT-ACCOUNT` | `BLOCKED` | 真实模式 QR 探针与受控 Cookie 链路 | 真实 APP 扫码、外部 Cookie、`loginuser.get` 资料同步 |
| `S4-ENV-RUNTIME` | `PLANNED` | 独立 Runtime 架构决策已存在 | 健康、超时、重试、取消、不可用和观测 |

## 已落地与已验证

- `apps/api/` 已具备统一 envelope、HttpOnly Session、CSRF 双提交、幂等、账号 scope、最小审计、Memory/Postgres store 和独立 Worker。
- `apps/web` 已按 feature/controller/ViewModel/state boundary 接入账号、商品、卡券首片；Products/Coupons 的桌面/移动截图已生成。
- `npm run verify`、商品 PostgreSQL smoke、商品/卡券 Chrome/CDP E2E 和 Compose 配置检查已有历史通过记录；这些记录只覆盖对应首片和受控环境。
- `docs/04-plan.md`、`docs/02-data-api.md`、`docs/03-component-contract.md`、`docs/06-risk-register.md`、`docs/09-decision-log.md` 已同步新增切片、依赖、回滚、状态和风险映射。

## 当前阻断与执行规则

- `S4-VS3` 的 `READY_FOR_REVIEW` 不得改成 `PASS`，直到按 `docs/evidence/stage5/S4-VS3/test-baseline.md` 在真实 PostgreSQL/Redis/MinIO 环境完成浏览器人工审核并回写截图、偏差和结论。
- 未通过 `S4-ENV-RECOVERY` 前，所有新写入切片只能在明确的测试数据库/容器证据下推进，不得宣称发布级可回滚。
- 未通过 `S4-EXT-ACCOUNT` 前，fixture/受控 adapter 的商品同步和账号登录结果只能标记为 `PARTIALLY_VERIFIED`。
- 所有前端切片必须固定 `1440×900` 和 `390×844`，覆盖适用的 loading/empty/error/forbidden/disabled/submitting/success/partial-success/unknown 状态。
- 每个切片必须完成业务/验收、架构/数据流、质量/安全/运维三轮评审；未执行的评审写 `READY_FOR_REVIEW` 或 `BLOCKED`，不得用计划代替结论。

## 下一步顺序

1. `S4-VS2A`：先做商品草稿基础信息的真实写入和冲突回归。
2. `S4-VS2B` → `S4-VS2C` → `S4-VS2D`：依次补 SKU、素材、受控发布；`S4-VS2E` 可并行做真实外部同步验收。
3. `S4-VS3A` → `S4-VS3B`：先补卡券明细/素材，再关闭库存 reserve/consume/release 后进入订单交付。
4. `S4-VS4A` → `S4-VS4B` → `S4-VS4C`：订单只读、交付预览、交付动作分开复核。
5. 横向独立执行 `S4-ENV-RECOVERY`、`S4-EXT-ACCOUNT`、`S4-ENV-RUNTIME`，每项都保留真实环境证据和回滚结果。

## Git / 证据记录

- 现有提交与验证记录保留在 `STATUS.md`；本轮仅更新计划、契约、风险、决策、评审和状态文档，未新增代码或伪造测试证据。
- 阶段 5 证据目录统一为 `docs/evidence/stage5/<slice-id>/`；尚未执行的切片不得提前创建“通过”截图、测试输出或回滚记录。
