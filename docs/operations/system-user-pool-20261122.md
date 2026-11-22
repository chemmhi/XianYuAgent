# 系统用户身份池与自动回复隔离（2026-11-22）

## 问题与验收行为

闲小蜜账号 `1400` 的通知使用普通文本 envelope。原分类仅检查结构化系统类型、任务标记和订单提醒，未检查发送方身份；外部导入来源 `system` 不是系统发送者标记。腾讯云只读聚合曾确认该身份的入站消息为 buyer/text，并已产生 AI 外发。本文不保存生产正文、账号凭证或用户数据。

目标：运维在独立文件增删系统用户 ID，保存后 API 与 Worker 均生效；命中身份的通知仍能查看，但不触发 AI；历史误分消息和未发送旧任务同样受保护。用户明确要求不增加设置页面入口。

## 模块和数据边界

- `xianyu-system-users.ts` 校验整个版本化 JSON、按完整平台 ID 匹配。运行文件为 `runtime-config/xianyu-system-users.json`，模板默认包含 `1400`。`XIANYU_SYSTEM_USERS_FILE` 支持独立 Node 进程部署。
- 同步 decoder 保留既有接口：查询时 stat 文件，只有 ino/size/mtimeNs/ctimeNs 变化才完整读取；读取后再次核对元数据，再替换有效集合。避免定时轮询造成发送前传播窗口。配置限制为 1 MiB、10,000 项。
- compact、named operation、历史导入与应用服务统一分类；保持正文/资源引用，不把身份池命中提升为可信订单事件。订单状态仍经原结构化与真实订单校验。
- AI 入口先于模型和 replay 检查会话身份；每个分段也检查当前会话。Reliable sender 再核对 recipient、快照会话、当前数据库会话。
- AI 专用 `sendAutoReplyText` 经签名 owner RPC 到 API 持锁发送；连接准备完毕及真正 WS 写入前同步重查，401 重连后的重试同样检查。人工与其他业务发送沿用原方法。
- 未发送 pending/retryable 和租约已过期任务按管理员/运行范围终止。有效 processing 租约不被夺取，由原 owner 的最终发送检查阻断；已提交平台的在途操作无法撤回。
- succeeded outbox 继续补写本地消息和成功记录，不依赖配置就绪，不重复外发；既有成功历史保留。移出池不会复活 dead-lettered 旧任务。

不新增数据库表或迁移；沿用既有 outbox 状态与租约。新增仓储操作只更新属于指定管理员、指定 run、`auto_reply_send` scope 且未成功的可终止任务。人工消息权限、账号范围和订单事件授权保持原契约。

## 配置、发布和回滚

运行目录忽略 Git，容器只读挂载整个目录以支持编辑器原子替换。部署脚本在第一个 Compose run 前排他创建默认文件，已有文件（含空/坏文件）都不覆盖；容器镜像包含模板与检查器，发布停止 API/Worker 之前先检查配置。

坏热更新/短暂文件丢失保留进程 last-good 并记录安全错误码。没有有效快照的冷启动禁止 AI，接收消息和人工聊天继续运行。last-good 不跨重启存储，因此必须修正磁盘配置，不能靠重启掩盖坏文件。代码回滚通过 revert PR；保留运行文件，旧版可能不支持系统池，不能视为仍有同等保护。

运维格式、路径和检查命令见 [README](../../README.md#系统用户-id-池独立文件维护保存即生效)。

## 验证证据

首次回归保留旧行为时，compact 分类、历史 buyer/text 进入模型、旧 pending replay、生成期间热加 ID 均失败；实现后通过。独立审核另外复现并关闭三个缺口：ensureClient 等待期间热加仍发送，成功外发中断后的本地补账被提前 skip，以及本地策略拒绝被误记为平台故障。

实际执行：

- `npm --workspace apps/api run test:system-users`：15 项配置/消息/AI 测试及 2 项部署配置测试通过。
- `node --import tsx --test scripts/xianyu-im-gateway.test.ts scripts/xianyu-im-owner-rpc.test.ts`：覆盖 WS 重连前围栏与 RPC purpose/错误码；与凭证测试组合 47 项通过。
- `npm --workspace apps/api run test:auto-reply:unit`：239 项通过，含订单系统消息、正常买家、人工接管和既有 outbox 行为。
- `npm run test:api`：完整 API 命令退出 0；`npm run test:web`：115 文件、595 项通过。
- `npm run typecheck`、API 构建、Web 构建、Compose 配置及 migration 配置检查、`git diff --check` 通过。
- 隔离 PostgreSQL + 正式 React/API 的 Chrome/CDP E2E：页面读取官方历史适配器的受控通知，真实落库 system 身份并呈现系统通知行；热加新 ID 无需重启即抑制 AI；人工从 textarea 发送，经 API、外部发送 fixture、PostgreSQL 回到 DOM。另验证未来可用时间的旧任务取消及跨管理员隔离。

E2E 入口为 `npm --workspace apps/api run test:system-users:e2e`；需本机 Chrome 和 `PASSWORD_LOGIN_TEST_DATABASE_URL`（仅允许 localhost/127.0.0.1 的 `xianyu_password_login_test`，测试角色需 CREATEDB），脚本创建迁移后的随机隔离数据库，结束后删除。本机截图/结构化结果位于临时目录 `xianyu-system-users-evidence`，不提交 Git。

首轮真实 PG 验收发现新增 SQL 将既有 `payload_json` 误写为 `payload`，返回 42703；已修正后整条 E2E 通过。这里的闲鱼历史/发送为受控外部适配器 fixture，不表示向生产闲鱼发送了消息；真实生产新通知须等平台自然到达后只读核验。本切片没有产品前端源码或样式变更，截图用于检查既有系统消息呈现，不宣称新增高保真视觉还原。

独立上下文审计未发现向 Planner、Plan contract、strict Runtime、Agent/Skill prompt 注入身份/工具规则；Provider wire、确认恢复、instruction parser 与计划 cache 未改。身份池位于协议/业务 adapter 边界。

## 发布状态

合并与生产结果以 GitHub PR、Actions 和合后实时检查为准；发布前腾讯云源码仍为 `e4ad9bb97cb0135e2f2027f74e6af6590e4306e8`。不得把本地 fixture 成功当作已发布，也不批量删除或伪造历史通知、AI 记录。
