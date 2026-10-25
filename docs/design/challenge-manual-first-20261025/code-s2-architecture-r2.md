# S2 独立架构代码复审 R2

日期：2026-10-26，Asia/Shanghai。

审核范围：S2 coordinator/repository/domain/迁移070、凭证generation及快照CAS、受影响的IM/MTOP/app/read-recovery链。审核者未修改实现或已有测试；只创建本审核报告与隔离复现脚本。R1报告保持原文。

**整体结论：PASS（仅S2门禁）。AR-S2-R1-001～008均已VERIFIED/CLOSED；本轮补充发现也已修订并独立验证关闭。当前没有阻止进入S3的开放P0–P2。**

本结论不表示人工优先全功能、HTTP/WS/前端/QR完整装配、真实闲鱼放行或生产上线已验收。人工窗口已按用户批准采用30秒。本轮未连接生产、未使用真实平台凭证、未部署。

## R1逐项关闭

| 问题 | 最终修订与独立证据 | 结果 |
| --- | --- | --- |
| AR-S2-R1-001 P1：actor外状态前提 | auto/presentation在change回调内部重检状态、controller和展示租约；claim检查当前presentation；beginSettling/handoff拒绝非法状态覆盖。queued auto-vs-claim、双reserve、排队manual_only意图先提交、自动未决响应先settling均有回归。 | VERIFIED/CLOSED |
| AR-S2-R1-002 P1：未完成release被跳过 | 布尔released改为共享releaseTask，所有退出路径等待同一屏障；同步suspended先禁旧人工输入。disconnect保持原3秒重连宽限，恢复不延长30秒。每次settling清旧时间，startAuto必须确认本轮release完成；closingSubjects保留关闭未确认的subject/容量。重叠release、第二轮settling、关闭未确认不启动第二执行器回归通过。 | VERIFIED/CLOSED |
| AR-S2-R1-003 P1：迟到保存续活owner | save返回先按原monotonic lease核验，过期不续租。统一loseOwner立即stopping/invalidate/reject原solve并关闭context，再异步终结持久化。fail的本地拒绝与关闭不依赖DB保存成功；closing tombstone只在context确认关闭后释放。late-save、持续DB失败、关闭未确认、异步启动容量预留回归通过。 | VERIFIED/CLOSED |
| AR-S2-R1-004 P1：旧响应洗白CAS | 普通Token与browser fallback采用请求开始的完整快照，request-local CredentialSession缓冲Cookie；只对initial/retryExpected条件提交，不再响应返回后读取最新快照给旧结果作expected。Memory真实MTOP请求/受控响应与真实PG均验证同generation新刷新获胜、旧普通/fallback结果被拒绝。 | VERIFIED/CLOSED |
| AR-S2-R1-005 P1：markVerified推断执行时generation | markVerified无完整expected则拒绝，status、lastVerifiedAt、内容、updatedAt、expiry与generation参与条件检查；app异步失败/成功贯穿原请求证据，证据不序列化到API输出。显式manual模式与异步业务校验分开；撤销递增generation。另补惰性expiry入口完整CAS与账号状态同事务更新，详见下文。 | VERIFIED/CLOSED |
| AR-S2-R1-006 P1：旧connected清新风险/无心跳核销 | registered/connected状态只发布connecting，只有匹配当前socket/epoch/mid的成功平台heartbeat才可发布新鲜连接证据。恢复前冻结source/episode/revision/generation及Token是否复验；风险事务在锁内核对generation/revision。追加account健康串行lane及每await后liveness检查，PG动态isCurrent失效回滚含outbox。真实本地WS和真实PG故障回归通过。 | VERIFIED/CLOSED |
| AR-S2-R1-007 P2：retry无授权 | active修改及future intent存储前统一access.authorize，未授权不能改模式或写意图。两分支拒绝回归通过。 | VERIFIED/CLOSED |
| AR-S2-R1-008 P2：事件序号歧义 | 每会话eventSequence等于CAS version，Memory/PG一致；两个会话交错和失败事务后各自序号仍1→2。repository明确global bigserial只是审计ID，不能作为max(sequence)式提交安全resume cursor；S3列表流须先订阅缓冲再full snapshot。 | VERIFIED/CLOSED |

## R2中发现的收尾缺口及最终复核

本轮复审没有把“核心修订已有”当作自动关闭。以下问题在中间修订中被实际发现，实施者追加修复后，本审核者重新读取最终代码并运行对应验收关闭。它们不是最终代码仍开放的问题。

1. **迟到save闭锁后仍不结束原solve。** 独立探针曾得到solve=pending、PG状态human_active、context关闭一次。现loseOwner同步拒绝原solve并排队cancelled；新增测试在不调用finally close的前提下确认solve自行OWNER_LOST、状态cancelled。
2. **DB终态保存失败使本地清理被跳过。** 独立复现save持续DB_UNAVAILABLE时solve=pending、contextCloseCount=0。现fail先本地拒绝/失效/关闭，再尝试持久化，finally关闭adapter；新增故障回归确认不用coordinator.close也能结束，关闭一次，无frame/自动旁路。
3. **旧context关闭未确认就释放subject。** 独立复现同subject新session可在旧closePromise挂起时创建并执行一个自动手势。现closingSubjects tombstone与全局容量保留到共享closeContext fulfilled，拒绝/挂起不放行；回归确认旧solve已取消但第二solve仍CLOSING。
4. **读取旧过期快照仍能把新登录标expired。** 本审核者在真实隔离PG复现oldGen2→freshGen3→freshStatus expired。现getCredential使用generation锁、完整快照/原expiry CAS，只有expired CAS获胜才同事务更新账号状态；失去CAS重新读新凭证。新增PG覆盖新登录先提交、同generation校验延长expiry先提交、无干扰真实过期，三项均独立通过。
5. **heartbeat等待持久化期间断线后迟到提交。** 产品审核者首先发现，本审核者复核修订：按account key把status/heartbeat放入同一health lane，固定connectionEpoch/current client及新鲜度，每个存储await后重检。clearRisk/Degraded携带仅服务端动态isCurrent；PG锁后、DELETE后、最终事务写后commit前失效会rollback，含outbox和风险状态。真实本地WS在getCredential/setTransport/clearRisk三个等待点断线并新增risk后，最终disconnected且风险保留；真实PG在DELETE及最终写后失效，也回滚完整核销和通知。
6. **异步授权前没有预留全局启动容量。** 产品补审发现并发三个solve可同时越过2会话上限。最终代码在await前同步pendingStarts预留，finally归还；新增并发准入/失败归还回归独立通过。

上述独立临时探针位于Temp目录，名称为s2-architecture-r2-owner-cleanup-repro.mjs、s2-architecture-r2-db-cleanup-repro.mjs、s2-architecture-r2-close-gate-repro.mjs和s2-architecture-r2-lazy-expiry-repro.mjs。它们断言中间缺陷存在，不能直接当最终修复测试；最终以仓库回归和下列实际结果为准。

## 本审核者实际验证

以下均实际执行，不是转述实施者结果。测试组有重叠，不相加冒充唯一用例总数。

| 验证组 | 实际结果 |
| --- | --- |
| verification-coordinator.test.ts + verification-postgres.test.ts | 最终18项coordinator+2项真实隔离PG，20/20通过、0跳过 |
| credential-fencing.test.ts + credential-fencing-postgres.test.ts | 最终12项凭证/真实本地WS+6项真实隔离PG，18/18通过、0跳过 |
| 9个相关凭证/IM/MTOP/刷新/恢复测试文件 | 88/88通过、0跳过，约71.9秒；包含原浏览器原生IM恢复用例 |
| auto-reply.test.ts + xianyu-verification-read-recovery.test.ts | 47/47通过；已核对夹具迁移，未删失败断言或加skip/only |
| npm run typecheck:api | 通过，退出码0 |
| 真实Chrome无限admit，默认3000ms排空deadline | 最终探针3135ms确认context/page关闭，release及solve拒绝RELEASE_TIMEOUT，autoGestures=0 |

主要可复现命令：

```powershell
$env:MANUAL_VERIFICATION_TEST_DATABASE_URL='postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_manual_verification_test'
node --import tsx --test apps/api/scripts/verification-coordinator.test.ts apps/api/scripts/verification-postgres.test.ts
node --import tsx --test apps/api/scripts/credential-fencing.test.ts apps/api/scripts/credential-fencing-postgres.test.ts
node --import tsx --test apps/api/scripts/auto-reply.test.ts apps/api/scripts/xianyu-verification-read-recovery.test.ts
node --import tsx --test apps/api/scripts/credential-fencing.test.ts apps/api/scripts/credential-service.test.ts apps/api/scripts/xianyu-im-credential.test.ts apps/api/scripts/xianyu-im-native-recovery.test.ts apps/api/scripts/xianyu-browser-im-recovery.test.ts apps/api/scripts/xianyu-im-gateway.test.ts apps/api/scripts/xianyu-mtop-cookie-fallback.test.ts apps/api/scripts/xianyu-chat-refresh-concurrency.test.ts apps/api/scripts/xianyu-verification-recovery.test.ts
npm run typecheck:api
node --import tsx C:/Users/Chenchen/AppData/Local/Temp/s2-architecture-r2-real-drain.mjs
```

88项回归完整输出保存在 `C:/Users/Chenchen/AppData/Local/Temp/s2-architecture-r2-regression.log`，末尾88 pass、0 fail、0 skipped。夹具调整核对结果：新增只读风险stub；mock注入新request-local session.client；server-probe故障只针对recheckReadRequest，不误阻断IM会话创建；没有真实socket心跳时同时保留Token/read风险，属于加强证据断言。partial stub在关闭时曾输出status_callback_failed TypeError诊断，该测试仍只验证并发bootstrap，不作为完整socket生命周期证据；新真实本地WS套件专门覆盖后者。

真实Chrome探针用原VerificationRemoteBrowser及真实Coordinator默认drain=3000，让externalAccess/admit永久pending，独立超时直接关闭BrowserContext；此前两次结果3187/3201ms，最终3135ms。3秒是触发关闭的deadline，完整Chrome退出另有关闭开销；没有把总耗时写成严格≤3000ms。该证据补齐S1留给S2的无限admit故障门槛。

所有PG测试强制本机专用数据库名，随机创建并清理fixture数据；Chrome页面与平台响应均受控；WS是真实本机server/socket，平台注册及心跳内容为fixture。它们证明本地实现的协议/事务边界，不能证明闲鱼真实挑战或生产网关已接受。

## 进入下一切片的边界

- **已验证：** S2状态/输入仲裁、持久化预算/CAS基线、owner失效及3秒释放、凭证旧写保护、来源revision/generation保护、真实匹配心跳及中途断线回滚。
- **模块边界：** domain、repository、coordinator、远程adapter、PG凭证助手和既有业务服务保持分工，未把HTTP/WS/产品逻辑塞入协调器。
- **没有环境阻塞：** 本轮上述窄验证均可运行并通过；没有生产操作。
- **尚未验收：** HTTP/WS鉴权与背压、正式Web人工30秒完整交互、QR临时主体到已有账号的完整接线、全入口业务纵向E2E、生产drain/回退与真实平台验收。S3/S4必须真实接入并独立评审，不能直接用本报告放行部署。

**最终：S2 R2 PASS；R1八项及本轮补充发现全部关闭。允许继续S3实施，不表示整项功能已完成或可上线。**

补充冻结记录：主Agent已确认完整 `npm --workspace apps/api test` 退出码0，主套件264项、item24项、slider17项、recovery47项，共352项且0skip，并完成全部既有smoke至pi-runtime-mock；完整输出位于Temp/xianyu-manual-challenge-api-tests.log。此完整命令由主Agent执行，未与本审核者独立跑的重叠测试相加。onboarding夹具修改已静态核对：只提供Cookie/profile，无真实IM，因此session succeeded+credential active+account disconnected正确；禁用该fixture真实平台IM启动不降低独立本地WS注册/心跳验收。
