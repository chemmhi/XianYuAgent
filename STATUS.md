# XianyuSellerAgent 项目状态

- 项目阶段：3
- 阶段状态：REOPENED / FAIL（阶段 3 组件职责、数据流与 API 细化未完成）
- 最近一次通过门禁：阶段 2 / 2026-09-19
- 当前目标：完成阶段 3 详细组件契约、ViewModel、Controller、路由/API 映射与超级组件拆分门禁
- 已完成范围：阶段 0 范围门禁；阶段 1 架构与模块边界；阶段 2 数据模型、数据库表设计、关系基数、状态机、API envelope、幂等、鉴权、敏感交付、迁移边界
- 未完成范围：真实后端、数据库、API、Worker、闲鱼 adapter、Pi Runtime 运行时、真实集成和端到端测试
- 未解决风险：R-001/P1、R-002/P1、R-005/P2、R-006/P2、R-007/P2、R-008/P1、R-009/P1、R-011/P1、S3-I001/P1、S3-I002/P1、S3-I003/P1、S3-I004/P1、S3-I005/P1、S3-I006/P1、S3-I007/P1、S3-I008/P1、S3-I009/P1、S3-I010/P1；S3-I005 至 S3-I010 阻断阶段 3
- 待复审问题：S3-R5 组件职责与实现落地 FAIL；阶段 3 门禁已重新打开；S1-I004 保持 P2 跟进项
- 下一步：完成 `docs/03-component-contract.md` DoD，补齐组件模块边界、canonical ViewModel、Controller/API façade 和移动端页面后重新独立复审

## 当前证据

- `SellerAgent/npm test`：已通过，`mock API contract flow passed`；
- `SellerAgent/npm run build`：已通过，TypeScript 检查和 Vite production build 通过；
- `git diff --check`：阶段 2 文档修订后重新执行；
- `docs/02-data-api.md`：v0.3，状态 PASS，覆盖字段级 schema、PK/FK、唯一约束、关系基数、状态机、P0 API、幂等、安全和迁移；
- `docs/02-database-schema.md`：v0.1，状态 PASS，覆盖 PostgreSQL 表清单、列类型、默认值、PK/FK、唯一/部分唯一索引、跨表约束、迁移顺序和回滚边界；
- `docs/05-review-log.md`：S2-R1、S2-R2、S2-R3 均 PASS，S2-I001 至 S2-I005 已关闭；
- `docs/03-frontend-design.md`：v0.1，阶段 3 原始契约；因组件职责复核重新打开门禁；
- `docs/03-component-contract.md`：v0.1，补充模块树、组件职责矩阵、canonical ViewModel、路由/API、数据流、移动端对等性和 DoD；待独立复审；
- `SellerAgent/npm test`、`SellerAgent/npm run build`、`git diff --check`：阶段 3 文档修订后重新执行并通过；
- 以上证据只证明原型可构建和阶段 2 契约存在，不证明阶段 3 组件边界已冻结或真实业务链路已完成。

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

阶段 3 未通过前不得进入阶段 4 执行门禁；仍不得提前创建真实后端、数据库、API、Worker 或前后端联调实现。阶段 3 重新通过后，才允许进入阶段 4 迭代计划与纵向切片编排。

## Git 提交记录

- 阶段 0：`38862e5`（`feat: 阶段0文档产出`）
- 阶段 1：`cfc756b`（docs(阶段1): 完成架构与模块边界）
- 阶段 2：`076a969`（docs(阶段2): 完成数据库表设计与数据契约）
- 阶段 3：`66fd989`（docs(阶段3): 完成前端信息架构与状态契约）
- 阶段 3 门禁重开：`6c5533e`（docs(阶段3): 重开组件门禁并补充详细契约）
