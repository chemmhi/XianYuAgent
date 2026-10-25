# 逐星智能生产会话核验（2026-10-25，含状态反复与时间更正）

## 结论

**2026-10-25 16:11:01 +08:00 的最新只读核验显示：账号再次需要验证，持续恢复尚未达成。** 账号状态为 `verification_required`，传输为 `disconnected`，`transportFresh=false`；最近心跳为 `2026-10-25T15:17:36.394465+08:00`。风险码为 `ACCOUNT_VALIDATION_REQUIRED`，来源为 `im_listener`，凭证状态仍为 `active`。凭证 active 和服务健康不能替代真实连接结果。

同轮生产 Git SHA 为 `591ce9682752eea267a504a542182d269c141852`，`healthz` 和 `readyz` 返回成功。目标账号的运行日志包含恢复失败及 `ACCOUNT_VALIDATION_REQUIRED`、`XIANYU_BROWSER_IM_REQUEST_FAILED`，未据此宣称新的真实挑战成功。本轮只读核验没有触发新的挑战、刷新 Token 或写回凭证。

以下是历史时点记录，不能作为最新状态。本次验收目标是生产账号“逐星智能”恢复正常。2026-10-25 **03:37:50 +08:00**（Asia/Shanghai）对腾讯云生产 PostgreSQL 只读核验得到：

- 账号 UUID：`1d274de5-38b8-4c9b-83ed-d8ba803685ac`
- 账号状态：`connected`
- IM 传输状态：`connected`
- 风险码/风险来源：均为 `null`
- 凭证状态：`active`
- 核验 SQL 使用 `BEGIN READ ONLY`，没有修改生产数据库。

生产代码 SHA 为 `f9fe016dc34bfd3ff7f66a2f77200654f4cf9ba4`，API 与 Worker 健康检查通过。GitHub Actions 部署记录：[40114281356](https://github.com/chemmhi/XianYuAgent/actions/runs/40114281356)。

## 本次正式链路

当前 main 中已将实验结论收敛为正式服务链路，相关实现按提交顺序包括：

- `800fc2d`：接入 Ydisks 滑块适配和 Patchright 持久化浏览器；保留实际 Chrome 身份，验证结果必须继续经过业务 Token/登录检查。
- `aaf11ff`：将同一浏览器会话取得的 IM Token、设备标识和 Cookie 快照写入正式凭证存储，并拒绝账号或设备身份不匹配。
- `22aec7a`：MTOP 刷新时保留原生 Cookie 快照及其分区属性。
- `2016ca9`：账号出现验证风险时立即调度恢复，避免只等待后续业务请求。
- `f9fe016`：只有凭证成功落库、身份校验成功且风险版本仍匹配时才核销对应风险；新的并发风险会保留。

流程顺序是：

1. 服务端发现平台验证要求，记录账号范围、风险来源、episode 和 revision。
2. Patchright 使用目标账号的持久化 profile，在合法闲鱼页面上下文中发起原生 Token 请求。
3. 若返回挑战，浏览器内执行已集成的 Ydisks 适配器；平台 verdict 不是唯一成功条件。
4. 同一个浏览器会话重新请求 Token，并校验 accessToken、deviceId 和目标 userId 一致。
5. 完整 Cookie 快照与 Token 通过正式 store 落库；写入失败时保留旧凭证，不清除风险。
6. 原始业务检查成功后，按风险来源、episode、revision 和开始时间核销对应风险；IM 注册仍需真实 connected 才清除连接风险。
7. 失败、超时、身份不匹配、Cookie 未变化、Token 缺失和数据库写入失败都会保留风险，并产生可查询事件。

## 接口与参数记录口径

历史已采集的请求、响应、浏览器事件、设备标识、Cookie 属性、浏览器环境和参数正文保存在本地忽略目录，不提交到 Git。覆盖范围以完整性清单和采集缺口为准，不表示每一次生产恢复都已有完整记录：

`F:\ChenHai\Project\XianYuAgent\artifacts\slider-recording\20261024-ydisks-local`

最终生产发布的过程记录位于：

`F:\ChenHai\Project\XianYuAgent\artifacts\slider-recording\20261024-session-cookie-fix`

已有记录与核验应关联以下字段；具体缺失项以各阶段记录为准：

- 平台 Token 请求的 API、版本、请求时间、设备标识、请求体/响应关联和 Set-Cookie 变化；
- 同一浏览器 profile 的 Cookie 快照、domain/path/secure/httpOnly/sameSite/partitionKey 及跨站祖先标记；
- 账号和 owner 范围、目标 userId、风险 source/episode/revision、凭证落库结果；
- IM WebSocket 注册 URL、mid、设备标识、注册响应、连接状态和断开状态；
- 浏览器版本、操作系统、启动模式、profile 路径、UA/CH 环境和运行时版本；
- 输入、阶段输出、错误、超时和最终业务判断。

原始值仅保留在本地开发证据目录。Git 提交不包含 Cookie、Token、密码、生产数据库内容或 profile 数据。

## 测试与部署证据

当前 main 的相关测试覆盖：

- Ydisks 轨迹/浏览器适配及 verdict 处理；
- 原生浏览器 Token 恢复、账号/设备身份校验和 Cookie 快照落库；
- 内存与隔离 PostgreSQL 风险 revision/CAS、写入失败保护和并发新风险保护；
- MTOP Cookie 增量合并、分区 Cookie、IM 注册和监听器恢复。

生产部署流程仍是：本地修改和测试 → GitHub main → GitHub Actions → 服务器拉取同一 SHA → 统一部署脚本 → healthz/readyz → 账号只读状态核验。本轮复核没有修改服务器源码、导入实验凭证或直接改生产状态；这不是对全部其他历史操作的审计结论。

## 长期限制

历史正常状态仅证明那些观察时点的数据库与连接状态；最新复核已经发现状态反复。平台挑战、Cookie 有效期和远端风控具有时效性。后续仍必须核验业务 Token、登录身份、IM connected、心跳新鲜度、凭证状态和风险状态，不能只看 HTTP 200、页面跳转或单次滑块 verdict。状态快照也不能单独证明一次新的自动挑战已经完整执行成功。

## 文档提交后的再次核验

- 文档提交 `b5744923911ae0a213c86af388667595825f4c03` 已由 GitHub Actions 运行 [40126486116](https://github.com/chemmhi/XianYuAgent/actions/runs/40126486116) 成功部署。该提交只改变文档和永久记忆入口，未改变服务算法或凭证数据。
- 2026-10-25 **03:45:09 +08:00**（Asia/Shanghai）服务器 Git SHA 为 `b5744923911ae0a213c86af388667595825f4c03`，`healthz` 与 `readyz` 均返回成功。
- 同时段生产只读核验仍为：`逐星智能` `status=connected`、`transport=connected`、`credentialStatus=active`、`riskCode=null`、`riskSource=null`。

## 时间更正与最新证据位置

此前文档及回复将已包含 `+08:00` 的服务器时间再次增加八小时，错误写成 11:37、11:45、11:49。正确历史时间分别为 03:37:50、03:45:09、03:49:39，均为 2026-10-25 的上海时间。原始返回值保持不变。

本轮原始日志、SQL、命令输入和只读结果保存在本地忽略目录 `artifacts/slider-recording/20261025-status-correction/`。旧封存目录不修改。本轮不增加求解算法、轨迹参数或自动挑战执行步骤；没有重新执行历史测试，也不将历史测试结果当作本轮生产验收。
