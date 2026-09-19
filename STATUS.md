# XianyuSellerAgent 项目状态

- 项目阶段：2
- 阶段状态：PASS（阶段 2 数据模型、API 契约与安全边界）
- 最近一次通过门禁：阶段 2 / 2026-09-19
- 当前目标：完成阶段 3 前端信息架构、组件树、状态和 API 映射设计
- 已完成范围：阶段 0 范围门禁；阶段 1 架构与模块边界；阶段 2 数据模型、数据库表设计、关系基数、状态机、API envelope、幂等、鉴权、敏感交付、迁移边界
- 未完成范围：真实后端、数据库、API、Worker、闲鱼 adapter、Pi Runtime 运行时、真实集成和端到端测试
- 未解决风险：R-001/P1、R-002/P1、R-004/P3、R-005/P2、R-006/P2、R-007/P2、R-008/P1、R-009/P1、R-011/P1；均属于后续实现或运维验证风险，不构成阶段 2 文档门禁阻断
- 待复审问题：无未关闭的阶段 0-2 P0-P2 评审问题；S1-I004 保持 P2 跟进项
- 下一步：创建 `docs/03-frontend-design.md`，把 SellerAgent 原型页面、路由、组件、状态、API 和异常态冻结为阶段 3 契约

## 当前证据

- `SellerAgent/npm test`：已通过，`mock API contract flow passed`；
- `SellerAgent/npm run build`：已通过，TypeScript 检查和 Vite production build 通过；
- `git diff --check`：阶段 2 文档修订后重新执行；
- `docs/02-data-api.md`：v0.3，状态 PASS，覆盖字段级 schema、PK/FK、唯一约束、关系基数、状态机、P0 API、幂等、安全和迁移；
- `docs/02-database-schema.md`：v0.1，状态 PASS，覆盖 PostgreSQL 表清单、列类型、默认值、PK/FK、唯一/部分唯一索引、跨表约束、迁移顺序和回滚边界；
- `docs/05-review-log.md`：S2-R1、S2-R2、S2-R3 均 PASS，S2-I001 至 S2-I005 已关闭；
- 以上证据只证明阶段 2 契约已冻结，不证明真实后端或业务链路已完成。

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

阶段 2 通过后允许进入阶段 3 前端设计，不得提前创建真实后端、数据库、API、Worker 或前后端联调实现。只有阶段 5 及以后纵向切片门禁通过后，才允许按契约实现真实业务链路。

## Git 提交记录

- 阶段 0：`38862e5`（`feat: 阶段0文档产出`）
- 阶段 1：`cfc756b`（docs(阶段1): 完成架构与模块边界）
- 阶段 2：待本轮验证后提交并补记 commit hash
