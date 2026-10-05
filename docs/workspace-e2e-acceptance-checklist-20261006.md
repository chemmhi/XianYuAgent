# Workspace 端到端验收 Checklist

- 日期：2026-10-06
- 执行人：Codex /root
- 目标：使用内置浏览器进入 Workspace，沿真实对话路径完成数据写入/读取核验；失败项先修复，再复测，最后合入 `main`。
- 证据要求：每个通过项必须同时保留 UI 可见证据、列表/配置页复读证据、必要时 API/数据库持久化证据；敏感值一律脱敏。

## 执行规则

1. 仅从下表顺序认领一项，状态改为 `CLAIMED`。
2. 通过后改为 `PASS`；失败改为 `FAIL`，定位根因并修复后回到 `RETEST`，复测通过再改为 `PASS`。
3. 商品发布只验证确认/取消与本地状态，不触发真实外部发布。
4. 所有真实外部写操作（账号、商品同步/规则、卡券、订单同步、配置）必须在页面完成并在列表/配置页复读。
5. 每项记录截图路径、页面摘要、关键实体标识与复读结果。

| 顺序 | ID | 范围 | 关键动作 | 复读断言 | 状态 | 证据 |
|---:|---|---|---|---|---|---|
| 1 | ACC-CRUD | 账号管理 | 新增、编辑、查询、删除/软删除测试账号 | 账号列表显示最终名称/状态，刷新后仍一致 | PASS | `npm run test:e2e:chrome`；`docs/evidence/stage5/S4-VS1/screenshots/accounts-desktop-1440x900.png`、`accounts-mobile-390x844.png`；新增/编辑/搜索/切换/删除/登出均通过 |
| 2 | PROD-SYNC | 商品管理 | 同步商品 | 商品列表数量/目标商品与同步时间更新 | PASS | `npm run test:e2e:chrome:products`；`docs/evidence/stage5/S4-VS2/screenshots/products-desktop-1440x900.png`、`products-mobile-390x844.png`；同步/刷新后列表复读通过 |
| 3 | PROD-KB | 商品管理 | 配置商品知识库 | 商品行/详情显示知识库已绑定 | PASS | 同上商品 E2E；`products-detail-drawer-desktop-1440x900.png` 与知识库编辑/详情复读断言通过 |
| 4 | PROD-AUTO-DELIVERY | 商品自动化 | 配置自动发货 | 商品详情规则卡显示启用及参数 | PASS | `npm run test:e2e:chrome:product-automation`；`docs/evidence/product-automation/02-payment-after-delivery-desktop.png`；保存后规则面板复读通过 |
| 5 | PROD-AUTO-REPRICE | 商品自动化 | 配置自动改价 | 商品详情规则卡显示启用及价格参数 | PASS | 同商品自动化 E2E；`docs/evidence/product-automation/03-unpaid-reprice-desktop.png`；未付款改价配置复读通过 |
| 6 | PROD-AUTO-REVIEW | 商品自动化 | 配置求评价 | 商品详情规则卡显示启用及触发条件 | PASS | 同商品自动化 E2E；`docs/evidence/product-automation/04-review-gift-desktop.png`、`05-overdue-review-desktop.png`；求评价规则复读通过 |
| 7 | PROD-AUTO-GIFT | 商品自动化 | 配置发送赠品 | 商品详情规则卡显示启用及关联卡券 | PASS | 同商品自动化 E2E；`docs/evidence/product-automation/06-delivery-coupon-picker-desktop.png`；赠品卡券选择/隔离/保存复读通过 |
| 8 | PROD-PUBLISH-DRYRUN | 商品发布 | 打开发布并完成确认/取消 | 页面显示确认/Outbox，本地状态可复读，不触发外部发布 | PASS | `node apps/web/scripts/e2e-workspace-confirmation.mjs`；WS-VS-02 截图 `artifacts/real-verify/S4-VS-WS-VS-02/screenshots/workspace-confirmation-desktop-1440x900.png`、`workspace-confirmation-mobile-390x844.png`；确认与取消均通过，未触发真实发布 |
| 9 | COUPON-CRUD | 卡券管理 | 新增、编辑、查询 | 卡券列表显示最终名称/状态/库存 | PASS | `npm run test:e2e:chrome:coupons`；`docs/evidence/stage5/S4-VS3/screenshots/coupons-desktop-1440x900.png`、`coupons-create-modal-desktop-1440x900.png`；新增/编辑/启停/刷新复读通过 |
| 10 | COUPON-LINK | 卡券管理 | 关联商品 | 卡券列表与商品详情双向显示绑定 | PASS | 同卡券 E2E；`coupons-relation-modal-desktop-1440x900.png`；关联商品与解绑状态复读通过 |
| 11 | COUPON-DELETE | 卡券管理 | 删除测试卡券 | 列表不再显示或显示可恢复已删除状态 | PASS | 同卡券 E2E；更多操作/删除后列表刷新复读通过 |
| 12 | COUPON-COPY | 卡券管理 | 复制卡券 | 列表新增副本且正文/库存隔离 | PASS | 同卡券 E2E；复制后列表新增批次，正文隔离断言通过 |
| 13 | ORDER-SYNC | 订单管理 | 同步闲鱼订单 | 订单列表显示同步时间、订单号、支付/交付状态 | PASS | `npm run test:e2e:chrome:orders`；`docs/evidence/stage5/S4-VS4A/screenshots/orders-desktop-1440x900.png`、`orders-detail-drawer-desktop-1440x900.png`；本地刷新/闲鱼刷新/列表复读通过 |
| 14 | AGENT-OPENAI | 自动回复配置 | 修改 OpenAI API 兼容 Provider/模型/Base URL | 配置页显示已保存版本、脱敏 Key、连通状态 | PASS | `npm --workspace apps/web run test:e2e:chrome:settings:openai`；`docs/evidence/stage5/S4-VS7A/screenshots/settings-openai-primary-success-desktop-1440x900.png`、`settings-openai-fallback-desktop-1440x900.png`；Provider/模型/Base URL/主备/fallback/脱敏复读通过 |
| 15 | WORKSPACE-EVIDENCE | Workspace 对话 | 对上述操作做真实对话查询 | 对话结果与列表/配置页一致，Run/Message 持久化 | PASS | WS-VS-01 原生读 `artifacts/real-verify/S4-VS-WS-VS-01/screenshots/workspace-native-read-desktop-1440x900.png`；WS-VS-06A 事件回放 `artifacts/real-verify/S4-VS6A/screenshots/workspace-desktop-1440x900.png`；WS-VS-02/03/04 Confirmation/Outbox 复读通过 |

## 认领记录

- [x] 已认领 `ACC-CRUD`（2026-10-06）。
- [x] 已认领并完成 `PROD-SYNC`、`PROD-KB`、`PROD-AUTO-DELIVERY`、`PROD-AUTO-REPRICE`、`PROD-AUTO-REVIEW`、`PROD-AUTO-GIFT`、`PROD-PUBLISH-DRYRUN`、`COUPON-CRUD`、`COUPON-LINK`、`COUPON-DELETE`、`COUPON-COPY`、`ORDER-SYNC`、`AGENT-OPENAI`、`WORKSPACE-EVIDENCE`（2026-10-06）。

## 失败修复记录

| ID | 失败现象 | 根因 | 修复提交 | 复测结果 |
|---|---|---|---|---|
| WS-01 | 原生读 E2E 将“查看当前账号的商品”误路由为账号读取；修复后又被当作商品关键词过滤 | `detectCommand()` 账号泛匹配优先；商品浏览未识别“当前账号”范围 | `3c79ed6` | 改为业务词优先、对账号范围浏览禁用关键词过滤；`node apps/web/scripts/e2e-workspace-native-read.mjs` PASS，PostgreSQL/Chrome/CDP 双 viewport 与 4 Run 复读通过 |
| WS-02 | Workspace 事件展开等待不到 2 行，且断言 UI 必须显示 `run.started` | 测试指令未命中内置读意图；UI 按契约过滤生命周期事件，仅投影 `workspace.native_read` | `3c79ed6` | 将 Workspace 状态摘要识别为 Agent 原生读；验收断言改为检查实际投影工具事件，同时保留持久化 `run.succeeded` 校验；`npm run test:e2e:chrome:workspace` PASS |

