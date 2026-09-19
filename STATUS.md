# XianyuSellerAgent 项目状态

- 项目阶段：5
- 阶段状态：进行中（S4-VS1 账号登录切片已完成受控 QR/Cookie/API/前端闭环和本机 Chrome/CDP 跨层验证；真实闲鱼 APP 扫码、当前已登录 Chrome 参考项目复核及容器持久化仍待人工/环境验收）
- 最近一次通过门禁：阶段 5 ENV-0 / 2026-09-19
- 当前目标：完成 S4-VS1 的真实外部验收：当前已登录 Chrome 参考项目登录态复核、真实 APP 扫码成功回调、Cookie/凭证落库和 PostgreSQL/Redis 持久化
- 已完成范围：阶段 0 范围门禁；阶段 1 架构与模块边界；阶段 2 数据模型、数据库表设计、关系基数、状态机、API envelope、幂等、鉴权、敏感交付、迁移边界；阶段 5 账号登录方法选择、真实 QR 适配器、Cookie 登录、账号资料同步、登录会话持久化、前端列表刷新和 Chrome/CDP 控制环境 E2E
- 未完成范围：真实闲鱼 APP 扫码成功回调、真实外部 Cookie 验证、PostgreSQL/Redis 容器实跑和完整视觉差异回归；账号密码登录依赖独立浏览器运行时，当前明确不可用
- 未解决风险：R-001/P1、R-002/P1、R-005/P2、R-006/P2、R-007/P2、R-008/P1、R-009/P1、R-011/P1、S3-I001/P1、S3-I002/P1、S3-I003/P1、S3-I004/P1、S3-I005/P1、S3-I006/P1、S3-I007/P1、S3-I008/P1、S4-I003/P1、S4-I004/P1、S4-I005/P1、S4-I006/P1、S4-I007/P2、S5-I001/P1、S5-I002/P1、S5-I003/P1、S5-I004/P1；S3-I009/S3-I010 已关闭，S4-I001/S4-I002 已部分缓解
- 待复审问题：S3-R5 为超出当前范围的实现审计；S3-R6 设计范围已澄清；S1-I004 保持 P2 跟进项；阶段 4 计划门禁已通过
- 下一步：在当前已登录 Chrome 中打开 `http://localhost:9000/accounts` 完成参考项目登录态复核；再用真实闲鱼 APP 扫码验证回调、资料同步和凭证落库；Docker daemon 可用后重跑 Compose、迁移和 Testcontainers 验证

## 当前证据

- `SellerAgent/npm test`：已通过，`mock API contract flow passed`；
- `SellerAgent/npm run build`：已通过，TypeScript 检查和 Vite production build 通过；
- `git diff --check`：阶段 2 文档修订后重新执行；
- `docs/02-data-api.md`：v0.4，状态 PASS，覆盖字段级 schema、PK/FK、唯一约束、关系基数、状态机、P0 API、FirstRun bootstrap、消息 handoff、幂等、安全和迁移；
- `docs/02-database-schema.md`：v0.1，状态 PASS，覆盖 PostgreSQL 表清单、列类型、默认值、PK/FK、唯一/部分唯一索引、跨表约束、迁移顺序和回滚边界；
- `docs/05-review-log.md`：S2-R1、S2-R2、S2-R3 均 PASS，S2-I001 至 S2-I005 已关闭；
- `docs/03-frontend-design.md`：v0.1，阶段 3 组件树、状态边界与 stockAlert/inventoryStatus 契约已同步；
- `docs/03-component-contract.md`：v0.1，补充模块树、组件职责矩阵、canonical ViewModel、路由/API、数据流、移动端对等性和 DoD；独立设计复审 PASS；
- `docs/04-plan.md`：v0.1，阶段 4 主体功能优先的 ENV-0 与 S4-VS1 至 S4-VS4 纵向切片计划、依赖、DoD、测试、视觉基线和回滚边界；计划门禁 PASS；
- `npm --workspace apps/api run test`：已通过，`env0 smoke passed`、`onboarding cookie login smoke passed`；覆盖 health、bootstrap、Session/CSRF、幂等重放/冲突、账号创建、Cookie 登录、资料同步、登录状态和账号列表读取；
- `npm --workspace apps/web run test`：已通过，覆盖账号 API adapter、QR 状态机和组件相关单元/契约测试；
- `docker compose config --quiet`：已通过；`docker compose up` 尚未执行成功，阻断原因为当前 Docker Desktop Linux engine 未启动；
- `npm run verify`：已通过；包含类型检查、API smoke、前端测试、构建、本机 Chrome/CDP E2E、1440×900 与 390×844 截图生成、Compose 配置和 diff 检查。
- `npm run test:e2e:chrome`：已通过；本机 Chrome + CDP 完成登录方式选择、无旧创建弹窗、无模拟二维码、Cookie 登录、服务端资料回传和页面可见持久化结果；不安装或执行 Playwright。
- `docs/evidence/stage5/S4-VS1/test-baseline.md`：已补充 Cookie 登录、资料同步、登录会话落库、当前 Chrome 参考项目登录态前置条件，以及受控 E2E 与真实外部验收的边界；
- `docs/13-account-login-slice.md`：新增账号登录切片实现说明、路由/数据流、迁移、测试证据、Chrome 登录态复核步骤和当前门禁结论；
- `docs/evidence/stage5/S4-VS1/screenshots/`：保存 `accounts-desktop-1440x900.png` 与 `accounts-mobile-390x844.png`；
- `SellerAgent/npm test`、`SellerAgent/npm run build`、`git diff --check`：仅作为原型健康检查，不作为阶段 3 组件设计证据；
- 高保真原型和现有源码：仅作为视觉与背景参考，不作为阶段 3 组件拆分依据；正式前端账号页已独立按 design token 重建壳层与账号切片。
- 以上受控证据不证明真实闲鱼 APP 扫码成功、真实外部 Cookie 验证或 PostgreSQL/Redis 容器持久化已完成；阶段 5 的剩余门禁必须按 `docs/13-account-login-slice.md` 的人工复核步骤关闭。

- canonical 设计同步：FirstRun 使用 `POST /api/v1/auth/bootstrap`；消息人工接管使用 `POST /api/v1/conversations/{id}/handoff`，恢复 AI 使用 `POST /api/v1/conversations/{id}/release`；统一字段为 `BootstrapAdminInput/Output`、`HandoffConversationInput`、`ReleaseConversationInput`、`ConversationHandlingOutput`，状态字段为 `handlingMode`，版本字段为 `expectedVersion`。

## 长期决策摘要

- 阶段 0 不提前开发真实后端；
- SellerAgent 原型 + design token 是阶段 3 前的临时视觉基线；
- `knowledge`、`review` 入口直接删除；
- Pi Runtime 采用独立服务；首期生产允许 Docker Compose；
- CredentialStore 直接存项目数据库，管理员拥有绝对管理权限，但凭证不得暴露给闲鱼买家；
- `unknown` 作为 `externalOutcome`，不作为 OutboxStatus；
- 幂等作用域为 `adminId + accountId + route + Idempotency-Key`，默认保留 30 天；
- 鉴权基线为 SameSite=Lax、CSRF 双提交、WebSocket Origin allowlist、Session 空闲 30 分钟/绝对 8 小时、登录和密码变更后轮换；
- 卡券正文、夸克链接、提取码仅按 `buyer_deliverable`、订单已支付、商品与账号匹配、策略通过和审计完成后交付。

## 阶段边界

阶段 4 计划门禁已关闭。阶段 5 已进入 S4-VS1 账号登录真实纵向切片；商品、卡券、订单仍冻结，直到账号切片的真实外部验收、容器持久化和审计证据补齐。

## Git 提交记录

- 阶段 0：`38862e5`（`feat: 阶段0文档产出`）
- 阶段 1：`cfc756b`（docs(阶段1): 完成架构与模块边界）
- 阶段 2：`076a969`（docs(阶段2): 完成数据库表设计与数据契约）
- 阶段 3：`66fd989`（docs(阶段3): 完成前端信息架构与状态契约）
- 阶段 3 门禁重开：`6c5533e`（docs(阶段3): 重开组件门禁并补充详细契约）
- 阶段 3 组件契约复审关闭：`bcf47b5`（docs(阶段3): 完成组件契约复审并关闭门禁）
- 阶段 4 主体功能纵向切片计划：`f55f7dc`（docs(阶段4): 编排主体功能纵向切片计划）
- 阶段 4 计划提交哈希回写：`3e0a0aa`（docs(阶段4): 回写主体切片计划提交哈希）
- 阶段 5 前端账号只读首片：`f72f688`（feat(阶段5): 落地账号管理前端只读切片）
- 阶段 5 路由骨架：`e2740a7`（feat(阶段5): 补充页面路由骨架）
- 阶段 5 测试门禁：`5c8f9e5`（test(验证): 建立阶段五前端测试门禁）
- 阶段 5 ENV-0 后端运行时：`d134f9d`、`2567714`、`50cbe0b`（基础运行时、bootstrap Cookie 重放、幂等竞争与异常清理）
- 阶段 5 账号真实读取链路与 ENV-0 部署骨架：`65b48d6`（feat(阶段5): 接通账号真实读取链路与ENV0部署骨架）
- 阶段 5 账号详情与连接状态读取：`2de5ff7`（feat(阶段5): 接通账号详情与连接状态读取）
- 阶段 5 账号登录会话状态机：`325161f`（feat(阶段5): 落地账号登录会话状态机）
- 2026-09-19 阶段5 S4-VS1 更新：二维码登录前后端闭环已接通；真实模式已验证二维码生成、轮询与取消，前端已展示二维码并自动轮询。人工扫码成功及外部闲鱼账号凭证落库仍需人工验收；风控 `verification_required` 保留为可恢复状态。
- 本轮提交：`c04b189`（`feat(阶段5): 接通闲鱼二维码登录与凭证校验`）。
- 本轮前端提交：`7cf0c0e`（`feat(阶段5): 完成账号管理前端与Chrome端到端验证`）。
