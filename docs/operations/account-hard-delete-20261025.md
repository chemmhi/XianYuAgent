# 闲鱼账号彻底删除与跨用户重新绑定（2026-10-25）

## 状态与验收

本地实现及验证 PASS；生产尚未发布，历史残留尚未清理，真实闲鱼 APP 扫码尚未复验。当前阶段 5.5：等待仓库要求的人工审核，再获取 merge lock 合入 main。不能将本地外部适配器夹具解释为生产闲鱼扫码成功。

生产只读核验确认：报告中的账号仍存在 disabled 记录，原管理授权 revoked，最近四次扫码 failure_code=CONFLICT。旧实现保留 (platform,seller_ref) 唯一身份及历史数据，导致其他用户无法绑定。生产源码和数据库均未修改。

验收路径：账号页打开删除确认 → 取消保留数据 → 确认永久删除 → 真实 API → 隔离 PostgreSQL/MinIO 清空 → 页面移除 → 邀请注册用户重新登录获得新 UUID 与空商品/聊天数据。账号级设置、订单、任务、卡券、凭证、审计、缓存响应、浏览器 profile 均在删除范围。闲鱼平台上的原始内容不由本系统删除。

## 模块与数据边界

- AccountDeleteModal：明确说明永久清空订单、商品、设置、聊天、凭证和图片附件，不可恢复。
- AccountService / Store：管理权限校验；删除请求先持久化 disabled + deletion_started_at 并撤销授权/凭证，阻止恢复登录；清理失败保留可见重试入口。
- account-purge-postgres：沿 account_id 和传入外键查找归属，先收集桥接 ID，再按依赖顺序在事务中物理删除；另清理 idempotency/outbox/执行键/审计目标；不把管理员或任意业务 JSON 当作归属根。
- account-purge-memory / repair repository：清除关联 Map、二级索引、修复状态 WeakMap；删除围栏阻止迟到回写。
- ObjectStorage / IM / verification browser / model runtime：删除附件前排空上传，停止连接与计时器，移除 profile、QR 内存会话、模型缓存和 Redis 键；跨进程写入通过 PostgreSQL advisory lock 与删除互斥。专用 lifecycle pool 避免锁持有者耗尽业务连接池。
- migration 069：新增删除围栏；为自动回复状态、任务队列、执行账本增加账号外键，约束迟到后台写入。新增约束 NOT VALID，兼容已有历史孤儿行，同时立即约束新写入；本次按账号清理已有数据。迁移按仓库 runner 的每次重放机制设计为幂等，并用真实 runner 在已有数据上连续执行两次验收。
- 人工发货 outbox 显式携带订单所属 accountId，避免删除后迟到入队产生无主任务。

删除接口成功只返回 deleted=true，不返回或重新缓存被删除账号快照。重复调用已删 UUID 返回 404；重复请求不产生新的删除副作用。应用用户和其他账号数据保留。

## 验证证据

- 修复前回归：ACCOUNT_DELETE_BASELINE=1 运行 memory delete erases 用例，在旧主线失败于 must physically remove the old identity；不是只检查 HTTP 状态。
- npm --workspace apps/api run test:account-delete：18/18 PASS，使用真实隔离 PostgreSQL、MinIO、Redis，覆盖清空、只读授权拒绝、其他账号保留、失败重试、事务回滚、跨进程缓存回写、并发上传、修复状态回写、浏览器目录、历史清理 CLI、发货入队竞态、全量已删除账号清理、恢复账号保护和迁移重复执行。
- npm --workspace apps/web run test:e2e:chrome:account-delete：Chrome/CDP → 正式 Vite 页面 → 真实 API → PostgreSQL/MinIO → 邀请用户重新绑定 PASS；闲鱼登录/资料 adapter 使用明确夹具，不发送真实闲鱼凭证。
- AUTO_REPLY_AGENT_SEND_DELAY_SECONDS=0 npm test：默认 API 264 项、图片/详情 24 项、滑块 17 项及全部既有 smoke；Web 106 files / 483 tests PASS。测试环境将等待时间设为零，未跳过任何测试；延迟行为有原有专用用例覆盖。
- npm run typecheck、npm run build、git diff --check：PASS。末次小改后专项 18/18、发货 smoke、runtime/RPC/repair 24/24 复跑 PASS。
- 桌面 1440×900、移动 390×844 截图与跨层结果：[证据目录](../evidence/account-hard-delete-20261025/README.md)。
- 主线已有部分 store mock 缺少现行身份/风险接口，先在未修改主线复现，再只补齐 mock fixture；未放宽业务断言。

## 独立评审与风险

设计评审：deletion_design_review；代码及修复复审：deletion_code_review，最终 PASS，无未关闭 P0–P2。

| 问题 | 修复与复验 | 状态 |
| --- | --- | --- |
| R1-P1 附件迟到上传重建 | 跨进程共享/排他锁、删除围栏；并发专项 | CLOSED |
| R1-P2 内存卡券二级索引残留 | reservationId/executionKey 闭包；专项断言 | CLOSED |
| R2-P1 修复状态残留/回写 | WeakMap 清理与围栏、PG 外键；迟到写入断言 | CLOSED |
| R2-P2 模型缓存重建 | 构建前后围栏、跨进程写入 guard、Redis 复验 | CLOSED |
| R3-P2 人工发货入队无归属 | 显式 accountId，真实 deliver 暂停入队竞态 | CLOSED |
| R4-P1 重复发布迁移失败 | 列/约束幂等保护；真实 runner 在已有数据上执行两次 | CLOSED |

当前生产 God View/verbose tracing 未启用且不存在默认 trace 文件；本次不对离线备份、容器运维日志或未来启用的自定义 trace 文件承诺物理擦除。业务数据库中的账号审计会清除；物理存储介质取证擦除不属于应用 DELETE 的能力。

## 发布、历史修复与回退

1. 人工审核通过后，在 merge lock 内合入 main；推送 GitHub，由既定 deploy-production Actions / 统一脚本部署同一 SHA，不修改服务器源码。
2. 部署脚本完成 migration 069、新 API/worker 启动和 healthz/readyz 检查后，自动执行历史清理，成功后才发布新 UI。API 镜像显式包含清理 CLI。清理失败会阻止本次发布成功，保留重试状态。用户已明确要求本次提交清除所有当前已删除账号。

```sh
node scripts/purge-deleted-account.mjs --all-deleted
node scripts/purge-deleted-account.mjs --all-deleted --apply --im-owner-url=http://127.0.0.1:8080
```

清理命令默认 dry-run；单账号支持准确 UUID，发布流程显式使用 --all-deleted。候选必须已停用、没有任何有效授权、具有唯一历史管理者；删除前在行锁内再次检查状态，已恢复账号会被保护。apply 通过签名内部 RPC 清理运行中 IM 状态，并复用正式删除链路。

3. 只读确认历史候选身份和所有关联数据消失、其他账号保留；由用户用闲鱼 APP 再次扫码，核验新账号归属、凭证与真实登录结果。
4. 源码可回退发布 SHA；新增数据库列/外键可保留以兼容旧读写。回退前必须完成/处理 deletion_started_at 非空的未完成删除，避免旧版恢复逻辑复活待删账号。必要时撤销 migration 069 的新增约束/生成列/围栏列，再部署旧版；已删除业务数据无法通过源码回退恢复，发布审批需认可这一用户要求的永久副作用。
