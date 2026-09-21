# 页面搜索框与下拉筛选修复证据（B 组）

## 范围

本切片仅修复真实业务页面中的页面级样式、尺寸与可审计锚点，不修改共享 `SearchField` / `SelectField` 实现，不修改 Workspace/在线聊天特调输入框，不修改 `SellerAgent/`。

覆盖页面：

- Coupons：搜索框、类型/状态/库存筛选、新建卡券按钮、卡券类型下拉。
- Agent Dynamics：顶部时间筛选、底部状态/阶段筛选、搜索框尺寸与字体。
- Settings：OpenAI Model 下拉的页面级宽度、溢出与锚点。

## 已验证

| 项目 | 命令/证据 | 结果 |
| --- | --- | --- |
| 组件回归测试 | `npm --workspace apps/web run test -- --run src/features/coupons/components/CouponToolbar.test.ts src/features/coupons/components/CouponCreateModal.test.ts src/features/agent-dynamics/components/AgentDynamicsDropdown.test.ts src/features/agent-dynamics/components/AgentDynamicsViews.test.tsx src/features/settings/components/OpenAISettingsPanel.test.ts` | 4 个文件、10 个测试通过 |
| Web 类型检查 | `npm run typecheck:web` | 通过 |
| API 构建 | `npm --workspace apps/api run build` | 通过 |
| Agent Dynamics 真实 Chrome/CDP | `npm --workspace apps/web run test:e2e:chrome:agent-dynamics` | 通过；3 个 shared select，filter width 112，search width 220，search font 11px，圆角 7px |
| Settings OpenAI 真实 Chrome/CDP | `npm --workspace apps/web run test:e2e:chrome:settings:openai` | 通过；primary/fallback 模型流程、保存与脱敏回显通过 |
| Focus/尺寸锚点 | `data-coupons-search`, `data-coupons-purpose-filter`, `data-coupons-status-filter`, `data-coupons-stock-filter`, `data-agent-dynamics-dropdown`, `data-openai-model-select` | 已写入组件并由回归测试覆盖 |

## 聚焦态与展开态证据

- Agent Dynamics 真实路由已在 Chrome/CDP 断言聚焦相关字体、尺寸、圆角与背景；关键结果：`searchFontSize=11px`、`searchWidth=220px`、`filterWidth=112px`、`headWidth=117px`、`filterRadius=7px`、`searchRadius=7px`。
- Coupons 与 Settings 的页面截图来自真实业务路由：
  - [Coupons desktop](../../stage5/S4-VS3/screenshots/coupons-desktop-1440x900.png)
  - [Coupon modal desktop](../../stage5/S4-VS3/screenshots/coupons-create-modal-desktop-1440x900.png)
  - [Settings OpenAI primary desktop](../../stage5/S4-VS7A/screenshots/settings-openai-primary-success-desktop-1440x900.png)
  - [Settings OpenAI fallback desktop](../../stage5/S4-VS7A/screenshots/settings-openai-fallback-desktop-1440x900.png)
- 下拉展开态的确定性视觉基准使用共享控件 Open preview，不把伪造菜单注入生产路由：[xianyu-admin-controls-baseline.html](../shared-controls/xianyu-admin-controls-baseline.html)。其中 `.ui-select-menu` 的阴影、选中态、hover 态、选项间距与层级是本轮页面控件的共同视觉基准。
- 真实业务页面使用原生 `<select>` 保留键盘/可访问性语义；操作系统原生选项菜单无法通过无头 Chrome 截图稳定复现，因此不将原生菜单截图冒充可比对的生产 DOM 菜单证据。

## Coupons E2E 开放问题

`npm --workspace apps/web run test:e2e:chrome:coupons` 已真实执行，但在既有启用流程失败：

```text
Error: created coupon enable button missing
apps/web/scripts/e2e-coupons-chrome.mjs:214
```

失败发生在创建、编辑、复制、禁用之后查找“启用”按钮的步骤；不是本切片新增断言，也没有通过删除测试、skip 或降低断言掩盖。该开放问题继续保留在 Coupons 全链路复核项中。

## 截图目录

- Agent Dynamics：`docs/agent/agent-dynamics/evidence/screenshots/`
- Coupons：`docs/evidence/stage5/S4-VS3/screenshots/`
- Settings OpenAI：`docs/evidence/stage5/S4-VS7A/screenshots/`

## 结论

页面级修复与回归测试已完成；Agent Dynamics 与 Settings OpenAI 真实 Chrome/CDP 通过。Coupons 全链路仍为“部分验证”，原因仅为既有“启用”按钮断言失败，交由主线最终门禁继续复核。
