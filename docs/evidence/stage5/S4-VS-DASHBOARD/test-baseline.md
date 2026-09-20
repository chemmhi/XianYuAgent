# S4-VS-DASHBOARD 测试基线

- 切片：`/dashboard` 仪表盘高保真界面
- 视觉输入：`SellerAgent/src/App.tsx`、`SellerAgent/src/styles.css`、`xianyu-admin-design-style/assets/design-tokens.json`
- 目标 viewport：桌面 `1440×900`；移动 `390×844`
- 浏览器：本机 Chrome + Chrome DevTools Protocol；未使用 Playwright
- 运行命令：`npm --workspace apps/web run test:e2e:chrome:dashboard`
- 浏览器证据：`screenshots/dashboard-desktop-1440x900.png`、`screenshots/dashboard-mobile-390x844.png`

## 已验证

- `/dashboard` 已从占位页切换到正式 Dashboard feature。
- 桌面 KPI、趋势图、账号健康度、商品排行、最近处理记录和风险待办均可见。
- 移动端独立渲染 `MobileFrame`：状态栏、移动标题、快捷动作、2×2 KPI、待办卡、经营快照和 8 项底部 Tab 均可见。
- 风险待办可打开抽屉并跳转到对应领域路径。
- Web typecheck、Vitest（32 files / 102 tests）、Web build 已通过。

## 未关闭

- 设计契约要求的 `/api/v1/dashboard/snapshot`、`/api/v1/dashboard/order-trend` 后端路由当前仓库尚未实现；浏览器视觉证据通过 `VITE_DASHBOARD_MODE=mock` 使用确定性 fixture 生成，不能替代真实 API / PostgreSQL 跨层 E2E。
- loading、empty、error、403、timeout 已有组件分支与单元覆盖基础，但尚未为每个状态生成固定 viewport 截图。
- 独立人工视觉签核、真实持久化和 rollback 仍未完成。

