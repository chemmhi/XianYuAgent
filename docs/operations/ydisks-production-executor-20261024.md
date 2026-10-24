# Ydisks 正式执行器接入（2026-10-24）

本次在本地 main 接入已验证的 Ydisks 算法及完整原生恢复流程，随后删除旧物理抖动生成器。生产环境上次检查运行 aaf11ff；本文记录不代表新的生产部署。

## 断点与修复

- 生产 15:35 的实际执行仍使用旧轨迹，三次后 verification_timeout。原生 Token 恢复和数据库保存分支尚未执行。
- 新执行器保持固定上游 2490eb849738539e5dc1c07444084f4b54b03287 的轨迹、页面准备、测距、确认和归位重试契约；TypeScript 逐点匹配独立运行 Python 得到的参考。
- IM 在同一浏览器中取得自己的挑战，保留分区 Cookie。签名 Cookie 过期时允许原生补发；补发后若产生新的账号挑战，继续处理，最多两种不同挑战，重复挑战直接失败。
- 自动浏览器沿用成功实验的原生窗口及 UA；开发/生产 Xvfb 配套 1920×1080。显式 headless/UA 配置优先。
- 新 Token、完整 Cookie 快照和设备 ID 原子保存，保存失败传播；经业务身份验证且落库后只核销 Token API 来源的风险。IM 风险仍等待实际注册。
- 日志新增脱敏平台返回码。code=300 即使 success=true 仍为拒绝；控制元素确认和响应读取有明确超时。

## 真实验证证据

以下为北京时间，生产数据只读；浏览器使用资料副本、腾讯云 SSH SOCKS 出口与本地 Linux 镜像，凭证保存到隔离 PostgreSQL。

- 16:00 首次接入测试收到三次真实 code=300，失败记录保留。
- 16:04 的原生挑战获得 code=0，但随后因签名 Cookie 补发而产生第二次挑战，未作为恢复成功。
- 16:07:56–16:08:14，原生挑战、业务 Token、身份校验及 PostgreSQL 保存/独立读回成功；Token API 风险核销正确。
- 16:09:58–16:10:16，使用修改后的正式浏览器适配器，再次获得真实 code=0、业务 Token、数据库读回及风险核销成功。
- 恢复凭证交给腾讯云临时进程中的生产 XianyuImClient，实际注册结果 registered=true、status=connected、identityMatches=true；随后主动断开，未写生产数据库或处理业务消息。

原始 HAR、资料副本、成功和失败日志保存在本地忽略目录 `artifacts/ydisks-production-integration-20261024/`。目录包含敏感凭证，不提交或公开正文。生产 profile 归档时根目录发生变化并由 tar 报告，保留该限制；测试实际读取的是隔离副本，后续以真实新挑战、业务 Token 和注册结果验收。

## 可重复回归

```powershell
npm run build:api
npm --workspace apps/api run test:xianyu-slider
npm --workspace apps/api run test:xianyu-im-credentials
node --test scripts/verification-container-config.test.mjs scripts/dev-verification-config.test.mjs
```

浏览器专项包含真实 Chrome 的受控挑战、受信鼠标事件、确认事件、过期签名 Cookie 补发、二次挑战、code=300、账号不匹配及保存后读回。设置 `NATIVE_RECOVERY_TEST_DATABASE_URL` 为本地 `xianyu_native_recovery_test` 数据库可验证真实 PostgreSQL；该入口拒绝其他库名和远程主机。

已执行结果：API 编译通过；滑块专项 17/17、凭证专项 27/27（真实 Chrome + 隔离 PostgreSQL）、登录/Cookie/验证浏览器相关回归 31/31、容器与开发配置检查 7/7，均无跳过。`git diff --check` 通过。没有执行完整业务前端 E2E 或发布后的常驻生产服务验收。

不承诺之后每次挑战均通过。新代码尚未发布；生产常驻服务的恢复必须在发布后另行核验，不直接修改账号状态或导入实验凭证作为上线结果。
