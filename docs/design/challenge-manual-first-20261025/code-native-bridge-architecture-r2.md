# 原生有限候选桥接：独立架构审核 R2

2026-10-26，native_callback_review。**限定 PASS**：R1 架构发现均已闭环；本次窄审没有新增未关闭的 P0–P2。结论覆盖默认关闭的原生有限候选实现、下述独立 Node 验证与已核对的受控跨层证据，不能表述为真实闲鱼验证成功或生产部署许可。

本轮审核只新增本报告；未修改生产源码，未启动 Chrome，未操作真实验证码，未读取真实凭证采集档案。

## R1 闭环复核

| R1 发现 | R2 源码与验证 | 结论 |
| --- | --- | --- |
| P1：DTO 等待期间取消 claim，仍能返回旧签名 URL | `verification-native-http.ts` 在 DTO、snapshot、当前登录 session 等全部 await 结束后，返回 success 前同步调用 `assertNativeClaimCurrent`。该方法检查 owner、lease、auth/client、generation、epoch、当前 controller、人工状态、截止与在途 operation。原样独立取消反例再次通过。 | 关闭 |
| P2：二代挑战重新获得 30 秒 | nativeClaim 使用 `humanDeadline ??=`，continueChallenge 保留原截止；原样独立续接测试再次通过。 | 关闭 |
| P1：状态流或续租断开时原 iframe 不按本地截止卸载 | NativeVerificationPanel 的 live 条件同时核对 humanDeadline、expiresAt、presentation.until 和当前 client；显示与消息接收共用这一围栏。本地时钟失效后清除 presentation，迟到 claim 不重新挂载。产品独立真实组件测试覆盖人窗与 lease 分离过期。 | 关闭 |
| P2：原生关闭文案承诺自动接续，实际却取消 | Provider 和 QR 关闭分支排除 native_iframe 的“交给系统”语义；已接管且结果未知的原生轮次明确终止。 | 关闭 |
| P2：completed_partial 被展示为通用失败 | NativeVerificationPanel 明确显示部分检查已完成、账号仍有待处理项目；没有将部分状态夸大成已连接。 | 关闭 |

迟到 claim 返回时还检查组件 lifecycle、challengeGeneration、当前较新控制状态与本地截止；无法使用的响应尝试以其 lease/generation/epoch 取消。正常续租保持同一 iframe key、window 与 document，避免每秒重建平台控件。

## 候选与最终恢复边界

`verification-native-candidate.ts` 只接受当前服务端保存的挑战 host 的一个 x5sec，限制字段集合、合法 Cookie 字符、长度与有限有效期。客户端不能扩展 Cookie 名、domain/path 或安全属性。browser driver 在原 BrowserContext 加入 host-only x5sec，固定 path=/、Secure、SameSite=None，并将 SDK 毫秒 expiry 转换成 Cookie 秒；不覆盖整套账号 Cookie。

私有 native URL 和 applyCandidate 仅存运行时 challenge，不进入 session 仓储、DTO 或广播。签名 URL 只通过当前 claim 响应返回；native HTTP 验证 CSRF、当前登录 session 与账号权限，不经过持久化幂等响应缓存；verification-sessions 响应 no-store。

nativeResult 将候选视为未认证凭证输入。唯一 operation 防止重复应用，并在应用前撤人工控制、进入 settling；tick/startAuto/continueChallenge 保留在途屏障。应用超时、取消、会话失效、权限或 owner 丢失都会阻止唤醒原业务并关闭 context。已接管原生人工但结果未知时停止本轮；无人且未接管时仍由后端自己的挑战路径自动执行。

候选本身不会生成 backend platformResult accepted，不直接保存账号凭证或清除风险。`createBrowserMtopTransport` 在原 context 用当前 token 和新时间重签原请求，保留平台的 x5sectag 等上下文 Cookie；`fetchXianyuBrowserImToken` 必须取得显式 loginuser 身份并匹配 expectedUserId，不能以 Token payload 的 userId 替代缺失的身份接口结果。后续仍须原凭证快照 CAS、风险 revision 与匹配 IM 注册/新鲜心跳。消息、改价、发货等写操作不自动重放。

## 本审核实际执行

工作目录 `apps/api`，实际命令：

```powershell
node --import tsx --test --test-concurrency=1 scripts/verification-native.test.ts scripts/verification-native-architecture-r1.test.ts scripts/xianyu-native-session-preservation.test.ts scripts/xianyu-native-session-preservation-review.test.ts scripts/xianyu-im-native-recovery.test.ts
```

**23 PASS / 0 FAIL / 0 skip，3.12 秒。** 全部为无 Chrome 测试。覆盖两个独立 R1 反例、auth/client/generation/epoch/lease 围栏、重复候选、应用在途屏障、权限/session/cancel 丢失、应用超时、人工未知结果止本轮、未接管后台自动、原请求重签、x5sectag 保留、显式身份缺失与错账号/设备拒绝、请求局部精确快照、旧快照失效后不复活、持久化失败、空快照、原生 Token 尚未完成 IM 注册时不清风险及较新风险 revision 保护。

这不是浏览器或真实平台端到端测试。审核人按根任务的串行浏览器约束没有重新启动 Chrome。

## 受控 UI 与跨层证据核对

独立读取 `NativeVerificationPanel.browser.test.ts` 与 `code-native-bridge-product-r2.md`。产品审核实际独跑 **8/8 PASS**：真实 Vite/React/Chrome/跨域 iframe DOM，HTTP transport、事件 socket、平台 HTML 受控。覆盖本地人窗截止、四秒 lease 失效、迟到 claim 关闭竞态、续租不重建 DOM/document、准确关闭文案、真实 iframe source 候选与非平台 passed 提示、桌面和手机布局。此处是对另一独立审核执行记录的核对，不声称由本审核重复执行。

读取 `apps/web/scripts/e2e-native-verification.mjs`、服务 fixture 的候选判定与 `docs/evidence/manual-verification/native-result.json`，核对根任务实际运行的跨层测试范围。脚本从真实 UI 原生 iframe 鼠标拖动开始，经真实 HTTP、PostgreSQL、原 backend Chrome、Token/显式身份、凭证 CAS 和 IM 心跳；后端 Chrome 未呈现人工挑战。平台响应与 IM 外部对端受控，测试没有真实闲鱼验证。

证据结果：succeeded；前端 slide=1、native result=1、native load=1、自动手势=0、截图 stream=0、pointer frame=0；人窗 30000ms；IM 注册与心跳 ACK 各 1；风险 0、transport connected。1440×900、768×700、390×844 三个实际视口均固定 540 高、页面无滚动、iframe 比例正确且完整显示。源码还断言续租保持同一 iframe、最终 platformResult 仍为空、x5sec 与原 x5sectag 共存、HTTP no-store、验证会话持久数据不含候选值或签名 query。

`native-result.json` 明确标注 `productionPlatformVerified=false`，与上述受控范围一致。这个测试证明项目原生结果交接和恢复装配链路可运行，没有证明真实平台接受跨浏览器迁移。

## 最终范围

功能实现：原生前端、有限结果交接、单控制者与候选应用屏障已形成可审查切片。模块拆分：panel、消息解析、HTTP、候选验证、协调器、浏览器适配与业务身份/凭证恢复职责分开。测试验证：本审核独跑 23 项 Node 通过，核对产品独立 Chrome 8 项及根任务受控跨层成功证据。环境阻塞：本范围无新增阻塞。未覆盖项：真实闲鱼是否实际发送有限候选、是否接受其进入原后端会话、真实账号的最终 Token/身份/CAS/IM 恢复及生产部署。

配置 `XIANYU_VERIFICATION_NATIVE_ENABLED` 默认仍为 false。只有本地显式打开后完成用户授权的真实平台一轮验收，才能关闭真实恢复门禁；不能以本限定 PASS 或受控 code0 代替。

## 全 API 回归后旧 credential fixture 更新复核

随后根任务报告全 API 首轮 264 项中旧 configured verification browser fixture 出现一项失败，并更新 `apps/api/scripts/xianyu-im-credential.test.ts`。本审核独立读取该文件的 Git diff、更新后测试和 `XianyuImService.refreshCredential` 的真实请求局部 session 分支，结论为 **PASS：这是修正过时 mock 契约与错误的按 Cookie 名删除预期，不是削弱断言**。

旧 mock 只在 fetchImToken 返回值中轮换 flat cookieHeader，原 metadata snapshot 仍留过期 signing Cookie，因此无法同时表达真实 transport 的 Set-Cookie 更新及 HttpOnly/Secure/SameSite 范围属性。更新后 mock 提供 createCredentialSession/client/getCredential，第一次 Token 请求后的 getCredential 返回旋转后的精确 snapshot，符合生产请求局部 MTOP jar 的契约。

Diff 没有删除原验证 URL、初始 x5secdata 存在性、cookie2 的 domain/path/HttpOnly/Secure/SameSite 全对象断言，也没有删除旋转后的 _m_h5_tk 精确对象断言、Token 请求恰好两次、保存恰好两次、最终 accessToken 和首轮 x5sec=passed 断言。唯一行为预期变化是：原 `doesNotMatch(x5secdata=)` 改为明确要求保存 browser 最终返回的 `x5secdata=stale`。这里 stale 只是受控 fixture 的值；恢复逻辑不能仅凭 Cookie 名或该值的拼写判断平台已经失效它。该正向断言仍能检出误删最终 Cookie 的回归，不能解释为放过凭证损坏。

本项覆盖的是 browser 未直接返回 imToken 时的配置浏览器兼容重试分支；原生 Token+显式身份+一次性 CAS 分支仍由前述 native preservation/native recovery 测试独立覆盖，不能用这次 fixture 更新替代那些边界。

审核人实际独跑：

```powershell
node --import tsx --test scripts/xianyu-im-credential.test.ts
```

**14 PASS / 0 FAIL / 0 skip，0.41 秒。** 未修改该测试或生产源码，未启动 Chrome。全 API 264 项完整复跑仍由根任务执行，本审核没有将此 14 项结果冒充全 API 已通过。

## 后续真实本机验收与未通过项（2026-10-26）

根任务随后提供并本审核读取 `docs/evidence/manual-verification/native-real-result-20261026.json`。这是**用户实际手动操作的本地项目原生 iframe → 原 backend 会话恢复成功**，与此前仅在用户自己的平台页通过、或 iframe code0 后 backend 仍被挑战的 case 不同。receipt 记录 human_active → settling → handoff → rechecking → succeeded，原生结果候选收到一次、autoAttempts=0，claim 时人窗剩余 29996ms；后续核对账号和 transport 均 connected、凭证 active、有 accessToken、剩余风险为 0，并观察到新鲜连接时间。

receipt 还记录 SDK 交接候选与原 backend 持久化 x5sec **等值比较为 true**，保存 scope 为 h5api.m.goofish.com、path=/、Secure、HttpOnly=false、SameSite=None。本审核未读取、输出或复制任何实际 Cookie/Token 值；真实采集归档继续私有保存，不应随提交进入仓库。

该次 frontend slide 响应未捕获，原始采集还有 iframe attach/buffer 缺口。因此不补造 code0 证据，最终 platformResult 仍为空；成功判断来自候选进入原 backend、业务与身份/凭证恢复及后续连接状态。这次真实结果关闭了**该本机账号、浏览器和配置的一轮跨会话恢复验收**，不推出所有浏览器/第三方 Cookie 策略/远端部署环境均可迁移。默认 native flag 仍 false，仅本地显式开启，未部署生产。

根任务报告最终完整 API **456 PASS**、完整 Web **561 PASS**、PostgreSQL 专项 **8 PASS**；新的 native controlled 跨层 E2E 与上述真实平台本机验收通过。审核人本追加轮次仅核对 receipt 与范围，未重跑这些整套命令，也没有启动浏览器。

**旧 legacy 截图 E2E 的 code300 → 原生刷新分支仍 FAIL。** 它不由当前 native manual iframe 路径使用，仍必须在状态、验收和测试结果中保留，不能将完整截图 E2E 或总 verification E2E 记为通过。以 legacy 脚本开头串联 native 的 `test:e2e:verification` 可能在执行到 native 之前失败；应分别记录实际执行命令与结果，不能改名或删断言掩盖失败。

成功与失败应在最终尝试记录中并列：早期真实截图输入拒绝/平台300、持续输入积压、前端原生曾通过而 backend 未恢复、旧 legacy 刷新失败、最终 native 受控跨层和本机真实恢复成功。正文可用脱敏摘要定位私有证据，原始 HAR、Cookie、签名 URL、截图调试档及临时 probe 不入 main。

## 本轮提交范围的只读建议

审查时分支为 codex/manual-challenge-priority，HEAD=d5e9f09，HEAD 仅有 S2；大量 S3 runtime/HTTP/Web 仍未入 Git。**仅提交 native-* 文件不可构建或运行。** 下列是依赖闭合的白名单建议，不是审核人已暂存/提交的文件清单；本审核未操作索引或提交。

### 必须随本轮收录的生产依赖

API 核心与先前 S3 装配（除后述混合文件需按 hunk 收敛外）：

```text
apps/api/src/app.ts
apps/api/src/config.ts
apps/api/src/services.ts
apps/api/src/realtime-session-access.ts
apps/api/src/verification-coordinator.ts
apps/api/src/verification-domain.ts
apps/api/src/verification-runtime.ts
apps/api/src/verification-dto.ts
apps/api/src/verification-http.ts
apps/api/src/verification-native-candidate.ts
apps/api/src/verification-native-http.ts
apps/api/src/verification-realtime.ts
apps/api/src/verification-input-error.ts
apps/api/src/xianyu-challenge-presentation.ts
apps/api/src/xianyu-native-challenge-frame.ts
apps/api/src/xianyu-browser-port.ts
apps/api/src/xianyu-browser-im-token.ts
apps/api/src/xianyu-browser-mtop.ts
apps/api/src/xianyu-cookie-jar.ts
apps/api/src/xianyu-im-service.ts
apps/api/src/xianyu-qr-login.ts
apps/api/src/xianyu-slider-solver.ts
apps/api/src/xianyu-slider-verdict.ts
apps/api/src/xianyu-slider-ydisks.ts
apps/api/src/xianyu-verification-browser.ts
apps/api/src/xianyu-verification-read-recovery.ts
```

其中 solver/ydisks 的 admit/beforeAttempt 是自动/人工互斥与预算的功能围栏，不能当作截图调试而漏收；browser port 与 verdict watermark/pendingAnswers 是在途结果屏障依赖；services/contextWithoutTouch 与 realtimeSessionAccess 是状态/事件鉴权依赖。

Web 装配与功能模块：

```text
apps/web/src/app/App.tsx
apps/web/src/app/VerificationBridge.tsx
apps/web/src/app/AccountRiskFeedback.tsx
apps/web/src/features/accounts/api.ts
apps/web/src/features/accounts/components/AccountLoginModal.tsx
apps/web/src/features/accounts/components/AccountTable.tsx
apps/web/src/features/accounts/qr-login/model.ts
apps/web/src/features/accounts/qr-login/components/QrLoginModal.tsx
apps/web/src/features/accounts/qr-login/components/QrLoginView.tsx
apps/web/src/features/verification/VerificationProvider.tsx
apps/web/src/features/verification/VerificationPanel.tsx
apps/web/src/features/verification/VerificationDialog.tsx
apps/web/src/features/verification/VerificationClose.tsx
apps/web/src/features/verification/NativeVerificationPanel.tsx
apps/web/src/features/verification/native-message.ts
apps/web/src/features/verification/model.ts
apps/web/src/features/verification/api.ts
apps/web/src/features/verification/client-identity.ts
apps/web/src/features/verification/useVerificationStream.ts
apps/web/src/features/verification/verification.css
```

旧 RemoteVerificationPanel 与 useVerificationStream 仍由 wrapper 的 flag-off 分支静态导入，不能因为 native 不建立图片 WS 就遗漏它们。QR 取消/关闭与账号重试入口同样是本轮完整用户路径的依赖。

### 混合文件：不能整文件排除，也不能原样夹带未闭环优化

`apps/api/src/verification-remote-browser.ts` 是 HEAD 已有的运行时依赖。当前版本新增静态导入 `verification-safe-region.ts`、`verification-input-snapshot.ts`；后者又导入 `verification-render-diagnostics.ts`。**全收当前 remote 却遗漏这三者会缺模块，不能称可构建白名单。**

建议按 hunk 保留已需的 onInvalidate、stream/frame 同步围栏与既有安全 ROI/原节点检查，排除 `location/currentLocation` 快缓存和 performance console 采样；`verification-realtime.ts` 内 queuedAt/serviceMs/performance 日志同样排除。render-diagnostics 虽然名字含诊断，它的 CSS/tag 常量被安全差异判定实际使用；input-snapshot 的 prepareTelemetry 中也含 data-spm/paint 有限兼容的安全证明，不能仅删调用导致围栏放宽。保留该安全模块组时，三份源码与对应安全回归必须一起收录，但无需把临时分析输出、性能测量日志带入 main。

若最终范围决定连前轮截图安全模块组也不收录，则应以 HEAD 的 remote 实现为基线，仅补 runtime 真正需要的 onInvalidate/必要同步接口，并一致调整其未提交测试和脚本引用；这是另一份切片，不等于当前已测试工作区。**任一 hunk 收敛后，必须在仅含待提交快照的隔离目录复建/复测，不能沿用完整脏工作区的 456/561 成绩宣称该提交已验证。**

### 测试与脚本白名单规则

必须收录本轮 native 回归、两个独立反例、session preservation 及旧 fixture 修订：

```text
apps/api/scripts/verification-native.test.ts
apps/api/scripts/verification-native-architecture-r1.test.ts
apps/api/scripts/xianyu-native-session-preservation.test.ts
apps/api/scripts/xianyu-native-session-preservation-review.test.ts
apps/api/scripts/xianyu-im-credential.test.ts
apps/api/scripts/xianyu-verification-recovery.test.ts
apps/api/scripts/verification-service-fixture.ts
apps/web/scripts/e2e-native-verification.mjs
apps/web/src/features/verification/NativeVerificationPanel.browser.test.ts
apps/web/src/features/verification/native-message.test.ts
apps/web/src/features/verification/test-fixtures.ts
```

前轮 S3 传输/授权/QR 生命周期测试属于新增 runtime/HTTP/Web 功能的覆盖，保留 package scripts 引用时必须一起收录：verification-access、continuation、http-fence、input-error、pending-answer、runtime、send-fence、transport、transport-scenario、transport-postgres；Web 的 api/model/VerificationPanel/VerificationProvider 测试亦应收录。若保留截图安全模块，再包括 verification-safe-region、native-input、remote-browser 相关功能回归。性能 console、为 unfinished cache 服务的时间阈值优化证明和一次性 probe 不应自动随目录全收。

`apps/api/package.json`、`apps/web/package.json` 只收实际保留的确定性测试入口与 native E2E 入口；每个引用的新增脚本必须存在。旧 legacy E2E 若仍列为入口，就同时保留其脚本/fixture与已知失败记录，不能用一个只跑 native 的脚本覆盖旧名称并宣称 legacy 变绿。

### 文档与证据收录边界

建议收录明确描述最终行为与限制的 STATUS、proposal、implementation、frontend-acceptance、本轮 native 架构/产品 R1–R2、native browser direction，以及两个脱敏结果回执 native-result.json、native-real-result-20261026.json。失败尝试的脱敏记录可保留为公开 evidence 或在统一尝试台账记结果、原因与证据定位，必须避免把较早的“待真实验收”写成现状。

不要用 `git add .`、整个 docs/evidence 或整个设计目录作白名单。旧逐轮 screenshot cache/performance 实验报告、临时 observer/probe helper、DOM dump、原始网络正文、截图调试档、私有录制/HAR、签名 URL、Cookie/Token 与任何设备/账号凭证均排除；用户要求记录失败不等于要求把原始调试材料发布进 main。审核建议本身不执行暂存、提交、合并或部署。

## 最终暂存源码清理复核

根任务按上述建议完成 hunk 收敛并显式暂存 97 个文件，再将纯索引导出到隔离 TEMP 目录执行整套验证。本审核直接使用 `git show :路径`、`git diff --cached` 检查**索引版本**，未以工作区内容冒充待提交内容；本追加轮次只编辑本报告，未改源码、索引或提交，未启动 Chrome。

**暂存源码与依赖窄审 PASS，无新增未关闭 P0–P2：**

- 暂存 remote 已无 location 字段与 currentLocation 快缓存，capture 编码前后均重新 locate；原 node/geometry/epoch、两秒时效、像素所有权与输入安全快照围栏保留。
- 暂存 remote/realtime 已无 verification-performance、queuedAt/enqueuedAt、queueLagMs/serviceMs 的性能采样输出。正常 close 的 cleanup 不打印警告；实际输入拒绝/stream 故障仍保留固定结构的脱敏业务告警，不包含 URL/Cookie/Token。
- safe-region、input-snapshot、render-diagnostics 三份实际安全依赖均已暂存；没有为了清理诊断而删除 data-spm/paint 有限兼容证明或放宽输入围栏。
- native HTTP 最后一次 auth/DTO await 后的同步 claim fence、候选唯一 host/单 Cookie/有限寿命、原 context 临时应用、应用前后权限与 operation/generation 复核、超时关闭、二代 humanDeadline 不延长、人工未知结果不自动重放均仍在索引中。候选不造 platformResult accepted，显式身份与 CAS/IM 最终恢复边界未削弱。
- 前端本地 lease/humanDeadline/expiresAt 的显示和消息围栏仍在；默认 native flag 与 `.env.example` 中的开关均 false。

本审核对 97 个暂存文件执行只读依赖检查：新增/修改应用源码和测试的 **402 个相对 import** 均能在 Git 索引中解析；API package 中 **166 个 scripts 文件引用**、Web package 中 **23 个 scripts 文件引用**均存在于索引，未发现漏收文件。`git diff --cached --check` 通过。该检查覆盖文件依赖闭合与 whitespace，不替代 TypeScript、运行测试或真实浏览器验证。

索引路径复核未见真实 `.env`、`.codex` helper、private/rawHAR/log、HAR/NDJSON、图片或 docs/evidence 文件；唯一环境示例为 `.env.example`。`.gitignore` 另增加私有采集/helper 和本地 evidence JSON 防线。脱敏成功/失败尝试结果保留在审阅文档；真实凭证采集与本机 receipt 仍保留在本地而不进入本次索引。

根任务正在该纯索引导出目录串行执行完整 API、完整 Web、build 与 native E2E。本审核不提前将其记为 PASS，也不复用清理前整套成绩来替代本次待提交快照的实际结果。源码窄审允许继续最终验证与审阅；提交前应把该纯快照的准确命令、通过/失败及既有 legacy 截图刷新失败边界补入最终交付记录。
