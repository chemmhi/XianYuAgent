# 页面级 CSS 隔离证据（2026-09-21）

## 范围

本切片只处理真实业务页面对共享 `SearchField`、`SelectField`、`InputField`、`TextAreaField` 内层 token 的直接覆盖；不改 `SellerAgent/`，不改共享控件实现，不替换 Messages 在线聊天 composer 或 Workspace Run composer 特调 textarea。

## 已清理的覆盖入口

| 页面 | 文件 | 清理内容 | 保留内容 |
| --- | --- | --- | --- |
| Auth | `apps/web/src/features/auth/auth.css` | 删除 `.auth-form label/input` 的颜色、字号、padding、border、radius、focus 覆盖 | 表单布局、错误态、提交按钮布局 |
| Accounts | `apps/web/src/features/accounts/components/accounts.css` | 删除 `.account-login-form label/input/textarea` 的共享字段 token 覆盖 | 登录表单网格与提示文案 |
| Products | `apps/web/src/features/products/components/products.css` | 删除 `.product-basic-form label/input/textarea` 的共享字段 token 覆盖 | 表单网格、错误文案、全宽字段布局 |
| Coupons | `apps/web/src/features/coupons/components/coupons.css` | 删除抽屉/表单网格对 input/textarea 的 border、radius、padding、background、font 覆盖；绑定商品输入改为 `.ui-input-control` 布局选择器 | 多选 checkbox/file 原生控件；外层 grid/width |
| Messages | `apps/web/src/features/messages/components/messages.css` | 删除 `.messages-search` 的 height/border/radius/background 与 `.messages-search input` 覆盖 | SearchField 外层宽度；在线聊天 composer 特调 textarea |
| Workspace | `apps/web/src/features/workspace/components/workspace.css` | 删除 `.workspace-search input` 以及无效 create-row input token 覆盖 | SearchField 外层 margin/width；Run composer 特调 textarea |
| Agent Dynamics | `apps/web/src/features/agent-dynamics/components/agent-dynamics.css` | 删除页面根节点对所有 input/select 的 font-family 与 focus 覆盖 | 页面根字体与领域按钮焦点样式 |
| Settings | `apps/web/src/features/settings/components/settings.css` | 删除 settings form 对 label/input/textarea 的共享 token 覆盖；OpenAI form 改为 `.ui-field`/`.ui-input-control` 布局选择器 | 原生 checkbox 尺寸与文案；Select/Input 外层布局；移动端字段列布局 |

## 回归守门

`apps/web/src/shared/ui/common-controls-migration.test.ts` 新增 selector 级扫描，禁止上述页面重新出现直接命中共享控件内层的 selector，同时显式保留两处已批准的页面专用 textarea 例外：

- `.messages-composer textarea`
- `.workspace-composer textarea`

## 验证命令

- `npm --workspace apps/web run test -- --run src/shared/ui/common-controls-migration.test.ts src/shared/ui/controls-usage.test.ts src/shared/ui/select-usage.test.ts` → 3 个测试文件、14 个测试通过。
- `npm run typecheck:web` → 通过。
- `git diff --check` → 通过。
- `git diff -- SellerAgent` → 无输出，确认 `SellerAgent/` 零 diff。

## 边界

本证据只覆盖页面 CSS selector 隔离，不代替真实业务路由双 viewport 视觉截图；SearchField/SelectField 的共享实现与 open preview 证据由共享控件切片单独复核。
