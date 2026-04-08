# GeoFields Demo Data Guide

This project uses a project-first seed profile built for the current operational workflow:
- case-based maintenance and breakdowns
- inventory usage and purchase linkage
- recognized spend classification by purpose
- billing-first drilling revenue capture (project rate cards + drill-report billable lines)
- USD-only sample financial values

Seed profile id: `project_first_operational_v3_clean`

## What `npm run db:seed` does

- Resets operational/demo tables, then loads the current project-first seed profile
- Ensures required roles, auth users, clients, projects, rigs, mechanics, and relationships exist
- Adds realistic drilling reports, drill-report billable lines, project billing rate cards, expenses, maintenance, approvals, inventory usage, and breakdown records
- Produces a deterministic clean dataset for consistency/smoke checks

## Recommended for consistency after workflow refactors

Use a full local reset to avoid legacy/demo drift:

```bash
npm run db:refresh:demo
```

This command:
- validates `DATABASE_URL`
- syncs schema (`prisma db push`)
- regenerates Prisma client
- reseeds with the current project-first dataset

## Reseed (clean reset)

```bash
npm run db:seed
```

This reinitializes demo records to the canonical local dataset.

## Optional full reset (destructive)

Use only when you explicitly want a clean local database and cannot use `db:refresh:demo`:

```bash
npm run db:doctor
npm run db:push
npm run db:seed
```

## Test coverage targets provided by seed

- Under-budget, overspent, and no-budget project scenarios
- Maintenance-heavy and breakdown-heavy project cost profiles
- Approved drill reports with persisted billable lines and non-zero billable amounts
- Approved usage linked to maintenance and breakdown cases
- Stock replenishment and operating spend examples
- One intentional unlinked row for data-quality testing

## Currency standard

- Demo/sample financial data is seeded in `USD` only.
- Receipt-intake demo defaults also use `USD`.
