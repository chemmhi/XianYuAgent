# XianyuSellerAgent 视觉验收基线

- 文档版本：v0.1
- 更新日期：2026-09-19
- 当前阶段：阶段 3——前端信息架构与设计契约
- 当前结论：SellerAgent 原型 + design token 已冻结为阶段 3 视觉基线；高保真截图回归留到阶段 5/6 执行

## 1. 基线来源

| 项目 | 当前基线 |
| --- | --- |
| 实现参考 | SellerAgent/ React + Vite + TypeScript 原型 |
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
| 视觉回归截图 | 当前未执行 | 阶段 5 每个前端切片提供目标 viewport 截图或回归对比 |

阶段 3 只冻结视觉与交互契约，不把原型可打开等同于真实 API、E2E 或最终视觉回归通过。截图、浏览器交互和逐项偏差记录在阶段 5/6 的纵向切片中执行。
