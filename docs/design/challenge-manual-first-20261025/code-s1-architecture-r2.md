# S1 独立架构代码复审 R2

日期：2026-10-26，Asia/Shanghai。

对象：修订后的 `apps/api/src/verification-remote-browser.ts`（175行）、`apps/api/scripts/verification-remote-browser.test.ts`（6项Chrome测试），以及 `implementation.md` 的 S1/S2职责边界。R1报告保持不变。审核者未修改实现或既有测试。

**结论：PASS（仅 S1 适配层技术门禁）。AR-S1-R1-001～004 在本轮限定范围内 VERIFIED/CLOSED；没有阻止该适配层继续进入 S2 的开放 P0–P2。**

此结论不表示全功能完成、真实闲鱼放行、3秒owner故障清理、WS性能或生产发布已通过。人工30秒窗口由后续coordinator实现，本轮不审其正确性。

## R1逐项复核

| 问题 | 修订与复核证据 | 结果 |
| --- | --- | --- |
| AR-S1-R1-001 P1：admit等待中导航后旧输入派发 | pointer入队时捕获inputGeneration；每次check在admit前后验证closed/input/stream/geometry/frame与新鲜度，授权后重新locate核对身份；实际mouse.move及down/up前再次valid。导航立即递增stream/input代次，旧队列不能继续。Chrome新增回归在第二次admit中导航，旧输入被拒绝且新页面downs=0；close等待期间同样拒绝旧down。 | VERIFIED/CLOSED（S1） |
| AR-S1-R1-002 P1：release返回后排队down | release同步递增inputGeneration再把强制up放入同一tail；invalidate也递增inputGeneration，pressed时排队release；close先closed/invalidate再release。queued down在阻塞admit恢复后被拒绝，release/close不再允许旧代次按下。pointer异常时已有pressed会执行releaseNow，失败闭锁。Chrome回归直接断言release/close与排队down时新页面downs保持0。无限admit的清理时限另见下方明确边界，未被本轮测试冒充解决。 | VERIFIED/CLOSED（S1输入失效与串行屏障） |
| AR-S1-R1-003 P1：负坐标多截非挑战像素 | locate改为矩形真实交集，width=min(box.x+box.width,viewport.width)-max(0,box.x)，height同理。Chrome断言左/上部分越界220×40、右侧50×50、下侧100×30和完全越界不截帧。另通过真实JPEG解码读取挑战最右侧像素为绿色，未抓入相邻magenta区域，直接覆盖R1的隐私泄露复现。 | VERIFIED/CLOSED（S1） |
| AR-S1-R1-004 P2：测试证据不足/平台命名过度 | 第一项改为controlled protocol verdict；新增top与跨origin iframe在capture操作中的导航丢帧、发送前失效、admit等待中导航、release/close排队down、四边/完全越界、真实hasTouch操作页缩放映射以及JPEG像素断言。原SPA替换/未知origin拒绝保留。微基准与端到端WS性能已明确分开。 | VERIFIED/CLOSED（S1） |

本轮代码确实通过当前frame检查与每次派发前代次检查修复原缺陷；没有只修改断言或绕过失败分支。

## 实际执行

以下命令由本审核者实际独立运行：

```powershell
node --import tsx --test apps/api/scripts/verification-remote-browser.test.ts
npm run typecheck:api
```

结果：Chrome 6/6通过，0失败、0跳过；API typecheck退出码0。Chrome约8.12秒，跨origin原page拖动本次252ms、图片1542字节。

触屏测试使用另一个真正hasTouch的Chrome页面展示缩放JPEG，通过可信pointer事件调用原page适配层，并断言原page收到trusted mouse down且落在约108–109px的映射位置及正常up。它证明S1映射可行，未证明未来正式Web Panel的触控交互已经完成。

所有平台页面、iframe和slide响应均为route.fulfill受控内容。code=0是fixture协议结果，不能推导为闲鱼风控放行。没有生产凭证、真实登录或业务请求。

实施者报告“新增导航回归在初版Missing expected rejection先失败”；本审核者R1已独立复现相同初版漏洞，本轮独立确认修订回归通过。没有再次切回旧代码或修改共享实现。

## 必须保留到后续切片的边界

`implementation.md`已明确：如果外部admit永不返回，adapter.release/close本身仍可能等待tail，没有独立3秒超时。本轮新测试会主动unblock，不能证明无限挂起时故障清理。

这按模块边界由S2 owner/coordinator承担，且必须成为继续实施的硬门槛：

- owner独立race 3秒绝对deadline，不能只await remote.close/release；超时直接关闭原BrowserContext。
- 旧代次始终保持失效；未确认context关闭时，不能运行任何新人工/自动执行器。
- 必须注入永不返回的admit，实际断言3秒deadline后的context关闭、旧输入不再派发及无自动旁路。

上述是尚未完成的S2故障验收，不是由S1 PASS消除的风险。未来完整代码审核必须再次核验这项，不能把本报告作为3秒清理已通过的证据。

同样，Web→鉴权WS→owner的传输ACK p95、双会话负载、权限撤销、背压、全量生命周期、凭证CAS和风险证据都属于S2–S5。252ms是单次原page动作微基准，不是传输ACK p95；本轮没有以此宣称最终性能达标。

## 完成口径

- S1功能：受限原page裁剪、跨域iframe鼠标映射、触屏缩放可行性、导航/替换/发送前frame fencing及串行输入失效已验证。
- 模块边界：remote adapter只处理原page与输入，coordinator负责控制权/超时/故障终结，分层明确。
- 测试：6项真实Chrome受控协议集成与API typecheck已独立通过。
- 环境阻塞：本轮窄验证没有环境阻塞；没有连接生产。
- 未覆盖：3秒无限admit故障清理、正式Web/WS/PG业务链、平台放行和生产验收。

**最终：S1适配层 PASS；允许进入S2，禁止据此宣称整项功能已完成或可以上线。**
