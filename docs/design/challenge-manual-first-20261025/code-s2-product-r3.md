# S2 协调器：独立产品代码复审 R3

日期：2026-10-26（Asia/Shanghai）。
范围：已修订的 coordinator/domain/repository 及最终 17 项 coordinator 测试，复核 PR-S2-004/005 和关闭屏障收尾；前两轮文档保留不改。凭证与 IM 的并行修订不在本结论内。人工窗口维持 30 秒。

## 结论

**FAIL（新增 1 项 P2 待修复）。** PR-S2-004、PR-S2-005 已 VERIFIED/CLOSED；结合 R2 已关闭的 PR-S2-001～003，原有 5 项问题均完成代码修订与复验。但复审末尾对全局容量的并发探针发现 PR-S2-006，不能在存在该反例时签署 S2 PASS。

需先修复新增容量问题并独立复审，再签署后续切片门槛。不代表正式前端/HTTP/WS/QR、真实平台恢复或生产发布通过。未修改实现、未操作生产。

## 本人实际执行的验证

1. 在 `F:/ChenHai/Project/XianYuAgent/apps/api` 运行：

   `node --import tsx --test scripts/verification-coordinator.test.ts`

   最终结果：**17/17 PASS，0 fail/skip/todo**，约 2.16 秒。含本轮两项回归、释放时数据库故障独立终结、关闭挂起时 subject/容量保留，以及前轮重连、pending answer、租约和 lease 回归。第 17 项收尾前也曾完整运行 16/16，通过结果保留为中间验证，最终以 17 项为准。

2. 用内存 repository + 可控 browser port 重跑 R2 原反例的独立 stdin 探针，两个都 exit 0：

```json
{"case":"second-settling-fixed","attemptsBeforeRelease":1,"attemptsAfterRelease":2,"releaseFinished":true}
{"case":"manual-only-retry-races-startAuto","mode":"manual_only","state":"failed","gestures":0}
```

第一条在本轮 release gate 挂起期间等待多个 tick，断言 attempts 保持 1；只有 gate 完成且新的静默 600ms 过去，第二次 attempt 才允许开始，证明没有把修复简化为永久禁止接续。

第二条使用截止前 100ms 的新鲜 persistedAt，阻塞 manual_only 保存后推进 100ms，让 startAuto 真正排在 retry 之后；最终自动手势为 0，保留待人工终态。

3. R2 已独立执行的 2 项真实 PG 测试通过；本次 R3 修改集中在协调器观察/模式判断，未重复扩大测试范围。该 PG 结果不作为凭证/IM 模块的独立审核结论。

4. 在同一 owner 启动完成后，对 3 个不同账号 subject 同时调用 solve，经 20ms 后检查 repository，得到 `{"case":"three-simultaneous-solves","activeSessionCount":3}`。该独立内存状态探针 exit 0，finally 关闭全部测试会话，复现下面的新容量问题。

执行期间有一次从仓库根误用 `scripts/...` 运行的命令未找到测试文件；随后在正确的 apps/api 目录完成了上面的最终全 17 项运行，未将路径错误算作通过。

## 问题闭环

| 编号 | 级别 | R3 结论 | 修订与验证 |
| --- | --- | --- | --- |
| PR-S2-004 | P1 | VERIFIED/CLOSED | beginSettling 同步清除旧 settlingAt；offerHuman 清理旧观察时间；startAuto 对 settling 状态要求本轮 releaseTask 已完成且新的 settlingAt 已建立。新增两轮 auto→settling→human→release held 回归通过；独立原反例证实释放未结束时无第二次自动，结束后仍可正常接续。 |
| PR-S2-005 | P1 | VERIFIED/CLOSED | startAuto 的 actor 状态转换内检查最新 mode，实际自动 admit 再检查 mode；已完成的 manual_only 不能被旧 timer 意图覆盖。第 15 项回归已改为 4900ms 续租、阻塞 retry、推进 100ms，避免先等待普通 heartbeat 而未触发真实排队竞争。独立同条件探针由 R2 gestures=1 变为 0。 |

## 其他修订复核

- 第 16 项回归注入 repository.save 故障，验证 release 失败会终结 solve、关闭原 context、移除可操作会话，并且自动手势为 0；不再依赖测试 finally 调用 close 才发现并停止任务。
- closeContext 使用共享 Promise，避免同一故障触发多次实际关闭调用。
- 后续收尾增加 closingSubjects：关闭开始同步登记，只有 closeContext resolve 才释放，reject 继续闭锁；solve 拒绝相同 subject 的重入，closing 数量也计入全局容量。第 17 项挂起实际关闭 Promise，验证旧 solve 已取消时新同账号请求仍为 CLOSING，自动次数不增长。本审核确认该协调器内关闭门槛已落地，不能再描述为仅留给未来的能力。
- 30 秒默认值、3 秒重连、未决自动答案先 settling、actor 内展示租约检查等前轮修复仍保留，最终 17 项测试没有回退。
- 当前 eventSequence 按会话状态版本递增，避免把跨会话 bigserial 审计序号误当该会话连续 cursor。正式 WS 的缓冲/snapshot/gap 协议仍需 S3 验证，不能从该字段静态存在推导已经完成。

## 后续必须保持的集成边界

### PR-S2-006 — P2：并发 solve 绕过全局两会话容量

solve 对 `active.size + closingSubjects.size >= 2` 的检查在 await authorize 和 repository.create 之前，没有为尚未插入 active 的任务预留位置。三个不同 subject 的并发 solve 都能读到 0，然后各自通过异步步骤并创建会话，实际 activeSessionCount 为 3。当前单 subject 唯一约束不能限制不同账号的并发数。

这是本轮已暴露的协调器容量门槛自身存在竞态，不是要求提前补 S4 界面。建议在首次异步等待前同步预留 subject 与全局 capacity，失败路径归还预留；容量必须覆盖正在准备创建、active 和 closing 的任务，并防止重复计数。将 3 个并发 solve 只有 2 个获准、授权/创建失败归还名额、closing 仍占名额加入回归后独立复审。当前状态 **OPEN**。

### 后续切片门槛

1. S4/browser 资源层须与本轮 closingSubjects 一起持有账号/profile 屏障和实际浏览器并发名额，直到旧 context 关闭确认。协调器 fail 移除 active、返回错误与“旧 Chrome 已退出”是不同事实；不能仅凭 active 中找不到会话就重用未关闭的 profile。本轮可控 Promise 的关闭门槛已验证，后续仍要以真实 Chrome 的关闭挂起/失败重试路径验收，现有 profile 锁必须保留。
2. 正式 WS 断开/隐藏/重连需要正确调用 disconnect、presence 与 resume，提供新鲜 frame 并更新 connection/epoch；本轮测试验证方法契约，没有验证浏览器刷新全流程。
3. settling 的 pendingAnswers、verdict 和导航稳定性须由真实原 page 观察器准确提供。S2 可控 port 的计数不能证明平台网络层已被正确观察。
4. manual_only 模式必须来自明确用户动作并持久化到实际会话；UI 不得把自动预约、立即自动、人工重试混成同一个请求。
5. 本轮状态测试不替代真实 Chrome→API→PG、IM 心跳/风险核销、负载指标和真实平台人工验收。

这些均为原设计后续切片的实际门槛。本 R3 关闭原有五项问题，但新发现 PR-S2-006 必须先修复并经 R4 独立验证；前两轮失败记录保持不改，完整链路仍需独立总审。
