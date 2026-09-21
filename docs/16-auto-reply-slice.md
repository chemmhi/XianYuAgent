# 自动回复链路切片索引

自动回复 Agent 的设计文档已统一归档到：

- [`docs/agent/auto-reply/README.md`](./agent/auto-reply/README.md)
- [`docs/agent/auto-reply/design.md`](./agent/auto-reply/design.md)
- [`docs/agent/auto-reply/activity.md`](./agent/auto-reply/activity.md)

本文件保留为旧切片入口，避免历史引用失效。后续编码、测试、配置和验收均以 `docs/agent/auto-reply/` 下的设计为准。

当前状态：`IMPLEMENTED_PARTIALLY_VERIFIED`。自动回复运行查询 API、运行/事件迁移和 Agent 动态页面已有独立实现，但真实 PostgreSQL 事件一致性、浏览器端到端和双 viewport 视觉证据仍需关闭后才可标记完成。
