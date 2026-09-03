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
`pnpm --filter api db:check`. After a rebase, no schema changes proves schema
sync; `db:check` validates migrations, journal, and snapshots. Never hand-edit
generated SQL or the journal without the documented exception below.

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
migration; add a sibling function, then reprovision.

P4 - Journal `when`, not filename, determines order. New migrations use
timestamp prefixes. After parallel rebases, keep both journal rows, make `idx`
contiguous, and restamp/regenerate so `when` is strictly increasing. Otherwise
existing databases silently skip the entry.

Changing comments in an applied migration is safe; changing statements is not,
because the migrator never compares the stored hash or reruns the file.

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
