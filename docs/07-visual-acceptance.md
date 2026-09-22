# XianyuSellerAgent 视觉验收基线

- 文档版本：v0.1
- 更新日期：2026-09-19
- 当前阶段：阶段 3——前端信息架构与设计契约
- 当前结论：SellerAgent 原型 + design token 已冻结为阶段 3 视觉基线；高保真截图回归留到阶段 5/6 执行

## 1. 基线来源

| 项目 | 当前基线 |
| --- | --- |
| 视觉参考 | SellerAgent/ React + Vite + TypeScript 原型；仅供视觉、文案和交互参考 |
| 设计 token | xianyu-admin-design-style/assets/design-tokens.json |
| 图标资源 | xianyu-admin-design-style/assets/icon-symbols.svg |
| 组件参考 | xianyu-admin-design-style/references/component-recipes.md、design-system.md |
| 当前基线提交 | `076a969`（阶段 2 契约完成；阶段 3 设计契约见 `docs/03-frontend-design.md`） |
| 已知 viewport | 桌面 1440×900；移动端 390×844 |

## 2. 正式页面映射

| PRD 页面 | 当前原型入口 | 阶段 3 视觉验收要求 |
| --- | --- | --- |
| 仪表盘 | dashboard | 默认、加载、空异常、错误、权限不足 |
| Workspace | workspace | Run 状态、确认卡、取消、重试、部分成功 |
| 账号管理 | accounts | 登录等待、已扫码、成功、过期、失败、凭证异常 |
| 在线聊天 | messages | 连接中、断线重连、发送中、失败、人工接管 |
| 商品管理 | products | 草稿、校验失败、发布中、成功、部分成功、失败 |
| 卡券管理 | coupons | 空库存、低库存、批次状态、正文访问权限 |
| 订单管理 | orders | 待发货、发货中、成功、失败、结果未知、重试 |
| 设置 | settings | 保存中、成功、失败、权限和凭证状态 |

knowledge、review 不属于本轮正式一级页面，已决定直接删除原型入口及其页面分支，不保留隐藏、归档或内部入口。

## 3. 必须保留的视觉约束

- 深色侧边栏、卡片密度、表格信息层级和当前控制台整体布局；
- 颜色、字号、间距、圆角、阴影和图标优先使用现有设计 token；
- 所有正式页面必须覆盖加载、成功、空数据、错误、无权限、登录失效和提交中 / 禁用状态；
- 高风险按钮提交后必须禁用，直到收到结果或超时；
- 移动端目标覆盖 390×844；桌面目标固定为 1440×900，并在 `docs/03-frontend-design.md` 记录页面级状态映射。

## 4. 缺失设计输入与处理

| 缺失项 | 当前处理 | 关闭条件 |
| --- | --- | --- |
| Figma 链接和版本 | 不作为阶段 0 阻塞；以 SellerAgent 原型 + design token 作为临时基线 | 阶段 3 如有正式设计再补版本 |
| 桌面精确 viewport | 已冻结为 1440×900 | 阶段 3 文档已记录 |
| 逐状态标注 | 已补齐 8 个正式页面的状态清单 | `docs/03-frontend-design.md` §6–§7 |
| 视觉回归截图 | S4-VS1 已由本机 Chrome + CDP 生成 1440×900 与 390×844 截图 | 阶段 5/6 继续逐切片记录与 SellerAgent/design token 的偏差 |

阶段 3 只冻结视觉与交互契约，不把原型可打开、源码结构或当前交互实现等同于组件设计通过，也不等同于真实 API、E2E 或最终视觉回归通过。截图、浏览器交互和逐项偏差记录在阶段 5/6 的纵向切片中执行。
# Agent 动态视觉验收增量（2026-09-21）

- 基线：`artifacts/auto-reply-agent-ui.html`；
- 目标视口：`1440×900`、`390×844`；
- 必测状态：loading、success、empty、error、forbidden、drawer loading/error、handoff、failed、processing；
- 证据目录：`docs/agent/agent-dynamics/evidence/`；
- 逐项偏差字段：布局/间距、字号/行高、颜色、圆角/阴影、图标、表格密度、抽屉与响应式；
- 页面打开、API 200、构建成功不能单独作为视觉通过证据。

## Agent 动态本轮对比结论（2026-09-21）

- 先读取 Git 中的原型固定截图基线，再用真实 PostgreSQL + Chrome/CDP 重新截图实现；对比记录见 `docs/agent/agent-dynamics/evidence/visual-diff.md`。
- 最新产品约束覆盖原型壳层：只复用当前项目现有左侧导航，不渲染原型内置 Agent Console 左栏；右侧顶部“智能运营 / 运行记录”整栏一并移除。
- 账号展示与查询沿用全局 `AccountContext`，页面不新增账号选择器或重复账号 chip。
- 最新证据：桌面、桌面抽屉、移动主页面、移动抽屉四张截图及 `evidence.json`；截图由 `npm --workspace apps/web run test:e2e:chrome:agent-dynamics` 生成。
- 视觉验收不只看布局和文案：已从原型 HTML Git blob `620429f9d073011d6d88d7be87fc3ef49f227152` 提取并比对 18 个核心样式 token（颜色、阴影、圆角、间距、字号、字体栈），18/18 语义匹配；详细记录见 `docs/agent/agent-dynamics/evidence/visual-diff.md`。

## Dashboard 待人工处理铃铛切片（2026-09-22）

- 目标视口：桌面 `1440×900`、移动 `390×844`。
- 视觉变更：铃铛与未读数放入“待人工处理”KPI 卡片；点击后在卡片下方展开风险气泡；移除桌面底部独立风险条与移动顶部重复通知入口。
- 交互状态：默认收起、展开、风险项进入既有详情抽屉、Escape/外部点击关闭；移动右列卡片采用右对齐弹层，避免 390px 视口横向溢出。
- 证据：`docs/evidence/stage5/S4-VS-DASHBOARD/screenshots/dashboard-desktop-1440x900.png`、`dashboard-mobile-390x844.png`；由 `npm --workspace apps/web run test:e2e:chrome:dashboard` 生成。
- 当前结论：受控视觉与交互验证 PASS，等待用户人工审核后再合入 `main`。

## 账号弹窗视觉复核（2026-09-22）

- 设计稿源文件：`docs/design/account-login-dialog-design.html`；设计稿截图：`account-dialog-design-1440x900.png`、`account-dialog-design-390x844.png`。
- 实现截图：`accounts-login-modal-creating-desktop-1440x900.png`、`accounts-login-modal-creating-mobile-390x844.png`、`accounts-login-modal-desktop-1440x900.png`、`accounts-login-modal-mobile-390x844.png`、`accounts-delete-modal-desktop-1440x900.png`、`accounts-delete-modal-mobile-390x844.png`。

| 对比项 | 设计稿基线 | 实现复核结果 | 结论 |
| --- | --- | --- | --- |
| 登录弹窗尺寸 | 桌面固定 680×540；移动端受视口约束 | Chrome/CDP 实拍桌面 680×540；移动端无横向溢出 | PASS |
| 删除弹窗尺寸 | 桌面约 430px；移动端全宽收窄 | Chrome/CDP 实拍桌面 430px；移动端保留双按钮和安全边距 | PASS |
| 遮罩与背景 | `rgba(17,24,39,.54)` + `blur(7px)`；白色 16px 圆角卡片 | 账号专用遮罩和卡片样式已隔离于全局 modal；实拍背景层级、圆角和阴影一致 | PASS |
| 登录操作 | 仅右上角关闭按钮；移除“刷新二维码”“取消登录” | 实拍仅保留右上角关闭按钮 | PASS |
| 二维码区域 | 固定 292px；二维码/生成提示垂直居中；辅助文案完整 | 实拍固定扫码区无内部滚动条；生成中居中由 `QrLoginView` 回归测试覆盖 | PASS |
| 状态切换稳定性 | 生成中与二维码展示后共享同一扫码区高度和纵向位置 | Chrome/CDP 在同一 1440×900 视口下比较两态 DOM 几何，扫码区 top/height/bottom 偏差 ≤1.5px | PASS |
| 删除确认 | 产品内风险提示、脱敏账号摘要、取消/删除动作 | 实拍已替换浏览器 `window.confirm`，失败和提交中状态保留 | PASS |

本轮对比前发现的 P2 偏差为账号弹窗被全局 `.modal-card` 注入顺序覆盖内边距、溢出和删除宽度；以及 QR 视图在生成中与展示后子节点数量不同导致 Grid 拉伸、扫码区发生跳动。已通过提高 specificity、固定状态行占位、`align-content:start` 和桌面端间距修正关闭。登录截图中的“二维码暂不可用”属于受控 harness 未返回图像时的业务占位态，不影响固定扫码区和居中布局验收；Chrome/CDP 已对两态几何位置做回归断言。

### Dashboard 铃铛气泡视觉修正（2026-09-22）

- 气泡定位：以铃铛外层为锚点，垂直间距不超过 10px，右边缘与铃铛对齐。
- 触发器样式：白色实心背景、深色铃铛图标、可见边框、轻阴影和高对比未读徽标。
- 响应式：移动端右列卡片展开时，气泡右边缘不超过 390px 视口。
- 验收：Chrome/CDP E2E 已加入桌面/移动几何断言，截图已重新生成。
