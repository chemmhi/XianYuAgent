# S2 协调器：独立产品代码复审 R2

日期：2026-10-26（Asia/Shanghai）。
范围：本轮送审的 `verification-coordinator.ts`、`verification-repository.ts`、`verification-domain.ts` 及 coordinator 回归；不审核并行修订中的凭证/IM 实现。人工窗口仍为 30 秒。

本记录保留 R2 实际检查与探针时的结果。主 Agent 已开始根据发现继续修订共享目录；后续修订必须另作 R3 复审，不倒改本记录的失败证据。未改实现/测试、未操作生产。

## 结论

**FAIL。** 第一轮 PR-S2-001 至 PR-S2-003 可 VERIFIED/CLOSED，但独立扩展探针发现 **2 项新的 P1**：二次进入 settling 沿用旧时间，导致本轮输入释放尚未完成便启动自动；manual_only 重试与自动截止竞争时仍可派发自动手势。

## 本人执行的测试与证据

工作目录：`F:/ChenHai/Project/XianYuAgent/apps/api`。

- `node --import tsx --test scripts/verification-coordinator.test.ts`：**13/13 PASS**，0 fail/skip/todo，约 1.63 秒。
- `MANUAL_VERIFICATION_TEST_DATABASE_URL` 仅指向 localhost 的 `xianyu_manual_verification_test` 隔离库，执行 `node --import tsx --test scripts/verification-postgres.test.ts`：**2/2 PASS**，约 0.42 秒。第二项凭证测试仅记录运行结果，不对正在独立修订的凭证实现给通过结论。
- 经 stdin 运行内存 repository + fake clock + 可控 browser port 的窄探针，未创建项目代码文件：

```json
{"case":"second-settling-reuses-old-timestamp","attempts":2,"releaseFinished":false,"state":"settling"}
{"case":"manual-only-retry-races-startAuto","mode":"manual_only","state":"settling","gestures":1}
```

两条探针均 exit 0，并在 finally 关闭协调器。它们是 S2 状态/动作反例，不是 Chrome、生产平台或完整 Web E2E 结果。

## 第一轮问题复核

| 编号 | 状态 | 关闭理由与范围 |
| --- | --- | --- |
| PR-S2-001 | VERIFIED/CLOSED | disconnect 立即 suspended 并通过 change 持久化 reconnectDeadline；tick 在未到截止前不因缺少 viewer 立即 settling；resume 沿用 humanDeadline。新增 2999ms resume 测试通过。共享 releaseTask 保留真实释放等待。该关闭针对第一轮“立即跳过 3 秒宽限”的反例，不替代后续 HTTP/WS 刷新验收。 |
| PR-S2-002 | VERIFIED/CLOSED | 自动失败/预约出口进入 beginSettling，pendingAnswers 非零时保持观察；新增 pending 自动答案随后 code=0 的测试只 handoff，不给人工输入。原先未决答案即进入 preparing/claim 的直达路径被移除。但多轮复用观察状态产生新的 PR-S2-004，见下文。 |
| PR-S2-003 | VERIFIED/CLOSED | presentation 的 controller/现有展示租约条件在 actor 闭包内针对最新 next 再检查；新增同时 reserve 回归只有一个成功。本轮不将尚未形成完整 HTTP/WS 契约的操作页候选调度视为已验证。 |

额外检查：auto(id) 的 actor 状态重检、过期 lease 的晚返回 save 拒绝、retry 授权回归、每会话 eventSequence 与版本的对应均比 R1 明确；未把这些静态改进等同全链测试通过。

## PR-S2-004 — P1：多轮 settling 复用旧时间，当前 release 尚未完成就运行自动

### 复现路径

1. 一次自动 attempt 失败并有人预约，经过第一轮 settling，进入 offerHuman。
2. 用户完成 presentation/frame/claim，获得 human_active。
3. 将 browser.release 设为可控 gate，模拟本轮鼠标释放仍在等待；用户调用 release(toAuto=true)。
4. 新 beginSettling 已持久化 settling，但仍残留前一轮 rt.settlingAt/lastPendingAt；此时 tick 把旧静默 500ms 当成本轮已完成观察。
5. 在 gate 尚未放开时已调用第二次 autoAttempt，探针输出 attempts=2、releaseFinished=false。

### 原因

R2 送审时 beginSettling 在 await releaseBounded 之后才覆盖 settlingAt，但进入新状态前未清理上一轮的值；offerHuman 也未清理。tick 只检查 state===settling 和旧 settlingAt，并没有本轮释放完成这一代次的约束，startAuto 亦未重新确认屏障完成。

共享 releaseTask 本身已修复“第二位等待者直接提前返回”，但不足以防止 tick 利用上一轮时间绕过整个 await。

### 修复与验收要求

每次进入 settling 时同步清除旧观察状态，并绑定新的 settling generation/屏障；只有本轮 release 真正完成后设置本轮观察起点。tick 与 startAuto 都必须确认当前屏障完成，不能复用历史静默时间。offerHuman 离开观察阶段时清理旧状态。

新增完整两轮回归：auto→settling→人工→release held，等待多个 tick 后自动次数不增加；释放完成且本轮无未决答案静默 500ms 后才允许自动。重复 release、disconnect 与 release 交叠均不能跳过屏障。

主 Agent 已在收到消息后表示修复并新增第 14 项回归；本 R2 不以转述关闭，需 R3 独立验证。

## PR-S2-005 — P1：manual_only 重试排在自动之前仍派发自动手势

### 复现路径

1. 进入 priority_wait，priorityDeadline 为 readyAt+5000ms。
2. 推进到截止前 100ms，并完成一次展示续租，使 persistedAt 新鲜，避免下一 tick 先等待常规心跳。
3. 调用 retry(subject, manual_only)，将该 mode 更新的 repository.save 暂停在 gate 上。
4. 推进至 priorityDeadline，等待 tick 把 startAuto 的状态转换排到 retry 后面。
5. 放开 gate；retry 成功，接着 startAuto 仍派发自动，输出 mode=manual_only、gestures=1。

### 原因

startAuto 在进入 actor 之前检查 rt.row.mode；当时仍是旧 manual_then_auto。真正的 actor 闭包只核对 state，没有核对最新 mode；后续 admit/beforeAttempt 也未检查 mode，因此已经完成的 manual_only 转换挡不住旧调度意图。

已有 queued automatic command 回归只覆盖 auto(id) 与 claim 的 state 竞争，不能证明 timer 触发的 startAuto 与 retry(mode) 的竞争安全。

### 修复与验收要求

在 actor 中以最新 mode 决定是否可以转换 auto_active；实际自动派发准入也需确认当前 mode 仍允许自动，不能沿用旧判断。若 manual_only 请求先赢得 actor 顺序，后续旧截止任务应保持/结束为待人工，不得产生任何新自动手势；只有显式交给系统的模式转换可以重新授权自动。

新增优先窗口末尾 retry(mode=manual_only) 的 gate 竞争回归，断言 retry 成功后所有旧自动调度的 gestures=0；同时覆盖准备截止与 settling 后接续、模式修改与 attempt 预留之间的竞争，且不能误杀已进入人工控制的任务。

## 后续复审与证据边界

- 第一轮三项修订已获确认，不需要重开原编号；新编号 PR-S2-004/005 独立跟踪。
- 当前 13+2 测试通过不能证明新反例不存在，需把反例变成项目回归并重跑后续集合。
- S3/S4 的授权、真实鼠标与数据库跨层动作、前端 5 秒/30 秒显示、QR 生命周期和业务证据仍不在本轮通过范围。
- 未编码、未修改测试、未操作生产。待两项新 P1 修复后提交 R3；S2 在此之前不能宣称独立审核通过。
