# Pilot database migration runbook

The hosted pilot database and its migration history have not been verified
against the Operating Costs release. Use an isolated PostgreSQL copy of the
intended target, including its `_prisma_migrations` table if present. Keep the
original backup intact. Set `DATABASE_URL` explicitly to the copy before
running any Prisma command in this runbook.

## Inspect the copy

Run these read-only checks and save their results alongside the rehearsal notes:

```sh
npx prisma migrate status --schema prisma/schema.prisma
npx prisma migrate diff --exit-code --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma
```

The diff exits 2 for a schema difference. Pending migrations can cause
`migrate status` to exit nonzero. Confirm the actual database name, host, schema,
and migration history against the intended starting state before proceeding.

## Choose the matching path

- **Empty database or intact historical migration state.** Rehearse
  `npx prisma migrate deploy --schema prisma/schema.prisma` on the copy.
  The prerequisite migration supplies `InventoryUsageContextType`, and the
  reconciliation migration supplies the missing operational schema.
- **Failed batch migration.** Confirm the failed migration entry and inspect
  the copy for leftover batch tables, enum types, indexes, and data. If the
  failed attempt left no batch artifacts, rehearse
  `npx prisma migrate resolve --rolled-back 20260417120000_inventory_usage_request_batches`
  and then `migrate deploy`. Investigate partial artifacts before choosing a
  recovery procedure.
- **Current schema with no migration history.** If the schema diff is empty,
  rehearse baselining by marking each repository migration applied,
  in directory order, with `npx prisma migrate resolve --applied <migration-name>`.
  Then run `migrate deploy` and confirm there are no pending migrations.
- **Other schema drift or mixed history.** Inspect the exact differences and
  prepare a target-specific reconciliation. Keep any existing applied migration
  records and resolve individual entries only after verifying their effects.

After the rehearsal, rerun both inspection commands. Verify representative
project rates, inventory balances, usage requests, and billing data against
the copy's pre-upgrade values before scheduling a pilot change.

## Verified on disposable PostgreSQL 16

- Fresh deploy applied all five migrations and matched the Prisma schema.
- A database with the three original migrations recorded upgraded successfully.
  It retained a synthetic project rate of 125, stock of 7 units at 475 each, and
  a waiting usage request for 2 units.
- An already-current schema with no history was baselined after an empty diff.
  Deploy then had no pending work and retained a synthetic location.
- The reproduced batch failure left no batch artifacts. Resolving it as rolled
  back and deploying the repaired chain yielded an empty schema diff.

## Operating Costs rollout

The incremental migration from `7dcb2c6` to `37d9237` was rehearsed on
PostgreSQL 16. A synthetic database with all eight previous migrations and
existing records was dumped and restored into a separate local database.
Deploy applied only `20261112140000_project_operating_costs`. Migration status
was current, the schema diff was empty, and a second deploy was a no-op. The
existing project, approved drilling report, approved expense, inventory item,
and pending usage request were identical before and after. The three new
operating-cost tables started empty.

This is evidence for the recovery baseline only, not for the hosted target.
Before scheduling a release:

1. Confirm the exact Vercel project and environment, database branch and schema,
   and access to a restorable backup or disposable branch. Do not paste
   connection strings or authentication secrets into chat or migration notes.
2. On the isolated copy, inspect the applied migration names, checksums, and
   any failed entries. Compare the schema and follow the matching path above;
   do not assume only the Operating Costs migration is pending.
3. Verify the release candidate preserves the sign-in hardening from
   `ca529e2` (no displayed or prefilled demo credentials). The fix was
   carried forward onto the recovery branch after `37d9237`.
   Verify a named administrator can sign in,
   known demo accounts are disabled or rotated, and private receipt storage
   is configured before switching the pilot to the candidate.
4. Rehearse post-upgrade Operating Costs and financial totals on the copy.
   Apply changes to the hosted target only after a separate rollout decision.
