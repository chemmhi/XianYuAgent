# 独立架构审核 R1

审核对象：`proposal.md` v0.1，2026-10-25。审核身份：独立审核 Agent；未参与方案起草。

结论：**FAIL（设计仍需修订后复审）**。未发现必须推翻“同一原浏览器会话、人工优先、自动接续”的 P0 方向问题，但存在 P1 级生命周期与数据提交缺口。本文只做设计评审和本地源代码核对；未编码、未执行生产操作、未运行实现或平台测试，不能作为任何已实现能力的证明。

审阅范围：5000ms 仲裁、控制 fencing、临时 QR 主体、撤权/退出、owner 失效、帧泄露、业务 CAS、限额与回退。所有路径相对仓库根目录。

## 已认可的设计

- 5000ms 由首帧实际展示与通道就绪后由服务器确定，`now < priorityDeadline` 允许唯一胜者，迟到请求不回放：PASS。
- 不把挑战 URL 嵌入用户浏览器，复用服务器 page/context/profile 与原网络出口：PASS。
- 人工与自动共享成功复验；写操作不重放；code=0 不等于恢复：PASS。
- `hasAccountScope` 不足以授予远程控制，显式要求 active manage 与 expiresAt：PASS。现有 `store-postgres.ts:237` 的实现确实不区分 scope 名称，不能直接复用。
- 数据库权威、提交后唤醒、单 API owner 首期、多实例不隐式开放、开关关闭先排空控制：方向 PASS。

## 必须修订的发现

### AR-R1-001 [P1] credentialGeneration 尚不存在于实际凭证权威，不能只存入 verification_sessions

位置：方案第 6、8、11 节。

问题：方案多处依赖“新登录递增 credentialGeneration”“当前 generation 有效”“复用凭证 CAS”，但只在新 session 字段列出 credentialGeneration，没有确定其账号级权威存储、何时递增、与凭证写入的同事务约束。代码中 `store-postgres.ts:2111` 已有 `commitCredentialRefresh` 的凭证内容 CAS，但当前 IM 浏览器恢复 `xianyu-im-service.ts:774` 走的是无条件 `upsertCredential`，并提前 `clearAccountRisk`；QR 成功 `app.ts:366` 走 `credentials.save`。不能把既有 CAS 方法的存在解释为这两条恢复链已经使用 CAS。

后果：旧浏览器结果可能覆盖新扫码登录/撤销后的凭证；协调器记录显示 cancelled 也不足以阻止外部异步恢复代码落库。账号风险还可能在 IM 尚未 connected 时被提前清除。

要求：明确新增或扩展账号凭证权威 generation、每个触发递增的入口与唯一 CAS 提交方法。IM、只读、QR 需要分别标注替换的调用路径；恢复凭证提交必须核对 ownerGeneration、session/state、account lifecycle、credentialGeneration/快照、权限与主体身份；风险核销应在适用连接/业务条件满足后做 source/revision CAS。禁止继续通过无条件 upsert/save 绕过。补充“旧恢复完成与新扫码/撤销同时提交”和“凭证提交后连接失败”的验收断言。

### AR-R1-002 [P1] QR 临时主体解析为已有账号时缺少会话与 profile 的合并协议

位置：方案第 6、8、11 节。

证据：现有新账号 QR 的 `accountId` 可为空；`store-postgres.ts:2091` 持久化 `provisional_account_ref`，`app.ts:363` 的 `resolveForLogin` 在扫描身份后可能把登录绑定到已有账号，随后 `app.ts:365-366` 修改 loginSession.accountId 并保存凭证。临时挑战在 `xianyu-qr-login.ts:182` 使用 sessionId profile，与已有账号的 accountId profile 不同。

问题：方案只明确“已有账号扫码先取消旧恢复”，但 accountId 未知时也可能解析为正在恢复的已有账号。对该情况，没有定义什么时候取消已有 account subject、哪个 profile 拥有凭证结果、如何取得账号写屏障、如何把临时 subject 转为账号归属、如何阻止双方成功回调与 IM 启动。

要求：在正式凭证保存前引入受控 rebind 阶段：解析平台身份→取得目标账号生命周期/凭证 generation 屏障→使旧 account 恢复失效并确认释放→检查临时 session/QR generation/创建者授权仍有效→原子绑定登录与提交凭证→幂等启动后续连接。不得迁移一个仍活动的 page 到第二个 subject 或只改外键后继续无条件保存。给出已有账号身份碰撞、两个临时 QR 扫到同一账号、撤权/删除穿插的规则和测试。

### AR-R1-003 [P1] 自动预算键与 QR 新会话规则冲突，重启安全的扣次点也未定义

位置：方案第 8、12 节。

问题：临时主体以 loginSessionId 为键，预算在“账号/临时登录 subject 级”持久化；刷新或重建 QR 会生成新的 loginSessionId。第 12 节又要求新会话、source 变化和人工重试不能重置自动熔断。按当前字段无法保证 QR 刷新/重新打开登录不重置预算。自动 attempt 和 15 分钟会话额度也未说明在执行前还是执行后扣除；崩溃后补扣不可靠。

要求：定义稳定 budgetSubject（例如账号；未解析身份阶段按管理员/登录 flow 稳定标识，并另有限制新 flow 的管理员级预算）。说明临时身份解析为账号时如何并入现有预算，取更严格剩余额度而不清零。每次开始自动会话和每个自动手势前先在事务内原子预留额度并写入 attemptId；重启不能再次执行同一 attemptId 或退回额度。给出窗口计算、并发预留、清理保留期限、平台未明确返回的消耗规则。

### AR-R1-004 [P1] owner 心跳失效缺少恢复执行时的强制检查，串行执行器语义还可能阻塞人工控制

位置：方案第 6、8 节。

问题：“同一串行执行器管理计时器、手工命令和 solver”若把整个 solver promise 放入串行队列并 await，claim、撤权、release 与预算到期将无法及时处理。若只有动作批次前检查取消令牌，owner 事件循环阻塞超过 6 秒后恢复时，旧 solver continuation 可能先于心跳定时器恢复执行。单进程自己发心跳无法在阻塞期间主动撤权，DB ownerGeneration 字段也不能隔离已派发的浏览器输入。

要求：明确队列只串行化短状态迁移和 browser command admission，不能在 actor 队列内等待整个 solver、网络请求或截图；长任务在外执行，结果携带 generation 回入仲裁。所有自动/人工动作在真正派发前检查 owner monotonic lease、epoch、state 与绝对 deadline，延迟恢复先判失效再动作。定义已派发动作的排空/关闭屏障与最长等待；无法确认停止时终止 context，不把“CAS 失败”当作浏览器已停止的证据。列出需要进程外监督的部分或明确采用“阻塞恢复后立即终止、无第二 owner 直到进程退出”的保守策略。补充暂停事件循环 7 秒后恢复的定向验收。

### AR-R1-005 [P1] 导航停流需补截图完成到发送间的二次校验，单靠 pageGeneration 不能阻止帧泄露

位置：方案第 7、10 节。

问题：截图是异步操作：开始时仍为挑战，进行中导航到登录/聊天页，完成时可能得到新页面像素。方案要求导航时禁用截图，但没有明确对在途 screenshot、已编码/待发送帧做失效处理。即使图片标记旧 pageGeneration，敏感内容也已经发到客户端。

证据：`xianyu-browser-port.ts` 当前仅暴露 response/request 类事件，没有导航、popup 或 screenshot 接口；`patchright-verification-browser.ts` 没有已有裁剪流或导航 fencing 的实现可直接依赖。因此这必须是新适配契约，而非已有行为。

要求：每次捕获绑定 pageGeneration、geometryRevision、已确认挑战类型/容器；capture 前与完成后、发送前检查一致性及当前顶层/相关 iframe URL 与可见容器。任一变化即丢弃所有在途/排队图片，递增 frame stream epoch，客户端清空旧画面。明确顶层和子 frame 导航监听、popup/download/dialog 的处理；区域定位失败闭锁。加入“截图进行中导航”“同 origin SPA 替换挑战 DOM”“跨域 iframe 更新”的泄露断言。

### AR-R1-006 [P2] 状态快照与事件订阅仍有可丢事件窗口

位置：方案第 8、9 节。

问题：文案为“WS 重连发送完整 snapshot 再订阅新事件”，与“重连先 GET 完整快照”并存。如果先查快照后才注册订阅，中间已提交事件可能丢失；stateVersion 只能去重，不能自动补上缺失。现有 Redis Pub/Sub 不提供历史回放。

要求：确定单一时序：先注册 owner 事件缓冲→读取 snapshot/high-watermark→发送 snapshot→按 version 顺序冲刷更高事件；或采用持久化事件序号回放并检测 gap 后重取快照。客户端不能因丢失 cancelled/expired 或 auto_active 而继续显示控制成功；每条输入仍按服务端权威拒绝。给出订阅交接期间变更的验收。

### AR-R1-007 [P2] “5000ms 首帧就绪”需要固定在线窗口边界，防止 2 秒与 8 秒累计解释分叉

位置：方案第 5、9 节。

问题：无候选 2 秒，有候选 setup 8 秒，但是 setup 是否从挑战就绪开始还是候选出现时开始不清楚；候选切换、新 reserve、ACK 超时和展示租约到期能否重置也未写明。方案说“不能累加无限等待”可阻止无限延长，但仍会出现约 8 秒或约 10 秒的实现差异，直接影响“人工优先”用户承诺。

要求：给出 readyAt、discoveryDeadline、presentationSetupDeadline、priorityDeadline 的公式，明确 setup 的绝对起点，单会话只可设定一次且 reserve 转移不重置。定义 presentation lease TTL、当前持有人失焦时元数据与画面如何撤回、候补是否可在同一绝对 setup 期限内接续。5 秒边界 CAS 本身已明确，不要求改变其规则。

### AR-R1-008 [P2] 生产回退流程缺少阻止旧自动链先启动的可检查发布门槛

位置：方案第 14 节。

问题：设计正确要求先清理活动控制再回退，但具体由谁证明“无活动 page 控制”、旧进程退出且 profile 锁可取得，以及旧代码启动前如何阻止 worker/owner 自动调度没有确定。现有 profile 锁只跟踪 API PID；浏览器子进程可能仍活着，不能等同该锁不存在即清理完成。旧版本也不认识新表 ownerGeneration。

要求：补充回退的停止调度→拒绝新会话→使所有控制 epoch 失效→排空/关闭 context→确认旧 API 及其浏览器进程退出→再启动旧版的顺序和可观测检查。不能仅靠 feature flag 关闭而同时让旧 solver 启动。确认单 owner 部署没有滚动重叠；若既有 Actions 做滚动更新，需有停机窗口或专门 drain gate。新增表保留的加法迁移策略可以保留。

## 设计复审要求

关闭 AR-R1-001 至 AR-R1-005 后方可认为核心方案可进入实现；AR-R1-006 至 AR-R1-008 应在本次设计定稿中澄清。性能、跨域 iframe、移动端和原浏览器裁剪可用性仍为 **BLOCKED（待 S1 技术验证）**，不是设计文档能证明已可用的能力。允许批准一个带明确 S1 gate 的设计，但不得因此直接开放生产人工控制。

此轮独立审核结果：**FAIL；P0=0，P1=5，P2=3，P3=0。**
