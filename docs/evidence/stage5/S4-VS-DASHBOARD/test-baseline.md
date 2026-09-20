# S4-VS-DASHBOARD 测试基线

- 切片：`/dashboard` 仪表盘高保真界面
- 视觉输入：`SellerAgent/src/App.tsx`、`SellerAgent/src/styles.css`、`xianyu-admin-design-style/assets/design-tokens.json`
- 目标 viewport：桌面 `1440×900`；移动 `390×844`
- 浏览器：本机 Chrome + Chrome DevTools Protocol；未使用 Playwright
- 运行命令：`npm --workspace apps/web run test:e2e:chrome:dashboard`；跨层命令：`ALLOW_SHARED_E2E=1 REQUIRE_XIANYU_ORDER_SYNC=1 npm run test:e2e:chrome:dashboard:fullchain`
- 浏览器证据：`screenshots/dashboard-desktop-1440x900.png`、`screenshots/dashboard-mobile-390x844.png`、`screenshots/dashboard-fullchain-desktop-1440x900.png`、`screenshots/dashboard-fullchain-mobile-390x844.png`
- 跨层证据：`fullchain-evidence.json`

## 已验证

- `/dashboard` 已从占位页切换到正式 Dashboard feature。
- 桌面 KPI、趋势图、账号健康度、商品排行、最近处理记录和风险待办均可见。
- 移动端独立渲染 `MobileFrame`：状态栏、移动标题、快捷动作、2×2 KPI、待办卡、经营快照和 8 项底部 Tab 均可见。
- 风险待办可打开抽屉并跳转到对应领域路径。
- Web typecheck、Vitest（32 files / 102 tests）、Web build 已通过。
- 真实跨层已通过：Chrome/CDP → Live Dashboard API → PostgreSQL/Redis；闲鱼资料、商品、IM 会话、订单真实读取；商品同步与订单刷新均写入 PostgreSQL，并在浏览器页面回读可见。

## 未关闭

- 当前正式 Dashboard 使用并已实现 `/api/v1/dashboard/snapshot`；旧参考适配器中的 `/api/v1/dashboard/order-trend` 不属于当前 Dashboard feature 的调用链，作为后续兼容接口保留，不影响本切片跨层验收。
- loading、empty、error、403、timeout 已有组件分支与单元覆盖基础，但尚未为每个状态生成固定 viewport 截图。
- 独立人工视觉签核、完整状态截图与 rollback 仍未完成。

