# 自动回复接管窗口修复证据

## 目标

- 首次自动回复使用 `sendDelaySeconds` 收集窗口内全部买家消息并生成一条逻辑回复。
- Agent 已经出站后，后续买家消息立即处理，不重复等待 300 秒。
- 人工出站消息会取消当前自动回复，并让下一条买家消息重新进入等待窗口。
- 分段发送中检测到人工介入时停止剩余 AI 分段。
- 设置页移除“防抖窗口（毫秒）”，旧 `debounceMs` 仅保留兼容读取。

## 先测后改

先新增并运行 `apps/api/scripts/auto-reply-takeover.test.ts` 的 7 个行为 case，确认基线失败：

- 初次窗口多条买家消息产生多条 AI 回复；
- Agent 接管后的下一条消息仍重复等待；
- 分片发送时人工介入无法停止剩余分片。

随后实现状态机、设置契约和页面调整，并使用同一组 case 回归。

## 测试矩阵

| 层级 | 命令 | 结果 |
| --- | --- | --- |
| 接管行为 | `node --test --import tsx scripts/auto-reply-takeover.test.ts` | 7/7 通过 |
| API 自动回复单元 | `npm --workspace apps/api run test:auto-reply:unit` | 186/186 通过 |
| API 类型检查 | `npm run typecheck:api` | 通过 |
| Web 类型检查 | `npm run typecheck:web` | 通过 |
| Web 单测 | `npm run test:web -- --run` | 90 files / 321 tests 通过 |
| API 构建 | `npm run build:api` | 通过 |
| Web 构建 | `npm run build:web` | 通过 |
| 自动回复真实 E2E | `npm --workspace apps/api run test:auto-reply:e2e` | 8/8 通过 |
| PostgreSQL 持久化回归 | `npm --workspace apps/api run test:auto-reply:postgres` | 通过；重启后 run/message 可回读 |
| 设置页 Chrome/CDP E2E | `npm run test:e2e:chrome:settings` | 通过；验证旧防抖字段不可见、延迟秒数可保存、403/409 链路 |
| 差异检查 | `git diff --check` | 通过 |

## 关键修复

- `AutoReplyService` 使用会话级首次接管窗口，并通过实时事件立即响应人工消息。
- 通过出站消息来源恢复接管状态；AI 已接管时不重复等待，人工出站后重新开启窗口。
- 人工介入检查改用会话事件游标判断消息先后，避免同毫秒消息按 UUID 排序造成误判。
- 分段发送在首段前、段间和每段发送后检查人工介入。
- PostgreSQL smoke 显式设置 `sendDelaySeconds=0`，避免默认 300 秒延迟污染持久化回归耗时。

## 限制

- 当前验证覆盖单进程接管竞态和真实 PostgreSQL/浏览器链路；双 worker 跨进程 lease、发布级 live 外发与 outbox 恢复仍属于既有风险项。
