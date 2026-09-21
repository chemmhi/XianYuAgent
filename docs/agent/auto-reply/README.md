# 自动回复 Agent

## 文档状态

- 状态：`IMPLEMENTED_PARTIALLY_VERIFIED`
- 日期：2026-09-21
- 当前阶段：自动回复 Agent、账号级配置和四个只读工具已编码；定向单元、链路与设置页 Chrome/CDP 验证已通过，完整发布门禁仍需以最终命令结果为准
- 适用范围：闲鱼买家自动回复链路

## 文档索引

- [`design.md`](./design.md)：自动回复 Agent 的边界、工作流、工具、状态机、配置和测试契约。
- [`activity.md`](./activity.md)：Agent 动态 Tab 的运行、事件落库、查询 API、前端 adapter 和真实端到端验收契约。

## 核心结论

1. 应用启动后自动监听闲鱼网关，不依赖管理员打开页面。
2. 自动回复 Agent 与 Workspace Agent 完全分离，只共享底层基础设施。
3. 高风险问题默认转人工，不自动发送解释性消息。
4. Agent 只能选择性调用四个只读工具，不能通过工具修改商品、订单或直接发送消息。
5. 开发和测试默认使用 `simulate`；`live` 发送继续受环境变量数组白名单约束。
6. 同一条买家消息只产生一个逻辑回复；长回复可以拆成多段物理消息顺序发送。
7. Agent 可以在有业务相关性的情况下主动推荐店铺内其他商品，但必须基于店铺商品工具返回的事实。

8. Agent 动态只读消费 `messages.auto_reply_runs` / `messages.auto_reply_run_events`，不复用 Workspace Run/Step；页面必须经过 raw DTO → canonical VM adapter，并以真实数据库回读作为完成证据。

## 非目标

- 本设计不把 Workspace Agent 改造成买家 Agent。
- 本设计不允许复用 Workspace Agent 的 Prompt、Runtime loop、工具注册表、会话/Run/Step 或确认流程。
- 本设计不包含订单修改、商品修改、发货、改价、凭证读取或其他写操作工具。
- 本设计不把真实 `live` 发送作为自动化测试默认路径。
