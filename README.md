# GeoFields Operations Dashboard

Professional internal web app MVP for **GeoFields Tanzania** to replace Excel-based drilling reporting and operations tracking.

This app provides a modern, visual, dashboard-first system for:
- drilling activity management by client/project/rig
- finance tracking (revenue, expenses, profit)
- forecasting
- rig performance and condition tracking
- maintenance/workshop workflows with approval visibility
- executive summary reporting and alerts

## Phase A-E Upgrade (Current Build)

- Real authentication (`/login`) with secure cookie sessions
- Middleware-protected routes by role
- Dashboard access removed for `MECHANIC` and `FIELD`
- CRUD pages and APIs for:
  - clients
  - projects
  - rigs
  - employees
- Office-only manual expense input with receipt upload support
- Field operator breakdown reporting auto-linked to project/rig/client
- Forecasting filters by company/client/project/rig with API-driven results

## MVP Stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS, Recharts
- **Backend API:** Next.js Route Handlers (`/api/*`)
- **Database:** Prisma ORM (schema included), SQLite for local MVP
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

3. Generate Prisma client and push schema:

```bash
npm run db:generate
npm run db:push
```

4. Seed sample data:

```bash
npm run db:seed
```

5. Start app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Seed login accounts:
- `admin@geofields.co.tz` / `Admin123!`
- `office@geofields.co.tz` / `Office123!`
- `mechanic@geofields.co.tz` / `Mechanic123!`
- `field@geofields.co.tz` / `Field123!`

## Main Modules Included

- Company Dashboard
- Clients (including client-specific workspace pages)
- Projects (including project-specific rig assignment view)
- Daily Drilling Reports
- Revenue Analytics
- Expense Analytics
- Forecasting (30-day projections)
- Rigs & Rig Profiles
- Maintenance / Workshop (requests + approvals)
- Mechanics Directory
- Summary Reports + Alerts

## Role Access (MVP)

- **Admin / Management:** full visibility + approvals + finance + reporting
- **Office Staff:** projects, reports, finance view, maintenance approvals
- **Mechanics:** rig view + maintenance submission and tracking
- **Field Operations:** drilling submission + drilling/project/rig visibility

Role switching is available in the top bar for demo and testing.

## API Endpoints (MVP)

- `GET /api/drill-reports`
- `POST /api/drill-reports`
- `GET /api/maintenance-requests`
- `POST /api/maintenance-requests`
- `PATCH /api/maintenance-requests`
- `GET /api/summary-report`

Additional phase A-E endpoints:
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
- `GET/POST /api/expenses/manual`
- `GET/POST /api/breakdowns`
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
