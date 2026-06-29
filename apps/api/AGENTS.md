# apps/api

NestJS 11 backend: API + services, and owner of the database schema/migrations. Future home of the durable run worker (SPEC.md §9.5).

## Stack

- NestJS 11 (`@nestjs/*`), Express platform
- DB: Drizzle ORM via `@knaadh/nestjs-drizzle-postgres` + `postgres.js`; migrations with `drizzle-kit`
- Tests: Jest (+ SWC); e2e under `test/`

## Structure

- `src/` — feature modules, each as controller + service + module (`chats/`, `users/`)
- `src/db/` — `schema/` (`auth.ts`, `chats.ts`), `migrations/` (+ `meta/` journal), `migrate.ts`
- `src/main.ts`, `src/app.module.ts`

## Commands

```bash
pnpm --filter api dev          # nest start --watch
pnpm --filter api build        # nest build  (start:prod -> node dist/main)
pnpm --filter api test         # jest  (also test:e2e, test:cov)
pnpm --filter api db:generate  # drizzle-kit generate from src/db/schema
pnpm --filter api db:migrate   # tsx src/db/migrate.ts
pnpm --filter api db:studio    # drizzle-kit studio (also db:push / db:check)
```

## Local database & RLS (dev)

The repo-root `compose.yaml` runs Postgres for dev; root scripts wrap it (`pnpm db:up` /
`db:migrate` / `db:studio` / `db:psql` / `db:reset`). One-time: `cp apps/api/.env.example
apps/api/.env.local`.

Migrations run as a **non-superuser `app` role that owns the schema** (provisioned by
`docker/postgres/initdb/01-app-role.sql`), so RLS is exercised in dev as in production:

- RLS is `ENABLE`d **and** `FORCE`d on `chats`/`messages`. Without `FORCE` the table owner
  bypasses RLS, so a single-role self-hosted deployment would silently lose tenant isolation.
- Every request must run inside `TenantDbService.runAs(userId, …)`, which sets
  `app.current_user_id` transaction-locally. If it is unset, every RLS policy denies all rows.
- `scripts/rls-test.sh` re-proves cross-tenant isolation against a throwaway Postgres
  (non-superuser owner + FORCE). Run it after touching the schema, RLS, or `TenantDbService`.

## Conventions

- One NestJS module per feature (controller / service / module); wire via DI and register in `app.module.ts`.
- Schema lives in `src/db/schema`; change it, then `db:generate`. Don't hand-edit generated migration SQL or `meta/_journal.json` — the sole exception (`0004`) is documented in Gotchas.

## Gotchas

- Schema currently overlaps with `apps/web/lib/db` (the DB is being moved out of `web` into here) — keep the two from diverging until the move is finished.
- Migrations are `drizzle-kit`-generated (`0005`+). Exception: `0004` (the PoC → multi-tenant transition) is hand-authored, because drizzle-kit's interactive column-rename prompt can't be driven non-interactively; `drizzle-kit check` passes. `FORCE ROW LEVEL SECURITY` is also hand-maintained in `0004` (Drizzle can't express it). Re-add both if you ever regenerate that migration.
