# Design System (MVP)

## Visual Direction

- Clean industrial-professional look
- Bright, data-focused layout with gradient atmosphere
- Dashboard-first hierarchy with KPI cards and chart containers

## Core Principles

1. **Information clarity first**
- KPI cards and trend charts above detail tables

2. **Fast operational scanning**
- status badges for rig/project/maintenance condition at a glance

3. **Action-oriented workflows**
- clear maintenance form/approval blocks
- role-specific visibility

## Color Tokens

- `brand.*` (primary blue scale)
- `ink.*` (text and neutral dark scale)
- `accent.teal` (positive performance)
- `accent.amber` (warnings / pending)
- `accent.red` (critical states)

## Typography

- Body: `Manrope`
- Display headings: `Space Grotesk`

## Reusable Components

- `Card`
- `MetricCard`
- `DataTable`
- `Badge`
- Chart wrappers:
  - `LineTrendChart`
  - `BarCategoryChart`
  - `DonutStatusChart`

## Responsive Behavior

- Sidebar collapses into horizontal nav on smaller widths
- KPI and chart sections adapt from multi-column to single-column grids
- Tables remain scrollable without breaking layout

## UX Consistency Rules

- Keep all modules filter-aware (client/rig/date controls in topbar)
- Use same status tones across modules (active/idle/maintenance/critical)
- Show business-critical values in cards before deep detail tables
