# Common Controls 复盘与修复登记

更新时间：2026-09-21 23:05（Asia/Shanghai）
状态：**FAIL / OPEN — Phase 1 共享控件已修复，页面级 P0/P1 仍开放**
唯一视觉基准：`F:\ChenHai\Project\XianYuAgent-search-select-preview\docs\design-preview\xianyu-admin-controls-review.html`

## 1. 审核结论

用户本轮反馈确认：当前真实页面中的 SearchField 与设计稿存在可见差异，SelectField 差异更大，尤其是展开后的选项菜单。现有 `/controls` 预览页和 `visual-diff.md` 只能证明部分静态 token 接近，不能证明真实业务路由或 Select 展开态 1:1。

本文件先登记问题和修复顺序。**共享通用组件已先修复并完成浏览器截图/DOM 样式证据；下一步才处理页面级遗漏和非组件问题。** 页面级问题仍按本文 Phase 2/3 执行。

## 1.1 当前进度

- Phase 1 共享控件修复已通过 `19 tests passed`、`npm --workspace apps/web run typecheck`、`npm --workspace apps/web run build` 与 `git diff --check`。
- 合入提交：`fe9358c merge: fix shared search select controls`。
- 共享控件证据：`docs/evidence/common-controls/shared-search-select-fix-v3/visual-diff.md`；已包含 `1440×900` 与 `390×844` 的基线、实现、差异热图和 DOM 样式指标。
- SelectField Open preview 已在 `/controls` 实现；该静态菜单仅用于视觉审计，不进入业务实例，真实业务路由仍需继续做页面级复核。
- 页面 CSS 隔离、Accounts/Coupons/Workspace 功能遗漏和真实业务路由截图仍为 `OPEN`。

## 2. 已确认的范围决策

| # | 用户决策 | 本轮执行约束 |
| --- | --- | --- |
| 1 | 全局搜索正式移除 | 不恢复 `TopBar + SearchField`；旧文档/旧证据中若仍把全局搜索写成必需项，需要在文档清理阶段同步更正。 |
| 2 | Orders 保留单一聚合状态下拉 | 不拆成支付/订单/发货/售后四个独立下拉；保留聚合状态映射，同时记录 schema 能力差异。 |
| 3 | Workspace Run composer 保留特调 | 允许第二个页面专用 textarea；继续保留快捷键、提交状态和运行链路，不替换为 `TextAreaField`。 |
| 4 | 普通按钮不纳入本轮统一 | Dashboard、表格排序、分页、Tabs、菜单、图标按钮等普通/领域按钮不纳入本轮 `Button` 统一；只记录为后续独立切片，不作为本轮控件失败原因。 |
| 5 | P0/P1 全部纳入下一轮修复 | 下表中的共享控件问题、页面遗漏、样式隔离和证据问题均进入后续计划；在关闭前 checklist 保持 `FAIL / OPEN`。 |

## 3. 共享通用组件问题（第一阶段，必须先修）

### 3.1 SearchField

设计稿基准 token：`34px` 高度、`7px` 圆角、`#F6F7F9` 默认底色、`#E5E7EB` 边框、`0 10px` 水平内边距、`7px` icon gap、`14px` 搜索图标、`#9CA3AF` placeholder；focus 为 `#245A8D` 边框、白底和 `0 0 0 3px rgba(36,90,141,.09)` 光环；清空按钮为 `20×20px`、`4px` 圆角。

| 问题 | 证据/位置 | 修复要求 |
| --- | --- | --- |
| `/controls` 静态预览中的 SearchField token 与设计稿大体一致，但这不代表真实页面一致 | `docs/evidence/common-controls/visual-diff.md` 的 DOM 指标显示实现与基线的 SearchField 均为 `34×220`、`7px`、`#F6F7F9`/focus 白底；整页像素差异仍为桌面 `12.024%`、移动 `17.611%` | 共享组件修复后，必须分别在真实 Accounts、Products、Coupons、Orders、Messages、Workspace、Agent Dynamics 路由截图，并比较 computed style；不能只引用 `/controls`。 |
| Workspace 页面直接覆盖 SearchField 内层 input，实际会改写共享 token | `apps/web/src/features/workspace/components/workspace.css:14`：`.workspace-search input` 重写 `height/padding/border/border-radius/background` | 删除对 `.workspace-search input` 的控件 token 覆盖；页面 CSS 只保留搜索容器的宽度、margin 和布局。 |
| Messages 页面把 SearchField 圆角改为 `8px`，与设计稿 `7px` 不一致 | `apps/web/src/features/messages/components/messages.css:182-188`：`.messages-search` 设置 `height:34px`、`border-radius:8px`、`background:var(--bg)` | 删除 border/radius/background 等内部控件覆盖；保留宽度、排列和间距。 |
| Auth、Settings、Products、Coupons 等页面仍有直接命中 input/textarea 的规则，存在同类漂移风险 | `auth.css:8-9`、`settings.css:1,7`、`products.css:66-69`、`coupons.css:9,69,76,97,100`；部分规则同时影响共享 Input/TextArea | 逐个 selector 分类：允许布局的保留，命中共享控件 token 的删除或改为外层布局 class；建立 CSS 扫描守门。 |
| 清空态只在预览页启用，生产搜索框没有统一 clear 行为 | `SearchField.clearable` 仅由 `ControlsPreview.tsx:23` 使用；生产页面调用未启用 `clearable` | 逐页确认是否需要清空；需要时使用共享 clear button，不需要时在页面矩阵中记录为有意差异。 |

### 3.2 SelectField（高风险）

设计稿基准 token：外观 `34px` 高、`7px` 圆角、浅灰底、SVG chevron；展开态包含独立浮层：白底、`8px` 圆角、`0 18px 40px rgba(17,24,39,.12)` 阴影，选项按钮最小高度 `31px`、`5px` 圆角，hover/selected 为 `#EBF3FA` + `#245A8D`，选中项带勾选图标。

| 问题 | 证据/位置 | 修复要求 |
| --- | --- | --- |
| 当前 `SelectField` 只输出原生 `<select>` 和 chevron，没有设计稿中的展开菜单 DOM | `apps/web/src/shared/ui/SelectField.tsx:18-24` 只有 `<select>` + `<svg>`；`select-field.css` 没有 `.ui-select-menu`/option button 样式 | 先按设计稿实现可审计的 open fixture/菜单呈现方案，同时保留原生 select 语义或明确原生与视觉浮层的同步策略；不能仅靠 `.is-open` 预留 class 宣称完成。 |
| 设计稿有 `Open preview`，实现预览没有对应状态 | 设计稿 HTML `xianyu-admin-controls-review.html:681-689` 有 `.ui-select-control.is-open`、`.ui-select-menu` 和 `role=listbox`；`ControlsPreview.tsx:24` 只渲染 Default/Focus/Disabled | 在 `/controls` 增加与设计稿相同的 Open preview；为真实路由补一份浏览器展开截图。 |
| 当前 SelectField focus ring 与设计稿不一致 | `select-field.css:28-34` 使用 `outline:2px solid rgba(36,90,141,.35)`；设计稿 CSS `xianyu-admin-controls-review.html:387-393` 使用 `box-shadow: var(--focus-ring)`（`0 0 0 3px rgba(36,90,141,.09)`） | 统一 focus 边框、白底和 focus ring token，避免同时存在强 outline 与设计稿光环。 |
| 原生 option 展开效果无法跨浏览器 1:1 控制，当前没有截图证据 | 现有 `visual-diff.md` 仅比较静态 `<select>` 外框；没有实际 open menu 的截图、option computed style 或键盘操作证据 | 以 Chrome/CDP 固定 viewport 记录 native open 或视觉 fixture；至少覆盖 default/focus/disabled/open/selected/hover/keyboard。若保留原生展开，文档必须标注浏览器差异边界。 |
| 页面 CSS 可能继续覆盖 SelectField 内部 token | `accounts.css:16-18`、`products.css:8-10`、`coupons.css:10-11`、`orders.css:10-12` 主要是尺寸布局；需与内层 `select` 命中情况分离确认 | 允许外层宽度/min-width/flex；禁止页面 CSS 重写 inner select 的 padding、border、background、radius、chevron。 |

### 3.3 其余共享控件

| 组件 | 当前判断 | 第一阶段动作 |
| --- | --- | --- |
| `InputField` | 共享 token 在预览页接近设计稿，但 Auth/Settings/Products/Coupons 页面仍有直接 input 覆盖 | 与 SearchField 同步完成 CSS 隔离；补真实 focus/disabled/error 截图。 |
| `TextAreaField` | 共享基础态接近设计稿；Messages 在线聊天 composer 与 Workspace Run composer 为特调例外 | 保留两个特调例外；普通表单只由 `TextAreaField` 负责视觉。 |
| `Button` | 预览页 token 已有基础覆盖 | 本轮不扩展 Dashboard、排序、分页、Tabs、菜单等领域按钮；只保留已迁移通用按钮的视觉证据。 |
| `PlaceholderCell` | token 与设计稿接近，生产页面覆盖不完整的风险仍在 | 在 Products 及其他明确空值字段补真实路由截图；不得把状态/错误文案伪装为空值。 |

## 4. 页面级遗漏与非组件问题（第二阶段，通用组件通过后执行）

| 页面/模块 | 问题登记 | 修改方向 | 优先级 |
| --- | --- | --- | --- |
| Auth | `auth.css:8-9` 直接覆盖共享 InputField 的 padding、背景、圆角、focus | 删除 token 覆盖，只保留布局；补登录/初始化页视觉证据 | P0 |
| Accounts | `AccountListFilters` 有 `connectionStatus`，`AccountToolbar` 只渲染 `status` | 增加共享 SelectField 和 controller 回调；补 schema→UI 映射测试 | P0 |
| Accounts | 登录方式切换、分页、表格操作属于自定义语义，未纳入独立清单 | 本轮不做 Button 统一；补 tabs/operation 语义登记和后续视觉证据 | P1 |
| Products | `.products-account-select .ui-select-control` 当前疑似死 CSS | 清理死 selector，或恢复真实账号选择器并登记 | P1 |
| Coupons | `CouponBatchFilters` 有 `status`、`stockAlert`，工具栏只有 `purpose` | 增加两个共享 SelectField，接通 controller/API/query，补测试 | P0 |
| Coupons | API/controller 支持分页，但 `CouponBatchTable` 无分页导航 | 增加分页控件；按钮本轮不统一，但分页能力必须可达 | P0 |
| Coupons | 关联商品选择使用 `button.active`，缺少 listbox/option 语义 | 保留 SearchField；提取多选列表语义组件并补键盘/ARIA 证据 | P1 |
| Orders | 保留单一聚合状态下拉，但 `sortBy/sortOrder` schema/API 没有 UI | 不拆状态维度；补排序能力或正式清理无用 schema，记录决策 | P1 |
| Orders | `.orders-filters-wrap` 等旧 selector 与当前 JSX 不一致 | 清理死 CSS，避免误判已有控件 | P1 |
| Messages | 搜索框被页面 CSS 改为 8px；“全部会话/未读”是独立二态筛选 | 先隔离 SearchField；Tabs/筛选语义单独登记，不按 SelectField 处理 | P0/P1 |
| Messages | 在线聊天 composer 是明确特调组件；emoji/附件为自定义 popup/action | 保持 composer 不改；补 popup/menu/附件清单和证据 | P0/P1 |
| Workspace | 搜索词没有传给 API：`controller.ts:33` 调用 `api.listSessions(options.accountId)`，未传 search | 将搜索词纳入 controller→API；补 debounce、loading、empty 证据 | P1 |
| Workspace | Run composer 为第二个特调 textarea，已获用户确认 | 保留现有特调；写入 exception allowlist，禁止默认豁免扩散 | P0 |
| Settings | `settings.css:1,7` 直接命中 input/textarea；`.settings-account-picker` 无 JSX | 删除 token 覆盖；清理死 selector；补真实编辑器状态截图 | P0 |
| Agent Dynamics | Search/Select 已接入，但真实 open/focus/disabled/empty/error 证据缺失 | 通用组件修复后补固定 viewport 与展开态证据 | P1 |
| 全局壳层 | 全局搜索已由用户正式确认移除 | 不恢复组件；清理旧截图/文档中将其列为必需的内容 | P1 |

## 5. 当前证据缺口

1. `docs/evidence/common-controls/visual-diff.md` 只覆盖 `/controls` 预览页；不能代表 Accounts、Coupons、Orders、Messages、Workspace、Settings、Agent Dynamics 的真实渲染。
2. 设计稿有 Select Open preview，但实现预览没有；现有 open class 只是 CSS 预留，没有真实展开截图。
3. 现有 DOM 指标对 SearchField 默认/focus token 基本相等，不能排除页面 CSS 覆盖；必须做 selector 级 computed-style 扫描。
4. 现有 guardrail 主要扫描“已经存在的原生控件”，不能发现搜索框/筛选字段/分页被删除或未渲染。
5. 当前视觉 diff 非零：桌面 changed `155827 / 12.024%`，移动 changed `57969 / 17.611%`；在组件级人工签核完成前不得写“1:1 通过”。

## 6. 分阶段修复计划

### Phase 1 — Shared controls gate（先做）

- 按设计稿修正 SearchField token 和清空态；移除页面对 shared inner input 的覆盖入口。
- 设计并实现 SelectField open fixture/菜单视觉，修正 focus ring，保留可访问原生语义边界。
- 更新 `ControlsPreview`：补 Open preview、移动端 Search + 双 Select、默认/focus/disabled/open/selected 状态。
- 执行 Chrome/CDP `1440×900`、`390×844` 截图、DOM computed style、像素 diff；Phase 1 未通过不得进入页面级修复。

### Phase 2 — Page CSS isolation and exceptions

- 扫描并清理 Auth/Workspace/Messages/Settings/Products/Coupons 等页面 CSS 对 shared token 的命中。
- 建立 exception allowlist：Messages composer、Workspace Run composer、checkbox/file/QR/password visibility 等明确例外。
- 清理死 CSS selector，并把 Tabs、menus、multi-select、session selector 从 SelectField 清单中单列。

### Phase 3 — Functional omissions

- Accounts `connectionStatus`；Coupons `status`、`stockAlert`、分页；Orders sort UI/schema；Workspace server-side search。
- 保留 Orders 单一聚合状态下拉，不扩展为四状态下拉。
- 不在本轮统一 Dashboard、排序、分页、Tabs、菜单等普通按钮样式；只保证相关功能和证据不再被误报为已统一。

### Phase 4 — Evidence and re-review

- 逐页真实路由截图：`1440×900`、`390×844`；覆盖 default/focus/disabled/open/empty/error/modal/drawer。
- 运行 typecheck、unit/integration、真实 Chrome/CDP E2E、visual regression、build、`git diff --check`。
- 人工审核通过后，才允许把 checklist 从 `FAIL / OPEN` 更新为通过；本轮文档提交本身不改变源码状态。

## 7. 通过标准

- 共享 Search/Select/Input/TextArea/Button/PlaceholderCell 的 token 与设计稿逐项一致，Select open 视觉有真实证据。
- 页面 CSS 不再直接覆盖共享控件 token；任何例外均在 allowlist 中。
- expected-control manifest 与实际 JSX/API schema 一致，不能只扫描现存控件。
- 所有 P0/P1 项均有修复提交、测试命令和浏览器截图证据；`SellerAgent/` 保持零 diff。

