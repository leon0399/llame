# apps/api

NestJS 11 backend: API + services, owner of the database schema/migrations, and host of the durable run worker (SPEC.md §9.5) — a pg-boss consumer co-located in the API process executes every chat run (#48/#50, #107); there is no inline request-thread mode.

## Stack

- NestJS 11 (`@nestjs/*`), Express platform
- DB: Drizzle ORM via `@knaadh/nestjs-drizzle-postgres` + `postgres.js`; migrations with `drizzle-kit`
- Tests: Jest (+ SWC); e2e under `test/`

## Structure

- `src/` — one directory per feature, each a NestJS module (`chats/`, `runs/`, `compaction/`, `titles/`, `queue/`, `models/`, `auth/`, `users/`, `db/`); a feature another feature consumes exports its service from its own module, never re-provided elsewhere. Boundary rules: `queue/` is consumed ONLY by `runs/` (chats dispatches runs via `RunDispatchService` and never sees queue names/payloads); `runs/` hosts the whole execution domain (executor, worker consumers, dispatch, stream bridge — `RunWorkerModule` is what the dedicated worker entrypoint (#116) will boot); `db/DbModule` is the single global `TenantDbService` provider
- `src/db/` — `schema/` (`auth.ts`, `chats.ts`), `migrations/` (+ `meta/` journal), `migrate.ts`
- `src/main.ts`, `src/app.module.ts`

## Commands

```bash
pnpm --filter api dev          # nest start --watch
pnpm --filter api build        # nest build  (start:prod -> node dist/main)
pnpm --filter api lint         # oxlint --fix; type-aware rules via tsgolint (tsgo)
pnpm --filter api typecheck    # tsgo --noEmit — full program incl. specs (nest build excludes them)
pnpm --filter api test         # jest  (also test:e2e, test:cov)
pnpm --filter api db:generate  # drizzle-kit generate from src/db/schema
pnpm --filter api db:migrate   # tsx src/db/migrate.ts
pnpm --filter api db:studio    # drizzle-kit studio (also db:push / db:check)
```

## Local database & RLS (dev)

The repo-root `compose.yaml` runs Postgres for dev; root scripts wrap it (`pnpm db:up` /
`db:migrate` / `db:studio` / `db:psql` / `db:reset`). One-time: `cp apps/api/.env.example
apps/api/.env.local`.

Chat replies need `OPENAI_API_KEY` in `.env.local` — an instance-wide model key for v0.1;
the loop returns **402** without it. Per-user BYOK is v0.4 (#37).

Migrations run as a **non-superuser `app` role that owns the schema** (provisioned by
`docker/postgres/initdb/01-app-role.sql`), so RLS is exercised in dev as in production:

- RLS is `ENABLE`d **and** `FORCE`d on `chats`/`messages`. Without `FORCE` the table owner
  bypasses RLS, so a single-role self-hosted deployment would silently lose tenant isolation.
- Every request must run inside `TenantDbService.runAs(userId, …)`, which sets
  `app.current_user_id` transaction-locally. If it is unset, every RLS policy denies all rows.
- `scripts/rls-test.sh` re-proves cross-tenant isolation **and** runs the auth e2e
  (real HTTP via supertest) against a throwaway Postgres (non-superuser owner + FORCE).
  Run it after touching the schema, RLS, `TenantDbService`, or the auth/HTTP surface.

## Conventions

- One NestJS module per feature (controller / service / module); wire via DI and register in `app.module.ts`.
- Schema lives in `src/db/schema`; change it, then `db:generate`. Don't hand-edit generated migration SQL or `meta/_journal.json` — the exceptions (`0004`, `0006`, `0010`, `0011`, `0012`, `0013`) are documented in Gotchas.
- **API contract — code-first OpenAPI** (decision + rationale: SPEC §22.0; established by #60). Every `/auth/v1`·`/api/v1` endpoint takes a class-validator **DTO** behind the global `ValidationPipe` and returns an **explicit response type** (never an ad-hoc object — mirror the `toPublicUser` egress allowlist), so `@nestjs/swagger` can emit a complete `openapi.json`. Add a DTO + response type with every new endpoint. Client/SDK codegen is **deferred** (post-v0.1) — don't hand-write or generate an API client yet; the spec is the source of truth. The live spec is served at `/docs` (UI), `/docs/json`, `/docs/yaml`.
- **RESTful resource design — design the surface deliberately.** Model the API as resources + standard verbs (`GET`/`POST`/`PATCH`/`DELETE`), JSON:API-ish. Partial updates are `PATCH /resource/:id` — **not** RPC-style verb handles (`/chats/:id/title`, `/x/rename`). Nullable response fields are modeled explicitly (`@ApiProperty({ type, nullable: true })`, required-not-optional). Path ids backed by a typed DB column get `ParseUUIDPipe` + `@ApiParam`. Think about the resource model before adding a handle; don't bolt on verbs.

## Gotchas

- `apps/api/src/db` is the **sole** schema; `apps/web` owns no database.
- Linting is oxlint with type-aware rules (`.oxlintrc.json`, `options.typeAware`) running on **tsgo** (TypeScript 7). tsgo rejects `baseUrl`, so `tsconfig.json` must not reintroduce it, and global test/node types are declared explicitly via `"types": ["node", "jest"]` (tsgo does not auto-include `@types/*` under pnpm the way tsc does). Formatting is prettier (`pnpm format`), checked in CI via the root `format:check` — it is no longer an ESLint rule.
- Migrations are `drizzle-kit`-generated (`0005`+). Hand-authored exceptions: `0004` (the PoC → multi-tenant transition — drizzle-kit's interactive column-rename can't be driven non-interactively; `FORCE ROW LEVEL SECURITY` is hand-maintained here too, Drizzle can't express it), `0006` (the sessions hashing migration carries a manual `DELETE FROM sessions` — raw tokens can't be carried into the hashed-at-rest model), `0010` (the nullable-title migration carries a manual `UPDATE` backfilling old default-literal titles to NULL, and drops a spurious generated DROP/CREATE of the unchanged `sessions_user_created_idx`), `0011` (the durable-runs migration hand-appends `FORCE ROW LEVEL SECURITY` for `runs`/`run_events` — Drizzle emits ENABLE only — and hand-reorders the composite-key unique indexes before the FKs that reference them), `0012` (the single-flight migration carries a manual `UPDATE` cancelling all but the newest non-terminal run per chat — the partial unique index cannot be created over duplicates — plus matching `run.cancelled` events, applied inside a NO FORCE RLS window since migrations run as the owning role), and `0013` (the `in_reply_to` reply-integrity trigger, #73 — Drizzle can't express triggers). `drizzle-kit check` passes for all. Re-add the manual steps if you ever regenerate these.
