# 聊天页随机刷新（2026-10-24）

## 修改前检查与验收

- 现有架构：TypeScript API 的 `XianyuImService` 按账号维护 IM 客户端；`scheduleCredentialRefresh` 每 600000ms 调用 `refreshSession`，强制通过 HTTP 获取 token 并重新注册。浏览器由 `XianyuVerificationBrowser` / Patchright 适配器管理，已有账号 profile 锁和 Cookie 快照。
- 用户明确选定纯 HTTP 模拟接口请求，取消真实浏览器刷新方案。最新 main 已 fetch 确认与开发基线相同：`2016ca9`。
- 变更边界：独立时段策略模块负责随机计划；独立 HTTP 刷新模块串行调用原生 `/im` 的登录检查和 token 接口；MTOP 适配器沿用签名、Cookie 增量合并、超时与失败处理，并为周期请求提供局部 Cookie 快照；Store 新增条件提交方法，以单次原子操作写入 Cookie/token/deviceId/metadata；IM 服务负责调度、身份核验及客户端凭证更新。健康 WebSocket 不断开，下次重连使用新 token。无页面、公开 API 或数据库结构变更。
- 已有验证：`apps/api/scripts/xianyu-im-credential.test.ts`、`xianyu-verification-browser.test.ts`、`xianyu-browser-im-recovery.test.ts`；命令使用 `node --import tsx --test`，构建使用 `npm --workspace apps/api run build`。
- 验收：取消固定十分钟定时器；按北京时间白天/晚间/深夜随机、串行刷新；跨时段重新计划；禁用或撤销凭证停止刷新；关闭服务取消下一轮并等待在途刷新；token 必须和请求 deviceId、登录身份匹配后才落库；并发人工更新优先；失败不覆盖 token 且继续低频计划；失效按需恢复和现有自动挑战处理保持原逻辑。
- 测试：策略边界与非法输入单测、定时生命周期/并发回归、本地真实 HTTP + WebSocket 与真实 Store 集成验证；自动回复、消息收取、挑战恢复既有回归。平台长期运行与生产验收单独记录，不由本地受控响应代替。此次无 UI 变动，视觉回归不适用。

## 内置浏览器实际观察

用户指定 `https://www.goofish.com/im?spm=a21ybx.home.sidebar.2.20063da6JhqsjZ`。刷新前后均已登录，刷新后会话列表恢复、未选择联系人。未发送消息。

核心 MTOP POST 请求（域名 `h5api.m.goofish.com`）：

| API | 版本 | 用途 |
| --- | --- | --- |
| mtop.taobao.idlemessage.pc.loginuser.get | 1.0 | 登录身份，观察到多次调用 |
| mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get | 1.0 | 页面初始化数据 |
| mtop.idle.web.user.page.nav | 1.0 | 导航 |
| mtop.taobao.idlemessage.pc.redpoint.query | 1.0 | 红点 |
| mtop.taobao.idlemessage.pc.login.token | 1.0 | IM token；请求字段 appKey、deviceId |
| mtop.taobao.idlemessage.face.emoji.load | 1.0 | 表情 |
| mtop.taobao.idlemessage.pc.accs.token | 1.0 | ACCS token |
| mtop.taobao.idlemessage.pc.session.sync | 3.0 | 会话同步 |
| mtop.taobao.idlemessage.pc.user.query | 4.0 | 会话用户资料 |

Token 和 loginuser 响应均为 `SUCCESS::调用成功`。Token 响应字段为 accessToken、accessTokenExpiredTime、refreshToken，观察到 accessTokenExpiredTime 为字符串 `86400000`；这是单次观察，不能推断平台保证永久不变。未保存原始 Cookie、签名、token 或聊天正文。

WebSocket `wss://wss-goofish.dingtalk.com/`：`/reg` 返回 code 200，随后有 `/r/Conversation/listNewestPagination`、`/r/SyncStatus/getState`、`/r/Conversation/listTop`、`/r/SyncStatus/ackDiff`、`/r/Conversation/getByCids`、`/!` 心跳。

还有 alicdn 脚本/样式/头像/字体/提示音、mmstat 埋点及风控脚本。首次事件读取标记 truncated，最早导航事件不完整；核心业务接口与随后 WebSocket 帧已观察，不宣称 HAR 无遗漏。

## 默认节奏

统一使用 Asia/Shanghai（UTC+8），与服务器本地时区无关。09:00–21:00 随机 25–45 分钟；07:00–09:00、21:00–24:00 随机 45–90 分钟；00:00–07:00 随机 90–180 分钟。跨时段边界只重新抽样，不在整点强制刷新。每轮结束后重新计划，失败不触发密集重试。随机节奏用于降低周期请求负载，不保证平台不会要求验证。

旧 `XIANYU_CREDENTIAL_REFRESH_INTERVAL_MS` 不再控制调度。周期流程仅模拟登录身份检查和 IM token 请求，复用现有 MTOP 签名及 Cookie 续期，不启动浏览器。头像、表情、埋点、静态资源和 ACCS 属于页面展示/浏览器侧能力，不为续期额外调用。已有常驻 WebSocket 继续负责消息和会话同步，不在每轮全量拉取会话历史；仅缺少连接时恢复监听。HTTP 风控失败仍经 main 原有回调触发自动挑战恢复；没有修改该回调、浏览器、求解器或冷却策略。

周期请求持有与按需 token 恢复相同的账号单次任务，避免双向并发。Set-Cookie 只修改请求局部快照；结束时 MemoryStore 同步比较写入，PostgreSQL 以单条带条件 UPDATE 提交，失败不回写。原始 credential 的状态、Cookie、token、deviceId、metadata、更新时间、有效期、权限和账号可用性都必须仍匹配，因此在途请求不能覆盖人工更新或复活撤销凭证。PostgreSQL 凭证映射复用已有 dateIso 保留毫秒，条件提交不新增数据库列/索引，无迁移需求；回滚只需回滚代码，不改业务数据。

## 独立审核与修复

首轮独立审核 `/root/independent_review` 为 FAIL，确认两个阻止合并的问题：R1（P1）晚于 MTOP saveCookie 的检查无法保护人工 Cookie 更新和撤销；R2（P2）周期任务只单向避让按需任务。已按上述局部快照+原子提交+共享 token 单次任务修复，并增加使用真实 MTOP 和真实 PostgreSQL 的并发复现测试。

最终独立复审：**PASS，可合并**；R1/R2 VERIFIED/CLOSED，无新增阻止合并问题。Reviewer 独立重跑标准测试在 MemoryStore + PostgreSQL 下 27/27 通过，独立复跑原真实 MTOP 缺陷复现，并核对既有挑战恢复调用链、存储失败保护和 diff-check。用户已明确授权独立审核通过后合入 main 并推送，无需再次等待合并确认。

## 验证记录

实际执行（全部退出码 0，无 skip/cancel/todo）：

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 新刷新流程/并发/持久化 | 设置仅本地临时数据库 `CHAT_REFRESH_TEST_DATABASE_URL` 后 `npm --workspace apps/api run test:xianyu-chat-refresh` | 27/27，MemoryStore + PostgreSQL；含真实 HTTP/WebSocket、实际应用装配和 Store，平台响应及模型发送使用受控夹具 |
| 自动回复单元回归 | `npm --workspace apps/api run test:auto-reply:unit` | 236/236 |
| 既有应用自动回复链路 | `node --import tsx --test apps/api/scripts/auto-reply-e2e.test.ts` | 12/12；含生产监听回调、inbox聚合/人工接管、商品和通用回复；无真实外发 |
| 会话/消息/挑战定向回归 | 下列完整文件清单的 `node --import tsx --test` | 122/122；含真实 Chrome 受控挑战夹具；随后新增恢复/存储失败场景另在上述27项验证 |
| API 编译 | `npm --workspace apps/api run build` | PASS |
| Cookie jar 回归 | `node apps/api/scripts/xianyu-cookie-jar-smoke.mjs` | PASS；仅补充检查，不冒称E2E |
| 差异规范 | `git diff --check` | PASS |

会话回归完整清单：`xianyu-chat-refresh.test.ts`、`xianyu-chat-refresh-integration.test.ts`、`xianyu-chat-refresh-concurrency.test.ts`、`xianyu-im-credential.test.ts`、`xianyu-im-native-recovery.test.ts`、`xianyu-browser-im-recovery.test.ts`、`xianyu-verification-recovery.test.ts`、`xianyu-listener-startup.test.ts`、`xianyu-im-gateway.test.ts`、`xianyu-im-read.test.ts`、`xianyu-verification-browser.test.ts`、`xianyu-qr-verification-browser.test.ts`、`xianyu-browser-identity.test.ts`、`xianyu-slider-ydisks.test.ts`、`xianyu-slider-solver.test.ts`、`xianyu-verification-url.test.ts`、`xianyu-mtop-cookie-fallback.test.ts`、`xianyu-account-health.test.ts`、`credential-service.test.ts`、`xianyu-cookie-login-update.test.ts`、`account-login-recovery.test.ts`，全部位于 `apps/api/scripts/`。

PostgreSQL 使用本地临时 `postgres:17-alpine` 容器和独立 `xianyu_chat_refresh_test` 数据库，已全量应用既有迁移；测试代码强制限定 loopback 与数据库名，未接触开发/生产库。可使用相同临时库设置变量后复现。日志保存在 worktree 忽略目录 `artifacts/chat-refresh/`。

验证过程暴露并修复：首轮新单测人工更新失败；PostgreSQL 夹具账号全局唯一约束冲突；真实 PostgreSQL 凭证映射丢毫秒导致 CAS 不命中。最终均已复跑通过。没有通过 skip 或放宽业务断言处理失败。

**未覆盖/不适用**：真实平台长期保活和生产新挑战未执行，不能由本地夹具推断生产验收完成；前端/视觉无修改，视觉回归不适用；数据库无 schema 变更，无迁移回滚需求。周期调度、请求快照和原子存储分别位于独立模块/适配器，原浏览器求解、即时挑战触发和自动回复业务代码不变。

用户要求独立 Agent 审核通过后才合并 main 并推送 GitHub；推送 main 会触发仓库既有自动发布。没有直接 SSH 操作或导入内置浏览器凭证。
