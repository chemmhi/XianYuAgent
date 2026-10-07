# XianyuSellerAgent 阶段评审记录

- 文档版本：v0.6
- 更新日期：2026-09-19
- 评审规则：问题先修复，再复验，再由独立评审关闭；未关闭的 P0-P2 不得进入下一阶段。

### 2026-09-28：商品目录知识库闭环

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R138 | 业务 / 交互 | 商品列表是否仅保留操作列按钮，知识库按钮名称是否明确；空内容是否显示短横线，有内容是否省略并支持悬浮查看全文 | root | PASS | `ProductTable.tsx`、`ProductTable.test.tsx`；Chrome/CDP 商品 E2E |
| S5-R139 | 前端 / 弹窗 | 新增、查看、编辑、保存和未保存关闭确认是否可用；弹窗内容、按钮、错误态和自适应编辑区是否正常 | root | PASS | `ProductKnowledgeBaseModal.tsx`、`ProductKnowledgeBaseModal.test.tsx`；Chrome/CDP 商品 E2E |
| S5-R140 | 数据 / 隔离 | 知识库是否通过商品 PATCH 持久化到数据库，并按 accountId、商品 configVersion 做范围和并发保护 | root | PASS | `products-smoke.mjs`、`products-postgres-smoke.mjs`；Memory/PostgreSQL smoke |
| S5-R141 | Agent / 回归 | `get_product_info` 与 `list_shop_products` 是否继续返回商品知识库，且不跨账号读取 | root | PASS | `auto-reply-product-lookup.test.ts`、`auto-reply-agent.test.ts`；API auto-reply unit 221/221 |

本轮结论：商品目录知识库已完成列表展示、查看/编辑弹窗、账号隔离、数据库持久化和 Agent 消费闭环；受控 UI、Memory/PostgreSQL 与 Agent 回归均通过。

### 2026-09-28：Workspace 原生能力合入主线复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R160 | 业务 / 查询 | Workspace 是否能按当前账号 scope 查看商品、卡券、订单和 Agent 运营数据 | root | PASS | `WS-VS-01-native-read.md`；Memory/PostgreSQL、Chrome/CDP 双 viewport 与持久化复读 |
| S5-R161 | 业务 / 商品发布 | 商品发布是否先生成脱敏 Confirmation，支持确认、取消、重试和 Outbox 入队，并避免伪造外部成功 | root | PASS（受控环境） | `WS-VS-02-product-publish-confirmation.md`；Confirmation/Outbox smoke 与真实 Chrome/CDP |
| S5-R162 | 业务 / 卡券创建 | 新增卡券是否复用 CouponService，支持固定文字/批量数据创建，且正文不进入 Workspace 可见数据 | root | PASS（受控环境） | `WS-VS-03-coupon-create-confirmation.md`；Memory/PostgreSQL/Chrome/CDP、正文脱敏断言 |
| S5-R163 | 业务 / 配置修改 | 自动回复 Agent 安全运行参数是否支持 Confirmation、expectedVersion 冲突保护、配置持久化和取消 | root | PASS（受控环境） | `WS-VS-04-agent-settings-confirmation.md`；16/16 API 合并测试、PostgreSQL 与 Chrome/CDP |
| S5-R164 | 架构 / 发布卫生 | Workspace 四条原生路径是否保持 Store/Service owner 边界、迁移顺序、审计和回滚说明 | root | PASS | `docs/02-data-api.md`、`docs/migrations/README.md`、`docs/06-risk-register.md`、`docs/10-stage5-progress.md` |

本轮结论：Workspace 原生读取、商品发布确认、新增卡券确认和自动回复 Agent 配置修改已按垂直切片完成验证并合入 `main`。商品真实外部发布 Worker、Provider/Credential/Policy Gateway/Runtime 等后续能力仍保持独立门禁。

### 2026-09-28：商品知识库单抽屉互斥修复

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R142 | 交互 / 状态 | 知识库保存是否误打开商品详情；商品详情、闲鱼详情、知识库、商品编辑、自动化和批量配置是否保持单抽屉互斥 | root | PASS | `ProductsPage.tsx`、`controller.ts`；Chrome/CDP 商品 E2E 单抽屉守门 |
| S5-R143 | Agent / 回归 | 新增知识库是否继续被 `get_product_info`、`list_shop_products` 消费并按账号范围返回 | root | PASS | `auto-reply-agent.test.ts`、`auto-reply-product-lookup.test.ts`；API auto-reply unit 221/221；Memory/PostgreSQL products smoke |

本轮结论：知识库保存不再触发详情抽屉，相关商品入口统一按单抽屉规则切换；新增知识库持久化后可被自动回复 Agent 的商品查询工具正常消费。

## 2026-09-25：QR 扫码登录后置 IM 验证失败复审

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| S5-R131 | 业务 / 状态机 | PASS | `xianyu-qr-login.ts`、`app.ts`；Cookie 校验/资料同步成功后 QR session 先落 `succeeded`，IM listener 不再阻断成功结果 |
| S5-R132 | 失败恢复 / 可观测性 | PASS | `xianyu-im-service.ts`、`app.ts`；`ACCOUNT_VALIDATION_REQUIRED` / `FAIL_SYS_USER_VALIDATE` 保留为可恢复验证错误，不覆盖有效登录态，真实凭证失效才映射为 `expired`，其他适配器故障映射为 `degraded` |
| S5-R133 | 回归 / 持久化 | PASS（受控环境） | API 327/327；QR renewal smoke；IM credential 回归；15 个 API smoke；隔离 PostgreSQL credential smoke；`git diff --check` |
| S5-R134 | 前端状态映射 | PASS | `apps/web/src/features/accounts/api.ts`、`api.test.ts`；服务端 `verification_required` 保留为人工验证态，不再显示为“登录失败” |

复审结论：本次“扫码后登录失败”由两处耦合共同造成：IM 后置滑块验证阻断 QR 成功边界，以及前端把 `verification_required` 误映射为 `failed`。现已拆分为“登录成功 + 可恢复验证错误”，有效账号保持 `connected`，真实凭证失效和其他适配器故障仍按各自状态机处理。真实闲鱼滑块挑战仍属于外部人工验收，不把受控测试等同于外部平台通过。

## 2026-09-22 Workspace ChatGPT 式对话改造复审

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| S5-R-WORKSPACE-UI-01 | 业务 / 验收 | PASS | `WorkspacePage.tsx` 保留会话、Run、确认卡承载；用户消息保留灰色气泡，Agent 思考与工具事件合并为单条默认折叠执行摘要，最终回复保持连续正文 |
| S5-R-WORKSPACE-UI-02 | 架构 / 数据流 | PASS | `messages.ts` 仅调整消息投影与语义排序；API、状态机和 PostgreSQL schema 未改；Pi terminal reasoning 重复事件在投影层过滤 |
| S5-R-WORKSPACE-UI-03 | 质量 / 端到端 | PASS | Workspace 定向单测 4 files / 13 tests；真实 Chrome/CDP → Pi Runtime → PostgreSQL E2E 连续两次通过，`workspace.messages` 含 user/reasoning/final，Run/事件落库可复读 |
| S5-R-WORKSPACE-UI-04 | 全量回归 | PARTIAL | 全量 Web 单测 72 files / 242 tests 中 1 个既有 Dashboard provider 测试失败；未发现与本次 Workspace 改动相关的失败 |

复审结论：Workspace UI 与跨层验收已通过；全量回归保留一个既有、非本切片失败项，当前切片状态为 `PARTIALLY_VERIFIED`。
## 2026-09-22：repair-agent 文档域重组

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| AR-REPAIR-R1 | 业务 / 验收 | READY_FOR_REVIEW | `docs/agent/auto-replay/repair-agent/00-scope.md`、`03-domain-policy-contract.md`：明确无硬编码路由、低拒绝/低 handoff 和终极敏感信息拒绝矩阵 |
| AR-REPAIR-R2 | 架构 / 数据流 | READY_FOR_REVIEW | `02-target-architecture.md`、`04-data-api-contract.md`、`05-vertical-slices.md`：明确 PolicyEngine、双层状态、Pre-send Review、Outcome Review 与 AR-VS-00 至 AR-VS-09 |
| AR-REPAIR-R3 | 质量 / 安全 / 运维 | READY_FOR_REVIEW | `06-stage-gates.md`、`07-risk-register.md`、`11-release-rollback.md`：明确三轮评审、风险闭环、灰度与回滚；业务代码未修改 |

重组结论：`docs/agent/auto-replay/repair-agent/` 成为当前修复治理唯一入口；旧 `docs/agent/auto-reply/` 仅保留运行契约和历史兼容快照。

> 当前修复域评审以 `docs/agent/auto-replay/repair-agent/08-review-log.md` 为准。2026-09-22 完成的 AR-VS-00 三轮独立复审结论为：R1 有条件通过、R2 FAIL、R3 BLOCKED_BY_EVIDENCE；阶段 0 保持 BLOCKED，不能进入 AR-VS-01。本文早先记录的 `READY_FOR_REVIEW` 仅表示复审材料已准备，不是最终通过结论。用户已确认五项裁决，当前进入文档修订与证据补齐阶段。

## 2026-09-22：AR-VS-00 范围、策略与基线锁定

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| AR-VS00-R1 | 业务 / 验收 | READY_FOR_REVIEW | `slices/AR-VS-00-policy-matrix.md`、`slices/AR-VS-00-traceability.md`：拒绝、继续帮助、澄清、生命周期和指标口径已冻结 |
| AR-VS00-R2 | 架构 / 数据流 | READY_FOR_REVIEW | `decisions/ADR-AR-0001-route-and-refusal-policy.md`、`02-target-architecture.md`：路由集中到 PolicyEngine，传输状态与解决状态分离 |
| AR-VS00-R3 | 质量 / 安全 / 运维 | READY_FOR_REVIEW | `slices/AR-VS-00-scope-policy-baseline.md`：静态代码证据、禁止范围、验收标准和回滚方式已记录；未修改业务代码 |

## 2026-09-22 自动回复 Agent 修复方案文档切片

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| AR-PLAN-R1 | 业务 / 验收 | READY_FOR_REVIEW | `docs/agent/auto-replay/repair-agent/03-domain-policy-contract.md`：已明确终极敏感信息拒绝矩阵、低 handoff 规则、生命周期目标、澄清、推荐与结果审核验收 |
| AR-PLAN-R2 | 架构 / 数据流 | READY_FOR_REVIEW | `docs/agent/auto-replay/repair-agent/02-target-architecture.md`、`05-vertical-slices.md`：已拆分 SignalExtractor、StateReducer、PolicyEngine、ResponseComposer、Pre-send Review、Outcome Review，并定义 AR-VS-00 至 AR-VS-09 |
| AR-PLAN-R3 | 质量 / 安全 / 运维 | READY_FOR_REVIEW | git diff --check、Markdown 结构检查、阶段状态与切片编号检查通过；业务代码和发送行为未修改 |

复审要求：文档进入下一轮前必须由独立评审确认：策略不依赖硬编码路由、普通不确定/售后场景不默认 handoff、所有纵向切片具备真实验收与回滚证据。

## 2026-09-21 消息重复落库修复复审

| 评审编号 | 类型 | 结论 | 证据 |
| --- | --- | --- | --- |
| S5-R-CHAT-DEDUPE-01 | 业务 / 验收 | PASS | 历史同步与实时 push 对同一闲鱼消息统一使用稳定 `.PNM` 外部消息号，避免同一买家消息生成两条本地记录和两次 AI 出站 |
| S5-R-CHAT-DEDUPE-02 | 架构 / 数据流 | PASS | `parsePushPayload`、`normalizeHistoryMessage` 和既有 `(conversation_id, external_message_ref)` 唯一约束形成同一幂等键；前端无需按正文强行合并 |
| S5-R-CHAT-DEDUPE-03 | 质量 / 运维 | PASS | `npm --workspace apps/api run test:xianyu-im-gateway`、`npm --workspace apps/api run test:auto-reply:unit`、`npm test`、`npm run typecheck`、`npm run build`、`git diff --check` 均通过 |

复审结论：本轮消息重复落库缺陷已修复；历史上已存在的重复数据未自动删除，避免破坏 `auto_reply_runs.inbound_message_id` 外键和审计链路。

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

| S3-R7 | 设计 / 组件 / 数据流 | 详细组件契约、canonical ViewModel、route/API catalog、设计级反超级组件 | feature_coverage_review | PASS | `docs/03-component-contract.md`；RunActionBar/Outbox recover、RuntimePanel/OutboxPanel 拆分、8×2 矩阵、queryKey/account isolation、ControllerResult/error map、交付配置状态均已复核 |

## 6. 阶段 2 人工裁决关闭记录

| 编号 | 用户裁决 | 关闭结论 |
| --- | --- | --- |
| S2-I001 | `unknown` 不作为 OutboxStatus | `unknown` 仅作为 `externalOutcome` 字段 |
| S2-I002 | 幂等作用域和保留期 | `adminId + accountId + route + Idempotency-Key`，默认 30 天；同指纹重放原结果，不同指纹冲突 |
| S2-I003 | 鉴权安全基线 | SameSite=Lax、CSRF 双提交、WebSocket Origin allowlist、Session 空闲 30 分钟/绝对 8 小时、登录和密码变更后轮换 |
| S2-I004 | 交付数据边界 | 卡券正文读取、交付预览和订单交付 API 纳入阶段 2；卡券不再区分内部发货范围 |
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
| S4-R3 | 质量 / 安全 / 运维 | 幂等、unknown/timeout、敏感交付、批量数据消费、审计、测试证据、视觉基线和回滚动作 | stage4_gate_review | PASS | `docs/04-plan.md` §3、§5、§6；阶段 5 执行时逐片留存真实测试、视觉和回滚证据 |

阶段 4 计划门禁：PASS。允许进入阶段 5 的 S4-VS1 账号管理真实纵向切片；未满足 ENV-0 或首片字段冻结前，不得扩展到商品、卡券和订单写入。

## 10. 阶段 5 ENV-0 与 S4-VS1 首片复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R1 | 基础设施 / 安全 | API、Worker、Session/CSRF、统一 envelope、幂等、账号范围、最小审计、Memory/Postgres store | env0_recon + root | PASS（内存运行） | `apps/api/src/app.ts`、`apps/api/src/services.ts`、`apps/api/scripts/smoke.mjs`；`npm run test:api` |
| S5-R2 | 前端 / API 适配 | 账号只读页面按 AccountVM/Controller/StateBoundary 拆分，接入 canonical `/api/v1/accounts` envelope | account_frontend_recon + root | PASS（迁移复核中） | `apps/web/src/features/accounts/`、`apps/web/src/features/accounts/api.test.ts`、`npm run typecheck:web`、`npm run test:web` |
| S5-R3 | 运维 / 发布 | Compose 拓扑与迁移文件可解析，容器实跑与 PostgreSQL/Redis 持久化验证 | root | PARTIAL PASS | `docker compose up -d --build` 已启动；health/ready、`pg_isready`、Redis `PONG`、账号写入/列表读取和 API 重启后持久化复读通过；迁移回滚/Testcontainers 未覆盖 |

阶段 5 当前结论：允许继续 S4-VS1 账号管理；AuthGate 未认证阻断、bootstrap cookie 注入、账号列表、登录方式选择、受控 Cookie 登录和 1440×900 / 390×844 截图的 Chrome/CDP E2E 已通过。仍不得宣称 PostgreSQL/Redis 容器、真实闲鱼扫码成功、真实凭证落库或完整视觉回归已完成；商品、卡券、订单仍冻结。
- 2026-09-19 S5-R4：QR/login-session 复核为 PARTIAL PASS。后端真实二维码生成、轮询与取消通过；前端二维码展示、状态轮询、重试/取消、成功后刷新已通过构建与单测。人工扫码成功及外部凭证落库尚未完成，不能关闭该门禁。

### 10.1 账号登录切片增量复核（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R5 | 纵向切片 / Cookie 登录 | Cookie 校验、账号创建或更新、CredentialStore、闲鱼资料同步、登录会话状态和账号列表读取 | api_onboarding_smoke + root | PASS（受控 adapter） | `apps/api/scripts/onboarding-smoke.mjs`；`npm --workspace apps/api run test`；`docs/13-account-login-slice.md` §3.2 |
| S5-R6 | 前端 / 浏览器 E2E | 登录方式选择、旧占位创建弹窗移除、无模拟二维码、Cookie 登录后昵称/备注回显和列表刷新 | chrome_e2e + root | PASS（受控 harness） | `apps/web/scripts/e2e-chrome.mjs`；`npm run test:e2e:chrome`；`docs/evidence/stage5/S4-VS1/screenshots/` |
| S5-R7 | 外部平台 / 人工验收 | 真实闲鱼 APP 扫码、真实 Cookie 验证、`verification_required` 恢复路径、外部凭证落库 | manual_review | PENDING | 必须在当前已登录 Chrome 打开 `http://localhost:9000/accounts` 后执行；真实扫码成功前不得关闭 |
| S5-R8 | 数据库 / 运维 | PostgreSQL/Redis 迁移、重启恢复、真实持久化和容器级 E2E | root | PARTIAL PASS | 容器健康、真实账号写入/读取与 API 重启后的持久化复读已通过；完整迁移回滚、Testcontainers 和发布级恢复演练仍待补证 |

### 10.2 人工复核入口

1. 参考项目 `http://localhost:9000/accounts` 必须在当前已经打开且已登录的 Chrome 中访问；新建 profile、无痕窗口或另一浏览器不视为等价环境。
2. 使用真实闲鱼 APP 扫描项目生成的二维码，记录 waiting → scanned → succeeded 或 `verification_required` 的实际结果。
3. 成功后核对昵称、备注、头像、平台用户 ID、CredentialStore 和 `account_login_sessions` 是否来自服务端持久化；买家侧不得看到 Cookie、Token 或内部凭证。
4. 若出现风控挑战，保留 `verificationUrl` 和失败码，禁止人工把失败状态改成 `succeeded`。

### 10.3 404 / Vite proxy / AuthGate 增量复核（2026-09-19）

本节记录当前工作树在 AuthGate 与开发代理修复后的最新证据。此前 S5-R6 的 PASS 结论已由本节重新执行并覆盖到当前增量。

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R9 | 开发环境 / 路由 | 浏览器 `/api/v1/auth/session` 是否因 Vite 未配置代理而落到 404 | root | PASS | `apps/web/vite.config.ts` 默认转发到 `http://127.0.0.1:8080`；未设置 `VITE_API_PROXY_TARGET` 时，经 Vite 代理请求返回 HTTP 200 canonical envelope |
| S5-R10 | 前端 / 鉴权门禁 | `App` 根布局是否先经过 `AuthGate`，并按 session、bootstrap、login、error、authenticated 分支阻断或放行业务页面 | root | PASS（受控 E2E） | `apps/web/src/app/App.tsx`、`apps/web/src/features/auth/`；未认证 `/accounts` 不渲染业务面，bootstrap cookie 注入后才放行账号列表 |
| S5-R11 | 外部适配器 / QR | 真实 QR 适配器是否保留 token 初始化、二维码生成、轮询、取消、超时和 `verification_required` | root | PARTIAL PASS | `apps/api/src/xianyu-qr-login.ts`、`apps/api/src/xianyu-mtop.ts`；受控 API smoke/adapter 测试通过，真实 APP 扫码和外部凭证落库仍待人工验收 |
 | S5-R12 | 浏览器 E2E / 交付门禁 | AuthGate 增量后是否可重新通过 Chrome/CDP、Cookie 登录和截图生成 | root | PASS（受控 harness） | `npm run test:e2e:chrome` 已通过：未认证 AuthGate 阻断、bootstrap cookie 注入、账号列表、登录方式选择、无旧创建弹窗、无模拟二维码、Cookie 登录和页面可见资料均通过；截图已重生成 |

### 10.5 二维码首开竞态修复（2026-09-19）

| 评审编号 | 类型 | 发现 | 处理 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-I013 | 前端并发 / QR | 开发模式 `StrictMode` 重放 `AccountLoginModal` 首次 effect，导致首开并发发送两个 `POST /api/v1/auth/qr-sessions`；后一个请求可能收到 `IDEMPOTENCY_IN_PROGRESS`，覆盖前一个成功结果并显示“二维码生成失败” | QR controller 增加 in-flight promise 去重，弹窗增加一次性自动启动保护；保留 `StrictMode`，不以关闭开发检查规避问题 | CLOSED | `apps/web/src/features/accounts/qr-login/controller.ts`、`apps/web/src/features/accounts/components/AccountLoginModal.tsx`、`apps/web/src/features/accounts/qr-login/controller.test.ts` |
| S5-R13 | 回归验证 | 首次打开二维码弹窗只能发出一个创建请求，且后续重试仍可执行 | Chrome/CDP E2E 监听 `Network.requestWillBeSent` 并断言首开创建请求数为 1；前端单测验证并发调用共享同一 promise；API smoke、构建和类型检查通过 | PASS（受控环境） | `npm run test:e2e:chrome`、`npm run test:web`、`npm run test:api`、`npm run build`、`npm run typecheck:web` |

本项只关闭前端首开竞态，不替代真实闲鱼 APP 扫码、外部凭证落库和人工验收门禁。

### 10.6 二维码 creating 状态卡死修复（2026-09-19）

| 评审编号 | 类型 | 发现 | 处理 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-I014 | 前端生命周期 / QR | React `StrictMode` 的开发期 effect cleanup 递增 `requestId`，但自动启动保护阻止第二次 start；首个 API 成功结果被判定为过期，界面永久停在 `creating` | 不再在普通卸载 cleanup 中使请求失效；真实登录方式切换仍在 `enabled=false` 分支中取消旧请求并重置去重锁 | CLOSED | `apps/web/src/features/accounts/qr-login/controller.ts` |
| S5-R14 | 浏览器 E2E | 仅断言 POST 发出不足以覆盖“请求成功但 UI 仍卡住” | Chrome/CDP 额外断言 `.qr-login-code` 已渲染；类型检查、前端单测和 Chrome E2E 通过 | PASS（受控环境） | `apps/web/scripts/e2e-chrome.mjs`；`npm run typecheck:web`；`npm run test:web`；`npm run test:e2e:chrome` |

当前增量复核结论：Vite 代理 404 根因已关闭；AuthGate 代码接入和受控浏览器门禁已通过；根 `npm run verify` 已通过。Compose 已完成容器健康与账号持久化复读，但完整迁移回滚/Testcontainers/发布级恢复、真实闲鱼 APP 扫码与外部 Cookie 验证仍待人工复核。

### 10.7 S4-VS1 账号管理人工放行（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R15 | 人工验收 / 账号管理 | 账号管理页面是否可进入、账号列表是否能正常加载并展示账号信息 | 用户 | PASS（人工放行） | 用户确认：账号管理审核通过，列表可正常加载账号信息 |
| S5-I015 | 遗留问题 / UI | 页面仍存在若干 UI 缺陷，但未影响账号列表读取、账号信息展示或进入下一主体切片 | 用户 + root | NON-BLOCKING | 转入后续 UI 修复队列；不阻断 S4-VS2 |

本次放行仅针对账号管理切片的可用性与进入下一切片条件；真实闲鱼 APP 扫码、外部 Cookie 验证、完整迁移回滚/Testcontainers 和发布级恢复仍保留独立待复核状态。

### 10.8 S4-VS2 商品列表/详情只读首片复核（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R16 | 后端 / 数据 | 003_catalog 迁移、Product domain、账号 scope 过滤、分页/筛选/排序、列表/详情 API、403/404/422 错误 envelope | inspect_product_backend + root | PASS | `apps/api/migrations/003_catalog.sql`、`apps/api/src/services.ts`、`apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`apps/api/scripts/products-smoke.mjs`；`npm run test:api` |
| S5-R17 | 数据库 / 持久化 | 真实 PostgreSQL 执行迁移、写入商品、通过 API 读取列表/详情、校验后清理测试数据 | root | PASS | `apps/api/scripts/products-postgres-smoke.mjs`；`npm run test:products:postgres` |
| S5-R18 | 前端 / 组件边界 | Products feature 按 api/controller/types/components 拆分；列表 loading/empty/error/forbidden；详情抽屉、重试和移动端共用 controller | inspect_product_frontend + root | PASS | `apps/web/src/features/products/`、`apps/web/src/app/App.tsx`；`npm run test:web`、`npm run typecheck:web`、`npm run build:web` |
| S5-R19 | 浏览器 / 端到端 | 本机 Chrome/CDP 从 `/products` 进入真实 API，读取商品列表、打开详情、刷新后确认商品仍可见 | root | PASS | `apps/web/scripts/e2e-products-chrome.mjs`；`npm run test:e2e:chrome:products`；`docs/evidence/stage5/S4-VS2/screenshots/` |
| S5-R20 | 范围 / 发布门禁 | 商品创建/编辑、SKU、素材、同步/拉取、发布确认、Policy、Outbox 是否被错误宣称完成 | root | PARTIAL PASS | 首片明确只读；完整 S4-VS2 仍保持开放，后续必须补写入状态机、外部同步和发布链路后再复审 |

### 10.10 S4-VS2 商品同步入口账号上下文复核（2026-09-19）
| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R25 | 前端 / 账号上下文 | 普通 `/products` 入口是否自动加载账号、选择可用账号、刷新列表并启用同步按钮 | root + inspect_sync_ui_bug | PASS | `apps/web/src/features/products/account-scope.ts`、`ProductsPage.tsx`、`ProductToolbar.tsx`；`npm run typecheck:web`、`npm --workspace apps/web run test` |
| S5-R26 | 浏览器 / 端到端 | 无 `accountId` query 时是否能选择账号、触发同步并展示 29 件同步商品 | root + inspect_sync_backend_bug | PASS（fixture adapter） | `apps/web/scripts/e2e-products-chrome.mjs`；`npm run test:e2e:chrome:products` |
| S5-R27 | 范围 / 发布门禁 | 修复是否误触发真实发布或修改闲鱼发布链路 | root | PASS | 仅修复账号上下文和同步入口；仍只调用 `POST /api/v1/products/sync`，未接入发布 |

本轮结论：已关闭“普通 `/products` 入口同步按钮置灰”问题；真实闲鱼账号的 29 件商品仍需在当前已登录 Chrome / Compose 环境执行人工外部验收，fixture E2E 不替代外部平台验收。

### 10.9 S4-VS2 商品同步只读切片复核（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R21 | 后端 / 闲鱼适配 | MTOP 商品卡片脱敏映射、分页聚合、账号 scope、凭证失效错误边界 | root + inspect_product_backend | PASS（受控 adapter） | `apps/api/src/xianyu-product-mapper.ts`、`apps/api/src/xianyu-mtop.ts`、`npm --workspace apps/api run test` |
| S5-R22 | 数据 / 幂等 | `(accountId, externalProductRef)` Upsert、重复同步更新、本地草稿跳过、Memory/PostgreSQL 一致性 | root | PASS | `apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`apps/api/scripts/products-sync-smoke.mjs`、`npm run test:products:postgres` |
| S5-R23 | 前端 / Chrome E2E | 商品页触发“从闲鱼同步”，真实 API/store 返回同步商品并刷新列表；不调用真实发布 | root | PASS（fixture adapter） | `apps/web/scripts/e2e-products-chrome.mjs`、`npm run test:e2e:chrome:products` |
| S5-R24 | 发布范围门禁 | 同步切片是否误触发闲鱼真实发布、素材上传、Outbox/Worker | root | PASS（范围受控） | 当前仅新增 `POST /api/v1/products/sync`；发布继续保持未实现，后置到 Policy → Confirmation → Outbox → Worker |

本轮门禁结论：S4-VS2 商品列表/详情只读首片 PASS，可继续同一商品切片的草稿、素材、SKU 和发布子切片；不能将当前结果表述为完整商品管理或真实闲鱼商品同步/发布完成。

### 10.11 S4-VS2 商品同步 Compose 回归复核（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R28 | 后端 / PostgreSQL | 外部商品 Upsert 是否正确命中 `products_account_external_ref_uq` 部分唯一索引，避免真实同步返回 500 | root | PASS | `apps/api/src/store-postgres.ts` 在 `ON CONFLICT` 中补充 `WHERE external_product_ref IS NOT NULL`；`npm run test:products:postgres` 通过；真实 Compose 同步接口返回 200 |
| S5-R29 | 前端 / 账号上下文 | 多个可用闲鱼账号时是否避免静默选中错误账号，要求显式选择后再加载/同步 | root + inspect_sync_backend_bug | PASS（受控 E2E） | `apps/web/src/features/products/account-scope.ts`、`ProductStateView.tsx`；`npm run test:web`、`npm run test:e2e:chrome:products` 通过 |
| S5-R30 | 外部平台 / 商品数量口径 | 当前 Compose 凭证是否实际返回用户所说的 29 件商品 | root + inspect_sync_backend_bug | PENDING 人工复核 | 当前两个 connected 账号 MTOP 实测分别返回 0 和 19 件；`nextPage=false`，在售分组为 19；未发现可安全推导 29 件的分组/分页参数，不能用 fixture 结果替代外部验收 |

本轮结论：已关闭 PostgreSQL 同步 500 与多账号误选账号两个代码问题；真实闲鱼“29 件”数量口径仍需确认目标账号及是否包含非在售分组，当前同步继续保持只读在售范围，不伪造或扩大外部数量。

### 10.4 本地 dev / Compose 数据源统一复核（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R13 | 开发环境 / 数据源 | 本地 dev 是否与 Compose 使用同一 PostgreSQL/Redis/MinIO，且不再静默回退 MemoryStore | root | PASS | `apps/api/src/config.ts` 默认 `ALLOW_IN_MEMORY=false`；根 `dev:*` 显式注入宿主机 PostgreSQL/Redis；`GET /healthz` 返回 `storage=postgres`、`database=ok`、`redis=configured` |
| S5-R14 | 运行编排 / 端口 | 本地 API 与 Compose API 是否避免同时占用 `8080` | root | PASS | `docker-compose.yml` 的 API/Worker 使用 `full` profile；`npm run dev` 的 `dev:prepare` 停止 Compose API/Worker 后再启动本地进程 |
| S5-R15 | 管理员初始化 / 认证 | 初始化页是否仍由真实 `bootstrapRequired` 驱动，已有管理员时是否只显示登录页 | root | PASS | `GET /api/v1/auth/session` 返回 `bootstrapRequired=false` 与 PostgreSQL 中现有管理员一致；`1051585831@qq.com` 登录成功，账号列表读取成功 |

本轮结论：本地 dev 与 Compose 已统一持久化数据源；当前不显示初始化页是因为开发 PostgreSQL 已存在管理员，不是前端渲染缺陷。若需再次演示首次初始化，必须人工确认后清理管理员数据。
- 2026-09-19 S5-R31 账号上下文与删除账号：PASS。账号管理新增 `DELETE /api/v1/accounts/{id}` 软删除，撤销当前管理员 scope 与 active credential，保留历史商品/审计；前端通过 `AccountContextProvider` + localStorage 传播当前账号，商品页不再重复选择账号。证据：`npm test`、`npm run test:e2e:chrome`、`npm run test:e2e:chrome:products`。
- 2026-09-19 S5-R32 商品动作边界：PASS。商品页明确区分“同步闲鱼”（POST `/api/v1/products/sync`）、“刷新本地”（GET `/api/v1/products`）和“发布商品”（仅打开本地草稿流程）；Chrome/CDP E2E 覆盖同步、刷新网络门禁、草稿创建/详情/编辑/持久化及 UI 账号切换。

### 10.12 S4-VS3 卡券首页合并后复核（2026-09-19）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R33 | 后端 / API | 批次、`purpose` 类型、metadata、列表安全摘要、PATCH/PUT 编辑、库存导入、绑定、作废、DELETE 软作废、正文受控预览、scope、审计和加密存储 | root + backend_coupons | PASS（受控环境） | `apps/api/src/services.ts`、`apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`apps/api/migrations/013_coupons.sql`、`apps/api/migrations/014_coupon_card_metadata.sql`；`node apps/api/scripts/coupons-smoke.mjs` |
| S5-R34 | 前端 / API 适配 | `/coupons`、搜索/类型筛选（变更即生效）、选择列/批量删除、详情/创建/编辑/复制、启用/禁用、导入/绑定、双栏关联、图片原图预览、错误状态、content 预览/复制、字段映射 | root | PASS（受控环境） | `apps/web/src/features/coupons/`；`npm test`；`npm run typecheck`；`npm run build` |
| S5-R35 | 真实浏览器 / 人工审核 | 正式路由 → 真实 API → MemoryStore → 列表安全元数据列 → 选择/关联 → 编辑/复制 → 启禁用 → 详情/预览/导入/绑定/作废 → 刷新后状态保持，以及平台样式一致性和移动 viewport | 用户 | READY_FOR_REVIEW | `apps/web/scripts/e2e-coupons-chrome.mjs`；`npm run test:e2e:chrome:coupons`；`docs/evidence/stage5/S4-VS3/test-baseline.md`；人工审核结论待回写，不再阻断代码合入但仍是发布门禁 |

本轮结论：S4-VS3 已与 S4-VS2 共享代码路径并入 `master`；自动化证据保持受控环境边界，真实 PostgreSQL/Redis/MinIO 及浏览器人工复核仍需按 runbook 执行。

2026-09-20 工具栏 follow-up 复核：`5a9f3cb` 已合入 `master`，补充“新建卡券”置末、移除 `共 N 张` 统计和居中空态文案回归；`CouponToolbar.test.ts`、`CouponStateView.test.ts`、Coupons Chrome/CDP E2E 及主线构建/类型检查作为证据。S5-R35 仍保持 `READY_FOR_REVIEW`，不代表真实持久化或人工视觉门禁已关闭。

### 10.13 未完成任务切片拆分复核（2026-09-19）

本节只复核“后续工作是否被拆成可执行纵向切片”，不把计划当作实现结论。

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R36 | 业务 / 验收 | 商品草稿、SKU、素材、受控发布、外部同步、卡券交付配置、订单交付和环境门禁是否有清晰用户路径、正式路由、非目标与完成门禁 | root + 待人工复核 | READY_FOR_REVIEW | `docs/04-plan.md` §3.1；`STATUS.md` 未完成切片索引 |
| S5-R37 | 架构 / 数据流 | 每个切片是否有独立 owner、API/store/migration 边界、账号 scope、状态机、幂等/审计和回滚；迁移 `013` 并行编号是否被显式阻断 | root + 待独立复核 | READY_FOR_REVIEW | `docs/02-data-api.md` §12；`docs/03-component-contract.md` §11；`docs/09-decision-log.md` 未完成任务切片化决策 |
| S5-R38 | 质量 / 安全 / 运维 | 是否明确真实 PostgreSQL/Redis/MinIO、Chrome/CDP、视觉状态、Testcontainers、恢复和外部账号证据；是否避免 smoke/mock 冒充完成 | root + QA/运维待复核 | BLOCKED | `docs/06-risk-register.md` `S5-RISK-013~S5-RISK-020`；`S4-ENV-RECOVERY`、`S4-EXT-ACCOUNT`、`S4-ENV-RUNTIME` 尚无完成证据 |

当前切片拆分门禁结论：`READY_FOR_REVIEW`。切片规划已写入文档，但尚未授权把任何新增切片标记为 `PASS`；实现阶段必须按单片执行 5 → 5.5 → 6 门禁，并在每片完成后追加独立业务/架构/质量复审记录。

### 10.14 优先级重排复核：在线聊天 / Workspace / Settings API Key（2026-09-19）

本节复核基础域已成型后的下一批开发顺序，不代表三项功能已经实现。

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R39 | 业务 / 验收 | 在线聊天、Workspace、Settings API Key 是否分别拆成可交付用户旅程，并明确先后顺序与非目标 | root + 待人工复核 | READY_FOR_REVIEW | `docs/04-plan.md` §3.2；`docs/10-stage5-progress.md` 优先切片队列 |
| S5-R40 | 架构 / 数据流 | Messages、Workspace、CredentialStore 是否保持独立 owner、API/store/WS/Runtime 边界，是否复用既有账号上下文 | root + 待独立复核 | READY_FOR_REVIEW | `docs/02-data-api.md` §13；`docs/03-component-contract.md` §12 |
| S5-R41 | 质量 / 安全 / 运维 | WebSocket 重连、Run unknown、Outbox recover、API Key 脱敏/加密/轮换是否都有真实测试和回滚门禁 | root + QA/安全待复核 | BLOCKED | `docs/06-risk-register.md` `S5-RISK-021~S5-RISK-026`；真实实现与证据尚未开始 |

重排结论：下一批只进入 `S4-VS5A/B/C`、`S4-VS6A/B`、`S4-VS7A`；订单交付及其他 Settings/运营页面继续后置。账号、商品、卡券的剩余真实环境复核仍按原风险矩阵推进，不被本次重排宣称为全部 PASS。

### 2026-09-19：S4-VS6A 首链路复审结论

- 业务/架构复核：Workspace 已形成 AgentSession → Run → Step → event stream 的受控首链路；Run 绑定 `accountId + sessionId`，状态迁移由服务端负责，前端只消费脱敏 ViewModel。
- 质量复核：API Workspace 专项 smoke、raw WebSocket smoke、Web typecheck/test/build 均通过；覆盖 `clientRunRef` 去重、`Idempotency-Key` 冲突、cursor replay 去重、Origin/认证/404 门禁。
- 结论：`S4-VS6A = PARTIALLY_VERIFIED`。受控进程内 Runtime 和 MemoryStore 只能证明首链路行为，不足以关闭独立 Worker/Pi Runtime、真实 PostgreSQL 持久化、浏览器 E2E/视觉和人工断线恢复门禁。
- 后续门禁：先补真实 Worker/Pi Runtime 与 Postgres smoke，再补 Chrome/CDP `1440x900` / `390x844` 截图和断线恢复复核；Confirmation/Outbox 不提前并入本片，按 `S4-VS6B` 执行。

### 2026-09-20：S4-VS6A 证据复核与状态维持

- 本轮复核通过：`npm --workspace apps/api run build`、`npm --workspace apps/api run test`、Workspace HTTP/WS smoke、`npm --workspace apps/web run typecheck`、`npm --workspace apps/web run test`（13 files / 41 tests）、`npm --workspace apps/web run build`、`git diff --check`。
- 真实浏览器 `npm run test:e2e:chrome:workspace` 通过：临时 PostgreSQL 迁移 001–015、`ALLOW_IN_MEMORY=false` API、Vite、Chrome/CDP、session/Run 持久化、断线重连、7 条事件回放、WS handshake 和 1440×900 / 390×844 截图均有可复现证据。
- 结论维持：`S4-VS6A = PARTIALLY_VERIFIED`；本轮切片文档/独立复核状态为 `READY_FOR_REVIEW`，未关闭独立 Worker/Pi Runtime、发布级恢复、人工视觉签核与 `S4-VS6B` Confirmation/Outbox 门禁。

### 2026-09-20：S4-VS5A 真实闲鱼回读与账号上下文复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R42 | 业务 / 验收 | 账号管理页设置当前账号后，消息页是否复用全局账号上下文且不再渲染账号选择器 | root + Chrome/CDP | PASS（当前切片） | `apps/web/src/app/account-context.tsx`、`apps/web/src/features/messages/components/MessagesPage.tsx`、`npm run test:e2e:chrome:messages`、桌面/移动截图 |
| S5-R43 | 外部平台 / 数据读取 | 使用 PostgreSQL 中已有登录态读取真实会话和历史消息，是否保持账号 scope、分页游标和消息去重 | root + real_api_verify | PASS（真实回读） | 账号 `19cf…`：3 会话 / 首会话 4 条；账号 `6f0…`：1 会话 / 首会话 20 条且 `hasMore=true`；数据库 `duplicate_external_refs=0` |
| S5-R44 | 质量 / 安全 / 运维 | 是否避免把真实登录态用于无意义测试或发送真实买家消息，并保持发布级边界声明 | root | PASS（范围受控） | 本轮未重复 Cookie 登录、未发送真实消息；`docs/evidence/stage5/s4-vs5a-chat-read/test-baseline.md`；`S5-RISK-021` 保持开放 |
| S5-R45 | 消息状态 / 实时链路 | 是否使用闲鱼真实 40103 已读回执与 `/r/MessageStatus/read`，并通过服务端事件更新 UI，而不是用买家回复推断卖家已读 | root | PASS（受控验证） | `npm --workspace apps/api run test:xianyu-im-read` 8/8；`npm --workspace apps/api run test:messages:infra`；`apps/api/src/xianyu-im.ts`、`apps/api/src/xianyu-im-service.ts`、`apps/api/migrations/017_message_read_status.sql`；`S4-VS5A` 仍保持 `PARTIALLY_VERIFIED`，外部线上 40103 仍待独立复审 |

本轮结论：真实闲鱼凭证回读、账号级上下文复用、40103 已读回执链路、Redis/PostgreSQL 恢复和 Chrome/CDP 视觉证据均已形成可复核记录；`S4-VS5A` 仍为 `PARTIALLY_VERIFIED`，独立复审与生产部署拓扑确认未关闭前不得宣称发布级完成。发送、附件、撤回继续进入 `S4-VS5B`。

### 2026-09-20：账号列表分页与工具栏修订复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R46 | 业务 / 验收 | 账号列表是否按服务端分页，搜索与状态/连接筛选是否真正生效，空态是否居中且表格滚动不带动页面 | root + Chrome/CDP | PASS（当前切片） | `apps/api/scripts/smoke.mjs`、`apps/web/src/features/accounts/api.test.ts`、`npm run test:e2e:chrome` |
| S5-R47 | UI / 交互 | 是否移除账号表格操作列与工具栏“共 x 个账号”统计，并保留紧凑的分页导航 | root | PASS（当前切片） | `apps/web/src/features/accounts/components/AccountTable.tsx`、`AccountToolbar.tsx`、`accounts.css` |
| S5-R48 | 质量 / 交付 | 是否在独立 worktree、merge lock 和主线门禁内完成合入 | root | PASS | `8b7c398`、`npm run verify`、`docs/agent-worktree-registry.md` |

本轮结论：账号列表分页/筛选和页面布局修订已合入 `master`；账号管理外部闲鱼登录、真实 PostgreSQL/外部账号人工验收等既有风险边界不变。

### 2026-09-20：账号表格操作列回归修订复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R51 | 业务 / 验收 | 操作列是否恢复切换账号、扫码授权/重新授权、删除账号，并验证真实切换与删除结果 | root + Chrome/CDP | PASS（当前切片） | `apps/web/src/features/accounts/components/AccountTable.tsx`、`AccountsPage.tsx`、`apps/web/scripts/e2e-chrome.mjs`；账号 Chrome/CDP E2E 通过 |
| S5-R52 | UI / 交互 | 分页是否与商品管理页保持三段式布局、选中态一致，表格是否继续最大高度内部滚动 | root | PASS（当前切片） | `apps/web/src/features/accounts/components/accounts.css`、`AccountTable.test.tsx`、`docs/evidence/stage5/S4-VS1/screenshots/accounts-desktop-1440x900.png`、`accounts-mobile-390x844.png` |
| S5-R53 | 质量 / 交付 | 是否在独立 worktree、merge lock 和主线门禁内完成合入 | root | PASS | `ed0f8eab`、`npm run verify`、`docs/agent-worktree-registry.md` |

本轮结论：账号表格操作列与行操作已恢复，账号分页视觉与商品管理页对齐；服务端分页、搜索/筛选、空态居中和表格内部滚动行为保持不变。

### 2026-09-20：商品表格空态与工具栏修订复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R49 | UI / 交互 | 商品表格空态和加载失败提示是否在表格剩余区域完整居中，工具栏是否移除冗余“共 0 件”统计且保留分页底部统计 | root + Chrome/CDP | PASS（当前切片） | `apps/web/src/features/products/components/ProductStateView.tsx`、`ProductToolbar.tsx`、`products.css`；商品 Chrome/CDP E2E 已覆盖空态/失败态布局和工具栏节点缺失 |
| S5-R50 | 质量 / 交付 | 是否补充回归测试并在独立 worktree、merge lock 和主线完成验证 | root | PASS | `99c60bf`、Web typecheck、Vitest 25 files / 86 tests、Web/API build、商品 Chrome/CDP E2E、`git diff --check` |

本轮结论：商品列表空态/失败态布局修订和工具栏统计清理已合入 `master`；商品真实 PostgreSQL、外部闲鱼数据和视觉人工复核等既有边界保持不变。

### 2026-09-20：S4-VS4A 订单列表只读切片复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R54 | 业务 / 验收 | 订单页面是否支持账号 scope、关键词、支付/订单/发货/售后四态、分页、详情和空/错/403 状态，且不暴露交付正文 | root + test_recon | PASS | `apps/web/src/features/orders/`、`apps/api/scripts/orders-smoke.mjs`、`npm test`、`npm run test:e2e:chrome:orders` |
| S5-R55 | 架构 / 数据流 | `018_orders.sql`、Postgres/Memory Store、OrderService、HTTP route 和闲鱼 mapper 是否职责分离、金额/时间/外部 upsert 契约一致 | root + test_recon | PASS | `apps/api/migrations/018_orders.sql`、`apps/api/src/store-postgres.ts`、`apps/api/src/services.ts`、`apps/api/src/xianyu-order-mapper.ts`、`npm --workspace apps/api run test:orders:postgres` |
| S5-R56 | 浏览器 / 视觉 | 真实 Vite + API + Chrome/CDP 是否完成桌面/移动订单旅程，桌面列是否完整可见，移动端是否无横向溢出 | root + test_recon + orders_e2e | PASS | `npm run test:e2e:chrome:orders`；`docs/evidence/stage5/S4-VS4A/screenshots/` |
| S5-R57 | 外部平台 / 质量 | 真实闲鱼 active 凭证是否可完成只读订单请求，失败不泄露敏感凭证，空结果不被伪造为订单 | root + test_recon + ydisks_order_recon | PASS | A/B 复验确认 `idle_site_biz_code: COMMONPRO` 请求头触发 `MTOP_PERMISSION_DENIED`；移除该头后真实返回 5 条订单，Chrome/CDP refresh 经 API 写入 PostgreSQL 并在订单页可见；未输出 Cookie/Token/raw payload |

| S5-R58 | 前端 / 架构 / 质量 | Dashboard 真实入口是否经 API、数据库和闲鱼完成跨层闭环，且浏览器可见结果与持久化一致 | root + fullchain_audit + integration_audit | PASS | `ALLOW_SHARED_E2E=1 REQUIRE_XIANYU_ORDER_SYNC=1 npm run test:e2e:chrome:dashboard:fullchain` 通过；PostgreSQL/Redis 可达，资料/商品/IM/订单读取成功，商品同步与订单刷新均落库并回读，桌面/移动截图与 `fullchain-evidence.json` 已归档 |
| S5-R58 | 范围 / 发布门禁 | 是否误把交付预览、发货/取消/重试、库存锁、Outbox、DeliveryRecord 宣称为本片完成 | root | PASS | `docs/evidence/stage5/S4-VS4A/test-baseline.md`；`S4-VS4B/C` 保持后置 |

本轮结论：`S4-VS4A = PASS（只读范围）`。前端、后端、PostgreSQL、浏览器和真实 seller 订单读取/落库复读均已通过；交付相关能力继续按 `S4-VS4B/C` 单独立项和复审。

### 2026-09-20：S4-VS4A 订单列表界面修订复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R62 | 业务 / 验收 | 订单列表是否收敛为订单号、买家昵称、商品名称、金额、下单时间、当前状态六个业务列，并保留操作列、查看详情按钮和详情抽屉 | root + orders_e2e | PASS | `apps/web/src/features/orders/components/OrderTable.tsx`、`OrdersPage.tsx`；`npm run test:e2e:chrome:orders` |
| S5-R63 | UI / 交互 | 筛选区是否仅保留关键词搜索和单状态下拉，买家昵称是否支持姓名悬浮提示，表格是否自适应高度、内部滚动并分页 | root + orders_e2e | PASS | `OrderFilters.tsx`、`orders.css`、`OrderFilters.test.ts`、`OrderTable.test.ts`、订单桌面/移动截图 |
| S5-R64 | 质量 / 交付 | 修订是否在独立 worktree、merge lock 和主线验证后合入，且不误改详情抽屉内容或真实外部权限结论 | root | PASS | `8ad36cd`、`npm run typecheck`、`npm test`、`npm run build`、`npm run compose:config`、`git diff --check`、`docs/agent-worktree-registry.md` |

本轮结论：订单列表界面修订已合入 `master`；详情抽屉内容按用户更正保留原样，下一步再单独调整。真实 seller 订单请求仍返回 `PERMISSION_EXCEPTION::无权限访问`，因此 `S4-VS4A` 整体继续保持 `PARTIALLY_VERIFIED/BLOCKED`。

### 2026-09-20：S4-VS4A 订单字段、头像与列表信息复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R65 | 业务 / 验收 | 缺失昵称、头像或商品名称时，是否从账号隔离的本地会话/商品数据聚合，而不是回退显示买家姓名、用户 ID 或商品 ID | root + orders_display_review | PASS | `apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`apps/api/scripts/orders-smoke.mjs`、`apps/api/scripts/orders-postgres-smoke.mjs` |
| S5-R66 | UI / 交互 | 列表是否只展示昵称/商品名称，头像 URL 是否渲染真实头像，无头像时不显示首字，昵称是否仍保留姓名 hover | root + orders_display_review | PASS | `apps/web/src/features/orders/components/OrderTable.tsx`、`OrderTable.test.ts`、订单桌面/移动截图 |
| S5-R67 | 质量 / 交付 | 迁移、构建、全量测试、PostgreSQL 持久化与 Chrome/CDP 订单旅程是否在 merge lock 后于 master 重跑通过 | root | PASS | merge `490e145`；`npm run typecheck`、`npm test`、`npm run build`、`npm run db:migrate`、`npm --workspace apps/api run test:orders:postgres`、`npm run test:e2e:chrome:orders`、`docker compose config --quiet`、`git diff --check` |

本轮结论：订单列表字段与头像聚合修订已通过复审并合入 `master`；详情抽屉内容仍按用户更正保留原样。真实外部 seller 权限与发布级回滚风险继续沿用 `S4-VS4A` 既有结论，不以受控 fixture 代替真实外部验收。

### 2026-09-20：S4-VS4A 订单状态筛选边界复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R68 | 业务 / 状态机 | “待发货”“待收货”“待评价”是否按已支付、订单、发货和售后 canonical 字段组合筛选，避免把未付款、待发货或退款订单误归入“待评价” | root + verify_pending_review_filter | PASS | `apps/web/src/features/orders/order-status.ts`、`apps/web/src/features/orders/order-status.test.ts` |
| S5-R69 | 浏览器 / 回归 | Chrome/CDP 是否验证“待评价”请求包含 `paymentStatus=paid`、`orderStatus=completed`、`deliveryStatus=delivered`、`afterSalesStatus=none`，且结果不混入“待发货/待收货” | root + orders_e2e | PASS | `apps/web/scripts/e2e-orders-chrome.mjs`、`npm run test:e2e:chrome:orders`、`npm test` |

本轮结论：此前记录的“待评价”筛选异常已修复并固定为四字段组合；回归用例明确排除已退款订单。该项作为状态机回归关注点继续保留，后续修改不得退回到仅按 `orderStatus=completed` 判定。详情抽屉内容本轮仍保持不变，交付动作继续后置至 `S4-VS4B/C`。
### 2026-09-20：S4-VS7A Settings API Key 首片复核

本节只复核当前实现和受控证据，不把 MemoryStore smoke、构建成功或页面可打开升级为发布级通过。

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R59 | 业务 / 验收 | `/settings` 是否要求明确 `accountId`，并支持 API Key 引用的列表、创建、编辑、轮换、启用、禁用、撤销；密钥是否不回显 | root + 待人工复核 | READY_FOR_REVIEW | `apps/web/src/features/settings/`、`apps/api/src/credential-store.ts`、`apps/api/scripts/credential-store-smoke.mjs`；受控 smoke 覆盖 create/list/rotate/status/version conflict/revoked guard |
| S5-R60 | 架构 / 数据流 | CredentialStore 是否独立于通用 Settings 保存入口，是否使用 `credential_refs` / `credential_values`、AES-256-GCM、fingerprint、scope、expectedVersion、Idempotency-Key 和审计摘要 | root + 待独立复核 | READY_FOR_REVIEW | `apps/api/migrations/018_credential_store.sql`、`apps/api/src/credential-crypto.ts`、`apps/api/src/credential-store.ts`、`apps/api/src/app.ts`；`npm --workspace apps/api run build` 已通过，真实 PostgreSQL 迁移复读尚未执行 |
| S5-R61 | 质量 / 安全 / 运维 | 是否完成真实 PostgreSQL/403/409/回滚、Chrome/CDP 双 viewport、逐状态视觉和三轮独立评审 | root + QA/安全待复核 | BLOCKED | 当前仅有 `allowInMemory=true` credential-store smoke、Web 26 files / 88 tests、typecheck/build；暂无 Settings 专属 1440×900 / 390×844 截图、真实 DB 回读或跨层浏览器证据 |

本轮结论：`S4-VS7A = READY_FOR_REVIEW`。实现已形成可审计首片，但 `S5-RISK-026` 及新增的 migration/视觉证据风险仍开放；未达到 `PASS`，不得宣称已完成发布级 Settings。

### 2026-09-20：S4-VS7A 真实证据增量复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R62 | 业务 / 验收 | `/settings` 账号隔离、create/rotate/disable/revoke、刷新后状态与明文不回显 | root + Chrome/CDP | PASS（受控链路） | `npm run test:e2e:chrome:settings`；`docs/evidence/stage5/S4-VS7A/screenshots/` |
| S5-R63 | 架构 / 数据流 | 真实 PostgreSQL migration 018、ciphertext/key_version/checksum、PG ref 投影指纹与 API 脱敏 | root + settings_audit | PASS（临时 PostgreSQL） | `npm --workspace apps/api run test:postgres:credentials`；`apps/api/scripts/credential-store-postgres-smoke.mjs` |
| S5-R64 | 质量 / 安全 / 视觉 | 403/409、secret 不进入 URL/localStorage/input、1440×900/390×844 双端视觉与短标签导航 | root + prototype_audit | PASS（受控环境） | `apps/web/scripts/e2e-settings-chrome.mjs`；`docs/evidence/stage5/S4-VS7A/README.md` |

增量结论：`S4-VS7A` 已完成首片真实浏览器与临时 PostgreSQL 证据闭环，状态仍保持 `READY_FOR_REVIEW`；发布级 rollback、旧明文 `auth.account_credentials` 双读单写兼容迁移和正式 merge lock 签核未关闭前，不标记 `PASS`。

### 2026-09-20：Dashboard 默认真实 API 入口修复复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R65 | 前端 / 配置 | `VITE_API_MODE=live` 且未设置 `VITE_DASHBOARD_MODE` 时是否使用真实 Dashboard API；显式 mock 覆盖是否仍可用 | root | PASS | `6522286`；`apps/web/src/app/App.tsx`、`App.dashboard-mode.test.ts`；Web 37 files / 110 tests、typecheck、build、显式 mock Chrome E2E、默认 live fullchain |
| S5-R66 | 真实全链路 | 默认模式是否完成 Chrome → API → PostgreSQL/Redis → 闲鱼 → Dashboard 回读，且不依赖显式 live 开关 | root + fullchain_audit + integration_audit | PASS | `ALLOW_SHARED_E2E=1 REQUIRE_XIANYU_ORDER_SYNC=1 npm run test:e2e:chrome:dashboard:fullchain`；`docs/evidence/stage5/S4-VS-DASHBOARD/fullchain-evidence.json` |

本轮结论：Dashboard 不再因缺少独立 `VITE_DASHBOARD_MODE` 而默认展示 mock；mock 仅作为显式测试覆盖保留。高保真视觉签核、旧 `/order-trend` 兼容接口与 rollback 门禁仍按 `S4-VS-DASHBOARD` 原范围开放。

### 2026-09-20：自动回复链路切片复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R70 | 业务 / 验收 | 闲鱼监听事件是否完成入站规范化、消息幂等、风险优先意图识别、商品/订单/会话上下文组装、受事实约束的生成与高风险转人工 | root + docs_scan | PASS（dry-run 范围） | `docs/16-auto-reply-slice.md`、`apps/api/src/auto-reply.ts`、`apps/api/src/xianyu-im-service.ts`、`npm --workspace apps/api run test:auto-reply:unit`、`npm --workspace apps/api run test:auto-reply:e2e` |
| S5-R71 | 架构 / 数据流 | 自动回复是否复用 `MessageService` 和 Store 边界，入站/出站/运行记录是否可回读，是否按 `adminId + inboundMessageId` 幂等 | root + code_scan | PASS | `apps/api/migrations/021_auto_reply_runs.sql`、`apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`npm run db:migrate`、`npm --workspace apps/api run test:auto-reply:postgres` |
| S5-R72 | 质量 / 安全 / 运维 | 是否禁止真实闲鱼发送，敏感正文是否不进入运行记录，重复事件是否不重复出站，完整门禁是否通过 | root + postgres_verify | PASS（受控验证） | E2E 断言 `/r/MessageSend/sendByReceiverScope` 调用为 0；PostgreSQL 关闭/重启后回读 `messages.messages` 与 `messages.auto_reply_runs`；`npm run typecheck`、`npm test`、`npm run build`、`npm run compose:config`、`git diff --check` |

本轮结论：自动回复 dry-run 纵向切片通过。其科学链路不是无条件直通，而是“事实先落库、风险先门禁、上下文分层、生成受事实约束、Noop 投递、审计回读”；真实发送、模型 Provider、Outbox Worker、人工接管 API 和发布级恢复继续保持后置范围。

### 2026-09-21：真实闲鱼网关 push 路径复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R73 | 外部平台 / 数据流 | 历史同步是否与买家网关 push 分离；响应与同帧 `syncPushPackage` 是否都被处理；非 200 响应是否不会被误当成功 | root + gateway_path | PASS（适配器层） | `apps/api/src/xianyu-im.ts`、`apps/api/scripts/xianyu-im-gateway.test.ts`：5/5；真实 DB 凭证 probe 连接、历史读取、`/s/vulcan` 同步帧与 ACK 证据 |
| S5-R74 | 运行时 / 可恢复性 | 应用启动是否自动恢复 listener，多个账号是否串行、单飞且有限重试；连接关闭后是否自动重连 | root + listener_fix | PASS（受控验证） | `apps/api/src/app.ts`、`apps/api/src/xianyu-im-service.ts`、`apps/api/scripts/auto-reply.test.ts`：11/11；`xianyu-im-gateway.test.ts`：断线重连通过 |
| S5-R75 | 业务 / 真实验收 | 是否已有真实买家 WebSocket push 驱动自动回复和 live 发送的完整证据 | root | BLOCKED / PARTIALLY_VERIFIED | 当前 `4310178918003.PNM` 仅存在历史导入消息，`auto_reply_runs` 为空；DB probe 未收到新的买家消息，禁止用合成事件代替 |

本轮结论：已修复网关混合帧丢失、错误响应误判、并发启动和断线恢复问题；当前应用会在启动后自动监听，不依赖管理员打开页面。真实买家 push→自动回复→真实发送仍需在 probe 等待窗口内由闲鱼外部买家产生新消息后单独归档。

| S5-R76 | 前端 / 鉴权 | 在线聊天页面在 API 重启后是否能恢复旧 CSRF token 并安全重放发送请求 | root + csrf_send_fix | PASS | `apps/web/src/api/http.ts`、`apps/web/src/api/http.test.ts`；403 `CSRF_INVALID` → session refresh → 单次重试，保留幂等键；Web 38 files / 117 tests、typecheck、build |
| S5-R77 | 业务 / 白名单 | 真实 push 缺少买家昵称时是否会因身份缺失而被错误跳过 | root + listener_ready | PASS（受控回归） | `apps/api/src/xianyu-im-service.ts`、`apps/api/scripts/auto-reply.test.ts`；按 external conversation ref 补全身份后 allowlist 通过，run persisted |
| S5-R78 | 业务 / 事件幂等 | 历史同步先落库后，真实 push 是否仍会触发一次自动回复 | root + listener_ready | PASS（受控回归） | `apps/api/src/xianyu-im-service.ts`、`apps/api/scripts/auto-reply.test.ts`；`created=false` 的 push 继续调用 `processInbound`，同一 inbound idempotent 且仅一条 outbound |

### 2026-09-21：自动回复模型 Provider 接入复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R79 | 架构 / 配置 | 自动回复是否复用 Workspace 的服务端模型配置与客户端，而不是复制一套 Provider | root + workspace_ai_scan | PASS | `apps/api/src/app.ts` 的 `createConfiguredModelClient`；复用 `API_KEY/BASE_URL/MODEL/MODEL_TIMEOUT_MS`，同一 `ModelClient` 注入 Workspace Runtime 与 `ModelAutoReplyGenerator` |
| S5-R80 | 业务 / 安全 | 规则意图和高风险门禁是否仍在模型调用前执行，模型是否只接收裁剪后的结构化事实 | root + auto_reply_provider_scan | PASS | `apps/api/src/auto-reply.ts`、`apps/api/src/auto-reply-model.ts`；system/user 双消息、商品/订单/会话分层 facts、历史与字段长度限制、敏感输出拦截 |
| S5-R81 | 质量 / 失败恢复 | Provider 成功、配置缺失、HTTP 失败是否分别落到模型回复、模板回复和失败不发送 | root + listener_ready | PASS（受控环境） | `apps/api/scripts/auto-reply.test.ts`：模型生成持久化、模型上下文裁剪、显式关闭后的模板回退、503 失败 run、不产生 outbound；`npm --workspace apps/api run test:auto-reply:unit` 18/18 |

本轮结论：自动回复已接入与 Workspace 一致的本地环境变量模型配置；配置完整时使用共享模型客户端，配置缺失时保留模板生成，Provider 失败时不回退错误模板、不发送买家消息，仅将安全错误码落库。Settings 页面凭证解析、真实 live 自动化归档、Outbox/unknown 恢复和离线模型评测仍保持后续门禁。

### 2026-09-21：S4-VS7A OpenAI API 主备配置复审

本轮在已有首片基础上复核真实主备配置、动态模型列表、PostgreSQL 复读、Agent 消费与视觉差异。

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R82 | 业务 / 验收 | 主配置与备用配置是否可分别测试、保存，更新后 Agent 是否无重启命中新配置，主失败是否自动切备用 | root + e2e_audit | PASS（真实受控链路） | `apps/web/scripts/e2e-settings-openai-chrome.mjs`；Agent 输出 `PRIMARY_V1_REPLY` / `PRIMARY_V2_REPLY` / `BACKUP_REPLY` |
| S5-R83 | 架构 / 数据流 | UI → API → CredentialStore → PostgreSQL → Agent 是否按账号隔离、角色隔离并保持密钥脱敏 | root + repo_recon | PASS（临时 PostgreSQL） | `apps/api/scripts/openai-settings-postgres-smoke.mjs`；`apps/api/src/store-postgres.ts` 指纹投影修复；迁移 024 |
| S5-R84 | 前端 / 视觉 | SellerAgent 高保真结构、动态 Model 下拉、双 viewport、成功态保持和时间线规则行是否对齐 | root + dynamic_models + e2e_audit | PASS（截图证据） | `settings-openai-*.png`；`docs/evidence/stage5/S4-VS7A/visual-diff.md` |
| S5-R85 | 质量 / 安全 / 运维 | fallback 专用审计、发布级 rollback、旧凭证兼容迁移是否完整 | root | PARTIALLY_VERIFIED | E2E 已证明切换行为；`fallbackAudit=false`，rollback/兼容迁移未执行 |

本轮结论：OpenAI API 主备配置纵向链路已实现并完成真实 PostgreSQL + Chrome/CDP 受控验证；视觉 P2（timeline 基类缺失、保存后成功态重置）已修复并重新截图。实现通过 `9be12d8` 合入 `master`，共享模型下拉控件和最终截图由 `f8ad6f3` 补齐。切片保持 `READY_FOR_REVIEW`，不得升级为发布级 `PASS`，直到 S5-R85 项开放项完成或经人工签核接受。

### 2026-09-21：Agent 动态壳层与视觉复验

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R86 | 业务 / 验收 | Agent 动态是否沿用现有左侧导航，且位于“订单管理”和“设置”之间；右侧是否只保留业务内容区 | root + prototype_visual_analysis | PASS | `apps/web/src/app/App.tsx`、`apps/web/src/app/navigation.ts`、Chrome/CDP shell assertions；`docs/agent/agent-dynamics/evidence/visual-diff.md` |
| S5-R87 | 架构 / 数据流 | 页面是否复用全局 `AccountContext`，前端职责是否拆分为 API/controller/types/views，后端是否拆分为 activity/domain/store 模块；迁移文档是否与 DDL 一致 | root + requirements_architecture | PASS（受控环境） | `apps/web/src/features/agent-dynamics/`、`apps/api/src/auto-reply-activity.ts`、`apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`docs/agent/agent-dynamics/design.md`、`apps/api/migrations/024_auto_reply_run_events.sql` |
| S5-R88 | 质量 / 视觉 / 端到端 | 是否先对比原型 HTML/截图与样式 token，再用真实 PostgreSQL + Chrome/CDP 生成桌面、抽屉、移动主页面和移动抽屉证据；是否移除原型 sidebar/topbar 且无双重滚动 | root + prototype_visual_analysis | PASS（受控环境） | `npm run verify:agent-dynamics`；`docs/agent/agent-dynamics/evidence/visual-diff.md`；`docs/agent/agent-dynamics/evidence/evidence.json`；18/18 核心样式 token 语义匹配 |

本轮结论：Agent 动态已完成设计、模块化实现、真实 PostgreSQL → API → Chrome/CDP → 截图闭环；当前主线合入后保持受控环境 PASS，真实闲鱼外部 push/live 发送仍不属于本轮验收范围。

### 2026-09-22：卡券批次序号、列表布局与创建时间排序复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R89 | 业务 / 验收 | 卡券 ID 是否为从 1 开始的可回收序号，删除后新建是否复用最小空缺，默认是否最新创建置顶 | root + final_backend_audit | PASS（MemoryStore/API 受控验证） | `apps/api/scripts/coupons-smoke.mjs`；DELETE 删除、序号复用、默认 `createdAt DESC`、旧 UUID URL 兼容与作废批次不可复活断言 |
| S5-R90 | 架构 / 数据流 | 内部 UUID、`sequence_id`、部分唯一索引和显式 voided 历史查询是否保持一致 | root + final_backend_audit | PASS（静态 + API 受控验证） | `apps/api/migrations/029_coupon_batch_sequence.sql`、`apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`docs/02-data-api.md`、`docs/02-database-schema.md` |
| S5-R91 | 前端 / 视觉 / 端到端 | 空态居中、表格自适应高度与内部滚动、备注列、名称纯文本展示、时间列升降序交互是否完整 | root + frontend_sorting | PASS（Chrome/CDP + Vitest） | `npm run test:e2e:chrome:coupons`；`apps/web/src/features/coupons/components/CouponBatchTable.test.ts`；63 files / 204 tests；桌面/移动断言 |
| S5-R92 | 质量 / 发布 | 全量类型检查、构建、API/Web 测试、smoke、Compose 配置和差异卫生是否通过 | root | PARTIALLY_VERIFIED | `npm run typecheck`、`npm test`、`npm run build`、`node apps/api/scripts/coupons-smoke.mjs`、`node apps/api/scripts/products-smoke.mjs`、`docker compose config --quiet`、`git diff --check`；真实 PostgreSQL 迁移/rollback 因环境缺失未执行 |

本轮结论：用户提出的全部卡券列表与批次序号需求已在代码和受控跨层路径中覆盖；真实 PostgreSQL 迁移 apply/rollback/复读仍待具备 `DATABASE_URL` 与运行中数据库后复审，当前切片保持 `READY_FOR_REVIEW`。

### 2026-09-22：Dashboard 待人工处理铃铛卡片复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R93 | 业务 / 验收 | 铃铛是否位于“待人工处理”卡片内，风险项点击是否复用既有详情抽屉，桌面底部风险条和移动顶部重复入口是否移除 | root + dashboard_risk_card_audit | PASS | `DashboardViews.tsx`、`DashboardPage.tsx`；DashboardViews 单测 6/6；桌面 Chrome/CDP 气泡断言 |
| S5-R94 | 架构 / 数据流 | 弹层是否作为 KPI 卡片内局部状态实现，是否复用 `riskTodos` 与 `onOpenTodo`，未引入新的导航或 API 状态 | root + dashboard_risk_card_audit | PASS | `PendingManualKpiCard`；现有 `openTodo()` 与风险 drawer；桌面/移动共用组件 |
| S5-R95 | 前端 / 视觉 / 可访问性 | 右列移动卡片定位、Escape/外部点击关闭、动态 aria 文案、固定 1440×900/390×844 截图与构建回归 | root + dashboard_risk_card_audit | PASS（受控环境） | `dashboard.css`；`npm --workspace apps/web run typecheck`；`npm --workspace apps/web run build`；`npm --workspace apps/web run test:e2e:chrome:dashboard`；`docs/evidence/stage5/S4-VS-DASHBOARD/screenshots/` |

本轮结论：铃铛已按最新产品约束嵌入“待人工处理”小卡片，不新增顶部标题栏。目标切片达到 `READY_FOR_REVIEW`；全量 Web 单测仍有一个既有 `AccountContextProvider` 测试夹具失败，未将其误报为本切片通过。
### 2026-09-22：S4-VS1 登录 / 删除弹窗视觉复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R97 | 业务 / 验收 | 登录弹窗是否只保留右上角关闭按钮，删除账号是否改为产品内确认弹窗 | root + visual_compare | PASS | `AccountLoginModal.tsx`、`AccountDeleteModal.tsx`；Chrome/CDP 删除确认链路 |
| S5-R98 | 前端 / 视觉 | 680×540 登录尺寸、430px 删除尺寸、遮罩、白卡片背景、16px 圆角、阴影和移动端收窄 | root + visual_compare | PASS | `docs/design/account-login-dialog-design.html`；`account-dialog-design-1440x900.png` / `account-dialog-design-390x844.png`；对应实现截图 |
| S5-R99 | 交互 / 状态 | 二维码区域固定 292px，生成中提示居中，桌面端无内部滚动条，提交中删除按钮禁用 | root + component_tests | PASS | `QrLoginView.test.tsx`、`AccountDeleteModal.test.tsx`、`AccountLoginModal.test.tsx`；`npm --workspace apps/web run test -- --run ...` |
| S5-R100 | 质量 / 浏览器 | 真实 Vite + API + Chrome/CDP 是否完成登录 → 搜索 → 切换 → 删除 → 退出，并验证生成中/展示后扫码区不跳动 | root | PASS（受控 harness） | `npm --workspace apps/web run test:e2e:chrome`；同一 1440×900 视口下布局偏差 ≤1.5px；`docs/evidence/stage5/S4-VS1/screenshots/` |

本轮结论：账号登录和删除弹窗的视觉 P2 已修复并通过设计稿对比、组件回归和 Chrome/CDP 实拍复验；生成中与二维码展示后共用固定状态行和扫码区几何，消除灰色区域跳动。全量 Web 测试仍有既有 `App.dashboard-mode.test.ts` 失败（`useAccountContext` 缺少 Provider），与本轮账号弹窗改动无关；不因该既有失败扩大本次提交范围。

### 2026-09-22：Dashboard 铃铛气泡视觉修正复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R96 | 前端 / 视觉 / 端到端 | 气泡是否贴近铃铛、铃铛是否具备足够对比度、移动右列是否不溢出 | root + dashboard_risk_card_audit | PASS（受控环境） | `DashboardViews.tsx`、`dashboard.css`；桌面/移动截图；E2E 几何断言 |

本轮结论：气泡从卡片底部定位改为铃铛触发器定位，铃铛改为实心高对比样式；当前修正分支等待人工审核后再合入 `main`。

### 2026-09-22：在线聊天字体层级与可读性复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R101 | 前端 / 视觉 | 会话昵称、消息正文、人工/AI、已读/未读、composer 辅助文案和工具按钮是否建立清晰层级 | root | PASS | `apps/web/src/features/messages/components/messages.css`；`messages-typography.test.ts`；消息目录定向 44/44 |
| S5-R102 | 前端 / 可读性 | 搜索框是否与侧栏内容对齐，外发气泡链接是否与背景形成足够对比 | root | PASS | `apps/web/scripts/e2e-messages-chrome.mjs`；Chrome/CDP messages E2E；桌面/移动截图证据 |

本轮结论：用户已确认当前平台设计并明确要求合入 `main`。在线聊天字体层级、会话标签、搜索框对齐、composer 控件与外发链接对比度均通过人工审核和自动化验证，切片进入 `READY_FOR_MERGE`。

### 2026-09-22：商品自动化四流程实现复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R103 | 业务 / 验收 | 商品级四条自动化规则、卡券选择入口、批量配置和保存/版本冲突是否按已确认交互稿落地 | root + design_baseline_alignment | PASS（受控前端链路） | `apps/web/src/features/products/components/ProductsPage.tsx`、`apps/web/src/features/product-automation/components/AutomationDrawer.tsx`、`apps/web/scripts/e2e-product-automation-chrome.mjs` |
| S5-R104 | 架构 / 数据流 | 触发器、工作流、持久化账本、租约、重试、评价事实、求评状态和账号/会话/商品归属是否分层且可恢复 | root + backend_persistence_reliability | PASS（外部执行适配器除外） | `apps/api/src/product-automation.ts`、`apps/api/src/product-automation-trigger.ts`、`automation.execution_ledger`、`npm --workspace apps/api run test:product-automation` 21/21 |
| S5-R105 | 质量 / 视觉 / 端到端 | API、PostgreSQL、跨层 entry、Chrome/CDP 和 12 张双 viewport 截图是否真实执行；严格像素 diff 是否通过 | root + verification_audit + visual_pixel_tuning | PARTIALLY_VERIFIED | `npm run typecheck`、`npm --workspace apps/api run test:product-automation:postgres`、`npm --workspace apps/api run test:product-automation:entry`、`npm --workspace apps/web run test:e2e:chrome:product-automation`、`docs/evidence/product-automation/pixel-diff-report.json` |

本轮结论：商品自动化切片已完成受控实现与可靠性验证，但严格视觉 diff 仍有 14.39%–25.57% 不同像素，且真实闲鱼 MTOP/IM 执行适配器尚未接入；因此保持 `PARTIALLY_VERIFIED / BLOCKED`，不得宣称真实自动发货、改价、赠品或求评已生产验收。

### 2026-09-22：全量回归收口复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R106 | 质量 / 回归 | API 全量 smoke、Web 全量单测以及商品自动化定向门禁是否在修复既有回归后重新通过 | root + verification_audit | PASS | `npm --workspace apps/api run test`；`npm --workspace apps/web run test`（83 files / 279 tests）；`npm run typecheck`；`git diff --check` |

本轮结论：订单 Cookie snapshot 兼容、Dashboard provider 夹具和 Workspace CSS 断言的既有回归已修复并重新验证；商品自动化切片的唯一未关闭阻塞仍是真实闲鱼外部执行适配器和严格像素级视觉验收。

### 2026-09-23：卖家说话风格提示词优化追踪复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R107 | 质量 / CLI | 命令与脚本文件是否统一改名且不保留旧命令，至少 10 轮真实会话与 98 分阈值是否仍受约束 | root | PASS | `package.json`、`apps/api/package.json`；CLI `--help`；`seller-style-prompt-optimizer.test.ts` |
| S5-R108 | 可观测性 | 是否展示提示词版本、问题集、10 维评分、逐题结果、修订反馈与最终状态，且不把历史问答写入最终提示词 | root | PASS | `style-optimization-trace.md/json` 渲染测试；历史回答泄漏回归测试；定向测试 15/15 |
| S5-R109 | 构建 / 主线 | 合并后 API build、diff 检查和主线文件清理是否通过 | root | PASS | merge `58473ff`；API build；`git diff --check`；登记表 `CLEANED` |

本轮结论：卖家风格提示词优化已改为可审计的自迭代流程并合入 `main`；真实 PostgreSQL/模型 provider 端到端仍待具备凭证的环境复验。

### 2026-09-24：商品自动化单流程配置与局部校验修复

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R110 | 业务 / 契约 | 单商品保存是否只下发当前流程，未配置流程是否保留原值并跳过本次校验 | root | PASS | `AutomationDrawer.tsx`、`api.ts`；Web 商品自动化 14/14；`product-automation.test.ts` 单流程 patch 回归 |
| S5-R111 | 架构 / 数据流 | 单商品与批量保存是否共享规则级 patch 逻辑，卡券绑定是否仅在卡券规则提交时同步 | root | PASS | `product-automation.ts`、`store-memory.ts`、`store-postgres.ts`；API 商品自动化 31/31 |
| S5-R112 | 质量 / 端到端 | 真实 API 模式下，商品列表→自动化抽屉→卡券选择→保存→重开是否通过 | root | PASS（受控环境） | `npm --workspace apps/web run test:e2e:chrome:product-automation`；Chrome/CDP live E2E |

本轮结论：商品自动化保存契约已改为按规则 patch；单流程保存只校验当前规则并保留其余配置，受控 API/Web/Chrome/CDP 门禁通过。真实闲鱼外部 mutation 和严格视觉像素 diff 仍沿用既有开放边界。

### 2026-09-24：卡券配置驱动发货链路迁移与耦合清理

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R113 | 业务 / 验收 | 固定文字、批量数据、API、图片四类卡券及备注变量、延迟、多规格是否能被正常发货链路消费；无需邮寄是否只对真实发货生效 | root | PASS（受控 E2E） | `apps/api/src/coupon-delivery.ts`、`apps/api/src/product-automation-xianyu.ts`、`apps/api/scripts/product-automation-coupon-delivery-e2e.test.ts` 11/11 |
| S5-R114 | 架构 / 数据流 | 配置驱动卡券是否不再要求手工导入条目；历史无关字段是否从 reservation 与存储 schema 移除；Memory/PostgreSQL 是否保持一致 | root | PASS | `store-memory.ts`、`store-postgres.ts`、`domain.ts`、`038_remove_coupon_quark_fields.sql`；reservation Memory 6/6；PostgreSQL reservation smoke |
| S5-R115 | 质量 / 构建 / 回归 | API/Web 类型检查、构建、商品自动化回归和 Web 全量单测是否通过 | root | PASS（受控环境） | `npm run typecheck:api`、`npm run typecheck:web`、`npm run build:api`、`npm run build:web`、`npm --workspace apps/api run test:product-automation`、Web 84 files / 291 tests、`git diff --check` |

本轮结论：参考项目的四类配置消费逻辑已迁移到统一适配器；公开创建/更新、reservation 和存储 schema 均不再包含历史无关字段，配置型卡券无需先导入手工条目即可执行。评价赠品即使勾选无需邮寄也只发送 IM，不调用闲鱼确认发货接口。本切片保持 `READY_FOR_REVIEW`，不把受控 E2E 等同于真实闲鱼生产 mutation 验收。

### 2026-09-24：卡券发券可靠性修复合入复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R116 | 业务 / 验收 | 多规格订单是否持久化 `skuSpec` 并用于卡券精确匹配；图片说明文本断线后是否有限重试且不重复落库 | root | PASS（受控链路） | `039_order_sku_spec.sql`、`xianyu-order-mapper.ts`、`product-automation-xianyu.ts`；卡券回归 13/13；商品自动化 31/31 |
| S5-R117 | 架构 / 数据流 | Memory/PostgreSQL 订单读写、重启复读和发送 request ID 是否保持一致 | root | PASS | `store-postgres.ts`、`orders-postgres-smoke.mjs`、`product-automation-coupon-delivery-e2e.test.ts`；订单 PostgreSQL persistence smoke |
| S5-R118 | 质量 / 主线 | 合入 `main` 后构建、回归、PostgreSQL smoke 和 diff-check 是否通过 | root | PASS | merge `4486592`；`npm run build:api`；卡券回归 13/13；商品自动化 31/31；`npm --workspace apps/api run test:orders:postgres`；`git diff --check` |

本轮结论：提交 `992f9ef` 已在 merge lock 内以 `--no-ff` 合入 `main`。受控回归和 PostgreSQL 订单持久化门禁通过；真实闲鱼外部 mutation 仍保持隔离测试账号复测边界。

### 2026-09-24：卡券可重复使用与关联删除确认修复复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R119 | 业务 / 验收 | 卡券发货提交后是否仍为可用状态，是否可以使用新的 execution key 再次发货且不再出现“已耗尽” | root | PASS | `store-memory.ts`、`store-postgres.ts`、`040_reusable_coupons.sql`；reservation Memory 6/6；PostgreSQL reservation smoke |
| S5-R120 | 业务 / 交互 | 删除已关联商品的卡券是否二次提醒，取消是否保留卡券，确认后商品侧是否移除卡券信息 | root | PASS（受控 E2E） | `CouponDeleteConfirmModal.tsx`、`coupons-smoke.mjs`、Chrome/CDP coupons E2E 连续 2 轮 |
| S5-R121 | 质量 / 回归 | API/Web 类型检查、构建、全量单测和跨层 smoke 是否通过 | root | PASS | API 全量 smoke；API/Web typecheck、API/Web build；Web 88 files / 303 tests；Chrome/CDP coupons E2E Memory 2 轮 + PostgreSQL 1 轮；`git diff --check` |

本轮结论：卡券不再按单次发货耗尽；删除已关联商品的卡券会在统一产品弹窗中二次确认，并在商品列表/详情侧实时消失。提交 `ab0b989` 已以 `--no-ff` 合入 `main`，merge commit 为 `ac6fad8`；主线定向复验通过。

### 2026-09-24：卡券删除弹窗与启用开关 follow-up

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R122 | 业务 / 交互 | 删除弹窗颜色是否参考创建弹窗，内容与按钮区是否有间距，长名称是否可悬停查看，关联商品是否仍二次提醒 | root + acceptance_review | PASS | `CouponDeleteConfirmModal.tsx`、`coupons.css`、`CouponDeleteConfirmModal.test.tsx`；Chrome/CDP 删除链路 |
| S5-R123 | 前端 / 视觉 | 图片内容是否先显示小图，点击后是否打开大图；状态列是否改为语义 switch，切换中是否置灰并移除旧启用/禁用菜单 | root + visual_review | PASS（受控浏览器） | `CouponBatchTable.tsx`、`CouponBatchTable.test.ts`、`docs/evidence/stage5/S4-VS3/screenshots/`；Memory/PostgreSQL Chrome/CDP E2E |
| S5-R124 | 架构 / 数据流 | 新建默认 active，未启用或非买家可交付卡券是否被自动化发送拒绝；批量数据可重复使用时是否按成功发送次数轮换 | root + data_flow_review | PASS | `coupons/api.ts`、`product-automation.ts`、`store-memory.ts`、`store-postgres.ts`；API 商品自动化 32/32；Memory reservation 7/7；PostgreSQL reservation smoke |
| S5-R125 | 质量 / 发布 | 类型检查、构建、全量测试、API smoke、真实 API + Chrome/CDP + PostgreSQL 是否完成 | root + verification_audit | PASS（受控环境） | API/Web typecheck；API/Web build；API 全量测试；Web 88 files / 304 tests；`coupons-smoke.mjs`；Chrome/CDP Memory 1 轮 + PostgreSQL 1 轮；`git diff --check` |

本轮结论：卡券删除弹窗视觉和交互问题已修复；状态列统一为启用开关并覆盖加载禁用态；自动化发送只消费启用的买家可交付卡券；批量数据卡保持可重复使用并按成功发送次数轮换。受控跨层门禁通过，真实闲鱼外部 mutation 仍保持既有隔离测试账号边界。提交 `adfd372` 已以 `--no-ff` 合入 `main`，merge commit 为 `aff9390`；主线 typecheck、build、全量测试、定向回归、Memory/PostgreSQL Chrome/CDP E2E 与 diff-check 复验通过。

### 2026-09-24：商品发布官方主流程回放复审

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R126 | 业务 / 前端 | 图片与描述驱动的规格提示、官方四种发货设置、一口价邮费必填、地址跳过状态是否在桌面/移动端可见且与请求契约一致 | root | PASS（受控环境） | `ProductPublishForm.tsx`、`product-publish.ts`、`validation.ts`、`product-publish.test.ts`；商品发布视觉回归桌面/移动截图 |
| S5-R127 | API / 数据流 | 图片上传、属性推荐、发布接口的顺序；固定邮费字段映射；发布成功后本地 `published` 与 `externalProductRef` 持久化；Provider 驱动文案优化 | root | PASS（受控环境） | `apps/api/src/product-publish.ts`、`apps/api/scripts/product-publish.test.ts`；API 发布 3/3；视觉回归 persistence passed；`official-flow.fixture.json` |
| S5-R128 | 质量 / 外部验收 | 是否已在真实闲鱼账号完成一次受控外部发布并核对商品详情页 | root | PARTIALLY_VERIFIED | 真实外部浏览器/账号发布本轮未执行；已保留脱敏回放 fixture，禁止将 stub/fixture 证据升级为真实外部发布通过 |

本轮结论：本地前端、API、持久化与脱敏回放链路已按官方主流程完成并通过受控验证；地址流程按用户要求暂时跳过。真实闲鱼外部发布仍需在隔离账号/当前登录态下补做一次人工或可审计 E2E 复核。

### 2026-09-28：商品发布失败修复与真实外部复验

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R138 | 根因 / API | 图片上传后是否按官方顺序触发属性推荐，推荐失败是否阻止继续发布，标题与描述是否分离传输 | root | PASS | `apps/api/src/product-publish.ts`、`apps/api/scripts/product-publish.test.ts`；API 发布 6/6 |
| S5-R139 | 前端 / 交互 | 图片上传且标题、描述齐全时是否自动预览官方规格，发布前是否可以修正，地点是否可编辑 | root | PASS | `ProductDrawer.tsx`、`ProductPublishForm.tsx`、`product-publish.test.ts`；Web 定向 26/26 |
| S5-R140 | 数据 / 契约 | 显式库存是否从发布配置和 payload 中彻底删除；官方地点结构是否写入 `itemAddrDTO` | root | PASS | API/Web tests；`quantity` 不在发布请求、草稿元数据或审计字段中 |
| S5-R141 | 外部平台 / 真实发布 | 真实账号是否完成 5 张图片上传、官方推荐、发布，并可通过详情查询最终商品 | root | PASS（真实账号） | admin/account 脱敏记录；商品 `1086738034344`；详情成功、标题/价格/5 图/默认 `quantity=1` 与本地 `published` 复读一致 |
| S5-R142 | 质量 / 浏览器回归 | 当前发布表单是否完成真实 Chrome/CDP 草稿创建、详情、编辑、刷新和视觉回归 | root | PASS | `test:e2e:chrome:products` 通过；商品发布视觉回归桌面/移动 `layoutParity: passed`；API/Web 定向测试、Web typecheck/build、`git diff --check` 通过 |

本轮结论：发布失败根因已修复；上传图片触发官方推荐、发布前预览与修正、所在地同步、无显式库存配置和标题/描述分离均已落地。最终商品已在闲鱼可查，外部验收商品为 `https://www.goofish.com/item?id=1086738034344`。另一次旧 payload 产生的 `1087804453696` 仅保留作标题覆盖根因证据。

### 10.9 QR 登录成功回调账号恢复冲突修复（2026-09-25）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R129 | 后端 / 账号归属 | 已扫码成功但历史禁用账号和撤销 scope 仍占用 `(platform, seller_ref)` 唯一键时，QR 回调是否复用并恢复原账号而非误报 `CONFLICT` | root | PASS | `apps/api/src/services.ts`、`apps/api/src/store-memory.ts`、`apps/api/src/store-postgres.ts`、`apps/api/src/app.ts`；内存回归、PostgreSQL 恢复 smoke |
| S5-R130 | 质量 / 回归 | Cookie 更新、QR renewal、API 全量测试与合并后主线验证是否通过 | root | PASS | `account-login-recovery.test.ts`、`account-login-recovery-postgres-smoke.mjs`、`xianyu-cookie-login-update.test.ts`、`xianyu-qr-login-smoke.mjs`；API 58/58 + 详情 17/17 |

本轮结论：QR 成功回调与 Cookie 登录统一使用登录专用账号解析/恢复路径；软删除账号可在同一管理员历史归属下恢复 scope 并重新进入 `pending`，避免唯一键冲突导致二维码成功后被误判失败。提交 `425382d` 已以 `--no-ff` 合入 `main`，merge commit 为 `b21be57`。真实闲鱼 APP 扫码、外部 Cookie 与资料同步仍由既有人工验收门禁承接。

### 闲鱼发送链路修复复审（本轮）

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R135 | 前端 / 实时 | 实时连接建立后，会话列表轮询是否改用本地快照，避免外部刷新竞态；发送是否有确定性超时 | root | PASS（受控环境） | `apps/web/src/features/messages/controller.ts`、`controller.test.ts`；`npm run test:e2e:chrome:messages` |
| S5-R136 | 浏览器 / 进程 | 自动验证是否不再显示空白窗口，CDP 关闭/超时是否回收进程树 | root | PASS（本机 Chrome/CDP） | `apps/api/src/xianyu-verification-browser.ts`、`xianyu-verification-browser.test.ts`、CDP fixture |
| S5-R137 | 外部平台 / 真实发送 | 白名单买家是否完成真实滑块后外发并落库 | root | BLOCKED | 真实 NC 页面加载正常，但三次轨迹均返回 `验证失败(error:fALStr)`；保留 `ACCOUNT_VALIDATION_REQUIRED`，无外部消息引用 |

本轮结论：本地发送状态和实时消息竞态已修复并通过真实浏览器 E2E；真实闲鱼外部挑战仍阻塞自动发送，未把受控夹具或失败重试解释为真实发送成功。

### 2026-10-06 在线聊天发送超时根因复核

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R145 | 根因 / IM 网关 | 慢速入站推送处理是否会阻塞已收到的发送响应，最终触发前端 40 秒超时 | root | PASS（可复现） | 隔离 worktree 的 main 基线运行 `xianyu-im-gateway.test.ts` 时，新增回归稳定以 `XIANYU_IM_TIMEOUT:/r/MessageSend/sendByReceiverScope` 失败；修复后同一回归 17/17 通过 |
| S5-R146 | 环境 / 生产证据 | 是否取得当前生产容器日志以核对同一请求链路 | root | PARTIALLY_VERIFIED | 本机 Docker CLI 可用但 `docker compose ps/logs` 未返回运行态或日志；本轮不宣称已完成生产日志闭环，仅确认代码级根因与症状一致 |

本轮根因结论：`XianyuImClient` 原先把所有入站帧排入同一串行 `incomingChain`，慢速买家推送/自动回复处理会延迟后续发送响应帧的 pending resolve；基线回归已稳定复现超时。修复为先同步结算 pending response，再将推送业务处理排入串行队列。
### 2026-09-28：商品目录知识库闭环

| 评审编号 | 类型 | 评审重点 | 评审人 | 结论 | 证据 |
| --- | --- | --- | --- | --- | --- |
| S5-R138 | 业务 / 交互 | 商品列表是否仅保留操作列按钮，知识库按钮名称是否明确；空内容是否显示短横线，有内容是否省略并支持悬浮查看全文 | root | PASS | `ProductTable.tsx`、`ProductTable.test.tsx`；Chrome/CDP 商品 E2E |
| S5-R139 | 前端 / 弹窗 | 新增、查看、编辑、保存和未保存关闭确认是否可用；弹窗内容、按钮、错误态和自适应编辑区是否正常 | root | PASS | `ProductKnowledgeBaseModal.tsx`、`ProductKnowledgeBaseModal.test.tsx`；Chrome/CDP 商品 E2E |
| S5-R140 | 数据 / 隔离 | 知识库是否通过商品 PATCH 持久化到数据库，并按 accountId、商品 configVersion 做范围和并发保护 | root | PASS | `products-smoke.mjs`、`products-postgres-smoke.mjs`；Memory/PostgreSQL smoke |
| S5-R141 | Agent / 回归 | `get_product_info` 与 `list_shop_products` 是否继续返回商品知识库，且不跨账号读取 | root | PASS | `auto-reply-product-lookup.test.ts`、`auto-reply-agent.test.ts`；API auto-reply unit 221/221 |

本轮结论：商品目录知识库已完成列表展示、查看/编辑弹窗、账号隔离、数据库持久化和 Agent 消费闭环；受控 UI、Memory/PostgreSQL 与 Agent 回归均通过。

## 2026-10-05 Workspace 平台接管编排复审

- 文档依据：docs/PRD.md、docs/00-scope.md、docs/02-data-api.md、docs/04-plan.md 与 docs/agent/workspace/WS-VS-01~05。
- 代码复核：WorkspaceCommandOrchestrator 是唯一 Workspace 领域命令入口，读取路径委托现有服务；写路径保留账号 scope、Confirmation、Outbox、Audit 和幂等边界。
- 定向验证：npm run build、node --import tsx --test scripts/workspace-commands.test.ts（9/9）、npm run test:workspace-platform、git diff --check 通过。
- 结论：账号健康/恢复、经营分析与建议、商品查询/同步/编辑/知识库/自动化规则、卡券 CRUD/关联/启停/作废/复制、订单查询/同步/详情/交付预览、Agent 动态与配置、模型配置读取/保存/连通性测试已接通；订单交付写链路与商品外部发布发布级证据仍开放，故本轮为 PARTIALLY_VERIFIED，不标记 PASS。
## 2026-10-05 S4-VS4B/C 订单交付接入复核

- `OrderDeliveryService` 已接入 Workspace 与订单 API；预览、发货、取消、重试统一走账号 scope、DeliveryRecord、execution Outbox、Idempotency-Key 和 Audit。
- `047_order_delivery_records.sql` 补齐 DeliveryRecord 持久化结构；MemoryStore HTTP smoke、Workspace confirmation、既有订单回归和 API build 均通过。
- 结论：代码层 `IMPLEMENTED / PARTIALLY_VERIFIED`；真实闲鱼 mutation、PostgreSQL migration smoke、浏览器双 viewport、外部 unknown/人工恢复演练仍保持独立发布门禁，不宣称已完成生产验收。

### 2026-10-05 S4-VS4B/C 增量可靠性修复

- 迁移 `047_order_delivery_records.sql` 已补齐 `coupon_item_id` → `coupons.coupon_items(id)` 外键，以及成功状态部分唯一索引；与 `docs/02-database-schema.md` / `docs/02-data-api.md` 契约对齐。
- PostgreSQL `createDeliveryRecord` 改为“先读、`ON CONFLICT DO NOTHING`、再读回”，避免并发幂等下依赖 no-op update 的错误结果；Memory/PostgreSQL 更新均保留省略字段。
- 重复交付请求先按账号 scope + 幂等键读回原记录，已完成订单也能正确重放；不同订单复用同一键返回 `IDEMPOTENCY_CONFLICT`。成功卡券交付写入 `couponItemId`。
- Workspace 发货动作在 Confirmation 之前复用 `OrderDeliveryService.preview`，缺少人工物流引用或卡券配置时不再生成不可执行确认卡。
- 新增 `apps/api/scripts/order-delivery-postgres-smoke.mjs`；本机执行因 `127.0.0.1:5432` 未监听而失败，记录为环境阻断，不将 Memory/HTTP smoke 升级为 PostgreSQL 验收。

### 2026-10-05 Workspace confirmation regression review

| review_id | type | focus | reviewer | conclusion | evidence |
| --- | --- | --- | --- | --- | --- |
| WS-R-01 | controller / runtime | confirm and cancel refresh the latest run and confirmation, suppress duplicate submissions, and ignore stale refresh responses | root | PASS | `apps/web/src/features/workspace/controller.ts`; API targeted tests 24/24 |
| WS-R-02 | frontend / persistence | active session and waiting confirmation rehydrate after reload or tab switch | root | PASS | PostgreSQL Chrome E2E `WS-VS-02`; desktop/mobile screenshots |
| WS-R-03 | frontend / feedback | warning action remains readable on hover and operation errors render as bottom-right toast | root | PASS | `WorkspacePage.test.ts`; `workspace.css`; screenshot evidence |

Review conclusion: workspace confirmation fixes were merged after code review and real browser verification.

### 2026-10-07 Workspace Runtime 故障复核

| review_id | type | focus | reviewer | conclusion | evidence |
| --- | --- | --- | --- | --- | --- |
| WS-R-04 | 业务 / 数据流 | 生产 Run 重复查询、确认回交、批次 18 状态、`batchId` 错误与第二张卡失败路径 | root，第 1 轮 | PASS | `docs/evidence/workspace-runtime-recovery-2026-10-07.md`；生产 PostgreSQL 只读事件聚合和批次查询 |
| WS-R-05 | 架构 / 持久化 | 049 迁移允许历史多卡且同 Run 仅一张 active；续跑竞态、上下文 checkpoint 和回滚边界 | root，第 2 轮 | PASS | `workspace-confirmation-postgres-smoke.mjs`；`pi-runtime-stream.test.ts`；`docs/migrations/README.md` |
| WS-R-06 | 质量 / 前端 | 超长商品与 Skill 结果、公开链接、工具/摘要交替呈现、真实 Chrome 与 PostgreSQL | root，第 2 轮 | PASS | `npm exec -- cross-env AUTO_REPLY_AGENT_SEND_DELAY_SECONDS=0 npm test`；两条 Workspace Chrome E2E；`npm run typecheck`；`npm run build` |

本轮没有在生产重放写操作。原 Run 仍失败，批次 18 未关联商品；发布后的续办需以管理员当前会话和持久化结果为准。

### 2026-10-07 Workspace 上下文与工具事件复核

| review_id | type | focus | reviewer | conclusion | evidence |
| --- | --- | --- | --- | --- | --- |
| WS-R-07 | 业务 / 生产证据 | 两次目标 Run 的事件数量、错误状态、四次确认与空规则更新；未在生产重放写入 | root，第 1 轮 | PASS（只读取证） | `docs/operations/workspace-run-incident-20261007.md`；生产 `workspace.run_events/messages` 聚合 |
| WS-R-08 | 架构 / 数据流 | 确认续跑从事件构造有界检查点、Skill 成功结果按参数指纹恢复、旧 `arguments` 事件兼容 | root，第 2 轮 | PASS（代码级） | `workspace-context.test.ts`；`pi-runtime-stream.test.ts`；`workspace-commands.test.ts` |
| WS-R-09 | 质量 / 前端 | 隐藏原始推理和重复事件，浏览器路径仍展示计划、工具结果和最终答复；确认/取消流程分别验证 | root，第 2 轮 | PASS（隔离环境） | `messages.test.ts`；Pi 与确认/取消两条 Chrome/CDP + PostgreSQL E2E；Web 93 文件 / 376 项；API 全量使用 `AUTO_REPLY_AGENT_SEND_DELAY_SECONDS=0` 通过 |
| WS-R-10 | 合并 / 主线 | 合并提交、主线回归、工作区清理和生产复验边界 | root，第 3 轮 | PASS（合并与受控验证） | `1f918ba` 经 `--no-ff` 合入 `2f5ba65`；主线 API 定向 59/59、Web 全量 376/376、API/Web build 和 typecheck、`git diff --check` 通过；生产新 Run 待复验 |

独立人员复审与修改后生产同类 Run 复验仍待发布阶段执行；本轮结论不把隔离 E2E 等同于真实网盘任务复验。

### 2026-10-07 Workspace 首轮压缩与工具循环复核

| review_id | type | focus | reviewer | conclusion | evidence |
| --- | --- | --- | --- | --- | --- |
| WS-R-11 | 生产证据 / 根因 | 新 Run 的首轮 18,436→18,688 字符无效压缩、10 次压缩及 9 次同参商品检索 | root | PASS（只读取证） | `docs/operations/workspace-run-incident-20261007.md`；生产 Run `aeb4ba21-73de-4d1b-b16d-001ab06c9c00` 持久化事件 |
| WS-R-12 | 全链路 / 恢复 | Skill 短索引与按需检索、模型有效压缩、同参复用、写入后失效、确认续跑、UI 投影 | root | PASS（隔离环境） | API 定向 56/56、API/Web 全量、Chrome/CDP + PostgreSQL Workspace E2E、`npm run build`、`git diff --check` |

用户在当前会话明确要求保留主工作区既有无关文件并直接合入 `main`。真实生产网盘任务尚未在修复版本上复验，不能把本地结论升级为生产修复验收。
