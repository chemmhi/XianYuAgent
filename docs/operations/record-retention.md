# 三天记录保留与存量清理

## 范围与验收

`messages.auto_reply_inbound_quarantine` 和 `observability.audit_events` 均按 `created_at < 当前时刻 - 72小时` 过期，等于边界保留。关键事件也在 72 小时后过期；在保留期内保留全部明细。已解决与未解决记录使用相同规则。旧 `INBOUND_QUARANTINE_*` 不再生效，保留期不可通过环境变量放大或禁用。

本次只涉及后台记录写入、保留与维护 CLI，不改变前端和公开 HTTP 契约，视觉验收不适用。

## 模块与普通事件

- `record-retention-policy.ts`：72 小时规则、明确 allowlist、小时桶指纹与批次范围。
- `record-retention-postgres.ts`：唯一索引原子聚合、计数、两表短事务删除；MemoryStore 保持相同语义。
- `record-retention-worker.ts`：每分钟并行处理两表，每表每轮最多 20 批或 15 秒，默认每批 10,000 行。`RECORD_CLEANUP_BATCH_SIZE`、`RECORD_CLEANUP_POLL_MS` 可调整吞吐。
- `cleanup-retained-records.mjs`：发布后排空存量，默认只读预览，显式 `--apply` 才删除并执行普通 VACUUM。

仅四种 `product.automation.trigger.{payment_paid,unpaid_reprice,review_gift,review_reminder}` 的 `skipped` 结果允许聚合。指纹包含 UTC 小时、操作者、账号、动作、订单、结果摘要和原因，排除每次变化的 request/trace ID。仅写入次数和最后出现时间，不延长首次记录的保留期。该 trigger 不消费审计回调返回 ID；其他审计调用不使用聚合。

成功、失败、人工复核、blocked、未知事件及发货、库存、风控、鉴权、配置操作始终逐条记录。`PUSH_SYSTEM_CONTENT_IGNORED` 按账号、原因、原文摘要和 UTC 小时合并，真正解析异常逐条保留。旧数据没有可验证的完整结果分类，存量仅按时间清理，不猜测分类合并保留期内旧记录。

## 发布与回退

按本地子分支验证与提交 → 本地合入 main → `git push origin main` → GitHub 部署。子分支不推送。

统一发布脚本先构建，再停旧 API/Worker，执行 071–074 幂等迁移，再启动新进程。071 从现有审计精确回填 `delivery_send_steps.recovery_verified_at`；恢复操作与业务 checkpoint 同事务写入此字段。卡券计划校验与锁定完全依赖业务标记，不依赖可过期审计。072–074 独立在线建索引，迁移器可恢复中断留下的无效索引。

部署失败时数据库新增字段可保留。**清理审计后不允许回退至依赖 audit 判断发货恢复保护的旧二进制**；需要回退其他变更时也必须保留业务标记读写。过期数据删除不可逆，按本次用户授权执行，不作为业务备份。

## 生产存量维护

在腾讯服务器已从 GitHub 拉取本次 main、迁移完成且新 API/Worker 运行后：

```bash
cd /home/ubuntu/xianyu-agent-prod
docker compose -f compose.prod.yml exec -T api node scripts/cleanup-retained-records.mjs
docker compose -f compose.prod.yml exec -T api node scripts/cleanup-retained-records.mjs --apply
```

CLI 固定本次执行的 cutoff，先拒绝未回填的发货核验依据，再按每批 10,000 行短事务删除（15 秒 statement timeout、2 秒锁等待上限、SKIP LOCKED），检查两表过期剩余为零。临时被锁定的记录会令 CLI 报告未完成，解锁后可安全重跑。后台 worker 负责继续处理维护过程中刚刚到期的记录。

普通 `VACUUM (ANALYZE)` 让空闲空间可复用，不保证立即归还文件系统；不得把已删除条数误报为已释放磁盘。需要缩小文件时，另行检查剩余活数据、磁盘余量和锁影响；不要在业务运行中默认执行 `VACUUM FULL`。清理前后核对 `df -h /`、两表行数/最老时间/大小、索引有效性、healthz/readyz 和 worker 日志。

## 验证与评审

使用独立数据库，禁止将测试 URL 指向生产。`test:record-retention` 强制数据库名以 `xianyu_retention_test` 开头；先在本地 PostgreSQL 建库，然后设置 `RECORD_RETENTION_TEST_DATABASE_URL`：

```powershell
$env:RECORD_RETENTION_TEST_DATABASE_URL='postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_retention_test_20261027'
npm --workspace apps/api run test:record-retention
```

2026-10-27 本地验证：13 项通过（7 项规则/worker、5 项真实 PG/装配/CLI/生产 worker 子进程、1 项完整发货恢复回归）；迁移运行两次、24 并发聚合计数、关键事件明细、cutoff 精确边界、SKIP LOCKED、失败重试、多批排空、回填两次并删除审计后卡券计划锁与变更保护均通过。真实 worker 入口在旧保留期=7、旧开关=false 的环境下仍自动删除两表四天前的记录。原 HEAD 的七天实现执行三天 cutoff 断言实际失败，新实现通过。

自动回复单元回归239项、自动化相关36项、发布/Compose配置7项、`typecheck:api`、`docker compose config --quiet`、`git diff --check` 通过；完整 `npm run test:api` 退出0（456项显式测试及命令内全部既有集成/冒烟脚本通过）。首次验证发现测试库尚未迁移、夹具缺少 item_id、worker测试缺少专用RPC secret及中断遗留fixture，已修复测试执行顺序、隔离夹具和配置，正式命令全部通过。

独立 reviewer `/root/retention_review` 两轮检查：设计阶段 AR-01–05（恢复依赖、分类、吞吐、在线索引、空间回收）全部纳入实现/运维；代码阶段未发现 P0/P1，AR2-01 文档旧配置冲突已在 README、迁移说明和本文修正。发布/存量验收结果在本次交付记录中报告。
