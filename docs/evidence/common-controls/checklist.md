# Common Controls 迁移 Checklist

更新时间：2026-09-21  
范围：`apps/web` 正式前端；仅迁移通用搜索、输入、文本框、按钮和空值格。共享组件来源为 `apps/web/src/shared/ui/` 的 `SearchField`、`SelectField`、`InputField`、`TextAreaField`、`Button`、`PlaceholderCell`。

## 迁移原则

- 保留现有受控值、`onChange`、`disabled`、`required`、`aria-*`、`data-testid` 和提交边界；共享控件只负责外观与原生语义封装。
- 保留页面专用 class，优先通过 `className` 叠加，不改 API、状态机、权限和持久化逻辑。
- `SelectField` 继续作为原生 `<select>` 的唯一共享 owner；页面不重复实现 chevron 或自定义选择器。
- 只把明确的空值/缺失值渲染为 `PlaceholderCell`，业务状态文案、错误文案和真实数据不伪装为空值。

## 页面矩阵

| 页面/组件 | Search | Select | Input | TextArea | Button | Placeholder | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auth (`AdminLoginForm` / `AdminBootstrapForm` / `AuthGate`) | 不适用 | 不适用 | 本切片迁移 | 不适用 | 本切片迁移 | 不适用 | 已改，待与 common-controls 组件提交合并 |
| Accounts (`AccountToolbar`) | common-controls worktree 已迁移 | 已由 `SelectField` 承载 | 不适用 | 不适用 | 工具栏主操作已迁移 | 表格状态保持专用 Badge | 已改/已审计 |
| Products (`ProductToolbar` / `ProductTable`) | 工具栏已迁移 | 已由 `SelectField` 承载 | `ProductTable` 空值不写入输入控件 | 不适用 | 工具栏主操作已迁移 | 价格、关联卡券、AI 提示词空值本切片迁移 | 已改/待视觉复核 |
| Settings (`SettingsPage` / `OpenAISettingsPanel` / `AutoReplyAgentPanel`) | 不适用 | 已由 `SelectField` 承载 | API Key、Provider、Alias、URL、数值字段本切片迁移 | Agent Prompt 字段本切片迁移 | 状态、凭证、模型测试/保存、Agent 操作本切片迁移 | 状态卡/审计文案不是空值格，暂不替换 | 已改，待视觉复核 |
| Coupons (`CouponToolbar`) | common-controls worktree 已迁移 | 已由 `SelectField` 承载 | 创建/编辑表单另按字段语义复核 | 文本型卡券字段另按表单语义复核 | 工具栏主操作已迁移 | 表格预览/关联价格保留专用文案，避免误标空值 | 已改/已审计 |
| Workspace (`WorkspacePage`) | 会话搜索已迁移 | 不适用 | 不适用 | 在线 Run composer 仍为页面专用 textarea | 左栏主操作已迁移；消息折叠/会话操作保持原生 | 空会话状态保持 `WorkspaceState` | 已改/已审计 |

## 明确排除项

- **MessagesPage 在线聊天 composer**：保留 `apps/web/src/features/messages/components/MessagesPage.tsx` 中的专用 textarea、发送节流、快捷键、字符计数、重连/CSRF 处理和现有 class；不得替换为 `TextAreaField` 或共享 `Button`。
- **SellerAgent**：`SellerAgent/` 是参考/独立运行目录，本轮不迁移、不改样式、不引入 shared UI 依赖。
- 设置页 tabs、移动端 bottom nav、图标按钮、分页按钮、表格排序/行操作按钮：这些按钮带有页面专用布局或无障碍状态，本轮保持原生，后续按单独视觉证据迁移。
- Checkbox、文件/图片上传、二维码登录和密码可见性切换：不强行套 `InputField`，继续使用原生控件或领域组件。

## 本切片改动

- `AuthGate`、`AdminLoginForm`、`AdminBootstrapForm`：接入 `Button` 与 `InputField`，保留原有认证提交契约。
- `SettingsPage`：凭证状态动作、凭证编辑器和 Reference panel 的通用按钮/短文本字段接入 shared controls。
- `OpenAISettingsPanel`：Provider、Base URL、API Key 接入 `InputField`；测试/保存/重试接入 `Button`。
- `AutoReplyAgentPanel`：Prompt 接入 `TextAreaField`，数值配置接入 `InputField`，重试/保存接入 `Button`。
- `ProductTable`：价格、关联卡券、AI 提示词的明确空值接入 `PlaceholderCell`；不改真实商品标题、价格、时间和排序逻辑。

## 合并前检查

- [ ] common-controls shared UI 文件已先合入目标分支，再合入本切片的页面改动。
- [ ] `rg -n "MessagesPage|workspace-composer|SellerAgent"` 确认在线聊天 composer 与 SellerAgent 未被本切片改动。
- [ ] `npm run typecheck --workspace apps/web`。
- [ ] `npm run test --workspace apps/web -- --run`（至少覆盖 Auth/Settings/Products 相关回归）。
- [ ] `npm run build --workspace apps/web`。
- [ ] `git diff --check`。
- [ ] 在 `1440×900` 与 `390×844` 复核 Auth、Settings、Products 空值格；common-controls 视觉证据继续使用 `apps/web/scripts/common-controls-visual-diff.mjs`。

## 剩余审计清单

1. Accounts/Products/Coupons/Workspace 的当前迁移改动仍位于 `codex/common-controls` worktree，合入前需确认共享组件版本一致。
2. Auth/Settings 页面尚未完成固定 viewport 截图与视觉 diff；当前只完成结构化迁移和类型/测试准备。
3. Orders、Dashboard、Messages 的领域按钮和空值格不在本次页面范围；其中 Messages composer 属于明确禁改项。
4. `SelectField` 的全局使用约束继续由 `apps/web/src/shared/ui/select-usage.test.ts` 维护；本切片不重复实现 native select。
