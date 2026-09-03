# apps/api/src/db

The **sole** schema for the whole product. `apps/web` owns no database
(SPEC.md §22.0). Everything here is Drizzle + `postgres.js`, applied by
`src/db/migrate.ts` and read through the global `TenantDbService`
(`db.module.ts`).

## Commands

```bash
pnpm db:up                # start dev Postgres     ·  pnpm db:reset  wipes the volume
pnpm db:migrate           # apply migrations
pnpm db:provision-rls     # REQUIRED after every fresh migrate — see "app_rls" below
pnpm db:generate          # drizzle-kit generate + format the journal
pnpm --filter api db:check   # drizzle-kit check (journal/snapshot chain)
pnpm --filter api test:integration   # self-provisions a throwaway Postgres
```

Fresh volume, in order: `pnpm db:reset && pnpm db:migrate && pnpm db:provision-rls`.

Postgres must ship **`vector` (pgvector)** alongside `pg_trgm`. `compose.yaml`
pins `pgvector/pgvector:pg17` by digest; `db:migrate` fails outright on stock
`postgres:17-alpine`.

## Changing the schema

Edit `src/db/schema/`, then run `pnpm db:generate` and
`pnpm --filter api db:check`. A no-schema-changes result proves the schema is in
sync; `db:check` validates the migrations, journal, and snapshot chain. Never
hand-edit generated SQL without a reason in the migration's SQL header. Journal
edits are limited to the P4 rebase procedure and record ordering only. Never
hand-edit generated metadata snapshots.

## The four migration patterns

Almost every hand-authored step in this repo is one of four. Learn these and
most of the ledger becomes unnecessary.

**P1 — `FORCE ROW LEVEL SECURITY` is hand-appended.** Drizzle's `.enableRLS()`
emits `ENABLE` only. Without `FORCE`, the table-owning `app` role bypasses every
policy, and in the single-role self-hosted topology that means _no isolation at
all_. Every tenant-bearing table needs the statement appended by hand, and
re-added if the migration is regenerated.

**P2 — data backfills need a `NO FORCE` window.** Migrations run as the owning
`app` role with **no `app.current_user_id` set**, so under `FORCE` RLS every
policy denies and an `UPDATE` **silently no-ops** — no error, zero rows, and a
later `SET NOT NULL` or `USING` cast fails on data you believe you wrote. Wrap
the backfill:

```sql
ALTER TABLE "x" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- backfill here
ALTER TABLE "x" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
```

**P3 — cross-tenant discovery functions are `SECURITY DEFINER`, owned by
`app_rls`, and are never replaced in place.** The migration creates the function
(owned by `app`) and `GRANT`s it the reads it needs; `pnpm db:provision-rls`
later reassigns ownership to `app_rls`. Consequence: a later migration **must
not** `CREATE OR REPLACE` it. `CREATE OR REPLACE FUNCTION` requires the executing
role to already own the function, and on any instance that ran
`db:provision-rls` the owner is `app_rls` — which `app` is deliberately never a
member of. An in-place edit therefore fails `db:migrate` on exactly the
instances that deployed correctly. Add a **new sibling function**, add its
ownership and execute grants to `docker/postgres/rls-function-owner.sql`, then
run `pnpm db:provision-rls`. These functions return identifiers, timestamps,
and counts only — never content or vectors.

**P4 — apply order comes from the journal, not filenames.** `0000`–`0023` are
index-prefixed; `drizzle.config.ts` now sets `migrations.prefix: 'timestamp'`,
so newer files are `YYYYMMDDHHMMSS_<name>.sql` and parallel branches no longer
collide on the next number — only `meta/_journal.json` conflicts (append-only;
resolve by keeping both entries and renumbering `idx`). The migrator applies an
entry only when its `when` is newer than the newest already-applied migration,
so **an out-of-order entry is silently skipped on existing databases**.
`migration-journal.test.ts` pins both invariants (contiguous `idx`, strictly
increasing `when`). If it fails after a rebase because master gained newer
migrations, regenerate your migration or re-stamp its journal `when` so it sorts
last.

Editing an already-applied migration's **comments** is safe:
`drizzle-orm`'s `migrate()` gates on `created_at < folderMillis` only, and the
SHA-256 it records is written but never compared. Editing its **statements** is
not — the file will never re-run on a database that already passed it.

## Hand-authored migrations

Some migrations carry a manual step `drizzle-kit generate` will not reproduce —
the four patterns above, plus one-off data transitions. **The rationale lives in
the migration's own SQL comment, next to the statement it explains**, and that
comment is the authority. There is no second copy here to drift out of date.

A hand-authored step is not finished until its comment says what it does, why
the generator cannot emit it, and what to re-add if the file is ever
regenerated.

Comments are the index too — generated migrations contain none, so:

```bash
rg -l '^-- ' apps/api/src/db/migrations   # every migration with a manual step
```

Read the file before regenerating one. `drizzle-kit check` passes for all of
them.

## `app_rls` (BYPASSRLS) — required for org-unit/membership RLS

The org-units/memberships policies (`memberships_select`/`update`/`delete`, and
the owner-tier branch of `insert`) call `llame_role_on_unit_path(unit_id,
roles[])`, a `SECURITY DEFINER STABLE` function that must run AS a dedicated
**`app_rls`** role with **`BYPASSRLS`** to work at all. This is the only way to
check "member/admin on the unit's path" from _inside_ a `memberships` policy
without RLS policy recursion (`org_units`' SELECT policy already scans
`memberships`; a `memberships` policy scanning `org_units` back would close the
cycle — Postgres rejects that as 42P17). A plain `SECURITY DEFINER` function
owned by `app` would **not** work: `FORCE ROW LEVEL SECURITY` applies policies to
the table owner too, and `app` owns every table — `BYPASSRLS` is the only thing
that outranks `FORCE`.

**Provisioning is split across two steps, deliberately not one migration:**

1. The migration (run as `app`, like every migration) `CREATE FUNCTION`s and
   `GRANT`s it `SELECT` on the tables it reads — a privilege grant the table
   owner can make for any role, needing no membership.
2. `docker/postgres/rls-function-owner.sql`, run as the `postgres` **superuser**
   via `pnpm db:provision-rls` (`test:integration`'s globalSetup runs the
   equivalent against its own throwaway container), reassigns ownership to
   `app_rls`.

Why not reassign inside the migration: `ALTER FUNCTION … OWNER TO app_rls`
requires the current role (`app`) to be a **member** of `app_rls`. Granting that
membership would ALSO let `app` `SET ROLE app_rls` and assume `BYPASSRLS`
directly — Postgres reuses the exact same permission check for both, and
`GRANT app_rls TO app WITH SET FALSE` does not avoid it (verified empirically:
`ALTER FUNCTION` still fails with "must be able to SET ROLE"). Rather than hand
`app` a path around FORCE RLS, the reassignment runs as `postgres`, which
bypasses the membership check entirely. Evolution of these functions is a
**provisioning** concern, not a migration concern.

**Until `db:provision-rls` runs**, the functions are harmlessly owned by `app`
and do not bypass RLS, so the policies calling them behave as if the caller has
no membership anywhere.

**Existing dev volumes**: `initdb/02-app-rls-role.sql` (creates `app_rls`) and
`initdb/03-vector-extension.sql` run only on a **fresh** volume. A volume
predating either will fail `db:migrate` before `db:provision-rls` ever runs —
`pnpm db:reset`, or hand-run the scripts as `postgres`.

**Deployment requirement**: provisioning `app_rls` and reassigning ownership both
need `postgres` superuser access — fine for the docker-compose self-hosted
target. **Managed Postgres without superuser access** (some offerings restrict
`BYPASSRLS` and superuser entirely) cannot do either; the documented fallback is
a service-context connection with elevated privileges, used only by roster/admin
paths _after_ app-layer authorization has run. That fallback is weaker
defense-in-depth and must be called out explicitly wherever used, never silently
substituted. `app` gaining `app_rls` membership is **not** an acceptable
substitute — it reopens the exact `SET ROLE`-around-FORCE-RLS hole this split
exists to avoid.

## Rollout

**Pre-launch, [the repository policy](../../../../AGENTS.md#pre-launch-evolution)
outranks this section** — recreate the database rather than choreograph around
it, and never rewrite an already-applied migration without resetting the
databases that ran it.

A migration that changes what server-authored data means is a coordinated
API/worker revision boundary, not a schema-only change. The sequencing rules and
the operator SQL live in [docs/scaling.md](../../../../docs/scaling.md); the
per-change specifics live in the migration's own header.
