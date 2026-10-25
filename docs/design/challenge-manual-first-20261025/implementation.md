# 人工优先挑战实施记录

2026-10-26：用户批准按方案实施，将人工窗口改为30秒，要求代码完成后独立Agent审核。授权本地编码与测试，不包含部署。

## 修改前检查

- 架构：TypeScript/Node24，API为唯一浏览器与IM owner，worker经Redis/RPC唤醒；React/Vite前端，PG持久化，Patchright独立port。
- 生产文件：xianyu-verification-browser、browser-port、patchright适配、im-service、qr-login、read-recovery、store-postgres、app装配；Web App/账号/QR。
- 测试：apps/api/scripts的post-challenge、im-credentials、verification-recovery、guard-e2e；Web Vitest及Chrome E2E。
- 命令：npm run typecheck/build；npm --workspace apps/api run test:xianyu-post-challenge / test:xianyu-im-credentials / test:xianyu-verification-guard:e2e；npm --workspace apps/web test。
- 模块边界：remote-browser只负责原page截帧/输入与导航fence；coordinator负责状态/租约/时限；repository负责PG事务/预算；transport负责鉴权与WS；Web独立model/controller/Panel。
- 验收：5秒优先、30秒独占人工、结果settling、无双控、code0后真实业务证据、凭证与风险CAS、所有入口、撤权/删除/QR生命周期、图像不泄露、持久化重启和预算。
- 初始工作树：只有上一轮未跟踪设计文档，无代码改动。

## S1 技术门禁

输入：已批准v0.3；目标：原Patchright页面截帧、跨域iframe、鼠标/触控映射与导航停流。
输出：远程适配器与真实Chrome测试、性能证据、独立审核；禁止生产连接/凭证。
状态：实施中。S1通过审核后再接入协调器/业务链。

S1实际验证：API typecheck通过，6项真实Chrome受控协议集成通过；跨域iframe原page拖动、导航/SPA在途图像fence、缩放touch到原page、裁剪JPEG像素与上下左右/完全越界、授权await期间导航、release/close与排队down的回归。初版新增导航回归实际失败（Missing expected rejection），修订后通过。单次拖动微基准约241–295ms，不是传输ACK p95或双会话压测。

S1职责边界：adapter立即使旧输入失效并提供串行释放/关闭屏障；若admit永不返回，release/close本身没有3秒上限。**S2 coordinator必须独立race 3秒deadline，超时直接关闭原BrowserContext，阻止新执行器；不得只await remote.close。** S2故障验收必须注入永不返回的admit，断言3秒后context关闭、旧epoch永不再派发、未确认关闭时不运行自动。此项未在S1冒充已验证。

## S2 状态与凭证门禁（进行中）

- coordinator/domain/repository/migration070：5秒优先、30秒人工、3秒重连/释放上限、10秒settling、owner单调时钟fence、PG状态和事件原子提交、持久化自动预算。
- S2 R1：产品3项、架构6P1+2P2；报告保留原失败证据。actor内前提、共享releaseTask、迟到save闭锁及自行终结、retry授权已修；事件序号明确为每会话version，bigserial仅内部审计主键，列表采用订阅+snapshot，不用bigserial当无缝游标。
- 产品R2新增2P1：二轮settling不能复用旧静默时间；manual_only先提交时自动actor与dispatch均须拒绝。均补真实受控顺序回归，等待R3。
- 当前实际命令：node --import tsx --test apps/api/scripts/verification-coordinator.test.ts =>15/15；MANUAL_VERIFICATION_TEST_DATABASE_URL 指向本机xianyu_manual_verification_test，verification-postgres.test.ts=>2/2。
- 凭证与IM修订及相关测试由独立实施Agent处理，之后由原两位独立审核者复审；实施者不审核自己的修改。
- S2未PASS，尚未进入S3/S4装配。迁移只在隔离测试库执行，生产没有修改。

## S2 门禁通过

- 产品协调器R4 PASS：PR-S2-001～006全部关闭；产品凭证R2 PASS：PR-CRED-PROD-001关闭；架构完整R2 PASS：AR-S2-R1-001～008及R2补充发现全部关闭。
- 当前coordinator18项、原PG2项、credential12项、credential PG6项通过。架构另跑真实Chrome无限admit默认3秒屏障，3135ms关闭原context/page且自动0次。
- API typecheck PASS；完整npm --workspace apps/api test exit0，352项测试（264+24+17+47，无skip）与后续全部既有smoke通过。全量日志在本机TEMP/xianyu-manual-challenge-api-tests.log，不作为产品产物提交。
- 完整回归中更新旧fixture：partial Store补新增风险查询；read mock位于真正request-local client且无心跳时保留Token风险；onboarding仅证明cookie登录成功/credential active，账号保持disconnected，禁止fixture去连真实平台。架构独立确认不是削弱断言。
- 前端基线：107文件、510项Vitest全部通过。
- S2完整PASS，可实施S3原页面→实时控制→界面接线。生产无变更。
