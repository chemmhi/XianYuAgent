# Component Recipes

Use these implementation patterns to recreate the prototype style quickly.

## Token Object

Use this semantic token object in React/TypeScript/CSS variables:

C = {
  bg: '#F6F7F9', card: '#FFFFFF', sidebar: '#1D2638', sidebarHover: '#253348',
  brand: '#1F3A5F', link: '#245A8D', text: '#111827', sub: '#6B7280',
  border: '#E5E7EB', success: '#2E7D5B', warn: '#B7791F', danger: '#B42318',
  muted: '#475569', info: '#2F6F8F'
}

## Default Card

Baseline: background card, borderRadius 10, border 1px solid border, boxShadow 0 1px 3px rgba(0,0,0,0.04). Use this for KPI cards, lists, task blocks, tables, and chart containers. Vary only padding and grid span.

## Desktop Shell

- Root: display flex, width 1440, height 900, background bg, overflow hidden, global font stack, text color.
- Aside: width 224, background sidebar, flex column, full height.
- Header: height 56, card background, border-bottom, display flex, align center, padding 0 28px, gap 16.
- Main: flex 1, overflow-y auto, padding 22px 28px, column flex, gap 18.

## Sidebar Navigation

- Logo area: 32 x 32 rounded-8 logo square, link background, white 2x2 rounded tile SVG.
- Product title: 13px, weight 700, white. Subtitle: 10px uppercase, 0.04em tracking, 35% white.
- Nav item: padding 8px 10px, 6px radius, 9px icon gap, 13px label.
- Active item: rgba(36,90,141,0.5) background, white text, 2px solid #245A8D left border.
- Inactive item: transparent bg, rgba(255,255,255,0.45) text.
- Section labels: 10px, weight 600, uppercase tracking 0.08em, rgba(255,255,255,0.25).

## Top Header

- Search box: width/max-width 260px, bg #F6F7F9, border, radius 7, padding 6px 12px, 13px search icon, 12px placeholder #9CA3AF.
- Notification: 18px bell icon, 14px red badge at top-right.
- User area: 28px avatar circle in brand, 12px white bold glyph, 12px user/store name, 10px subtitle.

## KPI Card

- Card padding: 16px 20px.
- Label: 11px, sub, weight 500, margin-bottom 10, letter-spacing 0.01em.
- Value: 24px, weight 700, text, letter-spacing -0.02em, margin-bottom 8.
- Delta row: flex, center, gap 6; delta 11px semibold success; context 11px sub.

## Status Tag

Status tags are 11px semibold, padding 2px 8px, 4px radius, 0.01em tracking.

- ai: label AI 已回复, color #2E7D5B, bg #EAF4EF.
- manual: label 待人工, color #B7791F, bg #FEF3E2.
- error: label 风险待确认, color #B42318, bg #FEF0EF.

## Trend Chart

Use ResponsiveContainer 100% x 188, AreaChart margin top 4 right 0 left -22 bottom 0. Include two vertical gradients, primary #245A8D opacity 0.12 to 0.01 and success #2E7D5B opacity 0.10 to 0.01. Grid is dashed 3 3 #F3F4F6 with no vertical lines. X/Y tick font 10, fill #9CA3AF, no axis or tick lines. Tooltip uses white card, border, 8px radius, 11px font, tooltip shadow. Areas are monotone, 1.5px stroke, dot false.

## Mobile Dashboard Shell

- Root: width 390, height 844, bg, flex column, font stack, overflow hidden, relative.
- Status bar: height 44, card bg, center aligned, space-between, padding 0 22px.
- Header: card bg, padding 10px 20px 14px, bottom border.
- Main: flex 1, overflow-y auto, padding 14px 16px, column gap 14.
- Bottom nav: absolute bottom, white, top border, padding 8px 0 24px, space-around; active tab icon container 40 x 28, radius 8, bg #EBF3FA.

## Mobile Status Card

- Deep brand bg, 12px radius, 18px padding.
- Add two absolute decorative circles: 100px circle at right -24 top -24, 60px circle at right 8 top 8, both low-opacity white.
- Icon block: 40 x 40, 10px radius, rgba(255,255,255,0.12).
- Metrics row: three equal ghost panels, 8px radius, rgba(255,255,255,0.08), 18px bold value, 10px label.
- Primary button inside deep card is white bg with brand text; secondary is transparent with 20% white border.

## Tables and Lists

- Use white card container with overflow hidden; each row has 12-14px vertical padding and 1px bottom border except the last row.
- Buyer/list avatar: 36px circle, brand fill, white initial, 12px bold.
- Row title: 13px semibold; subline: 11px muted; message snippet: 11px text.
- Dense action buttons: 11px semibold, padding 5px 10px, 6px radius.
- Risk/priority tags: 10px, 2px x 7px padding, 4px radius, semantic color and 30% alpha border.

## AI Suggestion / Confirmation Cards

- Suggestions: white card, 14px padding, 10px gap, each suggestion has 3px x 36px rounded accent bar in info or warn.
- Confirmation cards: use default card, 16-20px padding, clear title, masked credential refs, before/after rows, semantic state tag, and two right-aligned actions.
- High-risk external writes must be visually explicit: danger/warn tag, concise reason, idempotency/audit hint, and a prominent confirm action.
