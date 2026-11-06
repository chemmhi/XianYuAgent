# 闲鱼账号密码登录：协议、实现与验收（2026-11-05）

## 当前状态

2026-11-06 本地真实验收已通过：后台官方设备首次人工验证后，同设备保存账密再次登录成功；重启服务后第三次登录也成功，后两次均没有安全验证请求。当前本地隔离账号授权正常、真实 IM 心跳 connected，账密密文启用且无失败记录。官方密码、验证、换票、身份和消息 Token 均由后端 HTTP 完成，后台 SDK 只生成当次设备参数。已补旧任务凭证冲突误报账号异常和初始化数据库失败遗留租约的回归及独立复审。原工作区的用户删除保持不变，改动只在隔离分支 codex/xianyu-password-login；未合并、推送或部署，不代表生产账号已经恢复。

该结果证明本次设备连续性和已保存账密恢复链路，不保证平台未来永不要求验证。授权过期自动调度、停用/撤权保护及进程重启恢复由服务测试、真实 PostgreSQL 和页面端到端验证覆盖；尚未等待平台自然到期做长期实测。

## 目标与边界

用户要求在本服务中通过 HTTP 使用账密登录，接入官方滑块、App 扫码及人脸验证，登录后恢复同一失活账号。成功后加密保存账密，授权失效时自动登录；人工停用、删除、撤权不得被自动恢复。临时网络断连先复验 Cookie 与重连，不能重复提交密码。平台要求人工验证时暂停自动尝试，由用户完成，不能绕过验证。

密码登录的协议适配、验证会话、业务编排、密文仓储、恢复调度和前端弹窗分开实现；沿用现有账号、权限、凭证 generation、Cookie jar、IM 和数据库抽象。现有 React/Vitest、Node/tsx、PostgreSQL 测试及运行方式保持兼容。

## 协议依据与实际观察

- 已获用户授权，以 raw 模式采集内置浏览器；原始请求、响应、Cookie、脚本、HAR、截图只留在仓库外的本机私有目录，不提交。成功 returning-browser 密码请求、业务响应和后续身份请求已取得；该轮没有验证，不能作为首次设备验证成功证据。
- 官方 mini_login 初始化返回 window.viewConfig / window.viewData；读取当次 RSA 公钥、CSRF、server UMID、loginApi、脚本版本。使用官方 PKCS#1 v1.5 密码字段编码，不能把历史 password2、CSRF 或验证 token 当作正式登录实现。
- POST /newlogin/login.do 使用 appName=xianyu、fromSite=77。业务成功必须进一步核验 Cookie 中身份、MTOP loginuser 身份及 IM accessToken，HTTP 200 或 resultCode=100 单独不代表认证完成。
- RGV challenge 在原官方 iframe 展示，由用户手动滑动。仅接收匹配 iframe source、origin、challenge nonce、host、expiry 的官方 x5sec；种回同一后端 jar。重复验证只重试被拦截的当前请求或当前重定向步骤。
- 人脸 IV 入口 /iv/remote/pc/mini_login_check.htm 为一次性初始化。官方 normal_validate 页的设备 SDK 失败分支是 _umidfg=-1；后端使用这一公开失败分支，不伪造成功的设备签名。随后 verify_modes 重定向到 identity_verify。
- 从官方 identity_verify 文档提取其 App 人脸验证 URL 和 photoVerify/check.do 地址；二维码内容原样使用官方 URL。按官方间隔轮询：0 等待、1 验证、2 审核、3 成功、-1 未通过。只有 code=3 后，跟随官方返回、经过来源和路径限制的 ivCheckLogin 换票地址；真实 code=3 返回路径是 /newlogin/safe/ivCheckLogin.htm，兼容已观察的 /iv/**/ivCheckLogin.htm。
- IV 初始化、轮询、换票、身份和 IM token 获取全部共用后端 jar。人脸完成后不得再次 POST 密码，不以浏览器本地 Cookie、用户按钮或 postMessage 自报成功替代后端平台核验。
- 捕获过已脱离 iframe 的正文缺口和一次探针拦截规则清除问题；已明确保留证据缺口，不能声称全部网络无损或所有官方验证模式均已覆盖。

## 设备连续性缺口（用户最新验收）

已核对原始成功请求：ua 长度 1244、umidGetStatusVal=255、deviceId 长度 24，另有 bx-ua、bx-umidtoken、bx_et、x-pipu2；原浏览器 Cookie 包含 cna、isg、tfstk、_uab_collina。项目真实重登请求的 ua 与 deviceId 均为空，缺上述设备 Cookie，server UMID 在每次新初始化时变化。havana 官方代码从 localStorage.APLUS_CNA 读取设备 ID，并使用 uab.js 的 UA_Opt 行为值；Baxia preRequest 按真实请求 URL 经 FY.getFYToken 生成动态请求参数。登录 Cookie 和账密成功保存，不等于这一层设备状态已经实现。不得复制历史动态值、伪造成功签名，或把经常要求人脸当作完整一致。

已向用户确认“只调用接口”的运行边界：是否允许服务内部运行不显示窗口的持久化官方 SDK 环境，密码提交及换票继续 HTTP；用户已明确允许后台官方 SDK 环境、不打开登录窗口。已按此边界实现：仅设备参数在后台生成，密码提交、轮询和换票仍由 Node HTTP 完成。

## 模块与状态

| 职责 | 代码 |
| --- | --- |
| 密码 HTTP 协议与 Cookie/身份/IM token | apps/api/src/xianyu-password-http.ts、xianyu-password-protocol.ts、xianyu-password-response.ts |
| 官方人脸会话与扫码轮询/换票 | apps/api/src/xianyu-password-iv.ts |
| 传输端口、验证参数与挑战展示限制 | password-login-port.ts、password-login-client.ts、password-verification.ts |
| 登录生命周期、权限与提交 fences | apps/api/src/password-login.ts；Store.completePasswordLogin |
| 账密 AES-256-GCM 与 CAS/租约 | password-login-vault.ts、password-login-repository.ts、password-login-postgres.ts；迁移 075 |
| 自动恢复 | apps/api/src/password-relogin-worker.ts；PasswordRecoveryHost.tsx |
| 独立弹窗、官方滑块及 App 二维码 | PasswordLoginForm.tsx、PasswordVerificationPanel.tsx、password-verification.css |

会话状态为 logging_in → verification_required → succeeded / failed / expired / cancelled。创建、读取、取消和验证提交仅限创建者，写接口沿用 CSRF 与幂等保护；同账号分布式租约、secret version、credential generation 和最终数据库提交谓词阻止旧任务覆盖新凭证。删除、停用、撤权或取消后不能写入成功状态。保存失败不声称账密已保存，也不替换旧密文。

账密只在用户成功认证后写入专表，以管理员和账号绑定的 AES-256-GCM 密文存储；不回填表单，不在列表、错误、审计或模型上下文中返回。密钥必须独立配置，拒绝开发默认值。自动任务只由 API owner 运行，失败退避。官方安全验证保留同一任务及其 Cookie jar、nonce、密文版本、generation 和租约，延后队列时间，再由账号页面 PasswordRecoveryHost 自动发现创建者的待验证任务；无需重填密码。worker 在首次验证持久化后释放扫描，原任务继续持租约等待。最多 1 个后台任务，为手动登录保留 1 个名额。pending/get/原生验证回执使用 30 秒展示租约，多标签仅一个页面操作；页面卸载不取消后台任务，用户明确关闭才取消。密码错误、取消、超时或撤权会停止自动重复尝试。账号密码页提供“使用已保存账密登录”：用户准备好后主动开始，先校验 actor/manage/账号状态，再取得账号租约，CAS 保留密文并递增版本启用；不会让旧任务覆盖新设置。这样官方窗口超时后无需重复填写账密。

## 本轮问题闭环与独立复核

| 编号 | 级别 | 原因与修复 | 证据 / 状态 |
| --- | --- | --- | --- |
| LOGIN-IV-001 | P1 | 浏览器与后端 jar 分离，完成 IV 后再 POST 密码造成第二轮验证；改为后端保留 IV 会话、check=3 后换票 | HTTP/IV 回归和完整页面契约 E2E 通过，2026-11-06 真实后台 SDK 首次验证及连续两次重登通过 |
| LOGIN-IV-002 | P1 | 外层重试覆盖整个认证流程；改为当前 POST/MTOP 请求和 GET 当前 hop 重试 | 独立 reviewer 另写复现，passwordPosts=1、ivStarts=1，已关闭 |
| LOGIN-IV-003 | P2 | 初始化/轮询 403 RGV 未在当前 hop 处理；识别明确 challenge 后再处理 HTTP 错误 | 初始化 HTML、轮询 JSON 的 403 回归通过，已通过独立复审与回归 |
| LOGIN-IV-004 | P1 | 真实官方换票路径是 /newlogin/safe/ivCheckLogin.htm，旧白名单过窄；补严格官方来源及此路径 | 同轮真实续接成功，safe-login-ticket 回归通过，独立复核及真实同轮续接成功，正常表单及保存账密恢复路径均已真实复验 |
| LOGIN-AUTO-001 | P1 | 后台登录收到官方 IV 后直接结束，用户无法继续；保留同一任务并由创建者账号页面自动展示验证 | 62 项服务回归、后台 QR、按需保存账密按钮的页面→API→PG→完成及导航复验通过，真实保存账密任务已完成官方验证续接，后续免验证及重启登录通过 |
| LOGIN-UA-001 | P2 | 认证方式切换后 metadata 留存旧 UA；仅 password_http 读取该 UA | MTOP 与 IM 边界回归 27 项通过，独立复审关闭 |
| LOGIN-DEVICE-001 | P1 | 官方 returning-browser 带真实 UA SDK、APLUS_CNA deviceId、Baxia 请求动态参数与 JS 设备存储；初版 HTTP 实现为空 UA/空 deviceId；新版真实官方 SDK 输出非空 UA、CNA deviceId、UMID 状态及当次 Baxia 字段 | SDK 集成与本地边界测试通过，2026-11-06 首次人工验证、同设备重登及服务重启后重登通过，后两次零验证 |
| LOGIN-SECRET-001 | P1 | 添加入口的 input.accountId=undefined 经对象展开覆盖真实账号 ID；保存改为逐字段绑定，覆盖全新/已有/已有密文三种路径 | 服务回归通过，添加入口及已保存账密按钮的真实 PG/DOM 端到端复验通过 |
| LOGIN-UI-001 | P1 | 验证位于原账号弹窗内，二维码被截断；改为独立 portal 弹窗，原表单保持挂载但隐藏 | 桌面、移动、短窗口完整二维码与取消按钮 E2E 通过 |

独立只读 reviewer password_design_review 已执行业务、架构、权限与续接复核。独立复审执行 IV/MTOP/IM 38 项及最终业务/HTTP/IV 62 项通过；展示租约在异步权限检查后的接管竞态已由独立复现与回归关闭，无未关闭 P0–P2。早期 browser password adapter 及其浏览器专用测试随着用户明确 HTTP 架构要求删除；等价密码提交、身份校验、Cookie 会话、取消和重启恢复由 HTTP 契约/业务测试与 PG/页面 E2E 覆盖，既有扫码登录浏览器适配保持不变。旧 confirmed 按钮续登分支已删除，避免让人工自报成功重开密码登录。

## 已执行验证

- npm run typecheck：API/Web 通过。
- npm --workspace apps/api run test:password-login：57 项通过，含正常、错误、RGV、IV、取消、删除、权限、generation、租约、保存失败和恢复分支。
- PASSWORD_LOGIN_TEST_DATABASE_URL 指向本机专用测试数据库后，npm --workspace apps/api run test:password-login:postgres：1 项通过；随机测试库完整迁移，验证密文重启、CAS、租约、最终提交 fences。
- PASSWORD_LOGIN_E2E_VERIFICATION=true，npm --workspace apps/api run test:password-login:e2e：真实页面 → API → 隔离 PostgreSQL → 列表及进程重启自动恢复通过。上游是明确的本机官方协议夹具，不能据此声称真实闲鱼登录成功。
- npm run test:web：115 文件、591 项通过。SDK 集成后的并行全量运行有 1 项既有原生鼠标轨迹测试短暂失败，未修改该测试；随后完整重跑 591/591 通过。
- npm run test:api：SDK 集成后全量回归通过（包括原扫码、原安全验证及所有 smoke）；SDK 动态字段刷新随后单独复验 3 项实际浏览器边界测试通过。
- 截图与运行证据仅在仓库外私有/临时目录。E2E 检查桌面、移动、短窗口，二维码和操作区完整可见，无旧检查按钮。

实登入口为隔离本机验收服务，仅接真实闲鱼上游；独立数据库不等于线上账号数据。真实验收：用户已完成官方人脸验证，check.do 返回 code=3。首轮被过窄的换票路径白名单拒绝；修正后使用同轮官方 ticket 和同一 jar 续接，0 次重提交密码，官方身份与 IM token 通过，经本地正式凭证/连接复验接口恢复同一账号，真实心跳确认 connected。该轮业务任务已失败、密码未保存（该次补救时密文表 0 行），不能把私有续接补救当作完整项目自动登录验收。随后用户再次正常表单提交，完整官方 IV→换票→身份/IM token→成功会话→加密 secret 1 行→真实 connected 已全部确认。自动恢复真实读取该密文并发起密码 POST，但官方再次要求人脸；已补后台任务挂回页面的验证控制器，正验收此分支；不能提前修改 connected 状态制造通过。

## 运行配置、迁移与回滚

1. 在 API owner 配置 XIANYU_PASSWORD_LOGIN_ENABLED=true、真实闲鱼模式和独立 CREDENTIAL_ENCRYPTION_KEY（至少 32 字符，不用示例值），按既有迁移流程运行至 076。副本不启动重复恢复 owner。
2. 075 新增密文表与账号租约表，外键级联账号删除；不回填历史账号明文或自动启用没有保存账密的旧账号。旧凭证读取兼容。
3. 关闭密码登录功能开关并重启服务可停止新任务及自动恢复；取消活动任务后回滚应用代码。新增表可保留以兼容前向恢复，不自动删除用户密文。加密密钥需与既有凭证备份一致，不能以新密钥覆盖现有加密数据。
4. 不在生产数据库运行测试夹具、模拟 expired 标记或离线验证码。E2E 创建/删除的仅是专用 loopback 测试数据库下随机子库。
5. 合并发布遵守项目分支验证、中文提交、本地 main 合并再 push 的顺序；人工 READY_FOR_MERGE 和 merge lock 仍是合并门禁。原主工作区有用户保留的删除，不能强制切换或恢复。

## 后台官方 SDK 切片（用户已授权）

2026-11-05 用户明确允许服务端内部运行不显示窗口的持久化官方 SDK 环境，密码提交与换票仍 HTTP。新增 SDK 生命周期与签名端口，不启动可见登录窗口、不伪造旧设备参数。复用项目已安装 Patchright/Chrome 与 profile 锁，隔离账号/租户 profile，保存官方 origin 的 Cookie/localStorage/IndexedDB。HTTP 适配器在每个当次官方请求前获取官方 SDK 动态参数，与 SDK 双向同步 Cookie；业务编排继续使用账号租约、generation、secret version 与取消 fences。

预期模块：password-device-sdk.ts 管理浏览器设备上下文与真实请求钩子；password-device-profile.ts 管理稳定不透明 profile 路径/锁；密码传输端口追加设备工厂，现有密码/IV/MTOP 实现不混入 UI。已验证别名和已存账号优先复用原 profile，未知账号按管理员与登录名派生稳定 opaque key，不能每次随机新建。

验收：真实官方初始化能取得非空 ua/deviceId/SDK 参数；请求按当前 URL/正文生成；同 profile 进程重启保留存储；成功换票 Cookie 写回相同设备；首次人工验证后重复密码登录时观察官方真实结果，无强制免验证或提前声称全部风险场景都无需验证。单元/真实本地 SDK 夹具/PG/DOM E2E、独立评审和真实同设备二次登录证据齐全后才关闭 LOGIN-DEVICE-001。

## SDK 切片最新证据

- 隐藏持久 Chrome 实际加载官方 home 与 mini；真实 UA_Opt.LogVal（当前为 _n）非空，UMID 状态 255，APLUS_CNA 设备 ID 长 24，密码请求完整生成 bx-ua、bx-umidtoken、bx_et、x-pipu2。原始值仅私有保存。未写死 255 或复制采集动态值。
- 登录 SDK 位于 passport 文档，MTOP SDK 位于主站文档，同一 profile。Node 使用实际捕获的 Origin/Referer/Client Hints 及真实 SDK 浏览器 UA。官方当前 GET IV 与正常主站 MTOP 配置不追加 Baxia 字段（原浏览器存档中 MTOP 亦只有 data）；仍经过相应 SDK 请求钩子，不人工添加不存在的签名。
- SDK 请求只被截获并返回本机空响应，Node 原样发送 vendor 处理后的 URL/body；内部 nonce 由官方 SDK 之前安装的最底层 XHR.send 在签名之后添加，并在路由中去除，不发给平台。签名超时关闭上下文，未签名密码请求失败关闭。
- 浏览器认证/MTOP HTTP 与全部 WebSocket 默认禁止外发，公开文档、静态 SDK 与已观察的官方遥测域仅供初始化。独立 reviewer 本地 WS 复现从 2 次 upgrade 降为 0。
- Cookie 采用响应差量同步，保留域/路径/过期/分区；支持 host/domain 替换与删除，拒绝越域 Set-Cookie。已持久的 CNA/isg/tfstk/collina 优先于旧成功快照，失败尝试不会回退设备状态。
- 076 保存 HMAC 管理员隔离别名与 profile 所属历史，回填既有 secret/alias；后续别名登录复用 canonical profile，删除账号枚举历史目录清理，不遗留旧 profile Cookie。
- 已执行：后台真实本地 SDK 夹具 3 项通过（零 HTTP/WS 认证外发、当前请求字节、存储重启、Cookie 生命周期、旧快照不倒退、未签名拒绝、超时晚请求拒绝）；PG 1 项通过（含别名及历史切换）；接 SDK 端口的真实 DOM→API→PG→重启恢复 E2E 通过。测试 SDK 为明确夹具，不能替代真实平台的同设备重登。


## 2026-11-06 真实平台验收与最终复核

时间均为北京时间；记录来自本机隔离数据库和私有 HTTP 档案，原始 Cookie/Token/密码不进入文档。

| 场景 | 实际结果 |
| --- | --- |
| 11:37:02–11:37:43 后台 SDK 设备首次验证 | 用户完成官方滑块、App 二维码及人脸；photoVerify/check 成功后跟随 safe/ivCheckLogin 换票，loginuser/IM token 成功；项目 password 会话 succeeded，保存密文版本 5 |
| 11:39:36–11:39:39 同设备再次登录 | 使用已保存账密，只有密码 POST、loginuser、IM token 三次 HTTP 请求；三者业务成功，无 RGV/IV 请求，无人工操作 |
| 11:47:21–11:47:24 重启服务后再次登录 | 同一持久 profile 和加密账密，仍仅上述三次 HTTP 请求，零安全验证；会话 succeeded |
| 11:47:49–11:48:04 登录后状态 | credential generation 9；账密版本 7、enabled=true、attempts=0、failure_code=null；真实 transport 心跳 connected；页面“账号正常、消息已连接” |

旧历史恢复任务在新凭证写入后触发本地 XIANYU_VERIFICATION_CREDENTIAL_CHANGED，原健康分类误设 degraded。修正仅忽略此精确本地冲突对健康状态的影响，旧操作仍抛错、凭证写入 fence 保留；真实 IM_REQUEST_FAILED 仍记录异常。修复前新回归失败，修复后相关业务/健康/IM 64 项通过，独立 reviewer 的 IM/SDK 19 项通过。

独立复核另发现初始化 profile 数据库读取失败会遗留租约与 waiting 会话，已将读取纳入租约清理保护块并放在会话创建之前。新回归修复前失败，修复后证明零认证调用、零等待会话、租约立即可重新取得且数据库恢复后可登录；独立 reviewer 39/39 通过，两处问题均已关闭。

本轮最终执行：密码/HTTP/IV/后台 SDK 67/67；PostgreSQL 1/1；真实 DOM→API→PostgreSQL→DOM 及进程重启恢复 E2E PASS（外部协议使用明确的本地夹具）；双端 typecheck/build PASS。PG 初次命令因未设置专用数据库环境变量被测试安全门禁拒绝，设置 PASSWORD_LOGIN_TEST_DATABASE_URL 后完整复跑通过。此前完整 API、Web 591 项及构建均通过；本轮两处后端修正执行上述相关回归，未重复全量 Web 测试。正式验收页面同时真实接入闲鱼，不能与协议夹具混淆。

真实截图和 raw 档案只保存在仓库外 private-runs/password-login-20261105。暂不将未来风险验证、自然到期长期稳定性、未部署的生产服务或完整全站视觉验收描述为已通过。
