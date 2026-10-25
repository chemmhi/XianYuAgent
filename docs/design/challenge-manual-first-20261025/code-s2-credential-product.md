# S2 凭证与 IM：独立产品补充审核 R1

日期：2026-10-26（Asia/Shanghai）。
范围：credential-fencing 的 9 项测试与 1 项隔离 PG 测试、IM 注册/心跳的真实结果语义、app 异步校验快照绑定与内部凭证序列化边界。架构审核者另行检查全部 PG/凭证写入口；本审核不重复宣称其结论。未修改实现或测试，未操作生产。

## 结论

**FAIL：新增 1 项 P1，PR-CRED-PROD-001。** 普通/浏览器 fallback 凭证 CAS、旧校验结果绑定和正常心跳匹配路径的既有测试均通过，但真实 WS 断线与异步心跳落库竞争会把已经断开的连接重新报告为 connected，并清除风险，直接违反“账号恢复必须有当前有效连接证据”的产品规则。

## 本人实际执行的验证

工作目录：`F:/ChenHai/Project/XianYuAgent/apps/api`。

- `node --import tsx --test scripts/credential-fencing.test.ts`：**9/9 PASS**，0 fail/skip/todo，约 0.95 秒。
- 配置已明确提供的 localhost 隔离库 `xianyu_manual_verification_test` 后执行 `node --import tsx --test scripts/credential-fencing-postgres.test.ts`：**1/1 PASS**，约 0.38 秒。测试显式限制 hostname 和数据库名，未使用生产连接。
- 另经 stdin 运行一次真实 localhost WebSocket 的确定性竞态探针，exit 0，原服务/客户端与 server 在 finally 清理。该探针使用真实 XianyuImClient 和 XianyuImService、MemoryStore、受控 Token 响应；没有请求闲鱼生产。

根 Agent 的聚合 90/90 和 typecheck 结果由其负责记录；本审核只认领上面的本人执行证据。

## PR-CRED-PROD-001 — P1：心跳回调等待期间断线，迟到结果重新发布在线并核销风险

### 位置与实际反例

`apps/api/src/xianyu-im-service.ts:661`–678 的 onHeartbeat，在第一次 await 前检查 `client.connected` 和 receivedAt 新鲜度；随后 await getCredential，再 setAccountTransport(connected)、逐条 clearAccountRisk，期间未再次确认当前 socket/连接代次仍有效。

确定性探针：

1. 建立带 Token 与 im_listener 验证风险的账号，真实 WS `/reg` 成功；此时风险仍在、transport 尚未 connected，符合新规则。
2. 服务端收到首个 `/!` 后发送正确 mid 的 code=200 ACK。
3. 只将 onHeartbeat 的下一次 store.getCredential 挂在 gate 上；其余 getCredential 正常，避免同时阻塞断线回调。
4. gate 已进入后终止服务端 socket，等到 onStatusChange 已把 transport 写成 disconnected。
5. 放开旧心跳 getCredential，等待回调完成。

实际输出：

```json
{"case":"heartbeat-callback-finishes-after-disconnect","clientConnected":false,"transportStatus":"connected","remainingRisks":0}
```

因此页面可能看到“已恢复”及新鲜 transportSeenAt，但实际 socket 已断。该结果不是缺少前端、不是平台未放行，也不是伪造心跳；ACK 的确匹配，错误在于把旧连接上的证据跨异步边界应用到已经断开的状态。

### 修复要求

把 heartbeat 的证据绑定到产生它的 socket/connection generation，在异步等待、状态落库和风险核销之间重新验证存活及代次，避免旧回调覆盖后续 disconnected/reconnecting 状态。仅在回调开头多加一次判断不足以处理 DB 写入中的竞争；应保证同一连接状态变更的提交顺序/条件更新有明确边界，断线后完成的旧写入不能成为最终健康状态。

新鲜度也应绑定实际 ACK 接收时间，不因延迟持久化把旧心跳伪装成“刚刚收到”。风险核销必须继续保持 generation/source revision fence，不能为修复状态显示而删除这些条件。

### 必须新增的回归

- 正确 ACK 后、getCredential 挂起期间断线：恢复等待后仍 disconnected，风险不被该已失效回调清除。
- connected 状态写入挂起期间断线，以及风险核销各异步步骤间发生断线/重连，最终状态不被旧回调覆盖。
- 新 socket/新的 credential generation 已建立时，旧 socket 的迟到 ACK/回调不能使其健康或核销其风险。
- 正常有效连接仍能在匹配新鲜 ACK 后恢复；错误 mid、注册失败、heartbeat timeout 继续保留风险。

需要真实 localhost WS 的事件时序与最终 Store 状态断言，不能只通过检查回调次数关闭该问题。

## 已通过的产品语义检查

1. **Token 保存不冒充恢复。** ensureClient 的 connected 注册回调映射为 connecting；匹配 `/!` ACK 后才发布 connected 并核销适用 IM 风险。现有 registration-failed、heartbeat-timeout、wrong-mid、new-risk/new-login 真实 WS 测试均通过。
2. **旧结果不能改新凭证。** ordinary 和 browser fallback 的迟到 Token，在同 generation 已出现更新快照时 CAS 拒绝；旧登录/刷新/撤销前的 markVerified 证据也拒绝。真实 PG 测试支持这部分语义。
3. **校验结果绑定执行请求。** MTOP callback 带原始请求凭证证据；app 的 markXianyuAccountFailure/credentials.verify 使用请求结果中的 evidence 或发起前快照，不把返回时读取到的新凭证当成原请求对象。失败回包不能过期新登录。
4. **新增内部 evidence 不进入通常 JSON 序列化。** bindMtopCredential 使用 enumerable=false 的 property；现有测试确认 Object.keys 不含 credential，app 校验响应也显式挑选 success/accountInvalid/errorCode/message/response。不要将服务内部仍含 cookieHeader 的 MTOP result 整体当成公共 DTO；本结论只覆盖新增 evidence 和已检查的路由选择。
5. **登录成功与 IM 在线不同。** app QR/cookie 既有流程先确认登录，再后台启动 IM；正式 S3/S4 UI 必须沿用分层结果。当前旧 QR UI/链接及新远程通道装配不属于本轮 S2 补充审核，不因其尚未实现而扣分。

## 复审安排

PR-CRED-PROD-001 当前 OPEN。已向根 Agent 与其授权的凭证实施 Agent 提供精确 gate 位置和真实 WS 时序；修复后保留本文，另写复审文档。产品范围在此问题关闭前不签署凭证/IM PASS；整体功能、完整接口/UI 和真实平台验收仍需后续独立审核。
