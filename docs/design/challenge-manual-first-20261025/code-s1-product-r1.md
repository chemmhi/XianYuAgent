# S1 原浏览器远程交互：独立产品代码审核 R1

日期：2026-10-26（Asia/Shanghai）。
范围：`apps/api/src/verification-remote-browser.ts` 与 `apps/api/scripts/verification-remote-browser.test.ts`。人工窗口按用户最新要求为 30 秒；S1 尚不实现协调器和前端，不能因缺少 S2/S3 模块而判缺陷。

本次使用 ai-software-engineering-standards 的证据要求进行审核，未修改实现或测试文件、未操作生产，只创建本审核记录。检查重点为原 page 真实鼠标、归一化坐标、准入回调、失焦/释放以及测试证据边界。

## 结论

**FAIL。** 存在 3 项需修复的实现问题：2 项 P1、1 项 P2。它们均在 S1 新 adapter 内可独立复现，无需等待协调器或前端存在。原 page/跨域 iframe 的基本拖动路径真实可用，但当前 adapter 还不足以作为后续唯一受限输入通道。

## 已执行验证

1. 在 `apps/api` 执行：`node --import tsx --test scripts/verification-remote-browser.test.ts`。
   - 2/2 通过，0 skip、0 todo。
   - 本次 drag evidence：elapsedMs=98，bytes=1542。
   - 这是本地真实 Chrome + 受控路由/页面的集成测试；挑战判定由测试 HTML 的鼠标处理及 route.fulfill 生成，不是闲鱼真实生产放行。
2. 使用同一 Chrome factory、独立临时 profile 和受控路由，经 `node --import tsx --input-type=module` stdin 执行 3 个附加定向探针；未创建项目测试文件。全部浏览器与临时 profile 在 finally 中清理。
   - 释放竞态：`{"case":"release-during-admission","events":"up,down,"}`。
   - 导航竞态：`{"case":"navigate-during-admission","events":"down,","pointerAccepted":true}`。
   - 左侧裁剪：`{"case":"left-clipped","expectedVisibleRightEdge":240,"actualFrameWidth":320}`。
3. 未重复 API typecheck；主 Agent 报告其已通过，本审核不把转述计入本人执行结果。

## PR-S1-001 — P1：异步准入期间导航后，旧帧鼠标仍发送到新的非挑战页面

位置：`verification-remote-browser.ts:117`–130，重点为 locate/epoch 检查只在第一次 admit 之前进行。

### 复现与观察

- 在受控 `/punish` 上取得 frame，调用 pointer(down)。
- 第一次异步 admit 中导航到同 origin 的 `/im`；此页仅含普通 private page 文本，没有挑战容器。
- 导航事件会运行 invalidate()，但 admit 返回 true 后后续代码不重新检查 streamEpoch、frame 是否仍在 frames、closed 或当前挑战位置，只重复询问业务 admit。
- pointer 成功返回，新的 `/im` document 收到真实 mousedown；DOM 事件为 `down,`。

这不是缺少前端权限检查：即便该账号的人工作业权限仍有效，旧挑战帧也不允许在业务页面继续产生输入。adapter 自己掌握 streamEpoch 和 frames，必须在实际 dispatch 时使用它们，而不能要求未来 admit 调用者猜测其私有状态。

### 修复要求

在每次真实 mouse move/down/up 派发前，重新验证该 operation 捕获的 adapter 输入 generation/streamEpoch、closed、frame/geometry 及页面仍处受限挑战区域。异步 admit 或 page.mouse 等待返回后同样重检，发生导航/失效即取消旧输入并进行安全释放，不在新页面执行历史 down。释放类 mouse-up 应走明确安全清理路径，不因普通输入拒绝而遗留按下状态。

### 回归验收

真实 Chrome 中分别让导航发生于第一次 admit、第二次 admit，以及 move 与 down 之间；导航目标无挑战，断言旧 pointer 拒绝且新页面零 down/click。另覆盖同 origin SPA 更换容器和关闭 adapter，不以“调用了 admit”作为足够断言。

## PR-S1-002 — P1：release() 不是输入屏障，返回后旧 down 仍能重新按下

位置：`verification-remote-browser.ts:112`–138。pointer 进入 tail 队列，但 release() 独立直接发送 up，既不使在途/排队输入失效，也不排空它们。

### 复现与观察

- 启动 pointer(down)，让第一次 admit 在 Promise gate 上等待。
- await remote.release()，模拟本地 pointercancel、失焦或拖动取消；此时本地人工控制权可以仍有效，不能依赖撤销整个人工会话解决取消手势。
- 打开 gate，所有 admit 返回 true。
- 旧 pointer 随后执行 down，真实页面事件顺序是 `up,down,`，释放返回后再次遗留按下状态。

后续协调器需要一个可确认的输入释放边界；现有 release 契约无法提供它。权限仍有效的本地取消也会触发，因此不宜仅要求调用者把 admit 永久改为 false。

### 修复要求

release 调用起始就同步使之前在途/队列中的指针 operation 失效，结合串行清理或输入 generation 确认它们不会在 release 返回后派发旧 down。支持之后的全新手势，避免用永久关闭 30 秒人工会话代替取消当前手势。与 close/导航共用清晰的失效和清理路径，给调用者一个可 await 的屏障。

### 回归验收

覆盖 admit 等待期间 release、排队的 down/move/up、两次并发 release、down 已发送后的失焦、release 后新手势。断言释放完成后所有旧 operation 无新 down，远端无按住状态，随后新手势仍可正常操作。若下层 mouse-up 失败，需要明确向调用者报告以便关闭 context，不能误报已释放。

## PR-S1-003 — P2：挑战部分位于视口左侧/上侧时，截图延伸到挑战外区域

位置：`verification-remote-browser.ts:67`–71 的 geometry 计算。

当前先把 x/y 截断到 0，再以原 box.width/height 截宽高，未减去在视口外的左/上部分。例如挑战 box 为 x=-80、width=320，真实可见右边界是 240；当前得到 x=0、width=320，额外传出 x=240–320 的挑战外像素。上侧同理。测试中的 private 文本位于 x=245，可落入这段多余截图。

### 修复要求

按矩形交集计算：left=max(0,box.x)、right=min(viewport.width,box.x+box.width)，width=right-left；top/bottom 同理。对空、太小及无法安全表示的区域拒绝传输。归一化输入必须对应这个真实截取区域，不能把未裁剪 box 的尺寸继续用于坐标映射。

### 回归验收

真实 Chrome 覆盖 left/top/right/bottom、角落和完全越界的挑战，旁边放置可识别的私有内容。断言精确裁剪尺寸，且截图像素区域不含相邻内容；同时对裁剪后的可见滑块进行真实鼠标点击/拖动断言。仅测试正常居中容器不足以覆盖该边界。

## 测试真实性与未覆盖项

- 当前跨域 iframe 测试确实通过原 Chrome page 的真实 mouse down/move/up 触发了页面 fetch，优于 fake mouse 调用断言；它证明基本浏览器交互链，不证明平台实际接受人工作答。
- 现有第二个测试覆盖 SPA 更换为无容器后 capture 拒绝和未知 origin 不传帧；没有真正制造“截图进行中导航”，测试名称中的 navigation 目前超过其实际断言范围。建议修复上述问题时补真实导航回归，并将 real platform verdict 统一表述为 controlled verdict，避免后续交付误读。
- 98ms/主 Agent 的 164ms 都是单次本地测试时长，不是网络条件下 ACK p95、帧延迟 p95 或 2 会话负载证据。
- 本轮没有声称验证前端缩放/letterbox、触屏映射、WSS、manage 鉴权、30 秒窗口、持久化协调、真实业务复验；这些属于后续切片。但 S1 应留足受限坐标和可确认释放的契约，以上三项必须先修复。

## 模块与门禁建议

生产变更目前集中为受限浏览器 adapter，未混入控制台、数据库、业务风险或自动求解仲裁，边界合理。admit 作为 owner 授权/lease 检查注入点也合理，但不能替代 adapter 私有 generation、原 page 和输入取消边界。

修复 PR-S1-001 至 PR-S1-003，并加入上述真实 Chrome 回归后交独立复审。S1 PASS 才能进入后续协调器/前端切片；当前不能报告“远程人工验证已完成”或“已可上线”。
