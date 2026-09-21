# S4-VS7A 视觉偏差记录

基线：`SellerAgent/src/App.tsx` 与 `SellerAgent/src/styles.css` 的 OpenAI API ModelClient 面板。  
实现：`apps/web/src/features/settings/components/OpenAISettingsPanel.tsx` + `settings.css`。  
复核 viewport：`1440×900`、`390×844`，Chrome/CDP，2026-09-21。

| 区域 | 基线映射 | 实现结果 | 级别 | 处理 |
| --- | --- | --- | --- | --- |
| 页面骨架 | 深色侧栏、浅灰背景、右侧设置内容 | 结构、颜色和间距对齐 | P3 | 已通过截图复核 |
| 设置导航 | 280px 分类列表、active 左侧蓝色 inset | 桌面双栏、移动横向短标签和底部导航对齐 | P3 | 已通过截图复核 |
| OpenAI hero | `ModelClient` eyebrow、标题、说明、右上 badge | 保留原文层级并接入真实状态 | P3 | 已通过截图复核 |
| 主/备卡片 | `two-grid nested` + `model-box` | 双列桌面、单列移动；各自 provider/base URL/key/model/连通性 | P3 | 已通过截图复核 |
| 操作区 | 原型未固定业务按钮 | 每张卡片新增“测试连通性”“保存”，保持原型按钮密度和主色 | P3 | 需求新增，已验证 |
| API Key 回显 | 原型使用脱敏示例串 | 已保存配置回显末四位，中间以 `••••` 掩码；聚焦编辑时切换为密码输入，不回显明文 | P2 | 已修复并加入 E2E 脱敏断言 |
| Model 下拉 | 原型为静态示例 model | 正式实现按卡片 configId 延迟调用 provider `/models`，不硬编码模型 id | P1 | 已验证 |
| 时间线 | 原型 `.timeline-row` 有边框、圆角、三列布局 | 正式前端补齐基类样式后与原型一致 | P2 | 已修复并重新截图 |
| 成功状态 | “测试通过，已生效 / 备用可用” | 测试后保存保留本地成功态，API 脱敏刷新不重置 | P2 | 已修复并重新截图 |
| 移动可用性 | 原型移动端单列卡片 | 390px 单列，动作区最小 38px；证据截图滚动到操作按钮和备用卡顶部 | P3 | 已通过截图复核 |
| 动态 fallback 状态 | 原型展示规则说明，不要求实时 toast | 当前截图展示静态已保存配置；主失败→备用由 E2E 断言，未在页面实时展示切换事件 | P2 | 记录为产品后续增强，不阻塞本切片 |
| 测试地址 | 原型使用 `https://api.example.com/v1` | E2E 使用本地随机端口 fake provider | P3 | 测试环境差异，非生产 UI 偏差 |

结论：无 P0/P1 视觉偏差；P2 项已修复或明确记录为非阻塞增强。正式前端截图满足本切片高保真证据门禁，但仍需 merge lock 后独立人工签核才能关闭阶段门禁。
