# 23Star/Ydisks 自动挑战与账号恢复验证

当前状态：`PENDING_PRODUCTION_WRITE`。已找到自动完成挑战并取得可用凭证的路径，腾讯云临时进程使用生产现有 IM 客户端注册成功；生产数据库中的旧凭证及历史风控状态尚未写回，不能宣称生产控制台已经恢复。

## 实际通过的路径

1. 在本地隔离 Linux 环境使用目标账号的完整历史备份及生产 profile 副本，全程原始记录；生产只读。
2. 使用 `23Star/xianyu-super-butler` 提交 `2490eb849738539e5dc1c07444084f4b54b03287` 的轨迹、准备动作、距离计算和 `simulate_slide` 原始 Python AST 生成计划，经既有 Patchright 执行；未运行其完整业务应用。
3. 由浏览器原生网络发起 Token 请求，取得该浏览器会话的新挑战，直接在同一 profile 中执行上游动作。首次实际拖动的 `/slide` 返回 `code=0`。
4. 属性观测在控件失效后卡住，保留 profile 并停止任务容器。随后复用该持久化 profile，原生 Token 获取和登录态检查均成功，返回的真实 `userId=1903703477`。
5. 腾讯云只读临时进程导入生产 `dist/xianyu-im.js` 的 `XianyuImClient`，用这份新 Token 注册，真实响应 `code=200`，客户端 `connected`。临时进程随后断开；没有写业务数据库或生产 profile。

没有扫码、人工拖动或导入人工通过后的 `x5sec`。历史输入使用人工介入前的完整凭证，原生恢复阶段清除了本地旧挑战凭证，重新取得当前挑战。

## 不能混淆的结果

早期轨迹出现多个 `300`，也有多个 `0`；其中 `code=0` 后仍可能无法取得业务 Token。分区 Cookie 的实际可见性、客户端与浏览器之间的状态迁移、跨域同名 Cookie 混合、观测开销及失效元素等待均影响了诊断。仅凭 `code=0`、新 `x5sec` 或页面跳走不足以验收账号恢复。

服务端现有 HTTP Token 请求仍返回验证要求。当前可连接的 Token 来自原生浏览器；后续续期仍需要该路径，未验证长期稳定性，也未将该诊断流程部署为生产续期能力。

## 本地修复及验证

- Cookie 类型、Set-Cookie 转换和验证浏览器保留 Chromium 的 `_crHasCrossSiteAncestor`。转发回归先失败后通过；同站与跨站分区的 Cookie-jar 检查通过。
- 29 项相关 API 回归、API 编译通过。
- 记录器、轨迹回放、失败恢复、跨域同名 Cookie 合并及失效元素超时有独立测试；本地无网络 Chrome 测量记录开销，并验证分区标记改变页面 Cookie 可见性。
- 新增逻辑位于 `scripts/slider-recording/ydisks-*`；上游规划、浏览器执行、原生请求、服务器只读探针、归档和写回准备各自独立。

未执行生产写回、代码部署、合并和全量业务前端 E2E；这些不能由诊断或夹具通过替代。

## 原始证据与待写回内容

本地原始目录：`F:\ChenHai\Project\XianYuAgent\artifacts\slider-recording\20261024-ydisks-local`。

- `same-browser-native-recovery/native-judgment-1.json`：自动真实挑战的 `code=0`。
- `same-browser-ticket-check/account-verdict.json`、`account-check-token.json`、`account-check-login.json`：原生业务恢复结果。
- `server-existing-client-readonly.stdout.log`：腾讯云生产客户端真实注册、响应和连接状态；包含原始协议值。
- `production-writeback-plan.json`、`credential-put-body.json`、`rollback-account-snapshot.json`：仅目标账号的待执行写回、实际请求参数及原始备份。
- `request-response-index.ndjson`、`interface-inventory.json`：实际接口、参数、请求响应、WebSocket、输入事件及原始正文位置。
- 各场景的输入、计划、DOM、指纹、截图、HAR/trace、profile 归档、命令环境及源码版本；原始值保存在本地忽略目录。
- `capture-gaps.json`：正文缺失、被中断观测、早期启动器版本及远端不可冻结状态等缺口。

保留了源码、运行时及依赖归档，但不能保证未来平台风控和时效性挑战返回相同结果。部分观测曾被中断，不作完整逐字节重放承诺。

下一步需要更新目标账号的凭证，并在真实生产监听器连接后按既有健康状态规则核销对应旧风险。用户此前明确要求“绝不能动生产环境本地数据”，因此待用户解除这一步限制后才能执行。账户状态不能通过直接伪造 `transport_status=connected` 完成验收。
