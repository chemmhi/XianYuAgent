# 字体规范改造 · 人工审核清单

日期：2026-09-22  
分支：`codex/font-system-typography-20260922`  
Worktree：`F:\ChenHai\Project\XianYuAgent-font-system-20260922`

## 本次改动

- 在 `apps/web/src/typography.css` 增加统一字体栈、字号令牌、行高和页面域级覆盖。
- 将公共按钮、字段、输入框、搜索框、下拉框、文本域和占位组件统一到可读字号。
- 将 Dashboard、账号、商品、订单、卡券、消息、工作台、设置、Agent Dynamics 的业务文本提升到正文 / 表头 / 元数据三档。
- 侧边栏导航只保留图标和主标题，移除右侧辅助副标题（如“数据概览”）。
- 同步 SellerAgent 视觉基线的字号令牌，避免原型与正式前端分叉。
- 保留图表坐标轴等纯数据标记的 10px 受控例外。

## 建议审核路径

桌面 `1440×900`：

- `/dashboard`
- `/accounts`
- `/products`
- `/orders`
- `/coupons`
- `/messages`
- `/workspace`
- `/settings`
- `/agent-dynamics`
- `/controls`

移动 `390×844`：

- `/dashboard`
- `/accounts`
- `/messages`
- `/settings`

## 审核口径

- 正文、表格、导航、按钮是否达到 13px 以上。
- 辅助说明、时间、来源、状态元数据是否保持 12px，且没有比正文更抢眼。
- 页面标题、卡片标题、正文和辅助信息是否可以快速区分。
- 字号变大后是否出现按钮溢出、表格列挤压、分页折行或移动端横向滚动异常。
- 风险确认、消息气泡和表单错误提示是否仍然清晰可读。

## 已验证

- `npm run typecheck`：通过。
- `npm run test:web`：通过，70 个测试文件 / 232 个测试。
- `npm run build:web`：通过，仅保留既有 chunk size warning。
- `npm --prefix SellerAgent run build`：通过。
- Dashboard 真实浏览器 E2E：通过，包含桌面、移动、趋势 tooltip 和风险抽屉。
- Messages / Settings / Orders / Coupons Chrome E2E：通过。
- `git diff --check`：通过。

## 已知非本次问题

- Products Chrome E2E 仍有既有文案断言差异：测试期望“更新时间”，页面实际为“闲鱼更新时间”。
- 完整 `npm run verify` 在 API `xianyu-order-request-smoke.mjs` 被既有 `_m_h5_tk` 断言阻断；该失败与字号改造无关。

## 合入前

人工审核通过后，再将本分支合入 `main`。在审核完成前不做 merge、不改写 `main`。
