# S4-VS3 卡券首页验证基线

- 验证日期：2026-09-19
- worktree：`F:\ChenHai\Project\XianYuAgent-s4-vs3`
- 分支：`feature/s4-vs3-coupons`
- 当前门禁：代码已合入 `master`；人工浏览器审核与真实持久化复核仍为 `READY_FOR_REVIEW`

## 2026-09-20 工具栏修订

- 本次修订 worktree：`F:\ChenHai\Project\XianYuAgent-coupons-toolbar`；分支：`fix/coupons-toolbar`；已通过合并提交 `19c6798` 合入 `master`。
- 移除卡券首页顶部 KPI 卡片，将新建、刷新及选中后的批量操作并入列表工具栏。
- 搜索与类型筛选改为变更即生效，移除“查询”和“重置筛选”按钮。
- 回归证据：`CouponToolbar.test.ts`、Coupons Chrome/CDP E2E，以及 `1440×900` / `390×844` 截图。

## 2026-09-20 空态与工具栏顺序修订

- 本次修订 worktree：`F:\ChenHai\Project\XianYuAgent-coupons-toolbar-followup`；分支：`fix/coupons-toolbar-empty-state`。
- 已通过合并提交 `5a9f3cb` 合入 `master`。
- 新建卡券按钮后置到工具栏最后，移除 `共 N 张` 统计；无匹配批次时保留居中的空态标题与引导文案。
- 回归证据：`CouponToolbar.test.ts`、`CouponStateView.test.ts`、Coupons Chrome/CDP E2E。

## 用户路径

真实浏览器从 `/coupons` 进入卡券首页，经 AuthGate 使用真实 Session Cookie 访问真实 API，完成：

1. 卡券列表、搜索、类型筛选、库存/告警列和状态展示；
2. 当前页全选、批量删除，以及单选后的商品关联入口；
3. 新建、编辑、复制配置，启用/禁用和软删除；
4. 打开详情抽屉，导入库存，绑定/解绑商品；
5. 双栏商品关联：服务端分页、搜索、筛选结果全选、已选商品搜索、移除、保存/取消；
6. 受控正文预览与复制、图片原图预览；
7. 刷新页面后确认编辑、启禁用、关联和作废状态仍可见。

## 已执行命令

```text
npm run typecheck
npm --workspace apps/web run test
npm --workspace apps/api run test
npm --workspace apps/api run build
npm --workspace apps/web run build
node apps/api/scripts/coupons-smoke.mjs
npm --workspace apps/web run test:e2e:chrome:coupons
git diff --check
```

结果：以上命令均通过。前端 Vitest 当前为 9 个测试文件、26 个测试；API smoke 额外断言了列表安全 metadata 摘要不会泄露正文；Chrome/CDP E2E 输出：

```text
local Chrome E2E passed: coupons list -> detail -> preview/copy -> import -> bind -> void -> reload
```

## 浏览器证据

- 桌面：`screenshots/coupons-desktop-1440x900.png`
- 移动：`screenshots/coupons-mobile-390x844.png`
- 固定 viewport：`1440×900`、`390×844`
- 浏览器：本机 Chrome + Chrome DevTools Protocol；自动化使用隔离临时 profile，仅用于受控测试，不替代人工审核。

## 视觉与交互检查

- 只参考旧卡券项目的字段和操作，不复制旧项目表格视觉；表格、抽屉、按钮、颜色和响应式布局保持当前 XianyuSellerAgent 平台壳样式。
- 桌面代表数据验证了备注、多规格、延时发货、已发货次数、对接价、最低价和费用承担方等表格列不是 fallback 文案。
- 列表不返回卡券正文，只展示受控正文占位、库存数量、绑定数量、告警和状态。
- 正文只有在详情抽屉通过受控 content API 返回后展示，并提供复制动作；访问审计引用可见。
- 卡券首页不再展示独立 KPI 卡片；列表工具栏统一承载搜索、筛选、新建、刷新及条件批量操作。
- loading、empty、error、403、submitting 和 conflict 分支由状态边界/错误映射覆盖；本轮截图以成功态为主，完整逐状态视觉回归仍留给人工复核。

## 人工浏览器审核步骤

1. 在当前 `master` 工作区或等价复核环境启动卡券页面。
2. 确认主工作树没有占用 `5173`/`8080`；如有，先停止主工作树服务。
3. 执行 `npm run dev`。该命令使用真实 PostgreSQL/Redis/MinIO，`ALLOW_IN_MEMORY=false`，不是 MemoryStore smoke。
4. 用 Chrome 打开 `http://localhost:5173/coupons`；已有管理员直接登录，没有管理员先完成初始化。
5. 固定审核 viewport：桌面 `1440×900`，移动 `390×844`。
6. 逐项检查：搜索/类型筛选、工具栏新建/刷新；当前页全选与批量删除；单选关联商品；新建/编辑/复制；启用/禁用；双栏关联保存/移除；图片原图预览；详情、库存导入、正文预览/复制；作废后刷新状态保持；移动端横向表格滚动。
7. 记录异常态和截图。人工审核未通过前，不得将 S4-VS3 标记为 `PASS`。

## 明确未覆盖项

- Chrome E2E 使用隔离临时 profile、MemoryStore 和 stub 运行时，不能替代 PostgreSQL/Redis/MinIO 容器级持久化验收或人工浏览器审核。
- 真实闲鱼平台、真实买家交付策略、库存 reserve/consume、批量编辑、资产上传和订单交付属于后续切片或人工复核范围；批量删除已纳入本片。
- 代码已合入 `master`；真实 PostgreSQL/Redis/MinIO 持久化与人工浏览器审核仍未完成，审核通过前不得宣称整体 `PASS`。
