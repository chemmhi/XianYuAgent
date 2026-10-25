# 独立架构复审 R2

审核对象：`proposal.md` v0.2 最终修订稿（2026-10-25）。审核者与 R1 相同，未参与方案起草或直接修改 proposal。R1 原文保持不变。

**整体结论：PASS（设计通过，可提交用户审核）。** R1 的 8 项问题均在设计层面 VERIFIED/CLOSED；当前没有开放的 P0–P2 架构问题。此结论不表示实现、真实浏览器能力、平台挑战通过率或生产发布已验证。

本轮仅读取设计及本地既有代码/部署脚本、创建本审核文件；没有编码、连接生产或运行实现测试。

## R1 逐项复核

| 问题 | 复核依据与结论 | 状态 |
| --- | --- | --- |
| AR-R1-001 P1：generation 与实际提交链 | §2明确 IM native 的 upsert 与 QR credentials.save 尚未受完整保护；§8.1以账号 credential_generation 为权威，列出全部凭证更新入口，改用按 mode 校验的统一提交；recovery 要求活动会话/owner/claim，login/import 有独立 reservation，normal_refresh 只有原业务权限+generation/快照CAS且不能绕过排他写占用；revoke/mark_verified不能复活旧凭证。§11最终链已明确适用 IM 注册/心跳在对应风险核销之前。T22直接覆盖旧回调与新登录/导入/撤销并发及保存后连接失败。 | VERIFIED/CLOSED（设计） |
| AR-R1-002 P1：QR 临时主体归并 | §8.2新增身份事务锁、创建者 active manage 校验、跨 subject 的 account claim、A/B 两阶段 rebind。A 只取得 reservation/递增 generation/使旧恢复失效，锁外完成旧 context 关闭；B 重检期限/授权/关闭证明再绑定与提交。两临时 QR 同账号冲突、删除/撤权穿插、临时 profile 关闭后正式 IM 启动均有规则；不迁移活动 page 或复制 profile。T23覆盖。 | VERIFIED/CLOSED（设计） |
| AR-R1-003 P1：预算键与扣次时点 | §8.3使用稳定 loginFlowId 与 admin bucket，身份明确后叠加 account bucket，按更严格额度限制；session/gesture均执行前同事务预留，attemptId唯一，crash/结果未知照计消耗且不重放，窗口和保留期明确。QR刷新及新 flow 不再能直接重置预算。T24覆盖。 | VERIFIED/CLOSED（设计） |
| AR-R1-004 P1：actor 阻塞与 owner 恢复执行 | §6短 actor 不等待长 solver/截图/网络任务，长结果带 generation 回入；每次真实鼠标动作派发检查 lease/epoch/state/绝对期限。§8明确成功持久化心跳才更新最长6秒lease，暂停7秒恢复的第一条continuation也不能派发；3秒排空/关闭不能确认时必须停止 owner 并确认浏览器子进程退出，无第二 owner 抢跑。T25及T28覆盖。 | VERIFIED/CLOSED（设计） |
| AR-R1-005 P1：在途帧泄露 | §7新增 capture前、完成后、发送前三次校验，绑定 page/stream/geometry/container及允许URL；顶层、iframe、同源 SPA 挑战替换均使 streamEpoch 失效，丢弃在途/排队帧并清客户端画面。无法验证容器则停流；popup/download/dialog有受限规则，明确属于新适配契约。T26覆盖。 | VERIFIED/CLOSED（设计） |
| AR-R1-006 P2：snapshot/订阅窗口 | §8固定先注册缓冲→读snapshot/highWatermark→发snapshot→冲刷更高sequence→live；持久化events与状态同事务、列表有独立cursor，gap/溢出重新握手。§9明确同stateVersion事件按eventSequence消费，GET不再冒充订阅屏障。T27覆盖。 | VERIFIED/CLOSED（设计） |
| AR-R1-007 P2：2/8/5秒绝对边界 | §5明确 readyAt+2秒发现、readyAt+8秒准备、firstValidAckAt+5秒优先，均受expiresAt约束；reserve/候选切换不重置。展示TTL4秒/2秒续约、前台顶层Panel条件、候选排序及多账号繁忙取舍均已明确。T19覆盖。 | VERIFIED/CLOSED（设计） |
| AR-R1-008 P2：生产回退drain | §14明确暂停调度→拒绝新任务→失效控制/流→排空/关闭→持久化终结报告→确认旧API/浏览器子进程退出→确认profile无活跃占用→切换→启动唯一owner与调度。检查项不再只看锁文件，失败不启动旧自动旁路，不允许滚动重叠。T28覆盖。 | VERIFIED/CLOSED（设计） |

## 代码事实复核

下述均为当前代码事实，不是新能力已实现：

- `apps/api/src/xianyu-im-service.ts:773`、`:783`、`:795` 等仍直接调用 upsertCredential；`apps/api/src/app.ts:366` 的 QR 回调仍调用 credentials.save。
- `apps/api/src/store-postgres.ts:2111` 已有基于凭证快照的 commitCredentialRefresh，当前没有本方案账号 generation；`:237` 的 hasAccountScope 不区分 manage。
- `apps/api/src/xianyu-verification-read-recovery.ts:42`、`:56` 调用既有 CAS；本方案需扩展为统一 generation fence。
- `scripts/deploy-production.sh:232` 先停止 api/worker，`:241` 后执行迁移，符合方案关于既有部署顺序的描述；现有脚本并无新设计的验证会话 drain 检查，仍需要未来实现与演练。

§2与§8.1已明确区分上述现状和拟议修改，没有把现有CAS方法或profile锁误当成完整保护。

## 新增交互规则的架构一致性

复核产品修订后，没有新增需要阻止本设计通过的架构冲突：

- settling不重新授予控制，明确成功优先handoff；未知结果不自动猜测重试，与owner fencing一致。
- manual_only是服务端意图，未明确交系统则不会因超时/断网偷偷运行自动；活动自动attempt仍在安全边界切换，不与互斥冲突。
- claim ACK前up/cancel/失焦不注入down、无历史轨迹重放；迟到ACK不会产生孤立按下。
- QR只传verification会话引用并使用同一Panel，关闭与取消分离；实际顶层可见才ACK，避免被原扫码modal遮住时提前计时。
- executionOutcome、accountHealth、sourceResults分层，completed_partial不等于账号恢复，写操作安全探针不能核销原写来源。
- 多账号展示繁忙允许在绝对8秒截止后自动，已列为用户需批准的产品取舍，不再隐藏在内部排队规则中。

复审过程中要求补充的两处澄清已读取最终文案确认：§11改正IM核销顺序；§8.1明确普通刷新不能被迫创建verification会话，且仍必须受generation/快照与排他写屏障约束。两项均已闭合，未另留开放项。

## 后续必须保留的门槛

S1的原会话截图、跨域iframe容器定位、移动端触控、低延迟交互及导航停流能力仍为 **BLOCKED（尚无实现与实测证据）**，这不是本次设计通过能消除的限制。用户批准后也只能进入按切片实施，不能直接宣称人工控制可用或开放生产。

S2–S5仍须实际证明统一凭证写入口无旁路、PG并发和预算、owner故障、帧泄露、业务证据核销、回退drain及真实平台恢复。文中的T01–T28是未来验收要求，当前没有任何一项被本次设计审核标为“测试已通过”。

最终状态：**设计 PASS；AR-R1-001～008 全部 CLOSED；实现/平台/生产验收未执行。**
