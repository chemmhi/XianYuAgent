# Workspace 原生只读上下文垂直切片

- 切片编号：WS-VS-01
- 日期：2026-09-28
- 状态：VERIFIED
- 目标：让 Workspace 通过当前项目原生领域数据回答商品、卡券、订单和 Agent 运营数据查询。

## 用户路径

1. 管理员在 /accounts 选择当前账号。
2. 管理员进入 /workspace，在已有会话中输入自然语言查询，例如：
   - “查看当前账号的商品”
   - “有哪些可用卡券”
   - “最近的订单和未发货订单”
   - “查看今天 Agent 运营数据”
3. Workspace Run 通过当前项目 Store 读取数据，按当前账号 scope 过滤。
4. Agent 在对话中返回结构化、可读摘要，保留来源类型、数量和关键字段。
5. 刷新页面或重新打开会话后，查询结果仍来自持久化的 Run/Message 记录。

## 本切片范围

- 读取商品列表（标题、状态、价格、库存、更新时间）。
- 读取卡券批次列表（批次、用途、状态、总量/可用量、绑定商品）。
- 读取订单列表（订单号、商品、买家、支付/交付状态、金额、时间）。
- 读取 Agent 运营摘要（自动回复处理量、完成率、失败/转人工、延迟和健康状态）。
- 结果通过 Workspace 对话消息和 Run 事件展示。
- 仅允许当前账号范围，禁止跨账号读取。
- 读操作不进入 Confirmation / Outbox。

## 明确不在本切片

- 商品发布、卡券新增、设置修改、订单发货。
- Workspace Confirmation / Cancel / Retry / Outbox 写操作。
- 直接暴露 CredentialStore、闲鱼原始响应或卡券正文。
- 依赖模型自行猜测资源；必须由服务端工具路由与账号 scope 约束。

## 后端边界

- WorkspaceService：校验管理员会话、账号 scope、Run 与 session 归属。
- PiRuntimeAdapter：解析只读意图，调用 Store 领域查询，产出脱敏摘要。
- Store：复用 listProducts、listCouponBatches、listOrders、getAutoReplyActivitySummary。
- 前端只消费 Workspace Run/Message/事件，不直接请求 Store 或原始闲鱼接口。

## 验收证据

- 单元：意图路由、结果摘要、账号 scope、空数据、未知意图和异常脱敏。
- API：MemoryStore 真实 HTTP 链路，查询结果落 Run/WorkspaceMessage。
- 持久化：PostgreSQL 或等价真实 Store 复读 Run/Message。
- 前端：Workspace 对话显示查询结果、加载/失败/空数据状态；现有 session 切换和实时事件不回归。
- 浏览器：Chrome/CDP 通过 /workspace 输入查询并看到真实结果；桌面 1440×900，移动 390×844 至少各一份截图。
- 安全：跨账号查询返回 scope 错误；结果不包含 credential、cookie、卡券正文和原始外部响应。

## 已执行验证

- `node --import tsx --test apps/api/scripts/workspace-native-read.test.ts`：5/5 通过，覆盖意图路由、四类安全摘要、账号 scope、Pi Runtime 不调用模型、InProcess 终态事件正文。
- `npm run typecheck:api`：通过。
- `npm run build:api`：通过（Chrome/CDP 脚本内真实执行）。
- `npm run typecheck:web`：通过。
- `npm run build:web`：通过（前端构建与类型检查）。
- `npm --workspace apps/web run test -- --run src/features/workspace`：Workspace 前端定向测试通过。
- `node apps/web/scripts/e2e-workspace-native-read.mjs`：真实 PostgreSQL + API + Vite + Chrome/CDP 通过；4 个 Workspace Session、4 个 Run、商品/卡券/订单/Agent 运营摘要均完成持久化复读。
- 视觉证据：`artifacts/real-verify/S4-VS-WS-VS-01/screenshots/workspace-native-read-desktop-1440x900.png`、`workspace-native-read-mobile-390x844.png`。

## 真实浏览器结果

- 商品：返回 `E2E 原生商品`、发布状态、价格、更新时间和卡券绑定数。
- 卡券：返回 `E2E 原生卡券`、用途、状态与 `可用 2/2`；卡券正文未出现在 UI 或结果中。
- 订单：返回 `NATIVE-ORDER-*`、商品、买家、金额、支付和交付状态。
- Agent 运营：返回过去 24 小时入站量、完成率、转人工、失败、P95 与健康状态。
- 真实视口：桌面 `1440×900`、移动 `390×844` 均已截图复核。

## 评审结论

- 业务/验收：PASS；四类原生只读查询均从 `/workspace` 用户入口完成。
- 架构/数据流：PASS；Workspace 复用 Store，服务端按账号 scope 过滤，未进入 Confirmation / Outbox。
- 质量/安全/运维：PASS；敏感卡券正文、Credential、Cookie 和原始外部响应未进入结果；PostgreSQL 持久化和 Run 事件复读通过。

## 回滚

- 关闭 Workspace 原生查询路由，保留已有 Session/Run/Message 历史。
- 不删除产品、卡券、订单或 Agent 运营数据。
- 恢复到仅模型回答或只读历史展示。

## 下一切片门禁

WS-VS-01 已 VERIFIED，允许进入 WS-VS-02“商品发布确认”切片。
