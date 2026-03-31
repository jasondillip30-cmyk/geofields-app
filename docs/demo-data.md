# GeoFields Demo Data Guide

This project now uses an idempotent seed script that enriches existing data without deleting records.

## What `npm run db:seed` does

- Upserts (update-or-insert) roles and auth users
- Ensures required clients, projects, rigs, mechanics, and relationships exist
- Adds realistic drilling reports, expenses, maintenance, approvals, inspections, and breakdown records
- Preserves existing user-entered data
- Avoids duplicate seed records by using stable identifiers

## Reseed safely (recommended)

```bash
npm run db:seed
```

You can run this multiple times; it will refresh/enrich seeded records and keep existing operational records.

## Optional full reset (destructive)

Use only when you explicitly want a clean local database:

```bash
rm -f prisma/dev.db
npm run db:push
npm run db:seed
```

## Test coverage targets provided by seed

- Multiple clients, projects, rigs, and role users
- 40+ drilling reports over the last 90 days with mixed approval states
- 30+ expenses across all core categories, with Fuel as largest category
- 10+ maintenance requests with varied urgency and lifecycle states
- Pending/submitted records for approval workflow testing
