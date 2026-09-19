# S4-VS1 测试基础与门禁基线

- 日期：2026-09-19
- 范围：`apps/web` 正式前端账号切片与 `apps/api` API；`SellerAgent/` 仅作为高保真视觉参考。
- 状态：部分验证（前端单元/契约/类型/构建、本机 Chrome 账号 E2E 与固定 viewport 截图已执行；容器级持久化和真实闲鱼扫码成功仍未完成）。

## 已执行命令

在仓库根目录执行：

```text
npm run typecheck:web
npm run test:web
npm run build:web
npm run test:e2e:chrome
```

结果：

- `typecheck`：通过。
- `test:unit`：通过，1 个测试文件、5 个断言用例通过。
- `test:contract`：通过，`mock api contract flow passed`。
- `build`：通过，TypeScript 检查与 Vite 生产构建均通过。
- `test:e2e:chrome`：通过，本机 Chrome 真实浏览器完成“添加账号 → 真实 API → 页面可见持久化账号 → 二维码授权弹窗”。
- 截图证据：`screenshots/accounts-desktop-1440x900.png`、`screenshots/accounts-mobile-390x844.png`。

## 当前测试边界

- 单元测试：`src/api/mockApi.test.ts`，覆盖 dashboard、账号/商品范围、失败订单重试、Workspace confirmation、Settings 更新。
- 契约 smoke：`scripts/test-mock-api.mjs`，验证现有 mock API 的跨域调用顺序和状态变化。
- 依赖可复现性：根目录 workspace 统一管理 `apps/web` 和 `apps/api`；正式前端依赖固定在 `apps/web/package.json`，安装与脚本从仓库根目录执行。
- 尚未执行：Supertest 真实 HTTP 集成、Testcontainers 数据库/Redis、真实闲鱼扫码成功回调、视觉回归。
- 当前浏览器门禁使用本机 Chrome + Chrome DevTools Protocol，不安装 Playwright；Vitest 锁文件中的 `@vitest/browser-playwright` 仅为可选 peer 元数据，未安装、未执行。
- 原因：容器级数据库/Redis 链路和真实闲鱼账号扫码仍需环境与人工复核；当前 E2E 使用内存 API + QR stub 仅验证前端跨层账号创建与授权入口。

## 后续门禁

ENV-0 完成后，S4-VS1 必须补齐：

1. Supertest：账号列表/详情、QR session、登录会话状态、账号范围拒绝与幂等冲突。
2. Testcontainers：PostgreSQL/Redis 持久化、迁移、审计与回滚验证。
3. 本机 Chrome：1440×900 与 390×844，从登录/初始化到账号切换、授权失败/超时/重试的真实用户路径。
4. 视觉回归：固定代表性数据与截图差异记录。

以上缺失项不能由当前 mock contract 或生产构建替代。
