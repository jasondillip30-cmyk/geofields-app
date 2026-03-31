# Backend Logic (MVP)

## API Authorization Pattern

1. Read `x-user-role` from request headers
2. Map role to permission matrix
3. Allow or reject action (`403`)
4. Return module-specific payload

Files:
- `src/lib/auth/request-role.ts`
- `src/lib/auth/permissions.ts`
- `src/app/api/*/route.ts`

## Core Workflows

## 1) Daily Drilling Reports

- Endpoint: `POST /api/drill-reports`
- Permission: `drilling:submit`
- Captures:
  - date, client, project, rig
  - meters drilled and work hours
  - delays/standby/rig moves
  - billable activity amount

## 2) Maintenance Requests + Approvals

- Submit endpoint: `POST /api/maintenance-requests`
  - Permission: `maintenance:submit`
- Review/update endpoint: `PATCH /api/maintenance-requests`
  - Permission: `maintenance:approve`
- Lifecycle:
  - Submitted
  - Under Review
  - Approved / Denied
  - Waiting for Parts
  - In Repair
  - Completed

## 3) Executive Summaries

- Endpoint: `GET /api/summary-report`
- Permission: `reports:view`
- Returns executive KPIs + summary sections for daily/weekly/monthly views

## Persistence Strategy

- Current UI uses deterministic mock data for quick MVP iteration
- Prisma schema + seed are ready to become system of record
- Next step is replacing mock providers with Prisma-backed repositories in `src/server/services/*`
