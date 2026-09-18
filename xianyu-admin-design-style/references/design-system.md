# Distilled Design System

This reference distills the actual high-fidelity React prototype under 智能运营后台设计/ into reusable design rules.

## Brand Personality

- Modern SaaS admin console, not consumer social UI and not traditional ERP.
- Trustworthy, calm, operational, precise, and slightly AI-native.
- Visual energy comes from data density, deep navy shell, tiny status signals, and soft cards rather than gradients or decoration.
- Use generous whitespace inside a compact grid: every block should feel intentional and auditable.

## Color Tokens

### Core

| Token | Hex | Use |
| --- | --- | --- |
| bg | #F6F7F9 | Main desktop/mobile app background |
| previewBg | #ECEEF2 | Outer preview canvas around device frames |
| card | #FFFFFF | Main cards, top bars, tables, bottom nav |
| sidebar | #1D2638 | Desktop left navigation shell |
| sidebarHover | #253348 | Hover/darker sidebar surface |
| brand | #1F3A5F | Deep navy hero bars, avatar circles, primary emphasis |
| link | #245A8D | Primary actions, active navigation indicator, chart line |
| text | #111827 | Primary content text |
| sub | #6B7280 | Secondary text |
| muted | #475569 | Muted operational text/icons |
| border | #E5E7EB | Card/table/input dividers |

### Semantic

| Token | Hex | Use |
| --- | --- | --- |
| success | #2E7D5B | AI processed, online, positive trend, good scores |
| successBright | #6EE7B7 | Online dot/text on dark navy surfaces |
| successBg | #EAF4EF | Soft success pill background |
| successBorder | #BBE0D0 | Success chip border |
| warn | #B7791F | Manual attention, medium score, warning priority |
| warnBg | #FEF3E2 | Soft warning pill background |
| danger | #B42318 | Risk pending, alert badge, high priority |
| dangerBg | #FEF0EF | Soft danger pill background |
| dangerSoft | #FCA5A5 | Danger metric on deep navy |
| info | #2F6F8F | Informational accent bars |
| softBlueBg | #EBF3FA | Active mobile tab background |
| chartGrid | #F3F4F6 | Dashed chart grid lines |
| axis | #9CA3AF | Chart ticks and muted icons |

### Opacity Usage

- Dark shell dividers: rgba(255,255,255,0.06).
- Dark shell muted labels: rgba(255,255,255,0.25) to rgba(255,255,255,0.45).
- Deep card ghost panels: rgba(255,255,255,0.04) to rgba(255,255,255,0.12).
- Card shadow: 0 1px 3px rgba(0,0,0,0.04); tooltip: 0 4px 12px rgba(0,0,0,0.08).
- Device frame shadow only in previews: 0 20px 80px rgba(0,0,0,0.15-0.2).

## Typography

Global font stack: Inter, Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif.

- Import Inter weights 300-700 and Noto Sans SC weights 300-700 when web output permits.
- Product/section labels in mixed Chinese-English should use the same stack; do not switch Chinese to serif or display fonts.
- Numeric KPIs use font-variant-numeric: tabular-nums when shown in tables, scores, or badges.

| Role | Size | Weight | Color | Notes |
| --- | ---: | ---: | --- | --- |
| Page / store title | 16px desktop header or mobile title | 700 | text or white | Letter spacing -0.01em when large |
| Welcome/hero text | 15px | 600 | white | Used in deep navy hero/status cards |
| Card title | 13px | 600 | text | Compact admin density |
| Body / row label | 12-13px | 400-600 | text/sub | Primary operational text |
| Micro label | 10-11px | 600 | sub or muted white | Often uppercase with 0.04-0.08em tracking |
| KPI value desktop | 24px | 700 | text | Letter spacing -0.02em |
| KPI value mobile | 22px | 800 | semantic/text | Tight line height 1 |
| Badge text | 10-11px | 600-700 | semantic | Radius 4, compact padding |

## Layout

### Desktop Frame

- Target canvas: 1440 x 900 for prototype parity; 1440 x 1024 is acceptable for full app pages.
- Root: display flex, width 1440, min-height 900, background #F6F7F9, overflow hidden.
- Sidebar: 224px fixed width, full height, #1D2638, vertical navigation.
- Header: 56px height, white card background, bottom border #E5E7EB, horizontal padding 28px.
- Main content: vertical scroll, padding 22px 28px, gap 18px.
- KPI row: 4 equal columns, 14px gap.
- Chart/detail row: grid-template-columns 1fr 296px, 14px gap.
- Use card padding 16-24px depending on density; keep related cards aligned to the grid.

### Mobile Frame

- Target device: 390 x 844.
- Root: flex column, #F6F7F9, overflow hidden, position relative.
- Status bar: 44px high, white, 22px horizontal padding.
- Header: white, padding 10px 20px 14px, bottom border.
- Scroll area: padding 14px 16px, gap 14px, bottom spacer 80px for nav.
- KPI cards: 2-column grid, 10px gap, 14px internal padding.
- Bottom tabs: absolute/fixed bottom, white, top border, padding 8px 0 24px; icon container 40 x 28 with 8px radius.
- Touch buttons should be 36-44px high unless they are tiny secondary chips inside dense lists.

## Shapes, Borders, Elevation

- Default cards: white, 10px radius, 1px solid #E5E7EB, 0 1px 3px rgba(0,0,0,0.04).
- Major mobile status card: 12px radius, deep brand bg, soft circular background ornaments at 3-4% white opacity.
- Pills: 4px radius for status tags; 100px radius for online status capsule.
- Avatars: 28-36px circles; use brand fill and white text.
- Inputs/search bars: 7px radius, #F6F7F9 fill, border #E5E7EB, 12px text.
- Primary buttons: link or white-on-brand, 6-8px radius, 12-13px semibold text.
- Dividers: use borders, not thick shaded separators.

## Icon Style

- Use inline SVG, not emoji, for primary UI icons.
- Stroke icons use stroke currentColor, strokeWidth 1.3 or 1.5, rounded caps and joins where relevant.
- Filled product logo mark: 2x2 rounded square grid in white over link/brand background.
- Navigation can use minimalist glyphs or SVGs; if glyphs are used, keep them monochrome, 12px, monospace, and muted.
- Notification badge: 14px circle, danger red, 1.5px white border, 8px bold white number.

Canonical icon motifs: 2x2 dashboard grid; message lines; rounded square plus; rising analytics line; profile circle/arc; bell with badge; circle/rounded-square checkmark.

## Chart Style

- Prefer Recharts AreaChart for trends.
- type monotone, strokeWidth 1.5, dot false.
- Primary stroke #245A8D; secondary stroke #2E7D5B.
- Fill with vertical linearGradient; top opacity 0.12 for primary, 0.10 for secondary; bottom opacity 0.01.
- Grid: strokeDasharray 3 3, stroke #F3F4F6, vertical false.
- Axes: font 10px, fill #9CA3AF, no axis line, no tick line.
- Tooltip: white bg, border 1px solid #E5E7EB, 8px radius, 11px font, shadow 0 4px 12px rgba(0,0,0,0.08).
- Legend: manual compact legend beneath chart using 20 x 2px color strokes and 11px muted labels.

## Data & Status Language

- Surfaces should look operational: expose counts, percentages, elapsed time, risk state, and next action.
- Status tags use short labels such as AI 已回复, 待人工, 风险待确认, Agent 运行中, 高优先级.
- Confirmation and risk cards must summarize before/after state and show masked references instead of sensitive raw credentials.
- AI suggestions use left accent bars: 3px wide, 36px high, rounded, info or warn.
