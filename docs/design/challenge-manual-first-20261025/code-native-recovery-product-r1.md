# 原生会话保留修复与有限候选方案独立产品/凭证审核 R1

2026-10-26，native_recovery_review。审核仅涉及后端 Cookie/身份/凭证边界以及有限原生候选设计；未读取真实凭证或私有采集档案，未操作真实平台验证码，未部署。独立新增一项反例测试，未修改生产实现。

## 后端修复结论：限定 PASS

检查 xianyu-cookie-jar.ts、xianyu-browser-mtop.ts、xianyu-browser-im-token.ts、xianyu-im-service.ts、xianyu-verification-browser.ts、xianyu-verification-read-recovery.ts 及新增 preservation 测试。

- 恢复传输不再主动删除 x5sectag 等挑战 Cookie；浏览器最终快照不再按 Cookie 名称进行猜测清理。原请求 data/device 保留，挑战后仍重新读取签名 Cookie 并计算 t/sign，handoff 等待仍生效。
- IM 登录身份接口必须显式返回期望 userId，Token 载荷身份不能填补缺失的登录身份。
- 请求隔离会话的精确 Cookie 快照优先保留 domain/path、安全标记及 partition 信息。最终 snapshot 与 Token/device 仍在原凭证快照 CAS 下保存。
- Token 保存不清除 IM 风险；实际 IM 注册及匹配的新鲜心跳、新风险 revision、新登录/撤销与同 generation 的更新快照围栏保留。

审核初轮发现一项 P1：`requestLocalSnapshot ?? latestSnapshot ?? flatHeader` 会把请求隔离层明确置 null 失效的旧 snapshot 从 latest metadata 重新恢复。在真实 XianyuMtopClient 的 createCredentialSession 链路中，较新 raw Cookie、响应 token 轮换和 Cookie jar 失效发生后，浏览器仍收到 stale token/ticket，并丢失新 cookie2。独立文件 `apps/api/scripts/xianyu-native-session-preservation-review.test.ts` 修前实际 **1 FAIL**。作者随后将 request-local metadata 作为唯一权威来源；没有可用 snapshot 时仅从最终 flat header fallback，明确 null 不再回退旧 metadata。独立复验该 P1 已关闭。

## 实际验证

以下命令均从仓库根目录执行，所有测试串行；没有并发启动 Chrome。

```powershell
node --import tsx --test --test-concurrency=1 apps/api/scripts/xianyu-native-session-preservation-review.test.ts apps/api/scripts/xianyu-native-session-preservation.test.ts apps/api/scripts/xianyu-im-native-recovery.test.ts apps/api/scripts/xianyu-verification-read-recovery.test.ts apps/api/scripts/credential-fencing.test.ts apps/api/scripts/xianyu-mtop-cookie-fallback.test.ts
```

最终 **55/55 PASS，0 skip，3.71s**。包括独立反例修后通过、完整原凭证快照 CAS、IM 注册/心跳与迟到回调围栏、读 API 与写操作边界。此前作者 31 项结果之外，本审核独立执行了这些断言。

```powershell
node --import tsx --test --test-concurrency=1 apps/api/scripts/xianyu-post-challenge.test.ts apps/api/scripts/xianyu-browser-im-recovery.test.ts
```

真实 Chrome、受控平台响应、MemoryStore：**14/14 PASS，0 skip，86.19s**。覆盖延迟 fetch/navigation 回调、未完成 handoff 超时清理、签名 Cookie 轮换、code0 不重定向/不换 Cookie、身份错误、Token 缺失、重复挑战和 code300。此轮 Chrome 在最终 null-authority 小修前已启动；相关 Cookie 权威来源修后另以真实 MTOP 会话独立反例及 55 项回归复验。

`npm run typecheck:api` **PASS**。本次没有执行 PostgreSQL 专项或真实平台正向恢复，不据 MemoryStore 与受控外部响应认定生产放行。

## 原生有限候选设计：允许默认关闭实现，尚非实现验收

设计所述平台 SDK addCookieToHeader 只作为有限 x5sec 候选来源。完整签名 URL 只给当前认证/授权的人工控制者，不落库、不广播、不进入持久幂等缓存；前端用当前 iframeWindow 与精确 origin 校验两层 JSON 消息，后端独立校验 host 对 issued origin、有限 value 和毫秒 expiry。这是有依据的候选交接，仍不是已证明跨浏览器恢复。

实施门禁：

1. presentation 4 秒租约、authSession/client、version、generation/epoch 和原 30 秒人工截止须同时校验；独立 HTTP presence 替代图片 WS。前端不再建立截图流。
2. 当前 actor 接纳候选后，先冻结唯一 nativeApplyOperation、进入 settling 并撤控制，再 await 原 BrowserContext 的 host-only x5sec 应用。应用后重新检查权限、owner、generation 与 operation；过期、取消或身份变化不得 resolve 原挑战，超时关闭 context。
3. value 拒绝分号、CR/LF 等 Cookie 注入字符；expiry 按 SDK 毫秒解析为有限值、拒绝过期和超出允许上限，随后正确转为浏览器秒数。不能由客户端选择任意 Cookie 名称、domain/path 或导入完整 Cookie 集合。
4. 已人工接管但超时且结果未知时停止本轮并保留风险，不对同一前端旧挑战接续后台自动。无人接管的后台自动路径仍按既有仲裁与预算运行。
5. 候选接纳仅表示正在复验，不能伪造 slide accepted。持久凭证写入仍须原业务请求重签成功、显式期望身份、凭证 CAS；IM 风险清除仍须匹配注册/心跳。写请求不得自动重放。
6. 必须补跨 authSession/client、iframe 替换、错误 origin、过期租约、30 秒边界、候选应用超时、应用期间新登录/撤权/取消、重复/迟到候选和失败不清风险的行为测试。原生候选与后台自动不得并行修改同一 context。

默认 false 的特性开关满足隔离实施前提。真实验收还必须证明平台确实发出该有限候选，并由同一 backend 原 context/device 重试得到业务成功；只有 iframe 显示、postMessage 或写入 x5sec 都不能代替这条证据。

## 交付范围

功能实现：本审核确认上述后端增量与原有恢复模块边界相容，未新增 P0–P2 未关闭项。测试验证：独立 55 项、串行 Chrome 14 项及 API 类型检查通过。环境阻塞：无。未覆盖项：本轮 PostgreSQL 和真实闲鱼恢复、尚未实现的 native 候选前后端流程。模块拆分：审核只新增独立测试与此报告，未扩大生产修改范围。
