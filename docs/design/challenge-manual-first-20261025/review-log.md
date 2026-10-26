# 独立审核记录

## 2026-10-26 中间态 v0.9 与原生直接呈现

本轮独立架构/数据流由native_direct_display_review审查：先提出presentation版本、同步claim防重、迟到grant可见性及丢响应重载原version/deadline要求；主Agent修订后复审限定PASS，审核者实际运行原生浏览器17/17。新增两视口持续越界永久用例后再只读复审PASS，确认同iframe/Document、续租、截止与零取消/结果/图流的断言有效，未另跑Chrome，19项及完整580由主Agent执行。

独立视觉/流程由verification_intermediate_visual_review审查：实际查看14张中间态及2张原生画面，540px、居中内容、页脚、完整原生画面与正常屏无滚动限定PASS。VIS-09-001/P2：他页控制说明误指“当前页面”，状态OPEN→FIXING→READY_FOR_REVIEW；修订为“请等待其他页面完成验证，结果会自动同步。”，刷新桌面/手机截图后审核者复看确认VERIFIED/CLOSED。其余无P0–P2。

审核范围不包括真实平台对8778的原因、后台自动成功率或整体S3完成。真实两段新Chrome轨迹由主Agent采集，审核者只核对台账一致性，没有冒称独立读取私有凭证。原始报告、调试图与轨迹不入Git，正式结论并入本记录。

以下保留早期设计审核记录，不代表当前仍未编码。

当前：两位独立审核者均完成两轮，proposal v0.2最终设计PASS，可交用户审核。审核者不参与方案起草或修改proposal。

计划：业务/交互与架构/安全两个独立视角，随后对最终修订版进行复审。记录问题编号、级别、证据、修订、复审结果；P0–P2必须经审核者确认后关闭。设计审核不等于代码或生产验收。

第一轮原文：review-product-r1.md（FAIL，2 P1/4 P2）及review-architecture-r1.md（FAIL，5 P1/3 P2）。全部问题由主Agent修订；第二轮原文review-product-r2.md与review-architecture-r2.md均为PASS，逐项确认VERIFIED/CLOSED，不由起草者自行关闭。

| 问题 | 级别 | v0.2修订与验收映射 | 当前状态 |
| --- | --- | --- | --- |
| PR-R1-001 | P1 | §6 settling/10秒结果屏障、3秒动作释放屏障；T16 | VERIFIED/CLOSED，产品R2 |
| PR-R1-002 | P1 | §4部分完成UI、§9结果分层、§11来源结果与业务证据核销契约；T17 | VERIFIED/CLOSED，产品R2 |
| PR-R1-003 | P2 | §4 ACK前手势结束/位移/300ms阈值/不重放；T18 | VERIFIED/CLOSED，产品R2 |
| PR-R1-004 | P2 | §5绝对截止、4秒展示租约/2秒续租/候选与多账号取舍，§15用户决策；T19 | VERIFIED/CLOSED，产品R2 |
| PR-R1-005 | P2 | §4.1 QR响应字段迁移、原Panel复用、关闭/取消/轮询语义；T20 | VERIFIED/CLOSED，产品R2 |
| PR-R1-006 | P2 | §4.1 retry(mode=manual_only)、各活动/终态分支、预约确认；T21 | VERIFIED/CLOSED，产品R2 |
| AR-R1-001 | P1 | §2更正当前代码事实、§8.1账号generation权威与分模式全入口提交fence；T22 | VERIFIED/CLOSED，架构R2 |
| AR-R1-002 | P1 | §8.2双阶段rebind、身份锁、账号claim、双QR冲突与profile释放；T23 | VERIFIED/CLOSED，架构R2 |
| AR-R1-003 | P1 | §8.3稳定flow/admin/account预算交集、session/gesture事务预留与crash扣次；T24 | VERIFIED/CLOSED，架构R2 |
| AR-R1-004 | P1 | §6短actor+动作实际派发检查、§8 lease过期与保守owner停止；T25 | VERIFIED/CLOSED，架构R2 |
| AR-R1-005 | P1 | §7三次帧校验/streamEpoch/导航与SPA/iframe/在途帧清理；T26 | VERIFIED/CLOSED，架构R2 |
| AR-R1-006 | P2 | §8先缓冲订阅再snapshot/highWatermark、eventSequence；§9同version事件；T27 | VERIFIED/CLOSED，架构R2 |
| AR-R1-007 | P2 | §5 readyAt+2秒/+8秒/ACK+5秒公式、转移不重置；T19 | VERIFIED/CLOSED，架构R2 |
| AR-R1-008 | P2 | §14统一部署drain门槛与PID/context/锁验证，禁止新旧owner重叠；T28 | VERIFIED/CLOSED，架构R2 |

未执行实现测试；上表T编号是未来必须验证的验收要求，不能表述为测试通过。

架构R2收尾澄清同样经审核者确认：普通refresh不要求verification会话；需要IM注册/心跳证据的来源在取得证据后才核销。产品R2与架构R2都明确S1运行能力未验证，允许带S1硬门槛的设计交用户审核。当前无待关闭P0–P2设计问题，用户尚未审核，不进入编码。
