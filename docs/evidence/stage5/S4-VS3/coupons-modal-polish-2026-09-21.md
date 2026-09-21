# 新建卡券弹窗样式修复证据

日期：2026-09-21（Asia/Shanghai）
分支：`fix/coupons-modal-polish`
Worktree：`F:\ChenHai\Project\XianYuAgent-coupons-modal-polish`

## 验收行为

- 弹窗标题和右上角关闭按钮固定在弹窗顶部，内容区独立滚动。
- 移除“对接信息/对接消息”可见模块，保留兼容字段以避免破坏既有 API 数据结构。
- 必填星号与字段标题保持同一行，不再作为独立 grid 子项换行。
- 复选框统一为稳定的横向布局，说明文本与复选框对齐。
- 新增可复用 `SelectField`，使用项目 navy/gray token、统一 chevron 和 focus 样式。

## 验证命令

```text
npm --workspace apps/web run typecheck
npm --workspace apps/web run test -- src/features/coupons/components/CouponCreateModal.test.ts --run
npm --workspace apps/web run build
npm run test:e2e:chrome:coupons
git diff --check
```

结果：以上命令均通过；Chrome/CDP E2E 在隔离 Chrome + stub API/MemoryStore 中完成列表、弹窗字段、编辑、复制、导入、绑定、作废和刷新回读链路。

## 视觉证据

- 桌面弹窗（1440×900）：`screenshots/coupons-create-modal-desktop-1440x900.png`
- 移动弹窗（390×844）：`screenshots/coupons-create-modal-mobile-390x844.png`

E2E 打开弹窗后额外断言了：标题/关闭按钮滚动位置不变、对接模块不存在、必填标记同排、通用下拉组件存在、复选框行使用横向布局。

## 未覆盖项

本切片未修改后端或持久化逻辑；Chrome/CDP 脚本使用项目既有的 stub API/MemoryStore 夹具，不替代真实 PostgreSQL/Redis/MinIO 全链路验收。视觉截图为修复后证据，未包含独立人工设计评审签核。
