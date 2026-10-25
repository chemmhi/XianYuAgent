# 闲鱼统一验证恢复守卫（2026-10-25）

状态：本地实现与验证 PASS，独立 Agent 最终复审 PASS，待合入。只提交并合入本地 main，不推送、不部署。

现状：Node 24 / TypeScript；`XianyuMtopClient.call` 统一签名、Cookie、错误识别，app.ts 持久化风险并通过 Redis 唤醒 API owner。恢复被绑定在 IM Token 验证上，原接口复验只有商品详情。腾讯生产只读日志确认订单返回 SESSION_EXPIRED、商品详情返回 USER_VALIDATE；滑块成功后仍有浏览器 Token 请求失败，不能宣称生产挑战已恢复。

目标：已登记的只读 MTOP 请求通过统一策略采集恢复上下文，浏览器执行原接口自身的挑战和重试，校验账号，凭证先落库，原接口复验成功后按 episode/revision 清风险。IM 恢复独立；真正会话过期仍需重新登录。写接口、未知接口也独立启动浏览器安全只读探针，不依赖 IM Token 报错；不重放原写请求，不用探针成功清原接口风险。

模块边界：恢复策略负责只读白名单与参数校验；浏览器传输负责原生签名、同会话请求和有界挑战重试；恢复协调负责存储和风险 CAS；业务服务与页面不承担验证码策略。复用迁移 066 的 JSON 上下文，无新表或状态枚举。

验收：订单/商品列表统一采集；IM 正常时原接口独立挑战仍恢复；同账号并发去重；数据库失败/身份不符/挑战未解除不清风险；新风险不能被旧复验清除；写操作不重放；会话失效与验证区分；日志不含 Cookie、Token、sign 或挑战 URL。

验证入口：`npm run typecheck:api`、`npm run build:api`，`node --import tsx --test` 定向回归；真实 Chrome 受控 HTTP + 真实 PostgreSQL 验证跨层入口和持久化。不把受控平台测试当作真实闲鱼平台成功。

回滚：独立 Git 提交可整体 revert；旧 item_detail 上下文继续兼容；无数据库迁移。独立 agent 审核后才提交合并。

## 公共边界与新增接口约定

- `xianyu-verification-response.ts` 为 Node MTOP、浏览器 MTOP、二进制图片上传共享验证判定，覆盖多个 ret、顶层/嵌套验证地址、HTML。会话失效保留重新登录语义。
- `xianyu-verification-request.ts` 集中声明已确认的只读接口。新接口默认也统一识别和触发浏览器；只有需要自动重放原请求时才登记其只读契约、版本和参数边界，不另写验证码处理。
- `xianyu-browser-mtop.ts` 负责 Chrome 同会话签名、Cookie 更新、seller/www 来源、有界挑战重试、身份请求。IM Token 与其他 API 使用同一传输；每个账号仍由现有 owner/profile 锁串行执行。
- `xianyu-verification-read-recovery.ts` 与前置复验均使用缓冲凭证 session、不可变 generation、原子 CAS。风险清除另有 source/episode/revision fence。恢复中的新来源、同源新 revision、最后风险扫描期间的新信号都会补调度。
- QR 扫码是建立账号登录身份的独立入口，保留现有专用状态机；不会把需要扫码的登录过期包装成滑块已恢复。生产 IM 使用服务注入的凭证刷新，底层 IM 客户端无回调的独立库模式不属于应用生产调用链。

## 验证证据

1. 回归基线：在原版 `xianyu-mtop.ts` 上运行最初 5 项入口回归，3 个只读接口丢上下文及非首条 ret 漏识别共 4 项失败；修复后通过。后续增加上传挑战、URL-only、HTML和并发保护用例。
2. `npm run typecheck:api`、`npm run build:api`、`git diff --check` 通过。
3. 完整 `npm run test:api` 退出码 0，四组 Node 测试 264+24+17+40=345 项通过，既有业务 smoke 全部通过。smoke 仅作为附加回归证据。
4. 隔离 PostgreSQL + 真实 Chrome + 真实 Redis 组合：59/59，无 skip。命令如下（变量须指向隔离的本机依赖，数据库必须命名 `xianyu_native_recovery_test`）：

```powershell
$env:NATIVE_RECOVERY_TEST_DATABASE_URL='<isolated-local-postgres-url>'
$env:VERIFICATION_RECOVERY_TEST_REDIS_URL='<isolated-local-redis-url>'
node --import tsx --test apps/api/scripts/xianyu-verification-guard-e2e.test.ts apps/api/scripts/xianyu-verification-read-recovery.test.ts apps/api/scripts/xianyu-verification-risk-recheck.test.ts apps/api/scripts/xianyu-verification-recovery.test.ts
```

其中两条 E2E 从真实登录后的手动 HTTP 同步/刷新入口触发，跨真实应用装配、浏览器原生滑块输入、风险持久化、凭证落库和原 API 复验，再由调用方重试成功并断言 PostgreSQL 商品/订单数据；平台响应受控。首次业务操作仍异步触发恢复并返回需验证，恢复后原业务由调用方重试，不偷偷重放整个业务流程。

5. 原有浏览器原生 IM 恢复 9/9，覆盖平台成功但 URL/Cookie 不变化、签名 Cookie 过期、二次挑战、错误身份、无 Token 和失败保留旧凭证。
6. 独立 Agent `/root/guard_design_review` 设计审核和最终实现复审 PASS，独立构建与 32/32 相关回归通过。R1 同源/最后扫描丢唤醒、R2 浏览器后 CAS 可变基线、R3 上传挑战漏识别、R4 浏览器 HTML 判定、R5 写接口仍依赖 IM 门控、R6 前置复验无 CAS 全部修复并复核关闭。

## 环境阻塞与未覆盖项

无本地验证阻塞。纯后端与浏览器适配变更，无前端布局变化；视觉回归不适用。未使用本次代码写生产凭证、推送或部署，因此不能声称腾讯服务器已恢复。真实闲鱼挑战放行仍需发布后观察。CORS 阻断而无法读取响应、没有安全验证地址或平台持续拒绝时明确失败并保留风险；探针健康不能证明某个写接口健康。旧 item_detail 兼容仅面向历史数据库上下文，无新增迁移。
