# XianyuSellerAgent 长期决策记录

- 记录日期：2026-09-19
- 用途：保存用户已确认、后续默认沿用的范围、架构、安全和阶段门禁决策，避免重复询问。

## 已确认决策

1. 阶段 0 只锁定产品范围、非目标、角色、交付边界和验收标准，不提前开发真实后端、数据库、API 或 Docker Compose。
2. SellerAgent 原型与 design token 作为阶段 3 前的临时视觉基线，不要求补正式 Figma 文件作为当前前置条件。
3. `knowledge`、`review` 入口直接删除，不保留隐藏、归档或内部入口。
4. Pi Runtime 采用独立服务；业务 API 与 Worker 只依赖 `AgentRuntime` / `PiRuntimeAdapter` 抽象接口。
5. 首期生产允许使用 Docker Compose；健康检查、备份、迁移、监控和回滚在阶段 7/8 验证。
6. 闲鱼协议与凭证当前项目尚未实现，只参考 PRD 中提到的参考项目；真实适配器和可复现验证放后续阶段。
7. CredentialStore 直接存项目数据库。管理员拥有绝对管理权限，可查看、编辑、替换、启停、轮换、撤销和操作系统凭证；唯一硬边界是不得暴露给闲鱼买家。
8. 系统凭证不得进入闲鱼买家可见消息、订单交付内容、外部买家响应、日志、Trace、Replay 或 Prompt。
9. 卡券正文、夸克链接和提取码只有在 `buyer_deliverable`、订单已支付、商品与账号匹配、策略校验通过、库存成功锁定并记录审计后，才可交付买家。

## 阶段 1 结论

- 阶段 1 架构门禁：PASS。
- S1-R1、S1-R2、S1-R3：PASS。
- S1-I004（四环境拓扑、网络隔离、回滚边界）接受为 P2 跟进项，不作为阶段 1 硬门禁。
- 原型 `localStorage.auth_token` 是阶段 0/原型例外；生产必须迁移到服务端 Session + HttpOnly Cookie，并在 R-011 对应阶段验证。

## 阶段 2 裁决与完成结论

2026-09-19，用户确认 S2-I001 至 S2-I005 全部接受，结论如下：

1. `unknown` 仅作为 `externalOutcome`，不新增 OutboxStatus。
2. 幂等作用域为 `adminId + accountId + route + Idempotency-Key`，默认保留 30 天；同指纹重放原 envelope，不重复扣库存、发货、发布或发消息；同 key 不同指纹返回 `IDEMPOTENCY_CONFLICT`。
3. 鉴权基线为 `SameSite=Lax`、`X-CSRF-Token` 双提交、WebSocket Origin allowlist、Session 空闲 30 分钟/绝对 8 小时；登录和密码变更后轮换 Session。
4. `system_only / operator_only / buyer_deliverable`、卡券正文读取、交付预览和订单交付 API 纳入阶段 2 契约。
5. CredentialStore CRUD、rotate、revoke、enable、disable 纳入阶段 2 契约；管理员绝对管理，但不得向闲鱼买家暴露。

阶段 2 已补齐并冻结：

- 独立数据库表设计文档 `docs/02-database-schema.md`，覆盖 PostgreSQL 表清单、字段类型、默认值、PK/FK、唯一/部分唯一索引、跨表约束、迁移顺序和回滚边界；
- AccountLoginSession 实体与登录会话 API；
- Order 的 payment/order/delivery/after-sales 分离状态与转移；
- Run、Step、Confirmation、Outbox 的完整多步骤、重试、取消、部分成功和 expired 状态；
- 字段级 schema、PK/FK、唯一索引、空值/默认值、审计字段、版本并发控制和生命周期约束；
- 统一响应 envelope、HTTP 状态码、分页、错误码、幂等指纹与冲突语义；
- 商品同步/素材全生命周期/批量发布，卡券素材与批量操作，账号权限，Runtime/Outbox，Settings Policy Gateway 与外部服务契约；
- `system_only / operator_only / buyer_deliverable` 的正文读取、交付预览、订单交付和脱敏审计边界。

阶段 2 评审结论：S2-R1、S2-R2、S2-R3 均 PASS；阶段状态更新为 PASS，允许进入阶段 3 前端设计契约。

## 阶段 3 决策与完成结论

2026-09-19，阶段 3 前端设计契约完成并通过独立复核：

1. 正式一级页面冻结为 8 个：`dashboard`、`workspace`、`accounts`、`messages`、`products`、`coupons`、`orders`、`settings`；不存在 `knowledge` / `review` 一级入口。
2. 生产 canonical path 冻结为 `/dashboard`、`/workspace`、`/accounts`、`/messages`、`/products`、`/coupons`、`/orders`、`/settings`，认证路径为 `/login` 与 `/first-run`。
3. 桌面目标 viewport 固定为 1440×900，移动目标 viewport 固定为 390×844；SellerAgent 原型和 design token 继续作为临时视觉基线。
4. 页面状态统一覆盖 loading、success、empty、error、未登录、403、disabled、submitting，并补充 timeout、conflict、reconnect、unknown 等适用状态。
5. 前端只调用 `/api/v1` 领域 API；高风险写动作遵循 Policy → Confirmation → Idempotency → Outbox，前端不得直接修改服务端状态或访问 Pi/闲鱼原始接口。

阶段 3 评审结论：S3-R1、S3-R2、S3-R3、S3-R4 均 PASS；阶段状态更新为 PASS，允许进入阶段 4 迭代计划与纵向切片编排。

## 长期执行规则

- 已确认的决策不重复询问；只有出现越权、泄密、不可回滚、库存重复扣减或核心链路不可用等新高风险证据时，才重新发起人工裁决。
- 每个阶段完成后必须：更新 `STATUS.md`、评审记录、风险登记和本日志；运行适用验证命令；使用中文 Conventional Commit 提交；将 commit hash 写回 `STATUS.md` 和本日志。

## Git 提交记录

- 阶段 0：`38862e5`（`feat: 阶段0文档产出`）
- 阶段 1：`cfc756b`（`docs(阶段1): 完成架构与模块边界`）
- 阶段 2：`076a969`（`docs(阶段2): 完成数据库表设计与数据契约`）
