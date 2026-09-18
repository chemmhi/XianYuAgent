---
name: xianyu-admin-design-style
description: Create or restyle XianyuSellerAgent intelligent operations console interfaces to match the distilled high-fidelity admin design system from 智能运营后台设计.
metadata:
  short-description: Xianyu admin console visual style
---

# Xianyu Admin Design Style

Use this skill when creating, revising, or reviewing XianyuSellerAgent Web Console / Human Console / intelligent operations backend UI so the result visually matches the high-fidelity prototype in 智能运营后台设计/.

## Core Visual Target

Produce a modern, professional SaaS operations console for Xianyu sellers: calm, trustworthy, information-dense but breathable, with a deep navy operations shell, white cards, subtle borders, restrained shadows, compact typography, inline SVG icons, and muted blue/green data visualization.

Canonical source files:

- 智能运营后台设计/src/components/PCDashboard.tsx: desktop shell, card density, Recharts styling, icon language, status tags, tables, and side navigation.
- 智能运营后台设计/src/components/MobileDashboard.tsx: mobile dashboard, bottom tabs, touch targets, mobile cards, status bar treatment, and responsive compression.
- 智能运营后台设计/src/App.tsx and 智能运营后台设计/src/index.css: frame dimensions, global fonts, preview background, and font imports.

## Workflow

1. Load references/design-system.md for visual tokens, layout, typography, icons, and charts.
2. For implementation-ready UI, also load references/component-recipes.md and reuse the provided component patterns instead of inventing a new visual system.
3. When coding, copy or adapt machine-readable tokens from assets/design-tokens.json; keep semantic token names intact.
4. Before finishing, compare the output against references/quality-checklist.md and fix visible mismatches in color, spacing, type scale, icon stroke, chart softness, and responsive behavior.

## Non-Negotiable Style Rules

- Use the prototype palette, not generic Tailwind blues: deep shell #1D2638, brand navy #1F3A5F, action/link blue #245A8D, page bg #F6F7F9, white cards, border #E5E7EB.
- Use Inter, Noto Sans SC, PingFang SC, Microsoft YaHei, system sans-serif in that order for mixed English/Chinese UI.
- Keep desktop content compact: 224px sidebar, 56px top bar, 22-28px content padding, 10px card radius, 14px grid gaps, 11-13px operational labels, 24px KPI values.
- Draw icons as inline SVG with currentColor, 1.3-1.5px strokes, rounded caps/joins; avoid emoji, heavy icon packs, and colorful illustrative icons for core navigation.
- Charts must be restrained Recharts-style area charts: monotone lines, 1.5px strokes, low-opacity vertical gradients, hidden axis lines/tick lines, light dashed horizontal grid, compact tooltip.
- Status/risk UI uses soft tinted pills and narrow accent bars; avoid loud solid fills except primary buttons, deep hero/status cards, and notification badges.
- Desktop and mobile are separate compositions: mobile is not a shrunken desktop. Use 390x844 mental frame, 44px status bar, compact header, 2-column KPI cards, 10-12px radius, fixed bottom tab bar.

## Output Expectations

For UI/code generation, deliver a complete, runnable result using the active project stack unless the user asks otherwise. Preserve XianyuSellerAgent product boundaries: the Web Console is the primary workbench; risk confirmations appear as explicit cards; sensitive credential values are represented only as masked references or metadata.
