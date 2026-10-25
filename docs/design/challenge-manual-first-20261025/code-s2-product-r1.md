# S2 协调器与持久化：独立产品代码审核 R1

日期：2026-10-26（Asia/Shanghai）。
范围：`verification-domain.ts`、`verification-repository.ts`、`verification-coordinator.ts` 以及两份 coordinator/PG 测试。按用户最新批准参数，人工窗口为 30 秒。

本轮只创建审核文档，不修改实现或测试，不操作生产。HTTP/WS、正式前端、QR/业务装配属于 S3/S4，不因这些尚未到达的模块判本切片缺陷；但当前协调器已经暴露的控制权、展示租约、重连和交接契约需要自身成立。

## 结论

**FAIL：2 项 P1、1 项 P2。** 三项均可仅通过当前 S2 公开方法和内存 repository 独立复现，不依赖未来前端或生产环境。已运行的 6 个状态测试和 2 个真实 PG 测试均通过，但没有覆盖这三条有问题的交互路径。

## 本人实际执行的验证

工作目录：`F:/ChenHai/Project/XianYuAgent/apps/api`。

1. `node --import tsx --test scripts/verification-coordinator.test.ts`
   - **6/6 PASS**，0 skip/todo，总计约 1.29 秒。
2. 仅将 `MANUAL_VERIFICATION_TEST_DATABASE_URL` 指向已明确提供的 localhost 隔离库 `xianyu_manual_verification_test` 后执行：`node --import tsx --test scripts/verification-postgres.test.ts`。
   - **2/2 PASS**，0 skip/todo，约 0.49 秒。
   - 已检查测试对 hostname 和数据库名有显式拒绝生产连接限制。测试创建并清理自己的随机 fixture，本审核未连接其他数据库。
3. 经 `node --import tsx --input-type=module` stdin 执行定向状态探针，使用内存 repository、fake clock 和可控 browser port，不创建项目测试文件。
   - 断线：`{"case":"disconnect-no-clock-advance","state":"settling"}`。
   - 并发展示：`{"case":"simultaneous-presentation-reserve","fulfilled":2,"holder":"b"}`。
   - 自动答案未决时接管：`{"case":"human-offer-with-unresolved-auto-answer","state":"human_active","pendingAnswers":1}`。
   - 最初组合探针在等待第三场景时因 unref timer 与无其他活跃 handle 触发 Node unsettled top-level-await；该场景改为有界轮询后单独重新执行，exit 0 得到上面的第三条结果。前两个场景输出发生在该测试 harness 结束之前，不是实现测试崩溃证据。

未独立重跑 API typecheck 或主 Agent 提及的现有 IM 30 项回归；这些仍归主 Agent 验证记录。

## PR-S2-001 — P1：断网立即进入 settling，3 秒人工重连宽限实际失效

位置：`verification-coordinator.ts:51`–55、293–296。

### 实际行为

`disconnect(clientId)` 删除 viewer 并设置 reconnectDeadline=now+3000，同时进行输入释放；但下一次 50ms tick 的 human_active 判断同时包含 `!this.viewers.get(controller.clientId)?.visible`。viewer 已删除，该条件立即成立，不管 reconnectDeadline 是否尚有 3 秒，就调用 beginSettling，清除 controller 和 reconnectDeadline。

定向探针建立已接管的 human_active 会话，调用 disconnect 后不推进 fake clock，仅等一次真实 tick；会话已经成为 settling。用户刷新或短时断网将无法按同一 controller 在原 30 秒窗口内恢复，还可能在 500ms 静默后启动自动，远早于承诺的 3 秒宽限。

### 修复要求

把“输入立即失效/释放”与“放弃整个人工控制”分开。连接断开或前台可见性丢失时建立有界重连状态；存在未过期 reconnectDeadline 时不得因 viewer 不存在或隐藏立即退出 human_active。宽限内重新鉴权、确认新鲜画面与同一登录/client 后恢复，沿用原 humanDeadline 并使旧 connection/epoch 失效；超过最短宽限或人工总期限才进入 settling。重连期限变化应通过状态持久化/事件机制保存，不只直接写内存 row。

### 必须新增的回归

断线后 0ms、2999ms、3000ms；刷新同 client 在宽限内成功恢复；后台隐藏后短时恢复；其他 client/登录不能冒用 resume；原 30 秒 humanDeadline 不延长，旧连接输入始终拒绝。断言宽限内自动手势为 0、没有提前 settling，超时后先安全屏障再接续。

## PR-S2-002 — P1：自动转人工直接 offerHuman，旧作答尚未决也能授予人工操作

位置：`verification-coordinator.ts:244`–256，以及 `VerificationChallenge` 的 pendingAnswers/verdict 契约。

### 实际行为

自动 attempt 返回 success=false 或抛错且有人预约时，startAuto 直接 offerHuman。offerHuman 只等待鼠标释放，然后把会话改成 preparing/manual_only，未检查 pendingAnswers、verdict 或执行 settling 观察。鼠标已松开不代表自动作答请求已返回。

定向探针让 autoAttempt 已开始，pendingAnswers=1；用户 requestHuman 后令 attempt 返回 success=false。会话变成 preparing，随后调用现有 presentation/frame/claim 即可进入 human_active，pendingAnswers 仍是 1。此时人工可以操作平台仍在处理的上一自动答案，可能重复提交、拖坏即将成功的挑战或把旧结果误用于新一轮。

这与 S1 输入互斥不同：两个执行者没有同时按鼠标，但平台答案仍未决，仍不满足设计的“当前 attempt 明确结束、settling 完成后才能切换”。

### 修复要求

所有自动→人工的成功/失败/异常出口统一经过可确认的答案结果边界。当前 generation 成功优先 handoff；未决请求/导航必须继续有界观察；只有明确失败或已稳定、无未决作答时才给新鲜画面和人工确认。观察超时仍未知则停止本轮并保留风险，不能借 offerHuman 绕过屏障。若 S2 需要稳定/导航状态而当前 port 不足，应现在补充契约，而非默认为 solver 返回 false 就已确定失败。

### 必须新增的回归

自动失败返回但 pending=1、自动抛错且 pending=1、自动预约后迟到 code=0、观察超时未知、明确失败且无未决请求。前几种情况下 claim 必须无法进入可输入的 human_active；迟到成功只 handoff 一次；只有最后一种才允许人工接管。加入当前自动 attempt 的真实结果或受控结果时间线，不能只断言 flag 被设置。

## PR-S2-003 — P2：展示租约竞争检查位于串行更新之外，两个申请都可成功

位置：`verification-coordinator.ts:110`–128。

### 实际行为

presentation 在调用 change 之前检查当前 presentation/controller；两个并发请求都可能读到无租约，随后依次进入串行 change。change 的闭包只检查终态并直接覆盖 presentation，没有重新验证原租约，所以 A、B 都返回成功，最终 B 覆盖尚未过期的 A。

定向探针准备同一会话，两个前台 client 同时调用 presentation reserve：fulfilled=2，最终 holder=b。虽然 row 最终仍只有一个 holder，但前一个调用者收到错误的授予确认；未来前端可出现首帧获取失败、展示跳转或人工机会被抢走，不符合“CAS 只有一个胜者，持有期内不抢占”的契约。

### 修复要求

租约是否可取得、是否仍是 controller、是否已过期等条件必须在串行 change 内针对最新 next 再检查；不能依赖外部 await 前的快照。若 browser frame/canSend 检查在外部进行，进入状态提交前还须验证它属于当前展示租约代次，并且原调用者未失去授权/可见性。等待中状态变化应返回可解释的 busy/version_changed，而不是悄悄覆盖。

### 必须新增的回归

两个前台 client 同时 reserve，只有一个成功；持有者续租与另一方 reserve 竞争；TTL 到期换页；ACK 与 lease 转移竞争；人工 controller 已建立时其他页面只能获得元数据。至少有一条把相同竞争连接到真实 PG repository，验证不是 MemoryRepository 特有行为。

## 现有测试与实现边界评价

- 30 秒默认值、5 秒临界点、29.9 秒人工提交后成功、释放永不返回而独立 drain 关闭 context 的测试都有针对性；它们不是简单启动冒烟。
- 真实 PG 测试确实验证状态/事件同事务、竞争 CAS、预留预算并发上限和重建 repository 后预算保留；凭证测试也对旧 generation、登录 reservation 冲突和撤销后复活做了实际数据库断言。
- 但目前“claim excludes automatic”主要是顺序调用，不代表展示/接管/计时器的完整并发互斥已覆盖；manual_only 仅覆盖无人在线的初始路径，不代表活动自动预约与恢复路径安全。
- coordinator 使用的 browser port 仍为受控内存替身；本次状态探针也是如此，结论仅是状态契约存在反例，不冒充真实 Chrome/HTTP/业务全链验收。后续跨层测试仍必要。
- production 与测试模块拆分清楚，没有把数据库、UI 和浏览器细节塞进同一文件；本轮没有因尚未实现的 S3/S4 接口或界面要求扣分。

## 复审要求

修复 PR-S2-001 至 PR-S2-003，增加对应回归并重跑现有状态/真实 PG 测试后交 R2。请保留本 R1 记录；不得将当前 8 个通过测试表述为 S2 已通过独立审核。
