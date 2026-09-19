# XianyuSellerAgent 阶段评审记录

- 文档版本：v0.4
- 更新日期：2026-09-19
- 评审规则：问题先修复，再复验，再由独立评审关闭；未关闭的 P0-P2 不得进入下一阶段。

## 1. 阶段 0 评审结论

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| S0-R1 | 业务 / 验收 | PASS | PRD 范围、J-01 至 J-06、正式页面、管理员角色、交付边界已确认 |
| S0-R2 | 可实现性 / 边界 | PASS | SellerAgent/npm test、SellerAgent/npm run build、git diff --check 通过；真实后端转后续阶段 |
| S0-R3 | 异常 / 安全 / 运维 | PASS | 凭证、交付数据、失败路径、回滚边界和阶段后置实现已确认 |

阶段 0 门禁：PASS。阶段 0 只锁定范围，不提前开发真实后端、数据库、API 或 Docker Compose。

## 2. 阶段 0 问题关闭

| 问题编号 | 修复动作 | 状态 |
| --- | --- | --- |
| S0-I001 | 缺少后端、数据库和部署骨架明确为后续阶段范围，转为 R-001 | CLOSED |
| S0-I002 | SellerAgent 原型 + design token 作为临时视觉基线，阶段 3 固定 viewport | CLOSED |
| S0-I003 | 直接删除 knowledge/review 入口及页面分支，不保留隐藏或内部入口 | CLOSED |
| S0-I004 | 用户确认阶段 0 只验收范围锁定 | CLOSED |
| S0-I005 | 用户确认阶段 0 从 BLOCKED 转 PASS 的裁决 | CLOSED |

## 3. 阶段 1 评审结论

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| S1-R1 | 业务 / 模块映射 | PASS | `docs/01-architecture.md` §4.1、§6、§6.1；用户于 2026-09-19 接受 |
| S1-R2 | 架构 / 数据流 | PASS | `docs/01-architecture.md` §5、§7；ADR-001/002/006/007；用户于 2026-09-19 接受 |
| S1-R3 | 质量 / 安全 / 运维 | PASS | `docs/01-architecture.md` §8.1/§8.2；ADR-003/004；用户于 2026-09-19 接受 |

阶段 1 门禁：PASS。S1-I004（四环境拓扑）降为 P2 跟进项，不影响阶段 1 通过。

## 4. 阶段 2 评审结论

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S2-R1 | 架构 / 数据模型 | 实体字段、PK/FK、唯一约束、关系基数、状态机、生命周期 | repo_audit | PASS | `docs/02-data-api.md` §2-§4、§10-§11；`docs/02-database-schema.md` §2-§5；修订后复核通过 |
| S2-R2 | API / 契约 | envelope、HTTP 语义、分页、错误码、幂等、P0 API 覆盖 | repo_audit | PASS | `docs/02-data-api.md` §5、§10-§11；`docs/02-database-schema.md` §3；S2-I001/S2-I002 已按用户裁决关闭 |
| S2-R3 | 安全 / 运维 | SameSite、CSRF、Session、账号范围、敏感交付、迁移和回滚 | manual_review_points | PASS | `docs/02-data-api.md` §6-§8；`docs/02-database-schema.md` §4-§5；S2-I003/S2-I004/S2-I005 已按用户裁决关闭 |

阶段 2 门禁：PASS。允许进入阶段 3 前端信息架构与 API 映射设计；仍不得提前创建真实后端实现。

## 5. 阶段 3 评审结论

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S3-R1 | 业务 / 验收 | 8 个正式页面、canonical path、用户旅程、异常态和确认卡边界 | stage3_review | PASS | `docs/03-frontend-design.md` §1、§3、§6–§7；本次门禁不以源码导航实现为证据 |
| S3-R2 | 架构 / 数据流 | 组件树、状态归属、请求生命周期、缓存失效、WebSocket、阶段 2 API 映射 | repo_audit | PASS | `docs/03-frontend-design.md` §4–§10；`docs/02-data-api.md` §5–§11 |
| S3-R3 | 质量 / 安全 / 运维 | 权限一致性、敏感数据边界、可访问性、viewport、回滚与后续验证边界 | root + stage3_review | PASS | `docs/03-frontend-design.md` §2、§5、§8、§9、§11；`docs/07-visual-acceptance.md` |
| S3-R4 | 视觉 | SellerAgent 原型、design token、1440×900 / 390×844、状态映射可追踪性 | stage3_review | PASS | `xianyu-admin-design-style/assets/design-tokens.json`；`docs/03-frontend-design.md` §2、§8、§10 |

阶段 3 初审结论：PASS。但该结论仅覆盖页面旅程和概念映射，不覆盖实现级组件职责落地。

### 5.1 阶段 3 组件职责复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S3-R5 | 架构 / 组件 / 数据流 | 是否存在超级组件、页面职责是否拆分、Controller/ViewModel/API/移动端是否完整 | component_split_review + feature_coverage_review | OUT OF SCOPE | 该复核以源码实现为证据；用户已明确阶段 3 只审设计，不以源码或原型作为组件设计依据 |

### 5.2 阶段 3 设计范围澄清

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S3-R6 | 范围 / 设计门禁 | 当前阶段只进行组件设计；高保真原型仅作视觉参考；源码不作为组件拆分依据；本阶段不编码 | 用户 | ACCEPTED | `docs/03-component-contract.md` §1、§9、§10；`docs/09-decision-log.md` 阶段 3 范围澄清 |

阶段 3 门禁：PASS。组件职责、数据流、路由/API、8×2 页面矩阵和独立设计复审均已完成；阶段 4 可进入执行门禁编排，但本阶段未进行具体编码。

| S3-R7 | 设计 / 组件 / 数据流 | 详细组件契约、canonical ViewModel、route/API catalog、设计级反超级组件 | feature_coverage_review | PASS | `docs/03-component-contract.md`；RunActionBar/Outbox recover、RuntimePanel/OutboxPanel 拆分、8×2 矩阵、queryKey/account isolation、ControllerResult/error map、stockAlert/inventoryStatus 均已复核 |

## 6. 阶段 2 人工裁决关闭记录

| 编号 | 用户裁决 | 关闭结论 |
| --- | --- | --- |
| S2-I001 | `unknown` 不作为 OutboxStatus | `unknown` 仅作为 `externalOutcome` 字段 |
| S2-I002 | 幂等作用域和保留期 | `adminId + accountId + route + Idempotency-Key`，默认 30 天；同指纹重放原结果，不同指纹冲突 |
| S2-I003 | 鉴权安全基线 | SameSite=Lax、CSRF 双提交、WebSocket Origin allowlist、Session 空闲 30 分钟/绝对 8 小时、登录和密码变更后轮换 |
| S2-I004 | 交付数据边界 | 三类 deliveryScope、正文读取、交付预览和订单交付 API 纳入阶段 2 |
| S2-I005 | CredentialStore 范围 | CRUD、rotate、revoke、enable、disable 纳入阶段 2；管理员绝对管理但不得暴露给买家 |

## 7. 当前失败点（供人工复核）

当前仅保留设计/API 契约阻断；源码拆分和原型实现问题转为后续阶段风险，不作为当前阶段 3 设计门禁证据：

| 编号 | 风险 | 级别 | 处理阶段 |
| --- | --- | --- | --- |
| S1-I004 | local/test/staging/production 的完整拓扑、环境隔离和回滚演练尚未实现 | P2 | 阶段 7/8 |
| R-011 | 原型 `localStorage.auth_token` 尚未替换为真实 Session + HttpOnly Cookie | P1 | 阶段 5/6 |
| R-008 | CredentialStore 字段加密、备份与轮换演练尚未实现 | P1 | 阶段 7 |
| S3-I005 | 原型源码集中路由、全局反馈、业务动作和 DOM click capture，形成超级组件 | P1 | 后续实现阶段，非当前设计门禁 |
| S3-I006 | 原型源码 Settings、Workspace、Auth、ProductEditor 职责过宽 | P1 | 后续实现阶段，非当前设计门禁 |
| S3-I007 | 原型源码 DTO 与阶段 2 canonical 状态不一致 | P1 | 后续实现阶段，非当前设计门禁 |
| S3-I008 | 原型源码 Products/Coupons/Orders 移动端回退 Dashboard | P1 | 后续实现阶段，非当前设计门禁 |

如出现新的越权、凭证明文泄露、库存重复扣减、不可回滚迁移或核心链路不可用，必须重新打开阶段门禁并人工复核。

## 8. 阶段 3 已关闭问题

| 编号 | 关闭结论 | 复核证据 |
| --- | --- | --- |
| S3-I009 | VERIFIED / CLOSED：FirstRun bootstrap 与消息 handoff 的 canonical endpoint、字段和缓存失效语义跨文档一致 | `docs/02-data-api.md`、`docs/03-frontend-design.md`、`docs/03-component-contract.md`；MR-015/MR-016 |
| S3-I010 | VERIFIED / CLOSED：ControllerResult、canonical ViewModel、错误码映射和反超级组件规则经独立设计复审通过 | `docs/03-component-contract.md` §6.9、§8、§9、§10；S3-R7 / MR-018 |

## 9. 阶段 4 计划门禁

阶段 4 仍只做迭代计划与纵向切片编排，不写业务代码；阶段 5 才按切片执行实现。

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S4-R1 | 业务 / 验收 | 账号管理 → 商品管理 → 卡券首页/库存 → 订单列表/详情/交付的主体功能优先级、用户旅程和后置范围 | stage4_slice_plan | PASS | `docs/04-plan.md` §1、§3、§4；Dashboard、Messages、Workspace、Settings 不抢占前四片 |
| S4-R2 | 架构 / 数据流 | ENV-0、账号范围、Execution foundation、API/VM、query invalidation 和 VS1→VS2→VS3→VS4 依赖 | stage4_dependency_audit | PASS | `docs/04-plan.md` §2、§3、§5；执行基础与最小审计前置，QR session 与 login-session 分离；迁移拆分、DTO 冻结、fixture/清理责任在阶段 5 各片执行前回写并验证 |
| S4-R3 | 质量 / 安全 / 运维 | 幂等、unknown/timeout、敏感交付、库存锁、审计、测试证据、视觉基线和回滚动作 | stage4_gate_review | PASS | `docs/04-plan.md` §3、§5、§6；阶段 5 执行时逐片留存真实测试、视觉和回滚证据 |

阶段 4 计划门禁：PASS。允许进入阶段 5 的 S4-VS1 账号管理真实纵向切片；未满足 ENV-0 或首片字段冻结前，不得扩展到商品、卡券和订单写入。

## 10. 阶段 5 ENV-0 与 S4-VS1 首片复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R1 | 基础设施 / 安全 | API、Worker、Session/CSRF、统一 envelope、幂等、账号范围、最小审计、Memory/Postgres store | env0_recon + root | PASS（内存运行） | `server/src/app.ts`、`server/src/services.ts`、`server/scripts/smoke.mjs`；`server/npm test` |
| S5-R2 | 前端 / API 适配 | 账号只读页面按 AccountVM/Controller/StateBoundary 拆分，接入 canonical `/api/v1/accounts` envelope | account_frontend_recon + root | PASS | `SellerAgent/src/features/accounts/`、`SellerAgent/src/features/accounts/api.test.ts`、`SellerAgent/npm run verify:stage5`、`npm run test:integration` |
| S5-R3 | 运维 / 发布 | Compose 拓扑与迁移文件可解析，容器实跑与 PostgreSQL/Redis 持久化验证 | root | PARTIAL / BLOCKED | `docker compose config --quiet` 通过；Docker Desktop Linux engine 未启动，`docker compose up` 未完成 |

阶段 5 当前结论：允许继续 S4-VS1 账号管理，但不得宣称 PostgreSQL/Redis 容器、QR/login-session、闲鱼真实 adapter、E2E 和视觉回归已完成；商品、卡券、订单仍冻结。
- 2026-09-19 S5-R4：QR/login-session 复核为 PARTIAL PASS。后端真实二维码生成、轮询与取消通过；前端二维码展示、状态轮询、重试/取消、成功后刷新已通过构建与单测。人工扫码成功及外部凭证落库尚未完成，不能关闭该门禁。
