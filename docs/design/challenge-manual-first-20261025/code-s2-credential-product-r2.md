# S2 凭证与 IM：独立产品补充复审 R2

日期：2026-10-26（Asia/Shanghai）。
范围：PR-CRED-PROD-001 的心跳/断线竞态修订、相关真实 localhost WS 与隔离 PG 回归。第一轮 `code-s2-credential-product.md` 保留不改。未参与实现修订、未修改代码或测试、未操作生产。

## 结论

**PASS（S2 凭证/IM 产品语义范围）。** PR-CRED-PROD-001 已 **VERIFIED/CLOSED**。迟到的失效心跳不再把已断开的连接作为最终在线状态，也不能用失效回调核销风险。

本结论补足本审核者对 S2 的产品范围；不替代并行架构审核，不代表新人工验证功能、正式前端/接口、QR 全流程或生产部署已完成。

## 本人执行的验证

工作目录：`F:/ChenHai/Project/XianYuAgent/apps/api`。

1. `node --import tsx --test scripts/credential-fencing.test.ts`
   - **12/12 PASS**，0 fail/skip/todo，约 1.42 秒。
   - 包含真实 localhost WS 的 getCredential、setAccountTransport(connected)、clearAccountRisk 三个挂起位置；挂起中终止 socket 并增加新 Token 风险，最终 disconnected 且两条风险保留。
2. `MANUAL_VERIFICATION_TEST_DATABASE_URL` 仅指向 localhost 隔离库 `xianyu_manual_verification_test`，执行：

   `node --import tsx --test scripts/credential-fencing-postgres.test.ts`

   - **6/6 PASS**，0 fail/skip/todo，约 0.85 秒。
   - 含原 full-snapshot/generation/revision 检查、迟到 lazy expiry CAS，以及风险 DELETE 已执行后和事务最终写入后的失效回滚断言。
3. 重跑本人原真实 WS 探针，仍只挂起一次 onHeartbeat 的 getCredential，socket 终止后解除 gate，待状态队列完成，得到：

```json
{"case":"heartbeat-callback-finishes-after-disconnect-fixed","clientConnected":false,"transportStatus":"disconnected","remainingRisks":2}
```

该探针 exit 0，在 finally 关闭客户端、service 和 WS server，没有创建项目测试文件，也未请求闲鱼生产。

第一轮为 clientConnected=false、transportStatus=connected、remainingRisks=0；现在相同关键竞态返回 disconnected、2。新 health lane 有意让断线持久化排在在途心跳工作之后，因此复审探针先确认真实 socket 已断，再解除 gate 并核对最终状态；不再要求 gate 未解除时断线写入就必须先完成。这是明确的提交排序变化，不是放宽最终健康断言。

## PR-CRED-PROD-001 关闭依据

- `XianyuImClient` 提供 connectionEpoch，并将匹配 `/!` ACK 的实际连接代次传给 onHeartbeat。
- service 在任何队列等待前固定 credential generation、风险快照、开始时间、Token 复验事实和 connection epoch。
- 同账号的 status/heartbeat Store 写入通过 health lane 串行，避免较晚的断线结果先落库后又被旧心跳覆盖。
- `live()` 检查 connected、同一 connectionEpoch、当前 client 归属和 ACK 接收后 5 秒新鲜度，在读取凭证后、写 connected 后、逐条清风险前后重新执行。
- clearAccountRisk/clearAccountDegraded 接收同步 isCurrent fence；MemoryStore 在实际内存变更前检查。PG 在锁定账号后、DELETE 后、最终写入后 COMMIT 前检查，失效时回滚事务中的风险/聚合状态和 outbox，而不只跳过后续显示。
- 原 generation、episode、source revision 条件没有为了通过断线测试被移除；新风险、新登录、同 generation 更新、撤销、注册失败、错误 mid、心跳超时等既有回归继续通过。

本轮代码检查与真实 WS/PG 证据一致，未发现该修订引入新的阻断产品语义问题。

## 证据边界

- “真实 WS”指本机真实 WebSocket 和实际 XianyuImClient 注册/ACK 处理；Token、注册及心跳响应由受控 fixture 提供，不能表述为闲鱼真实生产放行。
- 这里确认当前连接证据与持久化风险的语义，不复审架构 Agent 正在负责的全部凭证/账号事务和迁移边界。
- 第一轮对 app 异步校验请求证据绑定及非枚举 credential evidence 的检查仍成立；本轮没有新增直接返回完整内部 MTOP result 的公共接口。正式远程会话 DTO/WS、画面输入及日志仍须后续审核，不能沿用此处结论跳过。
- 根 Agent 的 90/90 或实施 Agent 的 72/72、typecheck 由其分别记录；本审核只认领本次独立执行的 12+6 和原探针。

该 P1 可由本审核者确认关闭。S2 协调器产品范围已在 `code-s2-product-r4.md` 通过；凭证/IM 产品补充现也通过，继续后续切片与最终完整功能独立审核。
