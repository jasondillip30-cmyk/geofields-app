# App Architecture

## 1) System Overview

GeoFields Operations Dashboard is designed as a modular internal platform with:
- dashboard-centric UX for operational and financial decision-making
- role-based access for management, office, mechanics, and field users
- scalable data model for multi-client and multi-project operations

## 2) High-Level Layers

1. **Presentation Layer (Next.js App Router)**
- Route-based modules under `src/app/*`
- Shared shell (`AppShell`) with sidebar, filters, and role switcher
- Module pages for dashboards, drilling, rigs, maintenance, finance, and reports

2. **Application Layer**
- Permission checks (`src/lib/auth/*`)
- Domain services (`src/server/services/*`)
- Shared formatters and data utilities (`src/lib/*`)

3. **Data Layer**
- Prisma schema (`prisma/schema.prisma`)
- Seed data for realistic demo (`prisma/seed.ts`)
- MVP uses in-memory sample providers for UI speed, with Prisma schema ready for API persistence migration

## 3) Route Structure

- `/` Company dashboard
- `/clients` client list
- `/clients/[clientId]` client workspace
- `/projects` project list
- `/projects/[projectId]` project workspace
- `/drilling-reports` daily report entry + history
- `/revenue` revenue analytics
- `/expenses` expense analytics
- `/forecasting` 30-day projections
- `/rigs` rig fleet overview
- `/rigs/[rigId]` rig profile
- `/maintenance` workshop workflow
- `/mechanics` mechanics directory
- `/reports` daily/weekly/monthly/executive summaries + alerts

## 4) Key Logic Mapped to Requirements

- **Multi-client / multi-project:** client and project entities with linked workspaces
- **Rig-to-project clarity:** project pages show assigned + backup rig; rig pages show current project/client
- **Revenue/expense by rig/project/client:** analytics pages aggregate by each dimension
- **Rig ranking by revenue:** revenue module + dashboard leaderboard
- **Rig usage duration:** rig profile includes total lifetime days and current project days
- **Maintenance with photo + approvals:** maintenance module includes request fields and visible status workflow
- **Automatic summary reporting:** summary module and `/api/summary-report`

## 5) API Design (MVP)

- `GET/POST /api/drill-reports`
- `GET/POST/PATCH /api/maintenance-requests`
- `GET /api/summary-report`

MVP authorization uses header role simulation (`x-user-role`) and permission matrix.

## 6) Scalability Path

- Replace mock datasets with Prisma-powered repositories
- Add authentication provider (NextAuth/SSO)
- Add file/object storage for maintenance photos
- Add background jobs for scheduled summaries and anomaly alerts
- Add audit logs and approvals history views
