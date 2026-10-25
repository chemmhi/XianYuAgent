# 滑块通过后的恢复失败排查（2026-10-25）

状态：本地修复、组合复验与两轮独立审核 PASS；功能 `5fa0c15` 已在merge lock内合入main `9ef00d6`，合并后构建及102项Chrome/PG/Redis恢复复验通过。用户随后明确要求“这一步需要推送”，授权本次推送并由既定 Actions 发布；生产真实挑战恢复未验收。

修改前检查：Node 24 / TypeScript / node:test；公共浏览器传输位于 xianyu-browser-mtop.ts，滑块与生命周期在 xianyu-verification-browser.ts，旧实现由 xianyu-browser-im-token.ts 独立负责。最近 bc480a2 抽出公共传输，额外在每次调用前准备页面。现有 Chrome 夹具涵盖平台 verdict、Cookie 轮换与 URL 不变，但没有可靠模拟真实挑战页面的异步跳转和回调。

生产现象：新版本详情 API 多轮 code=0 后约1秒报 ERROR；IM code=0 后重取 Token 返回 SESSION_EXPIRED。旧版本 591ce968 在 16:11 的只读核验也已失败，不能把所有登录态失效归因于此次重构。

职责与验收：保留统一守卫；在浏览器会话准备/挑战后业务复验模块定位并修复回归，添加能在当前实现失败的真实 Chrome 测试，验证 Cookie/身份/凭证持久化与风险。导航失败应给出脱敏阶段码，不输出 URL、Cookie、Token 或 sign。真实平台诊断仅执行只读接口，不重放写操作，不写生产凭证。

验证入口：API 类型/构建、node --import tsx --test 相关浏览器/恢复用例；必要时使用独立本机 PostgreSQL。具体根因、独立复审、门禁结果和回滚提交随实际证据更新。

## 原因与历史归因

1. **可复现的公共浏览器缺陷**：滑块协议 code=0 早于挑战页异步 fetch/跳转完成。旧公共 transport 随即 goto robots.txt，并清除临时挑战 Cookie，可能中断会话交换。真实 Chrome 受控回归在旧码分别报 `XIANYU_BROWSER_MTOP_SESSION_EXPIRED` 和 `page.goto net::ERR_ABORTED`；会话只由延迟的 finish 回调发放，因此不是提前塞 Cookie 的假成功。
2. 旧 `591ce968` IM 已有滑块通过后立即跳转的时序隐患；`bc480a2` 将其复用于通用只读 API，又在每次身份复验前准备页面，扩大了暴露范围。不能据此说所有生产 Session 过期都是最近改动造成。
3. **确认的新回归**：`bc480a2` 在 IM 前 await 全部 read 恢复，一处异常中断整个账号任务；首个 source 异常也中断后续 read。新增回归先证明后续 read 未执行、IM refresh 次数为0，修复为来源隔离；新登录/撤销及凭证CAS拒绝仍终止过期任务。详情见 [隔离切片证据](recovery-source-isolation-20261025.md)。
4. 生产日志只能证明 code=0 后业务复验失败，旧版通用 ERROR 没有阶段/栈，无法逐条反推确切异常。本次两次隔离只读诊断分别使用临时 profile、生产 profile 的临时副本，均遇到平台 code=300，未进入 code=0 后阶段；后者限制一次滑块尝试即停止。临时副本已删除，无生产凭证写回。**受控复现与生产症状一致，尚不能证明生产每次失败的唯一根因。**

## 公共修复与安全边界

- 新 `xianyu-browser-challenge-handoff.ts` 在 solver 前监听 document/XHR/fetch；通过后等待文档、在途请求和短静默窗口完成，最长10秒。quiet 只允许开始业务复验，绝不单凭它认定恢复；超时保留风险。
- 相同 origin 复验不再强制导航；需要切换 www/seller 时先完成回调再导航，临时挑战 Cookie 也在交接后清理。IM Token、只读 API 和身份复验共用同一 transport，不加入某个商品或订单的特殊分支。
- 导航、签名 Cookie、初始 Cookie 与交接超时产生静态阶段错误；read 隔离层仅保留已分类异常，不输出原始浏览器消息、签名URL或 Cookie。未知原始错误继续脱敏。
- 一处 read 异常不阻断其他 read/IM；来源失败或预检异常时整体 pending。凭证及风险 CAS、原始只读白名单、写请求不重放保持强制约束。无 schema、新依赖或前端改动。

## 验证与独立审核

本地独立 PostgreSQL 容器 `xianyu-post-challenge-test-20261025` 端口55439，数据库 `xianyu_native_recovery_test`；Redis复用专用测试实例DB14，不清空无关数据。平台响应由受控 HTTP/Chrome route 提供，不能替代真实闲鱼放行。

- `npm run test:xianyu-post-challenge --workspace apps/api`：5/5，含真实Chrome异步fetch/跳转、10秒超时、监听释放、静态脱敏。
- `NATIVE_RECOVERY_TEST_DATABASE_URL=<隔离库> npm run test:xianyu-verification-guard:e2e --workspace apps/api`：9/9。两条完整 HTTP手动商品同步/订单刷新，经真实slider、延迟回调、身份、PG凭证/风险核销，用户再次请求后PG商品/订单内容正确；其余7条拒绝/账号/HTML边界。没有修改页面，未重新执行前端视觉验收。
- 组合 Memory/真实PG/Redis 恢复、凭证、守卫与启动测试：97/97，无skip。命令为 node --import tsx --test，文件包括 verification-read-recovery、verification-risk-recheck、verification-recovery、verification-guard-entry、im-credential、im-native-recovery、listener-startup。
- 原 IM Chrome/Memory 9/9；强化异步会话交换后的 IM Chrome/PG 9/9；最终组合 `npm test --workspace apps/api` 352/352（264+24+17+47）及全部既有smoke通过，无skip。API TypeScript构建通过。
- 独立 reviewer `/root/guard_design_review` 两轮均 PASS，无P0-P2。首轮实际重跑构建与5项新回归，最终组合再独立执行构建、26项handoff/read恢复/安全边界测试及暂存/未暂存diff-check，确认来源隔离和typed阶段错误。
- 合并后 `npm run build --workspace apps/api` 及97项恢复+5项handoff合计102/102通过，无skip。feature rebase前后tree一致，三条历史消息对象由独立reviewer逐字节核验PASS。

## GitHub Actions 中文乱码

检查 `git cat-file commit` 的原始消息：`a257752` 和 `2513d98` 存储内容本身已乱码，按 GB18030 编回字节再以UTF-8解码，分别可还原为“merge(登记): 同步验收更正合入记录”和“docs(登记): 记录验收更正主线合入”。`136b2d5` 按文档变更语义恢复为“merge(验收): 合入生产状态与时区更正”。同图 `10b9980` 原始中文正常。问题在提交消息编码链路，不是 GitHub 字体、服务运行日志或部署失败；乱码来自其他登记/验收文档提交，无业务代码差异。

用户在看到影响说明后明确选择“本地和远程历史一起修复，允许强制更新main”。保留本地 `refs/backup/xianyu-post-challenge-20261025/main`，仅更正三条标题及必要parent SHA，逐字节核验author/committer/时间和tree不变：`136b2d5→d9fde2a`，`2513d98→dfb848b`，`a257752→08813b6`。最终使用显式旧SHA的force-with-lease，拒绝覆盖其他人的新推送。服务端仅在干净、旧HEAD匹配、修正基线tree完全相同的条件下衔接Git引用，业务文件仍由Actions快进部署。旧Actions运行记录可能保留原始标题快照，不删除历史运行。本修复提交通过UTF-8文件交给 `git commit -F`，提交后再读原始消息核验。

## 回滚与交付限制

本切片整体代码可 Git revert，无数据库回滚。生产仅由GitHub既定流程发布；用户在组合验证和审核后追加授权推送。部署后仍需观察真实code0/业务复验/持久化/风险与心跳，不以服务健康、受控测试或历史一次成功代替。
