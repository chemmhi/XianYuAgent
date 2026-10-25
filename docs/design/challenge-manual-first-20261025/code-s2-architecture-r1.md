# S2 独立架构代码审核 R1

日期：2026-10-26，Asia/Shanghai。

范围：verification-domain/repository/coordinator、credential-generation-postgres、迁移070，以及 domain/store-memory/store-postgres、IM、MTOP与app.saveCookie的generation/CAS改动。未审尚未接入的HTTP/WS/前端/QR调用装配，不以其未完成单独判失败。审核者未修改实现或已有测试，只创建本报告与临时缺陷复现脚本；未连接生产或使用真实平台凭证。

**结论：FAIL，6项P1、2项P2，无P0。** 现有窄测试全部通过，但独立定向复现证明互斥、释放屏障、owner生命周期与凭证/风险证据仍有实质缺口。需修订后R2复审，不能越过S2门禁。

审核针对本轮提交审核的初版。实施者已收到即时通知并开始修订；本文保留首次发现和复现事实，不因共享目录后续变化自动关闭。

## AR-S2-R1-001 [P1] 状态前提放在actor外，立即自动可覆盖已成功的人工接管

位置：初版 verification-coordinator.ts:110–128、142–157、193–197、214–216。

`auto()`在await authorize后、进入change前检查preparing/priority_wait，change回调却无条件把状态写成priority_wait并设置立即到期。claim已排队但尚未完成repository.save时，auto仍看到旧priority_wait并入队；claim先提交human_active后，auto紧接着覆盖它。两调用都成功，人工已获得的操作权被后到自动请求收回，随后可开始自动手势。

独立复现：把claim的human_active保存挂起，在此期间调用auto，释放保存后两者均fulfilled，最终state=priority_wait。不是只用Promise竞争猜测。

```json
{"case":"claim_vs_auto","bothSucceeded":true,"resultingState":"priority_wait"}
```

presentation租约排他检查也在change外，两个reserve能同时通过旧快照检查再相继覆盖；beginSettling无条件写settling，也需防止迟到release覆盖handoff/rechecking。

要求：所有状态/操作权/租约前提在同一actor迁移或数据库expected-state/version条件中重检，明确claim/auto只有一个胜者，成功后迟到命令返回冲突或当前快照。不能仅在入口读取rt.row。增加claim-vs-auto、双reserve、release-vs-verdict/handoff的真实延迟保存竞争断言。

## AR-S2-R1-002 [P1] released布尔值把“释放已启动”当成“释放完成”，并发路径绕过3秒屏障

位置：初版 verification-coordinator.ts:51–55、172–184、214–216、232、254–261。

releaseBounded一开始就令released=true，第二个调用立刻return。disconnect发起第一次尚未结束的browser.release后，显式release/beginSettling会跳过它并设置settlingAt。500ms静默后即可startAuto，尽管原鼠标/队列释放仍在等待。handoff也可能同样误认为已完成释放。

独立复现：browser.release受控Promise始终pending；先disconnect再显式release，显式release已返回；虚拟时间推进501ms并执行tick后实际autoAttempt计数为1，原release尚未resolve。

```json
{"case":"disconnect_release_overlap","releasePending":true,"autoGesturesBeforeReleaseResolved":1}
```

要求：共享同一个正在进行的releaseTask，所有退出路径必须await其确认结果；只有屏障成功才能标记released。屏障失败/超时先同步stopping与输入失效，再独立关闭context，任何第二个调用不得启动新执行器。覆盖disconnect+release、disconnect+timeout、handoff+release、重连后再次退出的重叠；保留S1要求的永不返回admit/释放故障测试。

## AR-S2-R1-003 [P1] 延迟数据库保存可以重置已过期owner lease，旧continuation仍能操作

位置：初版 verification-coordinator.ts:58–70。

change在repository.save前检查一次stopping，save返回后无条件把leaseAt设为当前monotonic时间。保存期间发生>6秒停顿或DB等待时，最先恢复的Promise continuation可以在watchdog定时器前执行，直接给过期owner续命。当前“owner暂停7秒”测试只在没有进行中save时推进时钟，未覆盖这一恢复顺序。

独立复现：挂起claim的repository.save，monotonic/now推进7000ms，先resolve保存；claim完成后立即通过真实coordinator.pointer admission，旧owner操作获准。

```json
{"case":"late_save_renews_expired_owner","pausedMs":7000,"oldContinuationAccepted":true}
```

要求：任何保存/授权/预算长等待返回后，先核对原owner lease与绝对期限，不允许过期后靠迟到保存刷新lease；过期必须同步闭锁和invalidate，接着终结/关闭。不能只依赖watchdog定时器执行顺序。将心跳提交与普通状态命令的续租语义明确分离；迟到提交可保留审计，但不得再授权动作或发布可操作状态。增加late-save、late-heartbeat、save挂起时手工退出/关闭的故障验收。

## AR-S2-R1-004 [P1] IM刷新重新读取最新快照作为expected，洗掉同generation下旧响应的CAS保护

位置：初版 xianyu-im-service.ts:707–711、800–819（普通成功分支与fallback第二次保存）。

refreshCredentialInternal只捕获initialGeneration。await fetchImToken期间，另一个普通MTOP/IM刷新可以在同generation下更新Cookie/Token。旧请求返回后，本方法getCredential读取更晚快照，把它作为expected，却写入旧请求返回的token.cookieHeader/accessToken。CAS匹配的是刚读取的最新状态，而非发起该请求的状态，因而旧响应会覆盖新凭证。单flight只限制本service某类IM刷新，不会排除其他MTOP请求的Cookie更新。

独立复现使用真实隔离PG与真实refreshCredentialInternal，仅fetchImToken由受控fixture替代：在其返回前先commit一份newest cookie/token（generation仍为2），再返回old-response；最终PG的cookie/token被改回old-response，CAS没有拒绝。

```json
{"case":"same_generation_stale_refresh_overwrites_newer","generation":2,"newerCommittedFirst":true,"finalCookieIsOldResponse":true}
```

要求：请求结果必须携带它实际基于的凭证快照/该请求自身已提交版本，或使用createCredentialSession缓冲Cookie变化后一次条件提交。禁止用响应回来后新get的内容为旧结果制造expected。fallback和普通成功分支都要覆盖；并发较新同generation刷新获胜时旧结果必须拒绝或重走安全请求，而非覆盖。

## AR-S2-R1-005 [P1] markVerified仍默认采用执行时的新generation，旧校验/失败结果可改坏新登录

位置：store-postgres.markCredentialVerified、store-memory.markCredentialVerified；app.ts markXianyuAccountFailure与CredentialService.verify调用链。

expectedGeneration仍可省略，省略后helper取当前credential.generation，因此旧业务请求的延迟失败回调可在新登录后将新凭证标expired，延迟成功也可误激活已换内容的凭证。app的markXianyuAccountFailure(status expired)正是不传请求开始generation的现有调用；增加可选参数本身不会补齐这个旧调用。仅generation也不足以保护同generation内容已换新的验证结果，方案要求的snapshot与真实验证证据仍需绑定。

真实隔离PG复现：旧gen2请求之后显式写入新gen3，调用当前无expected的markCredentialVerified(expired)，gen3被标expired。

```json
{"case":"unbound_old_verification_result","oldGeneration":2,"freshGeneration":3,"newCredentialStatus":"expired"}
```

要求：异步验证结果必须携带请求开始的generation+凭证快照/updatedAt或专用验证证据令牌，不可默认回填执行时新状态；从app/服务失败与成功路径贯穿该上下文。没有有效证据的显式人工命令应独立建mode而非冒充业务校验成功。revoke应继续走递增generation/清reservation命令。补新登录后旧expired/active、同generation刷新后旧校验结果的回归。

## AR-S2-R1-006 [P1] connected回调提前且不带revision核销Token风险，会清掉请求期间新产生的风险

位置：初版 xianyu-im-service.ts:644–659；nativeRiskRevision在约718读取后未用于最终核销。

修改把XIANYU_IM_TOKEN_API加入connected回调的clearAccountRisk循环，但不传expectedRiskRevision。connectionAttemptStartedAt在refresh结束后才设置，所以刷新期间同source新增的revision也比这个startedAt早，会被当作旧风险清除。connected在xianyu-im.ts注册应答后立即发出，此时尚无后续平台心跳；startTransportHeartbeat只是每5秒由应用检查socket.connected写库，并不是收到平台心跳证据。

独立真实PG+真实service回调链复现（平台fetch和socket连接回调受控）：Token请求期间新增revision，随后connected回调把风险清到0，未产生平台心跳。

```json
{"case":"new_token_risk_cleared_by_old_connect_callback","newRevisionWasCreated":true,"remainingRisks":0,"freshPlatformHeartbeatReceived":false}
```

要求：从恢复开始绑定source/episode/revision和credentialGeneration，在真正适用的Token、身份、持久化、注册及新鲜平台心跳证据满足后才条件核销。普通旧socket连接成功不能替代Token API复验，也不能把后来的revision当成原轮结果。clear与generation判断需防止中途新登录穿插；不要先get当前generation后再无条件清风险。补新revision、保存后注册失败/无心跳、旧socket连接回调与新登录穿插的回归。

## AR-S2-R1-007 [P2] retry缺少服务层授权，允许不合法主体修改其他账号的恢复意图

位置：初版 verification-coordinator.ts:203–211。

retry没有调用access.authorize。传入另一个adminId但同accountId，可把已有preparing/priority_wait任务改mode，或为未来合法任务预设intent。其他同类人工mutation均有授权检查，这一例外没有可信system-only契约。

独立复现access.authorize对attacker应返回false：retry仍把owner任务改manual_only，且attacker授权回调调用次数为0。

```json
{"case":"retry_skips_authorization","unauthorizedMutationAccepted":true,"authorizationChecksForAttacker":0}
```

目前尚未装配HTTP，因此按P2服务契约缺口记录，不宣称已存在公网利用路径。要求在服务层验证subject归属及当前权限后才能改mode或存intent，不能寄希望S3的路由补救；活动任务与新intent两分支都需拒绝未授权调用。

## AR-S2-R1-008 [P2] 全局bigserial被当作每会话eventSequence，不能支撑已批准的连续序号/gap契约

位置：迁移070 verification_session_events.sequence；verification-repository.create/save赋值eventSequence；verification-domain。

所有会话共享bigserial，然后将该数写入各自eventSequence。两个会话交错A1、B2、A3时，A合法事件序号是1→3，并非缺事件；事务rollback也可能消耗sequence。后续按设计的每会话gap检测将无故重握手。若列表把它当global cursor，不同事务分配和提交顺序还可不一致，不能简单max(sequence)后过滤小值来保证无缝接续。

要求：在S2持久化契约上明确区分每会话连续sequence与列表/global cursor；每会话sequence应在行锁/CAS内递增，global订阅若需使用另定义可安全接续的语义。或正式修改gap规则并证明能识别真正丢事件，不能把bigserial自然跳号当成真实丢失。添加双会话交错、事务回滚和提交次序反转的验收，避免将歧义留到S3传输层。

## 独立执行与证据范围

实际执行原窄测试：

```powershell
$env:MANUAL_VERIFICATION_TEST_DATABASE_URL='postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_manual_verification_test'
node --import tsx --test apps/api/scripts/verification-coordinator.test.ts apps/api/scripts/verification-postgres.test.ts
```

结果：coordinator6项+真实PG2项，**8/8通过、0跳过**。它们覆盖了基本5秒/30秒、单次stuck release、无进行中save的owner失效、原子CAS与预算，以及显式旧generation拒绝；没有覆盖本报告的竞争顺序。

独立缺陷复现脚本（临时目录，未加入产品实现/测试）：

- `C:/Users/Chenchen/AppData/Local/Temp/s2-architecture-r1-coordinator-repro.mjs`：3项协调器缺陷断言通过。
- `C:/Users/Chenchen/AppData/Local/Temp/s2-architecture-r1-im-refresh-repro.mjs`：真实PG+service旧响应覆盖断言通过。
- `C:/Users/Chenchen/AppData/Local/Temp/s2-architecture-r1-im-risk-repro.mjs`：真实PG+受控平台回调的新revision误清断言通过。
- `C:/Users/Chenchen/AppData/Local/Temp/s2-architecture-r1-retry-repro.mjs`：未授权retry断言通过。
- `C:/Users/Chenchen/AppData/Local/Temp/s2-architecture-r1-pg-repro.mjs`：首项markVerified影响新generation断言通过；之后探索“revoke后残留claim”的断言未成立，复查共享代码已增加revoke删除claim，因此该探索没有列为开放问题，也没有当作通过的修复验收。

上述脚本用 `node --import tsx <绝对脚本路径>` 执行。真实PG部分只连接强制本机专用库xianyu_manual_verification_test，创建随机测试admin/account并清理其数据；未操作生产。模拟平台部分只用于确定本地回调与持久化的竞争行为，绝不作为闲鱼放行或真实socket心跳证据。

本轮未重复实施者报告的30项既有业务回归或typecheck，因共享实现已进入修订、暂不对修改一半的工作树做扩大验证；R2应对最终修订重新运行相关窄测试及必要回归。

## 交付判定

- 模块分离：domain、repository、coordinator与PG凭证助手的职责方向可保留；actor内等待保存仍需按本报告处理迟到续租与本地失效，不能由分文件本身证明互斥。
- 通过部分：基本状态链、真实PG原子CAS与预算预留基线8项已独立通过。
- 被阻塞：本报告6项P1使S2门禁失败；须修复并增加可失败先验回归，再独立R2。
- 未来切片：HTTP/WS/前端/QR、全量身份rebind及真实平台恢复仍未审核；本次FAIL不因为这些尚未接入而扩大扣分，也不能把它们当已实现。

**最终：S2 R1 FAIL；不得据此宣称整个功能完成或进行生产发布。**
