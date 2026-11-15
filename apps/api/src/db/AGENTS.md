# apps/api/src/db

Sole product schema: Drizzle + postgres.js, migrated by `src/db/migrate.ts` and
accessed through global `TenantDbService`. Web has no database.

## Commands

```bash
pnpm db:up
pnpm db:reset
pnpm db:migrate
pnpm db:provision-rls
pnpm db:generate
pnpm --filter api db:check
pnpm --filter api test:integration
```

Run `pnpm db:provision-rls` after every `pnpm db:migrate`. Fresh setup:
`pnpm db:reset && pnpm db:migrate && pnpm db:provision-rls`.
Postgres must include pgvector and `pg_trgm`; stock Postgres is insufficient.

Edit `src/db/schema/`, then run `pnpm db:generate` and
`pnpm --filter api db:check`. Each generated migration has its own timestamped
directory containing `migration.sql` and `snapshot.json`; snapshots record
schema history, including branches. Never hand-edit generated snapshots. Manual
SQL needs its header rationale and a matching snapshot.

## Migration traps

P1 - Drizzle emits `ENABLE ROW LEVEL SECURITY`, not `FORCE`. Append `FORCE` to
every tenant table and restore it after regeneration.

P2 - Migrations run as owner `app` without tenant identity. Backfills under
forced RLS silently update zero rows. Wrap them:

```sql
ALTER TABLE "x" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- backfill
ALTER TABLE "x" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
```

P3 - Cross-tenant discovery functions are `SECURITY DEFINER`, owned after
provisioning by `app_rls` (`BYPASSRLS`), and return only identifiers,
timestamps, or counts. Never `CREATE OR REPLACE` them from a later `app`
migration. Add the sibling plus its ownership/execute grants to
`docker/postgres/rls-function-owner.sql`, then reprovision.

P4 - Drizzle v1 stores each migration in its own timestamped directory with a
`migration.sql` and `snapshot.json`; there is no shared `_journal.json`.
Pending migrations run in directory-name order. After parallel changes, retain
both migration directories and run `db:check` for noncommutative changes.
That check cannot prove arbitrary hand-written SQL or data changes commute;
review their dependencies separately.

P5 - The v1 migrator identifies applied migrations by directory name rather
than the largest ledger timestamp. Never rename an applied migration directory.
Legacy ledger conversion must preserve the identity of every already-applied
migration; reject ambiguous history rather than replaying it.

Never change statements in an applied migration. Historical SQL hashes can also
be required to identify legacy ledger entries, so preserve comments as well.

## Manual SQL

The migration's SQL comment is the only ledger. It states what the manual step
does, why the generator cannot emit it, and what regeneration must restore.
Find manual migrations with:

```bash
rg -l '^-- ' apps/api/src/db/migrations
```

## `app_rls`

Org-unit/membership policies need the `app_rls`-owned
`llame_role_on_unit_path(...)` function to avoid recursive RLS. Provisioning is
split deliberately:

1. Initdb creates `app_rls`; old volumes must be reset or repaired as superuser.
2. Migrations create functions and grant reads as `app`.
3. `pnpm db:provision-rls`, running as superuser, reassigns function ownership.

Never grant `app` membership in `app_rls`; that permits `SET ROLE` around forced
RLS. Before provisioning, functions remain harmlessly owned by `app` and grant
no membership visibility.

Init scripts run only on fresh volumes. Reset an older dev volume that lacks
`app_rls` or pgvector, or apply the scripts as superuser. Managed Postgres that
cannot provision `BYPASSRLS` needs the documented weaker service-connection
fallback after app authorization; never substitute it silently.
