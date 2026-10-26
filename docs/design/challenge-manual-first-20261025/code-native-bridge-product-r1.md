# 原生有限候选桥接产品、前端与 HTTP 独立审核 R1

本轮 R1 发现已在后续 R2 修复并验证关闭，最终结论见 `code-native-bridge-product-r2.md`。下文保留初轮失败事实与审核历史。

2026-10-26，native_recovery_review。本轮不修改 src、不启动 Chrome、不操作真实平台、不读取私有凭证。范围：NativeVerificationPanel、native-message、verification API/model/wrapper、native HTTP、协调器租约/候选在途操作、后端原 BrowserContext 单 Cookie 应用及默认关闭开关。

## R1 结论：FAIL，前端生命周期缺口待修

消息来源/精确 origin、候选与平台 verdict 区分、单 x5sec host-only 写入、独立 nativeOperation、应用超时关闭原 context、应用后的权限/会话/owner/generation 复核及原业务重签方向正确。DB/广播 DTO 不包含签名 URL 或 Cookie 候选；native HTTP 绕过持久幂等缓存。已经人工接管但结果未知时停止本轮、未接管时允许后台自动，符合本轮设计边界。

当前尚未满足前端本地截止、异步 claim 卸载及关闭语义的产品门禁。以下发现已逐项发送主实现，生产修复由主实现负责。

### P1：本地人工截止或 presentation 租约失效后仍显示可操作 iframe

初轮 NativeVerificationPanel 的 `visible` 只检查 mine、generation、epoch；已有 server-clock 的 now 仅用于 countdown。presentation 请求失败仅设置错误文字，没有撤下现存 iframe。若事件 WS 断流、HTTP 续租失败，父面板保留旧 human_active DTO，则倒计时归零后仍可以继续操作平台 iframe，receive 也没有本地 deadline/lease 检查。服务器最终拒绝候选不能替代界面禁止继续操作，尤其前端平台请求与后端原 context 不在同一网络观察范围内。

要求：按校准的服务器时间同时检查 humanDeadline、expiresAt、presentation.until 及当前租约标识；在任一失效时撤下原生 iframe 并禁止候选提交，不因重连续租延长原 30 秒。真实 React 回归应断开事件更新、停止 presentation 返回，推进到截止并断言 iframe 被撤下。

### P2：异步 claim 在面板关闭/卸载后仍可写回控制状态

初轮 claim() await 返回后总是调用 context.update，并设置 presentation，没有 mounted/operation/session-generation 围栏。用户在 priority_wait 点击接管后、HTTP 返回前关闭窗口，Provider 可以直接卸载面板；迟到的 claim 仍将 human_active 写回全局，留下至少一个租约周期的无人操作控制。旧实例虽不会显示 iframe，控制归属与用户关闭意图已不一致。

要求：为 claim 建立可失效的本地操作标识；面板卸载、关闭、session/challenge 变化后，迟到结果不得恢复展示或重新打开窗口，并应受控取消服务器已授予的该租约/epoch。回归需挂起 claim、关闭/卸载、再放行响应，断言没有 iframe、无控制遗留且不能取消更新代次。

### P2：关闭确认承诺自动接续，但 native 实际取消本轮

共享 VerificationProvider 和 useVerificationClose 根据 autoAllowed 显示“交给系统并关闭”；NativeVerificationPanel 的 release 实际走 native/cancel，协调器取消并关闭本轮，不会接续自动。global 与二维码登录宿主均受影响。应按 native presentationKind 显示“结束本次人工验证并关闭”等准确文案，不承诺系统继续此轮。

### HTTP 最终签名 URL 授权围栏

初轮 native-http claim 在 await dto 后只有 snapshot 与认证复核，没有再次核对 native 租约、控制 epoch、人工截止及 controller；DTO 构造期间取消或租约到期后仍可能返回旧 URL。该缺口与架构审核重合，主实现已添加最终 assertNativeClaimCurrent。产品审核当前已静态看到此调用位于最终认证之后、success 返回之前；独立 HTTP 反例由架构审核负责，不能把本审核未完成的临时测试记作 PASS。

## 实际独立执行

```powershell
node --import tsx --test --test-concurrency=1 apps/api/scripts/verification-native.test.ts
npm --workspace apps/web exec -- vitest run src/features/verification/native-message.test.ts
```

协调器 **10/10 PASS，0 skip**；前端消息解析 **3/3 PASS**。覆盖：原签名 query 字节保留、限定 host/expiry/value/字段集合、租约 authSession/client/generation/epoch/version、30 秒不续期、重复候选只应用一次、在途不自动、应用期间撤权/会话失效/取消、超时关闭、已接管未知结果停止、未接管正常后台自动；以及精确 origin/source、双层 JSON、占位/畸形/超长消息和 Cookie 注入字符拒绝。

本次独立测试没有执行真实 React DOM、HTTP server、PostgreSQL 或 Chrome；未安装新的 DOM 测试依赖。根任务正在准备受控 React→API→PG→Chrome→IM 流程，不与其并发启动 Chrome。不得把上述纯消息与协调器断言当作 UI/HTTP 完整验收。

随后按根任务要求独立编写 `apps/web/src/features/verification/NativeVerificationPanel.browser.test.ts`，沿用现有真实 Vite/React/Chrome 模式，共 8 项：humanDeadline 与仍有效 lease 分离、4 秒续租失败、迟到 claim 关闭后主动取消、两次续租保持同 iframe DOM/document、global 原生关闭准确文案与取消、真实 iframe source 候选及候选交接文案、desktop/mobile 全 420×320 viewport 等比缩放与固定 modal/body 无滚动。平台 HTML 由 route 受控返回，既不加载真实平台也不发真实答案。已实际执行 `npm run typecheck:web` PASS；**此浏览器测试文件本审核尚未执行**，已通知根任务在 Chrome 空档串行运行。

## 需在根实际界面验收中确认

- 续租更新同一 iframe 时不改变 DOM 对象、不导航、不打断当前原生拖动；generation/epoch/租约改变后旧 source 消息被拒绝。
- 关闭、卸载、挑战续接、manual_only 重试均不留下旧平台 iframe、监听器、URL 或控制租约。
- 桌面、390px 手机与低屏：固定外框无多余滚动，平台滑轨末端完整可见。初轮 CSS 仅缩小 iframe viewport 到 min(420px,100%)，并未证明内部固定 420px 原生内容随之缩放；这项目前是必要验证项，不能仅凭样式断言裁切已发生。
- 有限候选接纳后文案仅为复验，平台未严格验证、Token/显式身份失败、CAS 拒绝或 IM 注册/心跳失败均保留风险。

## 交付范围

功能实现：静态确认有限候选权限与原 context 写入边界，但前端生命周期尚未通过。测试验证：独立 13 项通过。环境阻塞：按根任务协调未启动 Chrome。未覆盖项：上述真实 UI/HTTP/PG 链路与真实平台恢复。模块拆分：原生 panel、消息解析、HTTP 和候选验证分别负责自己的边界；本审核仅写此报告，未修改 src。
