# 评价自动化隐藏开关修复（2026-10-25）

当前状态：隐藏开关、幂等恢复和本地测试失配已修复；同步本地 main 05fc2d7 后最终独立组合审核 PASS，无未关闭 P0/P1/P2。相关本地验证通过，准备合入本地 main；不推送、未部署、未执行真实闲鱼写入。下方首轮记录为历史，最新结论见后续追加及最终组合验收。

## 目标与范围

平台已开启评价赠品或求评价时，生产运行不再受 `PRODUCT_AUTOMATION_REVIEW_EXTERNAL_WRITES_CONFIRMED` 的缺省值或遗留 false 值阻断。商品规则启用状态、通用 live 模式/确认/买家限制、账号/商品/买家/会话归属和可信评价事件判断继续生效。

首轮切片只修复隐藏开关；用户随后追加了幂等恢复和本地测试问题，范围变更见后续章节。始终未更改生产商品存量配置、登录态或数据库结构，不能据此声称生产全部自动化恢复。

## 功能实现与模块边界

- 配置层：删除独立评价确认字段及环境变量解析；既有服务器环境变量可以保留，无需数据迁移。
- 应用装配与触发器：删除独立评价门禁，四类商品自动化共用原有 live 条件；不更改执行适配器、存储或前端。
- 配置示例与契约：删除生产配置项；真实单订单测试脚本仍在自身入口要求评价动作确认，仅约束手工测试运行。
- 测试：沿用 Node test runner 和现有测试目录；扩展真实 HTTP 保存配置到 createApp 实际装配的验证，只替换 MTOP/IM 外部传输方法，保留真实触发器、工作流、执行适配器、审计和隔离 MemoryStore。

## 测试验证

修复前，新回归在“未设置”和“false”两种配置下分别复现赠品触发被阻断；单元与应用集成共 4 项失败。修复后原有与新增断言通过。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck:api` | 通过 |
| `npm --workspace apps/api run test:product-automation` | API 构建、API smoke、68 项单元/模块回归通过，无跳过 |
| `node --import tsx --test apps/api/scripts/product-automation-full-e2e.test.ts` | 2 项实际应用装配集成通过；HTTP 保存/读取四类规则，四类执行结果与赠品评价事实、求评计数持久化均有断言 |
| IM 未付款触发、订单观察、MTOP 自动化专项 | 与应用集成合计 16 项通过，无跳过 |
| 卡券交付扩展集成 `product-automation-coupon-delivery-e2e.test.ts` | 20 项中 1 通过、19 失败；未修改的主工作区同样 1/19，错误为测试替身缺少 `fetchOrderCandidates`；属于既有失败，未删测试或修改业务判断使其通过 |
| `git diff --check` | 通过 |

## 环境阻塞与未覆盖项

外部闲鱼接口使用确定性替身，本记录为应用集成验证，不能替代真实闲鱼操作验收。没有发送真实消息、赠品或执行真实改价。没有前端、存储实现或数据库结构变更，UI/视觉和迁移测试不适用；不以 HTTP 200 或 smoke 替代行为断言。

扩展卡券套件存在上述基线失败，完整功能验证据此只能标记为部分验证。独立审核须核对其与本次改动的关系，不得忽略或宣称全量通过。

已知的执行账本 `IDEMPOTENCY_CONFLICT`、生产规则关闭及账号 Session 过期仍是独立问题，本切片不解决；交付不得表述为全部自动化已恢复。

## 审核与回滚

用户要求先独立 Agent 审核，再提交。独立审核人：本聊天子 Agent /root/review_automation_gate，采用只读审核，未编辑或提交代码。

- 最终结论：本切片 PASS，无新增 P0/P1/P2；完整功能仍部分验证。
- 完整功能审查：付款发货、未付款改价路径保持；商品开关、通用 live 条件、买家限制、可信评价事件、账号/会话归属、适配器、幂等和重试保护保留；生产遗留环境变量可保留，无配置 API 或持久化格式变更。
- 工程审查：沿用原配置/装配/触发器边界，无无关重构；真实应用装配验证只替换外部传输，未用测试手工装配绕过生产配置。
- 独立执行：workflow、trigger、live-gate、xianyu-adapter、reminder-worker、order-worker、full-e2e 七文件共 70/70 通过；API typecheck 与 diff-check 通过。
- 独立基线复核：扩展卡券套件在本 worktree 和未修改主工作区均为 1 通过、19 失败，确认是相同既有缺失测试替身方法。
- R1-P3-001：契约文档仍称评价外部写入默认单独阻断，与本切片矛盾。OPEN → FIXING → READY_FOR_REVIEW → VERIFIED → CLOSED：主 Agent 修正文案，独立 reviewer 已复核关闭。
- 审核限制：未执行真实闲鱼写入或 PostgreSQL 全量回归；已有账本冲突、规则关闭、Session 过期不归因于本切片，也不宣称已解决。

本次为小范围后端配置/触发条件修复，复用已有模块与测试，采用窄切片工程流程；不启动前后端平台重设计、UI 重制或数据库迁移。

回滚以本切片 Git 提交为单位；无数据库迁移。回滚会重新启用旧隐藏开关，旧配置值将再次生效；回滚不能撤回已发送的外部消息或赠品。本次未操作生产，也未执行真实外部写入。


## 用户追加：修复本地问题并一起合入本地 main

用户后续要求一并修复本地发现的问题，重新独立审核后合入本地 main，禁止推送远程。以下记录更新首轮“未处理幂等冲突/卡券基线失败”的范围与结论；生产规则状态和远端登录态不属于本地代码修复，未操作生产。

### 实现与边界

- 求评指纹删除轮询时钟；规则关闭/未到期预检查不写入执行账本。旧时钟指纹对应的成功记录直接复用，避免升级后重复发送。
- 新增共享 execution-policy 模块，只把 rule_disabled / not_due_or_capped 两类无外部写入的 skipped 结果认定为可重新判断；内存账本、MemoryStore 与 PostgreSQL 统一采用该策略，旧跳过次数不消耗真实执行重试预算。
- PostgreSQL 以条件 UPDATE 原子领取，仍限制执行状态、原因、指纹及租约；成功、人工复核、不可重试的未知结果和其他跳过均不能借恢复路径重新执行。无表结构或数据迁移，无生产历史数据批量修改。
- 卡券套件补充 fetchOrderCandidates 和按订单号读取的详情替身。旧测试要求“订单事实不可用仍确认发货”“不确定发送盲目重发”与现行适配器/发送账本规则冲突，改为断言人工复核、保留记录、不重复消息或图片；未放松生产校验。固定文字/批量数据延迟继续在赠品链路验证，付款延迟由既有 PaymentEventWorker due-time 用例覆盖。
- 将修好的扩展卡券/订单观察/真实应用装配用例加入正式 test:product-automation 命令，另增显式本地专用数据库命令 test:product-automation:recovery:postgres。

### 复现与验证

- 8 项新增幂等回归在修复前全部失败，修复后全部通过。
- npm --workspace apps/api run test:product-automation：API 构建、配置 API smoke、101/101 测试通过，包含原失败卡券20/20，无跳过。
- payment-event-worker / xianyu-im-unpaid-reprice / xianyu-mtop-automation / product-sync-automation 四文件39/39通过；含付款延迟及到期恢复、事件关联、商品身份稳定性。
- 新建本地隔离 PostgreSQL 容器 xianyu-automation-recovery-20261025，127.0.0.1:55438，数据库 automation_recovery_test；应用全部仓库迁移后，恢复/并发/旧成功记录/终态/租约5/5通过，原 product-automation-postgres-smoke 通过。未使用其他任务或生产数据库。
- 更广的完整 API npm --workspace apps/api run test 已通过，覆盖单元、服务和所有串行 smoke。期间发现的凭证6项旧fixture缺失已修复：CredentialService测试使用真实MemoryStore，IM验证4项补充风险查询；原断言保留，独立16/16通过。auto-reply-smoke显式配置零等待、模板和模拟发送，解决原本继承产品默认300秒延迟造成的长等待，生产默认值未改；独立复核通过。
- 新PG测试文件额外通过严格TypeScript检查。
- 未访问真实闲鱼写接口；MTOP/IM 使用确定性替身。当前为后端工作流与持久化修复，前端界面和结构未改，不新增视觉验收；不是生产真实账号恢复验收。

### 独立审核

第二轮独立审核 PASS，无新增 P0/P1/P2。独立 reviewer 实跑自动化101/101、PG恢复5/5，并对三种账本补做过期接管、旧owner拒绝、续租、失败重试、成功去重及变更指纹拒绝验证。卡券断言更新、凭证测试夹具维护和自动回复测试显式模拟配置均分别独立审核通过。最新main合入后仍需最终组合复审；不推送远程。

### 回滚

回滚追加修复提交即可恢复旧执行策略，无迁移回滚。回滚后旧跳过指纹冲突可能重现；已发送消息不可撤回，因此不删除已成功或不确定记录。测试数据库仅为隔离验证资源，与生产无关。


## 最终组合验收

- 基线：同步本地 main 05fc2d7，组合提交 a15f2d1。四处冲突按语义合并：存储 imports 保留双方能力；凭证测试使用真实MemoryStore满足主线身份fence；IM测试保留主线风险/降级方法。未覆盖主线账号删除、身份或迁移保护。
- R3-P1-001：独立审核发现新恢复PG fixture不符合主线069生成账号外键。已改成真实创建隔离admin/account，finally只清理本测试key/账号/管理员；独立重跑5/5且检查0条残留、FK仍存在。状态 OPEN → FIXING → READY_FOR_REVIEW → VERIFIED → CLOSED。
- 最终独立审核 /root/review_automation_gate：PASS，无未关闭P0/P1/P2。独立101项自动化、16项凭证、18项账号硬删除/Redis/fence、5项PG恢复通过；兼容性和工程边界复核通过。
- 主Agent组合验收：完整API npm test退出0，包含264+24+17项测试及全部串行smoke；商品自动化101/101、关联39/39、PG恢复5/5、原PGsmoke、账号硬删除18/18通过。API/Web类型检查和Web生产构建通过。测试之外仍不声称真实闲鱼写入或生产登录态已恢复。
- 用户明确要求：只合入本地main，不推送远程。主工作区原有未提交登记行必须保留，禁止纳入本次业务提交或覆盖。

专用PG恢复用例运行入口：设置 AUTOMATION_RECOVERY_TEST_DATABASE_URL 指向本地专用 automation_recovery_test（本次127.0.0.1:55438），应用 apps/api/scripts/migrate.mjs 的全部迁移后执行 npm --workspace apps/api run test:product-automation:recovery:postgres。测试会拒绝非本地或非专用库名称。临时PG/Redis测试容器在验收后清理。
