# Product Automation Visual Regression Plan

## Design baseline

- Baseline: `docs/design/product-automation-interaction-v1.html` (approved interaction preview v5)
- Implementation route: `/products`
- Desktop viewport: `1440 × 900`
- Mobile viewport: `390 × 844`
- Comparison method: Chrome/CDP `Page.captureScreenshot`, then pixel diff against the baseline render at the same viewport. Any mismatch is recorded before acceptance.

## Screenshot matrix

| Order | State | Implementation screenshot | Baseline target | Viewports |
| --- | --- | --- | --- | --- |
| 01 | 商品列表（含勾选与批量入口） | `01-products-list-desktop.png` | design baseline 商品目录 table | 1440×900, 390×844 |
| 02 | 付款后自动发货抽屉 | `02-payment-after-delivery-desktop.png` | `data-panel=delivery` | 1440×900, 390×844 |
| 03 | 拍下未付款自动改价抽屉 | `03-unpaid-reprice-desktop.png` | `data-panel=reprice` | 1440×900, 390×844 |
| 04 | 评价后发送赠品抽屉 | `04-review-gift-desktop.png` | `data-panel=gift` | 1440×900, 390×844 |
| 05 | 超时未评价求评价抽屉 | `05-overdue-review-desktop.png` | `data-panel=review` | 1440×900, 390×844 |
| 06 | 选择发货卡券弹窗 | `06-delivery-coupon-picker-desktop.png` | `#relationOverlay` | 1440×900, 390×844 |

## Current evidence status

- Vitest: implemented and passing for API state transitions plus drawer/transfer/batch render contracts.
- Chrome/CDP: live-mode script passed the ordered desktop/mobile flow and saved 12 implementation screenshots. It also asserted single-item persistence after coupon selection and batch persistence after the batch dialog closes.
- Pixel diff: **RUN / FAILED (strict)** with `node apps/web/scripts/visual-regression-product-automation.mjs` using fixed 1440×900 and 390×844 viewports. The report is `docs/evidence/product-automation/pixel-diff-report.json`; current differing-pixel ratios are approximately 57.2%–62.9% on desktop and 24.0%–66.3% on mobile. Do not mark visual acceptance complete until the shell/table geometry and fixture content are aligned with the approved HTML baseline.
- Live backend API: adapter maps the UI keys to canonical `paidAutoDelivery` / `unpaidAutoReprice` / `reviewGift` / `reviewReminder`, reads `/api/v1/products/:id/automation` and `/api/v1/coupons/batches`, patches automation with `If-Match-Version`, and sends batch `POST /api/v1/products/automation/batch` with `expectedConfigVersions` plus canonical `config`.
