# Agent 动态视觉对比记录

- 对比日期：2026-09-21
- 实现分支：`codex/agent-dynamics`
- 实现视口：`1440×900`、`390×844`
- 浏览器：本机 Chrome Headless + CDP
- 数据条件：真实 PostgreSQL 迁移、真实自动回复运行、`auto_reply_runs` 与 `auto_reply_run_events` 已落库

## 对比素材

| 素材 | 路径 / 来源 |
| --- | --- |
| 原型桌面基线 | Git blob `94643a1a04439906cccac8b59cbb96991ecb33d8`，原型截图含 Agent Console 左侧栏与顶部栏 |
| 原型抽屉基线 | Git blob `d1f9bb9eeb042219bd95f415f03bb00c0cad8271` |
| 原型移动基线 | Git blob `f7321cc1275412f444b62adf0b908ec8c11c8952` |
| 当前桌面实现 | `screenshots/agent-dynamics-desktop-1440x900.png` |
| 当前桌面抽屉 | `screenshots/agent-dynamics-drawer-desktop-1440x900.png` |
| 当前移动主页面 | `screenshots/agent-dynamics-mobile-390x844.png` |
| 当前移动抽屉 | `screenshots/agent-dynamics-mobile-drawer-390x844.png` |

## 样式 token 对比

原型 HTML 已从 Git blob `620429f9d073011d6d88d7be87fc3ef49f227152` 恢复并与实现 CSS 做了逐项比对，不只检查布局和文案。实现使用 `.agent-dynamics-app` 局部 token，避免污染宿主页面；以下核心 token 与原型语义一致：

| Token 类别 | 原型值 | 实现值 | 结果 |
| --- | --- | --- | --- |
| 页面背景 / 卡片 | `#f6f7f9` / `#fff` | `#f6f7f9` / `#fff` | PASS |
| 品牌 / 链接 | `#1f3a5f` / `#245a8d` | `#1f3a5f` / `#245a8d` | PASS |
| 文本层级 | `#111827` / `#475569` / `#6b7280` | 相同 | PASS |
| 边框 / 状态色 | `#e5e7eb`、success/warn/danger/info | 相同 | PASS |
| 柔和蓝背景 | `#ebf3fa` | `#ebf3fa` | PASS |
| 卡片阴影 | `0 1px 3px rgba(0,0,0,.04)` | `0 1px 3px rgba(0, 0, 0, 0.04)` | PASS（仅空格格式差异） |
| 核心圆角 | 4 / 5 / 6 / 7 / 8 / 10px | 对应选择器逐项一致 | PASS |
| 核心间距 / 字号 | 8/9/10/12/14/16/18/20px，10–24px 字号层级 | 对应选择器逐项一致 | PASS |
| 字体栈 / 数字格式 | Inter、Noto Sans SC、PingFang SC、Microsoft YaHei；tabular-nums | 页面 token 与现有宿主字体策略兼容 | PASS |

Token 比对命令：从原型 HTML blob 提取 `:root` token，再与 `agent-dynamics.css` 的 `--agent-*` token 做映射比较；结果为 18/18 核心 token 语义匹配。此前仅凭这组 token 不能代表控件高保真，因为控件元素类型、级联优先级和 UA 外观不会被这类静态 token 比对覆盖。

## 控件级视觉复核（2026-09-21）

本轮用户反馈聚焦输入框、下拉框、筛选框、按钮和字体细节。复核发现并修复了两个导致截图级失真的根因：

1. 业务页曾各自定义原生 `<select>` 外观，原生箭头、UA padding、line-height 和 option 字体造成跨页面漂移。
2. `.agent-dynamics-app button, input, select { font: inherit; }` 的特异性高于控件单类规则，把控件字号和字重重置成宿主值，导致视觉被放大。

修复后，所有业务下拉（包括 Agent 动态的时间范围、运行状态、运行阶段）都通过共享 `SelectField` 渲染；Agent 动态仅保留领域适配组件，不再渲染按钮式菜单。共享组件按 `xianyu-admin-design-style` token 统一处理 12px 正文、400 字重、`#F6F7F9` 填充、`#E5E7EB` 边框、7px 圆角、SVG chevron、hover/focus/disabled 状态。Chrome/CDP computed-style 证据（1440×900）如下：

| 控件 | 元素 | 字号 | 字重 | 字色 | 背景 | 圆角 | 宽度 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 时间范围 | `SELECT` | `12px` | `400` | `rgb(17, 24, 39)` | `rgb(246, 247, 249)` | `7px` | `113px` |
| 主按钮 | `BUTTON` | `11px` | `600` | `#fff` | `rgb(36, 90, 141)` | `7px` | `103px` |
| 状态筛选 | `SELECT` | `12px` | `400` | `rgb(17, 24, 39)` | `rgb(246, 247, 249)` | `7px` | `96px` |
| 搜索框 | `INPUT` | `11px` | 宿主 normal | `rgb(17, 24, 39)` | `rgb(246, 247, 249)` | `7px` | `220px` |

本轮截图已与 Git 固定原型桌面基线并排复核：宿主左侧栏、顶部栏仍按产品约束移除；右侧业务区的卡片、密度、颜色、字体层级与共享下拉 token 保持一致。E2E 断言 Agent 动态区域恰好包含 3 个 `.ui-select-control select`，并校验 aria label、元素类型和 computed style，避免回退为按钮菜单或浏览器默认箭头。

## 动态刷新验收（2026-09-21）

页面仍按 `refreshIntervalMs=5000` 每 5 秒轮询摘要和运行记录，但轮询不再用 skeleton 覆盖已加载内容：

- KPI 在后台刷新期间继续展示上一版值，不再因为 `refreshing=true` 闪烁成骨架块；
- 运行列表刷新失败时保留上一次成功的行、分页和筛选条件，仅展示 inline error；
- 轮询不会修改 `filters`，也不会触发浏览器级页面重载；
- 回归测试覆盖旧数据、筛选关键词和刷新错误同时可见。

## 逐项结论

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| 主体信息架构 | PASS | KPI、实时运行动态、链路健康、状态分布、异常与运行记录保留在右侧业务区 |
| 当前项目左侧导航 | PASS | 仅使用 `App.tsx` 的现有 `.sidebar`；Agent 动态位于“订单管理”和“设置”之间 |
| 原型内置左侧栏 | PASS（按需求移除） | `.agent-dynamics-sidebar` 不再渲染，避免出现双侧栏 |
| “智能运营 / 运行记录”顶部整栏 | PASS（按需求移除） | 页面不再渲染 `.agent-dynamics-topbar`，不重复展示账号 chip / 通知入口 |
| 账号上下文 | PASS | 页面继续使用全局 `AccountContext.currentAccountId` 驱动 API 查询，不在页面内复制账号选择逻辑 |
| 桌面布局 | PASS | 外层 sidebar 宽度保持 224px，右侧宿主移除全局 main 双重 padding 与嵌套滚动 |
| 移动响应式 | PASS | 沿用项目现有横向主导航；Agent 动态正文在 390px 下正常换行，抽屉单独以底部 sheet 展示 |
| 原型与实现差异 | 已批准 | 原型的 Agent Console 左栏和顶部栏是刻意删除项；其余右侧内容结构与视觉 token 延续原型 |

## 证据限制

- 原型 HTML 不在当前 worktree 文件树，但可由 Git blob `620429f9d073011d6d88d7be87fc3ef49f227152` 恢复；截图和 token 对比均使用该固定基线。
- 原型左栏 / 顶部栏是与最新产品约束冲突的刻意删除项，不将其缺失计为视觉偏差。
