# 原生结果交接切片：独立架构复审 R1

2026-10-26，native_callback_review。审查当前工作区源码；不操作真实验证码、不启动 Chrome、不读取真实采集凭证。审核人只新增独立测试与本报告，未修改生产源码。实现者在审核期间修复了下述两个由独立反例暴露的问题，因此记录修前与复测结果。

## 门禁结论

**R1 限定架构 PASS / 部分验证。** 后端两个确定反例已经修复并独立复测通过；原生前端本地租约/人窗截止的渲染和消息围栏已复核源码，仍待真实 UI fixture 行为验证。普通浏览器与后端原 context 的真实跨会话恢复仍未验收，不能将受控候选回调或模拟业务响应写作平台恢复证明。默认关闭的本地 feature flag 可以保留；这不是发布或真实恢复验收的 PASS。

## 已确认边界

- `verification-native-candidate.ts` 将候选限制为当前服务端保存的挑战 host、单个 x5sec、合法 Cookie 字符和有限寿命；SDK 的毫秒 expiry 在 browser driver 中转换为秒。消息占位 smToken 不作为成功结果。
- 私有 challenge.native 只留在运行时；仓储/DTO 没有签名 URL 或候选值。原生 HTTP 不使用持久化幂等结果缓存；app 为 verification-sessions 路径设置 no-store。
- coordinator 的原生 lease 绑定 auth/client/generation；native result 在异步权限检查后预留唯一 operation，重复候选复用同一 task；startAuto、tick 和 continueChallenge 对候选应用在途设置屏障。
- 结果应用前后检查权限、owner、operation 和 challenge generation；应用超时停止本轮并关闭 context。候选不会伪造 platformResult accepted，也不会直接持久化凭证或清风险。
- 已接管原生人工结果未知时停止本轮；未接管时保留后台自己的自动路径，避免在人工已触达的平台挑战上继续盲目自动操作。
- 真实业务成功仍来自原请求重新签名、预期身份、凭证 CAS、风险确认和匹配 IM 连接。

## 独立发现与处置

### R1-P1-01：claim 的 DTO await 后可返回已经撤销的签名 URL（已修复）

修前 `verification-native-http.ts` 在 nativeClaim 后等待 runtime.dto，再做 snapshot 授权和 session 检查。snapshot 允许读取已终止的同账号会话，不等于当前 claim 的控制权仍有效。因此 DTO 读取被延迟期间 nativeCancel，可以得到成功 HTTP 响应，包含旧 human_active DTO 和签名 URL。

独立测试 `apps/api/scripts/verification-native-architecture-r1.test.ts` 第一项使用真实 coordinator 与真实 native HTTP handler，仅用 barrier 延迟 DTO；在 claim 已提交之后取消，再释放 DTO。修前失败为 `Missing expected rejection`，确定复现了撤权后的 URL 响应。

实现者增加 `assertNativeClaimCurrent`，在 HTTP 所有异步 DTO/登录/权限读取之后、构造成功响应之前同步检查当前 native lease、generation、epoch、controller、状态、人窗截止和 operation。独立复测通过。该 fence 必须保持同步且位于最后一个 await 之后。

### R1-P2-01：二代挑战重新获得完整 30 秒（已修复）

修前 nativeClaim 无条件写 now+30s；continueChallenge 保留旧 humanDeadline，但二代原生 claim 再覆盖它。独立测试先通过一代候选进入 handoff，推进 2 秒，再 continueChallenge 和 claim 二代，得到实际截止 1032000，原截止应为 1030000。旧远程分支保留剩余人窗，原生分支应保持等价。

实现者将设置改为仅在未设 humanDeadline 时初始化。独立复测通过。

### R1-P1-02：网络/状态流中断时 iframe 不按本地截止卸载（源码修复，待 UI 行为验证）

本次读取的 `NativeVerificationPanel.tsx:65`–`:66` 可见条件只检查 state/controller/generation/epoch；now 虽每 100ms 更新，但只用于倒计时，未用于 iframe 可见性或消息接收。续租失败也只设置错误文案。若接管后原生平台仍可访问，但本项目状态 WS 与续租网络断开，前端保持旧 human_active，iframe 会在 4 秒 lease 与 30 秒人窗到期后继续运行并可接收用户操作。

后端会拒绝迟到候选，因此不是直接把风险清除的漏洞；但它违反人工/自动控制与到期卸载契约，也会让用户继续完成已经失效的一轮挑战。需要基于最后确认的服务端 presentation.until、humanDeadline、expiresAt 计算本地硬截止；渲染与 message handler 同时围栏，期限到后清除 presentation。不能仅等待 WS 通知，也不能因后端防住候选就把 UI 视为合格。需在断状态流/断续租的真实 UI fixture 中验证卸载。

随后独立窄读已确认实现者增加 live(current, at)，同时检查 humanDeadline、expiresAt、presentation.until 和 client ownership；render 使用本地 100ms 时钟计算 visible，message handler 使用即时 clockNow，并在失效时清除 presentation。该源码修复关闭原静态缺口。审核人按要求未启动 Chrome，因此不把静态检查计为已通过断网 UI 测试。

### R1-P2-02：关闭确认承诺自动接续，实际却取消本轮（已修复，源码复核）

`VerificationProvider.tsx` 关闭确认仍依据 autoAllowed 显示“交给系统并关闭”。NativeVerificationPanel 注册的 release handler 调 nativeCancel；已接管 native 的 startAuto 也明确停止本轮。因此文案与实际结果相反。原生分支应显示结束本轮/保留账号状态，不承诺已冻结的自动接续。

随后独立窄读确认新增 closeHandsToSystem，明确排除 native_iframe，并用于关闭确认文案。源码问题已关闭。

### R1-P2-03：原生 completed_partial 使用通用失败展示（已修复，源码复核）

`NativeVerificationPanel.tsx:90`–`:93` 的 terminal 分支只特判 succeeded，其余均调用 failureLabel。completed_partial 因此丢失已有远程面板提供的部分完成、原业务结果核对提示。应保留明确 partial 结果，避免把已部分确认的业务状态显示成笼统失败。

最后窄读确认 completed_partial 现在单独展示“部分检查已完成，账号仍有待处理项目，请核对账号状态”。迟到 claim 也增加 lifecycle/generation/eventSequence/live 检查，失效响应主动尝试 cancel，不再挂载过期 URL。上述是源码复核，UI 端到端验证仍由实现者随后执行。

## 验证记录

实际命令（均在 apps/api 工作目录，无浏览器）：

```powershell
node --import tsx --test scripts/verification-native.test.ts
node --import tsx --test scripts/verification-native-architecture-r1.test.ts
```

- 原有 native 自测：10 PASS / 0 FAIL。
- 独立 R1 修前反例：0 PASS / 2 FAIL，分别为取消后的 URL 响应、续接人窗被延长。
- 实现者修复后再次运行同一独立测试文件：2 PASS / 0 FAIL。
- 最后合跑原有 native 测试和独立 R1 测试：12 PASS / 0 FAIL。
- 未运行真实 Chrome/UI、真实平台验证、真实 PostgreSQL 本切片持久化集成；这两项独立测试也不是端到端或真实平台恢复证明。

## 下一门禁

先用断网/过期 fixture 验证 R1-P1-02 修复后的 iframe 卸载、消息拒收，以及迟到 claim 和 partial 展示。随后验证真实 UI→真实应用 API→原 context 候选应用→业务复验装配，包含错误身份、业务仍 verification_required、CAS 丢失。只有用户授权的真实平台人工通过后原 backend Token/身份/CAS/IM 链成立，才能关闭跨浏览器恢复门禁。
