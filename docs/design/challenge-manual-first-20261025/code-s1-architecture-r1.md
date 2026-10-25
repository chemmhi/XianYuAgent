# S1 独立架构代码审核 R1

日期：2026-10-26，Asia/Shanghai。

审核范围：`apps/api/src/verification-remote-browser.ts` 初版 149 行，以及 `apps/api/scripts/verification-remote-browser.test.ts` 初版 2 项测试。审核者未编写这两个文件。本次只审 S1 原浏览器截图、输入、跨域 iframe 和导航停流边界；人工窗口已批准改为 30 秒，其协调器不在本轮范围。

**结论：FAIL，S1 不应越过技术门禁。P0=0，P1=3，P2=1。**

本次实际运行了原有窄测试及独立隔离 Chrome 缺陷复现。没有修改实现或现有测试，没有操作生产、登录真实闲鱼或执行真实业务。Chrome 使用持久化临时 profile，全部网页和 `/slide` 都由测试路由提供。

## AR-S1-R1-001 [P1] await admit 期间导航后，旧 frame 输入仍可派发到新业务页面

初版位置：`verification-remote-browser.ts:117`～`:130`。

`pointer` 在 locate 后校验一次 frame/epoch，随后最多三次 await admit。`framenavigated` 虽然递增 streamEpoch 并清 frames，admit 恢复后却不再检查 closed、streamEpoch、geometry 或旧 frame 是否仍登记，就直接 mouse.move/down。admit 只能证明控制权限，不能证明定位结果仍属于当前页面。

独立真实 Chrome 复现：先 capture 挑战帧，在第一次 admit 回调中 await 导航到同 origin `/im`（该 fixture 只有业务内容、无挑战），返回 true。旧 down 调用成功，新 `/im` 页实际收到一次 mousedown：

```json
{"case":"navigation_during_admit","oldFrameAccepted":true,"privatePageDowns":1}
```

这破坏“非挑战页不接受输入”边界，并非仅旧画面显示问题。close 在 admit 期间把 closed 置 true 也有同类竞态。

要求：真正派发每次 mouse 动作之前重新检查 closed、当前 stream/geometry/input 代次与已接纳帧；跨任何可等待外部调用后重新准入，不允许先检查后等网络再使用旧坐标。导航/容器变化必须同步使已排队命令失效。补上 admit 各等待点发生顶层/iframe导航、DOM替换、close 的回归，断言新页面收到零 down/move（必要的安全释放另列）。

## AR-S1-R1-002 [P1] release 不是输入屏障，返回后排队的旧 down 仍会执行

初版位置：`verification-remote-browser.ts:53`、`:112`、`:136`～`:145`。

`pointer` 使用 tail 串行，release 却直接 mouse.up，不使旧输入代次失效，也不与 tail 排序。invalidate 同样只清帧不释放已按下指针。正在等待 admit 的 down 可以在 release 已返回后继续执行，造成孤立按住；导航使旧 up 变成 stale 被拒绝时，也没有适配层主动完成安全释放。

独立真实 Chrome 复现：把第一个 admit 挂在 Promise 上，调用并等待 release 返回，再让 admit 返回 true。结果先 up 后 down，release 返回后实际仍收到新的按下：

```json
{"case":"release_during_pending_admit","releaseReturnedBeforeDown":true,"downs":1,"ups":1}
```

要求：release/close/invalidate 先同步撤销旧 input generation，再通过统一串行屏障排空已派发动作及确认强制 up；屏障完成后旧请求不能再 down。导航、popup/dialog/download 失效也需要可验证的释放策略。关闭/释放不能等一个永不返回的 admit 而无限悬挂；上层 3 秒超时/关闭 context 必须能真正生效。补 queued-down、正在move、导航中up拒绝、重复release/close及admit挂起的回归。

## AR-S1-R1-003 [P1] 负坐标裁剪没有求矩形交集，会截图非挑战像素

初版位置：`verification-remote-browser.ts:65`～`:69`。

当前先把 x/y clamp 到 0，再用原 box.width/height 计算裁剪尺寸。若 challenge 的 box.x=-100,width=320，正确可见范围是 x=0,width=220；代码却返回 x=0,width=320，多抓右侧100px。y<0 同理。这可能因移动端布局、容器偏移、缩放/滚动出现，不要求恶意页面。

独立真实 Chrome fixture：固定挑战容器 left=-100px、width=320，按钮放在其可见部分。capture 确实返回宽320而非安全220：

```json
{"case":"negative_crop","actualWidth":320,"safeVisibleChallengeWidth":220,"extraNonChallengePixels":100}
```

要求：按 left=max(0,box.x)、right=min(viewport.width,box.x+box.width)、width=right-left 求真正交集，y同理；交集过小或不安全则闭锁。相同交集用于截图、帧metadata与输入映射。增加左/上/右/下部分越界、两轴越界、完全越界的真实 Chrome 断言，并验证截图不包含相邻敏感fixture内容。

## AR-S1-R1-004 [P2] 当前两项测试不能证明完整 S1 技术门槛，且“real platform verdict”名称超出证据

位置：`verification-remote-browser.test.ts` 初版两项测试。

第一项由 raw.route 对 `/slide` 固定返回 `{"code":0,"success":true}`；它真实验证 Chrome 原page内跨origin iframe的鼠标事件与请求产生，但没有验证闲鱼平台放行。第二项名为 capture spanning navigation or SPA replacement，实际只在 beforeCapture 替换 DOM；末尾导航到 untrusted 页发生在下一次 capture 之前，没有覆盖截图或发送检查过程中的导航。

本次独立重跑原有命令：

```powershell
node --import tsx --test apps/api/scripts/verification-remote-browser.test.ts
```

结果：2/2通过；受控跨域iframe拖动93ms，截图1542字节。尽管全部通过，前三个缺陷仍可实际复现。

要求：在修复前三项时加入对应失败先验回归；把平台结果明确称为受控协议verdict。S1门禁还应给出触屏/缩放映射、截图进行中顶层/跨域iframe导航、同源替换、发送前失效、敏感像素排除和释放/关闭行为的有效断言。单次93ms不是ACK p95或2会话负载证据；尚未覆盖的技术项保持部分验证，不可把这2项测试当作整体S1完成。无需为本轮跑不相关业务全套测试。

## 复现记录

独立临时复现脚本：`C:/Users/Chenchen/AppData/Local/Temp/s1-architecture-r1-repro.mjs`。

执行命令：

```powershell
node --import tsx C:/Users/Chenchen/AppData/Local/Temp/s1-architecture-r1-repro.mjs
```

三个断言全部通过，断言目标是“上述初版缺陷确实存在”，不是修复验收通过。脚本不属于产品测试套件，不替代实施者补入仓库的回归。复现期间仅创建临时 Chrome profile，关闭 context 后清理；所有请求由受控 route.fulfill 提供，没有平台网络交互或凭证。

初版缺陷已向实施者发送，实施者正在补回归及修复；本报告保留初版事实，不能因后续源文件变化而自动变为PASS。修订后需要独立 R2 复审。

## 验证状态及后续边界

- 模块边界：新受限原page适配类方向合理，截图与输入未掺入数据库/产品业务；但当前依靠强转 Patchright Page 暴露新能力，后续接入应保持专属适配契约。
- 已验证：原2项真实Chrome受控协议测试；3项真实Chrome缺陷复现。
- 被阻塞：S1 因3项P1失败，不应继续宣称已通过。
- 未覆盖：Web真实触控入口、截图内容完整安全验证、传输ACK/2会话性能、完整协调器/凭证CAS/登录及业务恢复；其中S2及以后能力本轮不审。
- 不适用：本轮未修改数据库/HTTP/业务装配，不运行生产或全功能业务E2E。

**最终：FAIL，仅覆盖 S1 初版，不代表整项功能实现或上线审核。**
