# Quality Checklist

Use this checklist before delivering any UI that claims to follow xianyu-admin-design-style.

## Visual Parity

- Palette matches source tokens: especially #1D2638, #1F3A5F, #245A8D, #F6F7F9, #E5E7EB.
- No generic saturated Tailwind primary colors replace the prototype navy/blue tokens.
- White cards use 10px radius, 1px border, and subtle 0.04 alpha shadow.
- Dense labels are 10-13px; KPI values are 22-24px; weights are 600-800 only where needed.
- Font stack includes Inter and Noto Sans SC before system fallbacks.
- Icons are inline SVG/currentColor with 1.3-1.5px strokes, not mixed emoji/icon-pack styles.
- Charts use soft area fills, hidden axis/tick lines, 10px muted ticks, dashed light grid, compact tooltip.

## Product Fit

- The page feels like an operations console for Xianyu sellers, not a generic CRM/ERP dashboard.
- AI state, manual review, risk confirmation, and account context are visible but compact.
- Sensitive credential or delivery data is masked or shown as reference metadata only.
- Human confirmation appears as a card or explicit action block, not as hidden automatic mutation.

## Responsive Fit

- Desktop and mobile are intentionally different layouts.
- Mobile uses 390px-wide mental frame, bottom tabs, compact status/header, and cardified tables/lists.
- Touch actions are large enough on mobile; desktop remains compact and scannable.

## Implementation Fit

- Reuse assets/design-tokens.json or equivalent semantic names.
- Keep component spacing consistent: 14px grid gaps, 16-24px card padding, 22-28px main padding.
- Preserve accessibility basics: sufficient contrast, button semantics, chart labels/tooltips, and visible focus states when implemented with CSS.
- Run the relevant project checks for the modified artifact; if only generating static design guidance, validate skill frontmatter and inspect generated files.
