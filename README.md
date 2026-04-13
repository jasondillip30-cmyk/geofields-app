# GeoFields Operations Dashboard

Professional internal web app MVP for **GeoFields Tanzania** to replace Excel-based drilling reporting and operations tracking.

This app provides a modern, visual, dashboard-first system for:
- drilling activity management by client/project/rig
- finance tracking (revenue, recognized spend, profit)
- forecasting
- rig performance and condition tracking
- case-based maintenance and breakdown workflows
- inventory usage and purchase approvals
- executive summary reporting and alerts

## Current Build Highlights

- Real authentication (`/login`) with secure cookie sessions
- Middleware-protected routes by role
- Dashboard access removed for `MECHANIC` and `FIELD`
- Setup vs management page split (create/configure in Setup; monitor/manage in main modules)
- Project-first budget vs actual and profitability monitoring
- Receipt-intake follow-up for recognized expense posting
- Inventory movement, issues, and expenses workspaces with operational traceability
- Breakdown and maintenance operational case management (not approval workflows)

## MVP Stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS, Recharts
- **Backend API:** Next.js Route Handlers (`/api/*`)
- **Database:** Prisma ORM with PostgreSQL/Neon
- **Auth/RBAC (MVP):** role-based permission matrix (Admin, Office, Mechanic, Field)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Validate DB connection + sync schema:

```bash
npm run db:sync
```

4. Seed sample data:

```bash
npm run db:seed
```

Demo/sample financial records are seeded in **USD** and aligned to the billing-rate-card + drill-report billable-line workflow.

If you need a fully clean local demo dataset (recommended after major workflow refactors):

```bash
npm run db:refresh:demo
```

5. Start app:

```bash
npm run dev
```

If local dev ever shows chunk-load errors, endless loading placeholders, or missing-module errors from `.next`, run a clean reset:

```bash
npm run dev:reset
```

If you are running on a non-default port, use:

```bash
PORT=3001 npm run dev:reset
```

Dev artifacts are isolated per port (`.next-dev-3000`, `.next-dev-3001`, etc.). `dev:reset` only stops the active port process, clears that port's dist dir, and restarts clean.

Open [http://localhost:3000](http://localhost:3000).

Seed login accounts:
- `admin@geofields.co.tz` / `Admin123!`
- `office@geofields.co.tz` / `Office123!`
- `mechanic@geofields.co.tz` / `Mechanic123!`
- `field@geofields.co.tz` / `Field123!`

## Main Modules Included

- Company Dashboard
- Clients
- Projects
- Rigs
- Daily Drilling Reports
- Revenue Analytics
- Cost Tracking
- Budget vs Actual (project-first)
- Forecasting (30-day projections)
- Profit
- Inventory (items, stock movements, issues, expenses, receipt intake)
- Purchase Requests + Approvals
- Maintenance (operational case flow)
- Breakdowns (operational incident flow)
- Mechanics Directory + Summary Reports + Alerts

## Role Access (MVP)

- **Admin / Management:** full visibility + approvals + finance + reporting
- **Office Staff:** project/inventory/expense operations and approval actions by permission
- **Mechanics:** maintenance/breakdown reporting, inventory usage requests, rig-level operations
- **Field Operations:** drilling and breakdown reporting with project/rig visibility

Role switching is available in the top bar for demo and testing.

## API Surface (Selected)

- `GET /api/drill-reports`
- `POST /api/drill-reports`
- `GET /api/maintenance-requests`
- `POST /api/maintenance-requests`
- `PATCH /api/maintenance-requests`
- `GET /api/breakdowns`
- `POST /api/breakdowns`
- `PATCH /api/breakdowns/:breakdownId`
- `GET /api/inventory/usage-requests`
- `POST /api/inventory/usage-requests`
- `POST /api/inventory/usage-requests/:requestId/status`
- `POST /api/inventory/receipt-intake/commit`
- `GET /api/summary-report`

Additional endpoints:
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `GET/POST /api/clients`
- `PUT/DELETE /api/clients/:clientId`
- `GET/POST /api/projects`
- `PUT/DELETE /api/projects/:projectId`
- `GET/POST /api/rigs`
- `PUT/DELETE /api/rigs/:rigId`
- `GET/POST /api/employees`
- `PUT/DELETE /api/employees/:employeeId`
- `GET /api/forecasting`

Pass role header for API authorization simulation:

```text
x-user-role: ADMIN | OFFICE | MECHANIC | FIELD
```

Auth now uses cookie sessions. The role header method is legacy and kept only for older mock endpoints.

## Database

Prisma schema lives in:
- `prisma/schema.prisma`

Seed data script:
- `prisma/seed.ts`

DB helper scripts:
- `npm run db:doctor` checks `DATABASE_URL` for placeholder/invalid values.
- `npm run db:sync` keeps Prisma client + schema aligned.
- `npm run db:refresh:demo` syncs schema and reseeds a clean local demo workspace.

Quality/smoke scripts:
- `npm run quality:static` runs typecheck + lint + hygiene + architecture guard.
- `npm run smoke:critical` validates critical approve/finalize workflows.
- `npm run smoke:consistency` verifies cross-page recognized-spend reconciliation.
- `npm run smoke:ops` validates maintenance/breakdown operational lifecycle linkage.
- `npm run smoke:mutations` validates concurrent mutation conflict/idempotency behavior.

The schema includes entities for:
- users, roles
- clients, projects
- rigs, rig_usage
- drill_reports
- revenues, expenses
- maintenance_requests, maintenance_updates
- mechanics
- inspections
- approvals
- summary_reports

## Documentation

- Architecture: `docs/app-architecture.md`
- Backend logic: `docs/backend-logic.md`
- Design system: `docs/design-system.md`
- MVP roadmap: `docs/mvp-roadmap.md`
