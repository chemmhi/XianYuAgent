# S4-VS1 测试基础与门禁基线

- 日期：2026-09-19
- 范围：`apps/web` 正式前端账号切片与 `apps/api` API；`SellerAgent/` 仅作为高保真视觉参考。
- 状态：部分验证（前端单元/契约/类型/构建已执行；真实集成、E2E、视觉回归仍受 ENV-0 阻塞）。

## 已执行命令

在仓库根目录执行：

```text
npm run typecheck:web
npm run test:web
npm run build:web
```

结果：

- `typecheck`：通过。
- `test:unit`：通过，1 个测试文件、5 个断言用例通过。
- `test:contract`：通过，`mock api contract flow passed`。
- `build`：通过，TypeScript 检查与 Vite 生产构建均通过。

## 当前测试边界

- 单元测试：`src/api/mockApi.test.ts`，覆盖 dashboard、账号/商品范围、失败订单重试、Workspace confirmation、Settings 更新。
- 契约 smoke：`scripts/test-mock-api.mjs`，验证现有 mock API 的跨域调用顺序和状态变化。
- 依赖可复现性：根目录 workspace 统一管理 `apps/web` 和 `apps/api`；正式前端依赖固定在 `apps/web/package.json`，安装与脚本从仓库根目录执行。
- 尚未执行：Supertest 真实 HTTP 集成、Testcontainers 数据库/Redis、Playwright 真实用户流程、视觉回归。
- 原因：阶段 4 计划要求先完成 ENV-0（Compose、API/Worker、Session/CSRF、幂等、审计、execution foundation、闲鱼 adapter 探针）；当前这些真实链路尚未具备可复现运行入口。

## 后续门禁

ENV-0 完成后，S4-VS1 必须补齐：

1. Supertest：账号列表/详情、QR session、登录会话状态、账号范围拒绝与幂等冲突。
2. Testcontainers：PostgreSQL/Redis 持久化、迁移、审计与回滚验证。
3. Playwright：1440×900 与 390×844，从登录/初始化到账号切换、授权失败/超时/重试的真实用户路径。
4. 视觉回归：固定代表性数据与截图差异记录。

以上缺失项不能由当前 mock contract 或生产构建替代。
