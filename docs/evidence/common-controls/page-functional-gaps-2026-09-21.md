# 页面级功能遗漏修复证据（2026-09-21）

## 范围

本切片在共享 SearchField/SelectField 已合入并通过 Phase 1 门禁后执行，处理复盘文档中登记的页面级功能遗漏；不改 `SellerAgent/`，不恢复全局搜索，不拆 Orders 聚合状态下拉，不替换 Workspace Run composer，也不统一普通分页/Tabs/菜单按钮为 shared Button。

## 已修复

| 页面 | 修复 | 证据 |
| --- | --- | --- |
| Accounts | `AccountToolbar` 增加 `connectionStatus` 共享下拉，并接入 controller filter 更新 | `apps/web/src/features/accounts/components/AccountToolbar.tsx`、`AccountsPage.tsx`、`AccountToolbar.test.ts` |
| Coupons | 工具栏增加 `status`、`stockAlert` 两个共享下拉，接入 query filter；表格增加页码、上一页/下一页和总数状态 | `CouponToolbar.tsx`、`CouponsPage.tsx`、`CouponBatchTable.tsx`、对应测试 |
| Workspace | 搜索状态移入 controller，按 220ms debounce 将搜索词传入 `listSessions(accountId, search)`；保留 Run composer 特调 textarea | `workspace/controller.ts`、`WorkspacePage.tsx`、`workspace/controller.test.ts`、`workspace/api.test.ts` |

## 验证

- `npm --workspace apps/web run test -- --run`：56 个测试文件 / 172 个测试通过。
- `npm --workspace apps/web run typecheck`：通过。
- `npm --workspace apps/web run build`：通过；仅保留既有 chunk >500k warning。
- `npm --workspace apps/web run test:e2e:chrome:accounts`：通过（切片 worktree 证据）。
- `npm --workspace apps/web run test:e2e:chrome:workspace`：通过（真实 PostgreSQL/Chrome/CDP，切片 worktree 证据）。
- `npm --workspace apps/web run test:e2e:chrome:coupons`：**开放复核**；在既有 `created coupon enable button missing` 断言处失败，失败发生于创建/编辑/复制/禁用之后的启用步骤，尚未证明由本切片筛选/分页逻辑直接引起。
- Coupons E2E 在失败前已生成真实路由截图：`docs/evidence/stage5/S4-VS3/screenshots/coupons-desktop-1440x900.png`、`coupons-create-modal-desktop-1440x900.png`、`coupons-create-modal-mobile-390x844.png`；截图中可见新增状态/库存下拉与分页区域。
- Accounts 与 Workspace 主线 E2E 通过并刷新了真实路由截图：`docs/evidence/stage5/S4-VS1/screenshots/accounts-desktop-1440x900.png`、`accounts-mobile-390x844.png`、`artifacts/real-verify/S4-VS6A/screenshots/workspace-desktop-1440x900.png`、`workspace-mobile-390x844.png`。
- `git diff --check`：通过。
- `git diff -- SellerAgent`：无输出，确认 `SellerAgent/` 零 diff。

## 当前结论

Accounts、Coupons 筛选/分页和 Workspace server-side search 已完成代码与单元/构建验证；Coupons 全链路 E2E 的启用步骤仍为 `OPEN`，因此 common-controls checklist 继续保持 `FAIL / OPEN`，不能宣称本轮整体通过。
