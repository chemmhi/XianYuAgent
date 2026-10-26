# 原生有限候选桥接产品、前端与 HTTP 独立审核 R2

2026-10-26，native_recovery_review。**限定 PASS**：R1 提出的前端生命周期、关闭语义和最终签名 URL 授权围栏已关闭。本轮没有新增未关闭 P0–P2。本结论覆盖默认关闭的原生候选实现、受控平台与实际组件测试，不覆盖真实闲鱼放行或生产部署。

## R1 发现闭环

| 发现 | 最终实现与验证 | 结论 |
| --- | --- | --- |
| P1：本地 30 秒或 presentation 租约到期后旧 iframe 仍可操作 | `live()` 同时检查当前人工控制者、humanDeadline、expiresAt 与当前 presentation.until；显示、消息接收及 claim 返回均使用截止检查。真实 React 独立测试分离“人工作业到期但 lease 尚有效”与“4 秒 lease 到期但人工作业未到期”，两者均撤下 iframe。 | 关闭 |
| P2：claim 返回前关闭面板后遗留控制 | session/challenge 生命周期标识在卸载后失效；迟到已授权 claim 使用该响应的 lease/generation/epoch 发取消，不写回旧展示。真实 React 挂起 claim→关闭面板→放行响应，断言 cancel 恰好一次、服务器受控状态 cancelled、无 iframe 或窗口复活。 | 关闭 |
| P2：native 关闭文案承诺自动，而实际取消 | global Provider 与 QR useVerificationClose 仅在非 native 且 autoAllowed 时使用“交给系统”。native 明确结束本轮，global 实际按钮/取消/撤图测试通过；QR 分支静态复查通过。 | 关闭 |
| HTTP：异步 DTO 后旧控制者仍可能收到签名 URL | native-http 在最后认证等待结束后、返回 success 前同步调用 `assertNativeClaimCurrent()`，复核 lease、generation、epoch、控制者、人工截止和在途操作。独立重跑架构反例：DTO 等待中取消后拒绝返回 URL。 | 关闭 |
| 手机仅缩小 iframe viewport 可能裁切原平台内容 | iframe 保持内部 420×320 viewport，通过 ResizeObserver 测算整体 CSS 等比缩放。独立桌面/手机测试确认内部 viewport 420×320、右端控件可见、比例正确、固定 540 外框及 body 无滚动。 | 关闭 |

续租保留相同 lease/generation/epoch 的 iframe key。独立测试在原 iframe DOM 和子 document 放置 DOM 属性标记，等待两次真正的一秒续租后两个标记均保留，且没有建立截图 stream。原生消息仍同时校验当前 iframe window 与精确 origin，有限候选消息不会显示为平台严格成功。

## 本审核实际执行

```powershell
npm --workspace apps/web exec -- vitest run src/features/verification/NativeVerificationPanel.browser.test.ts
```

**8/8 PASS，9.02 秒**。真实 Vite、React Provider、Chrome 和跨域 iframe DOM；HTTP transport、事件 socket 与平台 HTML 受控。覆盖：人工截止、lease 失效、claim 关闭竞态、续租同 DOM/document、准确关闭文案、真实 iframe source 候选及非 passed 文案、桌面与手机布局。平台地址由本地 route 拦截，没有真实平台请求或验证码操作。Chrome 已在测试收尾关闭，未与根任务并发运行。

保留的失败历史：根任务首次执行该文件 **2 PASS / 6 FAIL**，原因是测试入口放在页面 main world 的全局变量无法由 Patchright 默认 isolated world 访问，尚不能用于判断生产缺陷。本审核将控制通道改为共享 DOM 事件/属性，候选发送改为子页按钮实际事件，未改生产源码或降低断言。修后初跑 **7 PASS / 1 FAIL**，是默认一秒 poll 窗口无法等待两次每秒续租；仅将该观察窗口设为四秒，随后八项全部通过。

```powershell
node --import tsx --test --test-concurrency=1 apps/api/scripts/verification-native.test.ts apps/api/scripts/verification-native-architecture-r1.test.ts
npm run typecheck:web
```

后端 **12/12 PASS，0 skip，0.84 秒**，包括最终 URL 取消围栏、挑战续接不重置既有 humanDeadline、独立在途操作、撤权/会话失效/取消、应用超时关闭、已接管未知结果不自动、未接管后台自动。Web 类型检查 **PASS**。此前本审核独立消息解析 **3/3 PASS** 的来源/origin、双层 JSON、host/value/expiry 和注入拒绝断言仍适用；本次没有更改消息解析源码。

## 根任务跨层证据的独立核对

本审核读取 `docs/evidence/manual-verification/native-result.json` 并核对 `apps/web/scripts/e2e-native-verification.mjs`；该流程由根任务实际运行，本审核没有重复执行。证据将范围明确标为受控平台、真实 UI/API/PostgreSQL/原 backend Chrome/Token 身份/CAS/IM 心跳，且 `productionPlatformVerified=false`。

记录结果：state=succeeded；原生 iframe load=1、前端 slide=1、有限 candidate result=1、自动手势=0、截图 stream=0、pointer frame=0；原 human window=30000ms；IM 注册与匹配心跳各 1、剩余风险 0、transport connected。三个实际视口 1440×900、768×700、390×844 均固定 540 高、body 无滚动、完整 iframe 等比显示。脚本还明确断言：前端拖动期间原生 DOM 手柄实际移动、续租不重建 iframe、后端没有人工挑战 iframe、最终 Cookie 包含 x5sec 与保留的 x5sectag、候选不伪造 platformResult、HTTP no-store、验证会话持久数据不含候选值/签名 query。该证据支持受控跨层集成，不支持真实平台已接受跨浏览器迁移。

## 产品与凭证边界

### 独立静态视觉复核补充

本审核随后使用 `view_image` 实际逐张查看最新 UTF-8 受控截图 `native-human-1440.png`、`native-human-390.png`、`native-success-mobile.png`，未启动浏览器，视觉范围限定 PASS：

- 桌面人工图为居中约 640×540 外框；390px 手机人工图与成功图为约 362×540 外框。三图的标题均仅为账号名“受控验证账号”，上方小字是统一“账号安全验证”，没有账号 ID、卖家标识或多余副标题。
- 人工图的图形、中文提示、完整滑轨两端与下方受控二维码均可见。手机保持桌面内容的整体比例，没有横向裁切或只缩小 iframe viewport；中文没有乱码。整体验证区域的 420×320 内部 viewport 及等比缩放精确数值由前述 DOM 断言确认，截图提供可见结果复核。
- 三图均未见弹窗内部的冗余滚动条或内容挤压；右上角使用一致的关闭按钮。成功图原生挑战已经撤下，不残留平台图形或滑轨，正文提示以账号列表实时连接状态为准，“我来重试”使用项目共享主按钮样式，原固定外框保持不变。
- 以上截图是受控平台素材，不被解释为真实闲鱼平台外观或放行证据。根任务另报告完整 Web **113 文件、561 项串行 PASS**；该完整回归由根任务执行，本审核独立执行范围仍以前文列出的命令为准。

native 默认开关仍为 false。完整签名 URL 只返回当前授权控制者；HTTP 使用 CSRF、当前 session 认证与当前账号授权，最终 claim URL 有同步租约围栏，验证接口响应 no-store，不经过持久幂等缓存。候选仅允许当前 issued host 的一个 host-only x5sec，在原 BrowserContext 暂存；Cookie 名称、domain/path、安全属性不能由客户端扩展为完整 Cookie 导入。

候选应用先转 settling、撤控制并占用唯一操作；超时/取消/撤权不得唤醒旧业务。候选本身不清风险、不持久化账号凭证、不伪造 slide accepted。最终凭证保存与风险恢复继续依赖原业务重签、显式期望身份、原凭证快照 CAS 和匹配 IM 注册/新鲜心跳；写业务不自动重放。

功能实现与模块拆分：原生 panel、消息解析、HTTP、候选验证及协调器职责保持分离，R1 发现均已关闭。测试验证：本审核实际 Chrome 8 项、后端 12 项与 Web 类型检查通过，根受控跨层证据已独立核对。环境阻塞：无。未覆盖项：真实闲鱼是否发出该有限候选并接受迁移后的原后端会话、生产部署，以及本轮未重跑的完整既有截图/QR 生命周期套件。真实平台成功仍须单独验收，不能由本限定 PASS 替代。

## 提交边界复核（2026-10-26）

本节由 native_staged_review 独立核对 Git 索引；分支 `codex/manual-challenge-priority`、HEAD `d5e9f09`，检查时共 97 个暂存文件。只修改本报告，未操作索引、提交或浏览器。下述检查直接读取索引对象，不能被解释为本审核独跑完整 API、Web 或跨层 E2E。

静态边界与依赖闭合 **PASS**：首轮检查的 402 处相对静态/动态导入、217 个 package script 文件引用均能在索引中解析，没有依赖未跟踪文件；最后收敛只移除一处无用 import，未增加依赖。原生功能所需 S3 runtime/HTTP/realtime/DTO、Web Provider/Bridge、账号/QR 入口均在提交范围；旧 remote 的 location/currentLocation 快缓存与性能采样日志已排除。安全 ROI、原节点输入快照及其 CSS/tag 常量仍有实际导入与安全判断用途，对应安全回归也在索引中，不能按 diagnostics 文件名误认为临时采集代码。

新增文件路径与新增内容检查未发现真实 `.env`、截图、HAR、原始采集、私有回执、私钥、实际 Cookie/Token 或完整真实签名 URL；凭证特征扫描的唯一长 query 命中为测试中明确的 `fixture%2Fsigned%2B%20value`。`git diff --cached --check` 通过。实际 `git check-ignore -v` 确认 `.env`、`.codex-*` helper、manual-verification JSON 回执、PNG、`network-private.ndjson`、`archive.har` 均被忽略。以上是已检查提交内容的结论，不把 ignore 规则视为任意文件名凭证的自动检测器。

**P2 / 提交边界已关闭：** 首轮发现 `verification-realtime.ts` 的 pointer catch 逐次输出拒绝 action/sequence，属于输入诊断采样而非原生功能依赖。主任务随后移除该输出及 streamFailure 的分类采样，并重新暂存；本审核再次直接读取索引，确认两个输出、无用 `browserStageError` import 和采样参数均已移除，拒绝 ACK/reason 与 close1008 行为保留。最终生产源码新增行扫描没有 `console.*`、debugger、currentLocation 或旧 queuedAt/serviceMs 采样残留，`git diff --cached --check` 再次通过。本项保留发现与修订历史；最终没有未关闭 P0–P2，提交边界为**限定 PASS**。

正式台账范围 **PASS**：STATUS 顶部及 implementation 的统一尝试表并列保留修前失败、夹具错误、旧截图 code300 刷新 FAIL、采集缺口与最终本地真实原生恢复成功。真实成功限于用户手动的一轮本机账号/配置，候选与原后端持久化 x5sec 比较一致、业务恢复与 IM 状态成功；本轮未捕获 `/slide` 正文，文档没有补造 code0。已接管但结果未知后的新 context 自动接续仍 OPEN，整体 S3 仍 FAIL、默认开关关闭、未部署，均没有被本机成功覆盖。

主任务报告仅含暂存文件的导出目录首轮完整 API 456 项、Web 561 项、构建及原生跨层 E2E 均实际 exit0；最后纯日志移除已同步导出目录，追加 API build 已实际 PASS，transport/native 窄回归与 UI 复验继续由主任务串行执行。本审核未重复执行这些命令，未将此前脏工作树成绩或主任务执行归为独立验证；最终执行状态以主任务的实际日志为准。此限定 PASS 只覆盖提交边界，不能扩张为整体 S3、无人自动、新 context 自动接续或发布门禁 PASS；已知旧截图刷新 FAIL 继续保留。
