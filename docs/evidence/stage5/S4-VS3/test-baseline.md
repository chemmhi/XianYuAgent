# S4-VS3 卡券首页验证基线

- 验证日期：2026-09-19
- worktree：`F:\ChenHai\Project\XianYuAgent-s4-vs3`
- 分支：`feature/s4-vs3-coupons`
- 当前门禁：`READY_FOR_REVIEW`，等待人工审核后再合入 `master`

## 用户路径

真实浏览器从 `/coupons` 进入卡券首页，经 AuthGate 使用真实 Session Cookie 访问真实 API，完成：

1. 批次列表、库存统计、低库存告警和状态筛选；
2. 打开批次详情抽屉；
3. 受控正文预览与复制；
4. 导入库存；
5. 绑定商品；
6. 作废批次；
7. 刷新页面后确认作废状态仍可见。

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

结果：以上命令均通过。前端 Vitest 当前为 9 个测试文件、25 个测试；Chrome/CDP E2E 输出：

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
- 列表不返回卡券正文，只展示受控正文占位、库存数量、绑定数量、告警和状态。
- 正文只有在详情抽屉通过受控 content API 返回后展示，并提供复制动作；访问审计引用可见。
- loading、empty、error、403、submitting 和 conflict 分支由状态边界/错误映射覆盖；本轮截图以成功态为主，完整逐状态视觉回归仍留给人工复核。

## 明确未覆盖项

- Chrome E2E 使用 MemoryStore 和 stub 运行时，不能替代 PostgreSQL/Redis 容器级持久化验收。
- 真实闲鱼平台、真实买家交付策略、库存 reserve/consume、批量编辑/批量删除、资产上传和订单交付属于后续切片或人工复核范围。
- 未合并 `master`；人工审核通过前不执行 merge。
