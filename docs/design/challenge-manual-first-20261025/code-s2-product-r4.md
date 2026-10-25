# S2 协调器：独立产品代码复审 R4

日期：2026-10-26（Asia/Shanghai）。
范围：仅复核 R3 新增 PR-S2-006 的并发启动容量修订，确认现有 18 项 coordinator 回归。R1、R2、R3 记录保持不改；人工窗口仍为 30 秒。未修改实现、未操作生产，凭证/IM 并行修订仍不在本结论内。

## 结论

**PASS（S2 协调器产品行为范围）。** PR-S2-006 已 **VERIFIED/CLOSED**。结合前轮复验，本审核者提出的 PR-S2-001～006 均已关闭，可继续后续切片。

该结论不是完整功能完成或生产发布通过；S3/S4 正式接口、页面、QR、真实浏览器和业务恢复链仍需实现后独立总审。

## 实际验证

在 `F:/ChenHai/Project/XianYuAgent/apps/api` 执行：

`node --import tsx --test scripts/verification-coordinator.test.ts`

结果：**18/18 PASS，0 fail、0 skip、0 todo**，约 2.10 秒。最新一项用挂起授权 Promise 同时启动 3 个不同 subject，第三个返回 BUSY；前两个授权失败后能够重新启动，证明容量预留可归还。

另重跑 R3 原三并发探针，使用内存 repository、真实异步 coordinator 方法和独立随机账号，exit 0：

```json
{"case":"three-simultaneous-solves-fixed","activeSessionCount":2,"rejected":["VERIFICATION_BUSY"]}
```

R3 同一探针修订前 activeSessionCount=3；修订后前两个进入活动状态，第三个拒绝，没有通过“全部拒绝”规避容量问题。探针在 finally 关闭全部测试会话，没有创建项目测试文件。

## PR-S2-006 关闭依据

- solve 在完成 owner start 后，先检查 closing、已有 pending subject 和 active subject。
- `active + closing + pendingStarts` 统一参与上限 2 的判断。
- 在第一次异步 authorize/create 前，同步把 subject 写入 pendingStarts；并发任务因此能看见尚未进入 active 的名额。
- 授权/创建步骤处于 try/finally，失败会归还预留；runtime 建立后再归还 pending，由 active 接续计数。
- await 整个恢复结果放在 finally 之外，不让同一个活动任务长期重复占用 active 和 pending 两个名额。
- 源码检查、项目第 18 项回归以及独立原反例重跑三者一致，满足该编号的修复要求。

## 保留的交付边界

1. 前轮 3 秒重连、自动答案 settling、输入释放屏障、manual_only 模式竞争与展示租约条件均在本次 18 项全量窄测中继续通过。
2. S2 closingSubjects 对受控关闭 Promise 的屏障已验证；真实 profile 锁、浏览器进程退出证明及部署 drain 仍要在最终装配验证，不能把内存 active 计数当真实 Chrome 清理证据。
3. 当前状态测试的 browser port 是受控替身；原 page 网络观察、正式控制台 5 秒/30 秒、WSS、manage 撤销、凭证/风险 CAS、IM 心跳、慢网和并发性能仍须后续跨层证据。
4. 最终 shutdown/drain 还应覆盖正在授权/创建中的 pending start，并禁止关闭后重新接纳新请求；该项列入 S4/发布装配验收，不属于本 R4 唯一容量问题的扩大审核。

本轮可签署 S2 协调器产品范围 PASS；完整功能的独立审核尚未进行，生产未操作。
