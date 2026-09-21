# 页面组 A 搜索与下拉修复证据（2026-09-21）

范围：Workspace、Accounts、Messages、Products、Orders。仅修页面级布局、控件外层使用方式与会话归档按钮；未修改 `SellerAgent/`、API 或共享控件生产代码。

## 已修复

| 页面 | 问题 | 修复 |
| --- | --- | --- |
| Workspace | 会话搜索框宽度覆盖共享设计上限；搜索有值时没有清空入口 | 使用 `calc(100% - 28px)` + `max-width:260px`，接入 `clearable` |
| Workspace | 归档动作使用纯文本 `•••`，缺少明确语义与焦点证据 | 改为 inline SVG 归档图标，补 `data-testid`、`title`、`focus-visible` |
| Accounts | `.accounts-domain-toolbar .ui-select-control{min-width:0}` 覆盖状态筛选宽度 | 删除高特异性覆盖，保留 `138px/128px` 设计宽度 |
| Accounts | 搜索框固定宽度偏小、缺少清空态 | 统一 `260px` 上限并接入 `clearable` |
| Messages | 会话用户搜索框缺少清空态 | 接入 `clearable`，保留在线聊天 composer 特调 |
| Products | 状态下拉被高特异性 `min-width:0` 压缩；搜索框偏窄、无清空态 | 恢复 `126px` 下拉宽度，搜索统一 `260px` 并接入 `clearable` |
| Orders | 聚合状态下拉被高特异性 `min-width:0` 压缩；搜索占位过长、无清空态 | 恢复 `132px` 下拉宽度，搜索统一 `260px`，占位改为“搜索订单号、买家或商品”并接入 `clearable` |

## 视觉/语义回归断言

- SearchField shared CSS：确认 `focus-within` 边框、`0 0 0 3px rgba(36,90,141,.09)` 光环、`7px` 圆角和 `#9CA3AF` placeholder。
- SelectField shared CSS：确认 open preview 菜单、`18px 40px` 浮层阴影、`31px` 选项高度、选中态背景/勾选。
- Workspace archive：确认 inline SVG、`data-testid="workspace-session-archive"` 与 `.workspace-session-action:focus-visible`。

## 真实路由证据

- Accounts：`docs/evidence/stage5/S4-VS1/screenshots/accounts-desktop-1440x900.png`、`accounts-mobile-390x844.png`。
- Orders：`docs/evidence/stage5/S4-VS4A/screenshots/orders-desktop-1440x900.png`、`orders-mobile-390x844.png`。
- Workspace：`artifacts/real-verify/S4-VS6A/screenshots/workspace-desktop-1440x900.png`、`workspace-mobile-390x844.png`。
- Products：现有 Chrome 脚本在既有“商品标题”选择器步骤阻塞，未覆盖本次搜索/状态栏改动；需后续修正 E2E 选择器后重新生成真实路由截图。
- Messages：现有 Chrome 脚本在既有 “latest history page” 等待步骤超时，未覆盖本次搜索框改动；需后续修正 fixture/等待条件后重新生成真实路由截图。

## 验证命令

- `npm --workspace apps/web run test -- --run src/features/accounts/components/AccountToolbar.test.ts src/features/products/components/ProductToolbar.test.ts src/features/orders/components/OrderFilters.test.ts src/features/workspace/components/WorkspacePage.test.ts src/shared/ui/SearchField.test.ts src/shared/ui/SelectField.test.ts` → 6 files / 15 tests passed。
- `npm --workspace apps/web run test:e2e:chrome` → Accounts Chrome E2E passed。
- `npm --workspace apps/web run test:e2e:chrome:orders` → Orders Chrome E2E passed。
- `npm --workspace apps/web run test:e2e:chrome:workspace` → Workspace PostgreSQL + Chrome E2E passed。
- `npm --workspace apps/api run build` → passed。

## 开放项

- Products Chrome E2E：既有商品标题定位器失败，需单独修复测试选择器后补截图。
- Messages Chrome E2E：既有 latest history 等待超时，需单独修复 fixture/等待条件后补截图。
- SelectField 业务路由原生展开菜单受浏览器原生 UI 限制；共享 `/controls` open preview 与 CSS 断言覆盖设计稿菜单尺寸/阴影/选中态，真实路由继续沿用原生语义。

## Open/Focus 视觉证据

- `/controls` Chrome/CDP 对比产物：`docs/evidence/common-controls/page-search-select-fix-a-visual/visual-diff.md`。
- 固定视口尺寸均匹配：桌面 `1440×900`、移动 `390×844`。
- 共享控件 Open preview 已包含下拉浮层、选项间距、选中勾选、阴影与 chevron 旋转；SearchField focus-within 的边框/光环/placeholder 由 CSS 回归断言锁定。
- 像素差异保持人工审核边界：桌面 changed `12.597%`、移动 changed `17.878%`，不自动宣称 1:1 通过。
