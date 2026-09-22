# XianyuSellerAgent 主 Logo 候选

这组候选专门针对两个使用面：

- 侧栏品牌角标：`32×32`，深色侧栏上要有足够对比和辨识度；
- 浏览器标签页 / favicon：`16×16`、`24×24`、`32×32`，必须减少细节、避免依赖文字。

设计依据来自 `docs/PRD.md` 与 `xianyu-admin-design-style`：闲鱼数字商品卖家、Agent 工作台、Policy Gateway、Confirmation Card、Outbox、Audit，以及当前项目的深蓝 + 方块母题。

## 五个方向

| 文件 | 主要隐喻 | 适合度 |
| --- | --- | --- |
| `01-signal-grid.svg` | 运营网格 + 数据脉冲 | 最稳妥，最贴近现有控制台 |
| `02-agent-fish.svg` | 闲鱼轮廓 + Agent 闪光 | 产品记忆点最强，最能表达“闲鱼 + Agent” |
| `03-chat-spark.svg` | 对话气泡 + 智能闪光 | 偏 Workspace，产品感更强 |
| `04-gateway-check.svg` | 闸门 + 策略确认 | 偏安全与受控执行，可信感最强 |
| `05-orbit-box.svg` | 中心业务对象 + Agent 轨道 | 偏平台化和可审计执行 |

## 推荐顺序

1. **02 Agent Fish**：最能让人第一眼理解“闲鱼卖家 + Agent”，适合作为产品主 Logo。
2. **01 Signal Grid**：最稳健、最容易和当前侧栏视觉融合，适合主 Logo / favicon 双用。
3. **04 Gateway Check**：如果更强调策略闸门、确认和安全交付，这是最合适的一套。

## 小尺寸建议

- `02-agent-fish.svg` 在 16px 下保留鱼形和闪光，但眼睛细节会变成一个单色点；适合标签页。
- `01-signal-grid.svg` 在 16px 下最稳定；如果你希望更“企业 SaaS”，优先选它。
- `03-chat-spark.svg` 和 `05-orbit-box.svg` 细节较多，更适合侧栏 32px 或登录页，不建议直接作为 16px favicon。
- 所有候选都是无文字方形 SVG，支持直接作为 `<link rel="icon" type="image/svg+xml">` 使用。

预览文件：`logo-preview.html`
