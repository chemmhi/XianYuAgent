# 商品发布 HTML 设计稿说明

## 项目边界

- 目标项目：`F:\ChenHai\Project\XianYuAgent`
- 参考项目：`F:\ChenHai\Project\Ydisks-Xianyu-Helper`
- 本稿只写入目标项目的 `design/` 目录。
- 参考项目只用于核对商品发布 API 字段与接口语义，不复用其 UI 壳、色板、侧栏或弹窗交互。

## 当前项目风格依据

- `xianyu-admin-design-style/references/design-system.md`
- `xianyu-admin-design-style/references/component-recipes.md`
- `apps/web/src/features/products/components/ProductsPage.tsx`
- `apps/web/src/features/products/components/ProductDrawer.tsx`
- `apps/web/src/features/products/components/products.css`
- `apps/web/src/features/messages/components/MessagesPage.tsx`
- `apps/web/src/features/messages/components/messages.css`
- `apps/web/src/features/settings/components/OpenAISettingsPanel.tsx`
- `apps/web/src/features/settings/components/AutoReplyAgentPanel.tsx`
- `apps/web/src/features/workspace/components/WorkspacePage.tsx`

## 设计决策

1. 使用当前项目的深海军蓝侧栏、`#F6F7F9` 页面背景、白色卡片、10px 圆角和紧凑运营台密度。
2. 发布入口沿用当前商品页的右侧抽屉，不使用参考项目的居中弹窗。
3. 商品描述复用聊天 composer 的交互语言：附件条、图片按钮、表情入口、可伸缩文本框、快捷键提示和发送区式 footer。
4. 当前账号上下文已由上游页面提供，发布抽屉不再展示“选择发布账号”卡片。
5. 商品图片直接进入描述 composer 的附件条，与描述输入保持同一交互上下文；底部只保留一个“+”上传入口，并将图片数量 / 支持粘贴提示与快捷键、字数信息合并为一条底部信息栏。
6. 不提供表情入口，不显示“AI 文案辅助已开启”状态提示；仅保留明确的“AI 优化文案”按钮。
7. 基础信息、价格与物流使用同一张连续表单卡，仅用细分标题和分隔线区分，不再拆成两张卡片。
8. 商品分类由商品标题和描述自动识别，UI 使用只读状态展示识别结果，不再提供手动分类下拉框。
9. 支持上传、剪贴板粘贴、删除和点击放大预览，最多 9 张；AI 优化只复用当前 Workspace / 自动回复的 Provider 配置，不在发布抽屉中单独展示 Provider 卡片，也不复制 API key。
10. 不额外展示买家侧预览；保留发布前显式确认，并在确认后进入“发布队列中”状态。
11. 字号梯度对齐当前项目其他抽屉：抽屉标题 20px、区块标题 16px、正文 14px、紧凑字段 13px、辅助信息 12px。

## API 字段映射（来自参考项目，仅作契约参考）

单商品发布：`POST /api/v1/items/publish`

| UI 字段 | API 字段 | 说明 |
| --- | --- | --- |
| 当前账号上下文 | `cookie_id` | 由上游账号上下文注入；本抽屉不再提供账号选择 |
| 商品标题 | `title` | 标题输入 |
| 商品描述 | `description` | 聊天式 composer 内容 |
| 售价 | `price` | 当前售价 |
| 原价 | `original_price` | 可选原价 |
| 库存数量 | `quantity` | 库存输入 |
| 邮费模式 | `postage_mode` | 包邮 / 买家承担 |
| 邮费 | `postage` | 买家承担时生效 |
| 发货地 | `location` | 省 / 市 |
| 商品图片 | `images[]` | 描述 composer 附件条中的图片列表 |

批量发布相关接口在本稿中不展开，仅保留未来可复用的批量操作入口：

- `POST /api/v1/items/publish-batches/preview`
- `POST /api/v1/items/publish-batches`
- 批次状态 / 结果 / 取消 / 重试接口

## Provider 复用约束

设计稿默认使用当前项目的 account-scoped Provider 配置：

- `provider`
- `baseUrl`
- `model`
- `reasoningEffort`
- `wireApi`
- primary / backup 配置及连通状态

发布页不新增独立 AI 配置，不复制 API key；“AI 优化文案”只消费当前 Workspace / 自动回复已经配置好的 Provider。

## 预览与验证

- 设计稿文件：`design/product-publish-design.html`
- 该文件是静态 HTML 预览稿，不修改生产 React 页面和 API 行为。
- 已包含桌面、窄屏和移动端压缩布局；可直接双击或通过本地静态服务器打开。
- 交互演示：打开抽屉、在描述 composer 中上传 / 拖拽 / 粘贴图片、点击附件放大预览、AI 文案优化、保存草稿、发布确认与队列状态。
