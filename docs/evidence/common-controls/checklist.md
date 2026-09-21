# Common Controls 迁移 Checklist

更新时间：2026-09-21 23:05（Asia/Shanghai）
范围：`apps/web` 正式前端；仅迁移通用搜索、输入、文本框、按钮和空值格。共享组件来源为 `apps/web/src/shared/ui/` 的 `SearchField`、`SelectField`、`InputField`、`TextAreaField`、`Button`、`PlaceholderCell`。

## 当前审核门禁

**状态：FAIL / OPEN。** 共享 SearchField/SelectField 已完成 Phase 1 修复并合入主线，但本 checklist 仍不能作为整体通过证据；页面级 CSS 隔离、设计要求但缺失的控件、真实业务路由覆盖、schema→UI 完整映射和逐页视觉证据仍未关闭。详细问题、范围决策和分阶段修复计划见 [`common-controls-review-2026-09-21.md`](./common-controls-review-2026-09-21.md)。

### 已确认的范围决策

- 全局搜索正式移除，不恢复 `TopBar + SearchField`；旧证据中的全局搜索要求需清理。
- Orders 保留单一聚合状态下拉，不拆分为四个独立状态下拉。
- Workspace Run composer 保留页面特调 textarea，作为明确例外。
- Dashboard、表格排序、分页、Tabs、菜单等普通/领域按钮不纳入本轮 `Button` 统一。
- 前述复盘中的全部 P0/P1 项纳入下一轮修复；共享组件必须先于页面级遗漏修复。

## 迁移原则

- 保留现有受控值、`onChange`、`disabled`、`required`、`aria-*`、`data-testid` 和提交边界；共享控件只负责外观与原生语义封装。
- 保留页面专用 class，优先通过 `className` 叠加，不改 API、状态机、权限和持久化逻辑。
- `SelectField` 继续作为原生 `<select>` 的唯一共享 owner；页面不重复实现 chevron 或自定义选择器。
- 只把明确的空值/缺失值渲染为 `PlaceholderCell`，业务状态文案、错误文案和真实数据不伪装为空值。

## 页面矩阵

| 页面/组件 | Search | Select | Input | TextArea | Button | Placeholder | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auth (`AdminLoginForm` / `AdminBootstrapForm` / `AuthGate`) | 不适用 | 不适用 | 本切片迁移 | 不适用 | 本切片迁移 | 不适用 | 已改，待与 common-controls 组件提交合并 |
| Accounts (`AccountToolbar` / `PasswordLoginForm` / `CookieLoginForm`) | common-controls worktree 已迁移 | 已由 `SelectField` 承载 | 密码登录字段已迁移 | Cookie 登录文本框已迁移 | 工具栏与登录提交已迁移 | 表格状态保持专用 Badge | 已改/已审计 |
| Products (`ProductToolbar` / `ProductTable` / `ProductBasicForm`) | 工具栏已迁移 | 已由 `SelectField` 承载 | 基础表单字段已迁移；`ProductTable` 空值不写入输入控件 | 基础表单商品描述已迁移 | 工具栏主操作已迁移 | 价格、关联卡券、AI 提示词空值本切片迁移 | 已改/待视觉复核 |
| Settings (`SettingsPage` / `OpenAISettingsPanel` / `AutoReplyAgentPanel`) | 不适用 | 已由 `SelectField` 承载 | API Key、Provider、Alias、URL、数值字段本切片迁移 | Agent Prompt 字段本切片迁移 | 状态、凭证、模型测试/保存、Agent 操作本切片迁移 | 状态卡/审计文案不是空值格，暂不替换 | 已改，待视觉复核 |
| Coupons (`CouponToolbar` / `CouponCreateModal` / `CouponDrawer`) | 工具栏与关联商品搜索已迁移 | 创建/编辑与工具栏已由 `SelectField` 承载 | 创建表单、抽屉绑定商品字段已迁移 | 创建表单与抽屉导入库存/备注字段已迁移 | 工具栏、创建、抽屉操作已迁移 | 表格预览/关联价格保留专用文案，避免误标空值 | 已改/已审计 |
| Orders (`OrderFilters`) | 订单筛选已迁移 | 已由 `SelectField` 承载 | 不适用 | 不适用 | 筛选区无共享按钮改动 | 订单状态文案保持领域语义 | 已改/待视觉复核 |
| Agent Dynamics (`AgentDynamicsViews` / `AgentDynamicsDropdown`) | 运行记录搜索已迁移 | 下拉筛选已由 `SelectField` 承载 | 不适用 | 不适用 | 页面操作按钮保持领域语义 | 空状态保持领域文案 | 已改/待视觉复核 |
| Workspace (`WorkspacePage`) | 会话搜索已迁移 | 不适用 | 不适用 | **在线 Run composer 仍为页面专用 textarea，明确豁免共享替换** | 左栏主操作已迁移；消息折叠/会话操作保持原生 | 空会话状态保持 `WorkspaceState` | 已改/已审计 |

## 明确排除项

- **MessagesPage 在线聊天 composer**：保留 `apps/web/src/features/messages/components/MessagesPage.tsx` 中的专用 textarea、发送节流、快捷键、字符计数、重连/CSRF 处理和现有 class；不得替换为 `TextAreaField` 或共享 `Button`。
- **SellerAgent**：`SellerAgent/` 是参考/独立运行目录，本轮不迁移、不改样式、不引入 shared UI 依赖。
- 设置页 tabs、移动端 bottom nav、图标按钮、分页按钮、表格排序/行操作按钮：这些按钮带有页面专用布局或无障碍状态，本轮保持原生，后续按单独视觉证据迁移。
- Checkbox、文件/图片上传、二维码登录和密码可见性切换：不强行套 `InputField`，继续使用原生控件或领域组件。

## 本切片改动

- `AuthGate`、`AdminLoginForm`、`AdminBootstrapForm`：接入 `Button` 与 `InputField`，保留原有认证提交契约。
- `PasswordLoginForm`、`CookieLoginForm`：接入 `InputField` / `TextAreaField` 与 `Button`，保留账号登录方式切换、提交状态和错误边界。
- `SettingsPage`：凭证状态动作、凭证编辑器和 Reference panel 的通用按钮/短文本字段接入 shared controls。
- `OpenAISettingsPanel`：Provider、Base URL、API Key 接入 `InputField`；测试/保存/重试接入 `Button`。
- `AutoReplyAgentPanel`：Prompt 接入 `TextAreaField`，数值配置接入 `InputField`，重试/保存接入 `Button`。
- `ProductBasicForm`：商品账号、标题、分类、价格和描述字段接入 `InputField` / `TextAreaField`，保留校验提示和保存契约。
- `ProductTable`：价格、关联卡券、AI 提示词的明确空值接入 `PlaceholderCell`；不改真实商品标题、价格、时间和排序逻辑。
- `CouponCreateModal`、`CouponDrawer`：创建/编辑、导入库存、绑定商品和受控正文预览字段接入 shared controls；保留卡券类型分支、权限提示和危险操作确认。
- `OrderFilters`、`AgentDynamicsViews` / `AgentDynamicsDropdown`：筛选搜索与原生选择统一接入 shared controls；不改分页、状态机和领域文案。
- `WorkspacePage`：仅迁移会话搜索和左栏主操作；在线 Run composer 继续保留页面特调 textarea，作为明确豁免项。

## 合并前检查

- [x] common-controls shared UI 文件已先合入目标分支，再合入本切片的页面改动。
- [x] Phase 1 shared SearchField/SelectField 修复已合入 `fe9358c`，并完成定向测试、typecheck、build 与双 viewport 视觉证据。
- [x] `rg -n "MessagesPage|workspace-composer|SellerAgent"` 确认在线聊天 composer 与 SellerAgent 未被本切片改动。
- [x] `npm run typecheck --workspace apps/web`。
- [x] `npm run test --workspace apps/web -- --run`（53 个测试文件、165 个测试全部通过）。
- [x] `npm run build --workspace apps/web`。
- [x] `git diff --check`。
- [ ] 在 `1440×900` 与 `390×844` 复核 Auth、Settings、Products 空值格；common-controls 视觉证据继续使用 `apps/web/scripts/common-controls-visual-diff.mjs`。
- [ ] 补充 Accounts 登录表单、Coupons 创建/抽屉、Orders 筛选和 Agent Dynamics 筛选的固定 viewport 复核；记录组件 token 与整页像素差异，不将非零像素差异自动判定为通过。

## 剩余审计清单

1. 共享 SearchField/SelectField 尚未完成按专有设计稿的 1:1 视觉复核；Select 展开项的真实截图、键盘行为和跨浏览器边界仍缺失。
2. 页面 CSS 对 shared inner input/select/textarea 的 selector 覆盖已隔离并有守门测试；真实业务路由视觉复核仍未关闭。
3. Accounts/Coupons 的 schema→UI 映射已补齐 `connectionStatus`、`status`、`stockAlert` 和 Coupons 分页；Coupons Chrome/CDP 的启用步骤仍失败，保持 OPEN。
4. Workspace 搜索词已从 controller 传入 API 并补 220ms debounce；Workspace Run composer 例外继续保留。
5. Auth/Settings/Accounts/Products/Coupons/Orders/Agent Dynamics/Workspace 尚未全部完成真实路由固定 viewport 截图与视觉 diff；`/controls` 预览页不能替代页面证据。
6. Dashboard、表格排序、分页、Tabs、菜单等普通/领域按钮明确不纳入本轮 `Button` 统一，但相关自定义语义仍需单列登记，避免被误判为 SelectField 或 shared Button 已覆盖。
7. `SelectField` 的全局使用约束继续由 `apps/web/src/shared/ui/select-usage.test.ts` 维护；本轮仍不得以现存 native select 扫描结果替代 expected-control manifest。
