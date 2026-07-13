# apps/api

NestJS 11 backend: API + services, and owner of the database schema/migrations. Future home of the durable run worker (SPEC.md §9.5).

## Stack

- NestJS 11 (`@nestjs/*`), Express platform
- DB: Drizzle ORM via `@knaadh/nestjs-drizzle-postgres` + `postgres.js`; migrations with `drizzle-kit`
- Tests: Jest (+ SWC); e2e under `test/`

## Structure

- `src/` — one directory per feature, each a NestJS module (`chats/`, `runs/`, `compaction/`, `titles/`, `queue/`, `models/`, `auth/`, `users/`, `db/`, `tools/`); a feature another feature consumes exports its service from its own module, never re-provided elsewhere. Boundary rules: `queue/` is consumed ONLY by `runs/` (chats dispatches runs via `RunDispatchService` and never sees queue names/payloads); `runs/` hosts the whole execution domain (executor, worker consumers, dispatch, stream bridge — `RunWorkerModule` is what the dedicated worker entrypoint (#116) will boot; `run-execution.service.ts` also owns the tool-calling loop's gate, `resolveAdvertisedTools` (`src/tools/registry.ts`) — the advertised/executable toolset is simply `allowlisted ∩ read_only`, sourced from `tools.allowed` in `llame.config.json` (no policy-verdict composition, no `TOOLS_ENABLED` env var — that machinery is gone). A real policy engine (org/user capability grants, deny-overrides-allow) is a later slice (#133); the gate is designed so it can later become "capability composition minus denies" without reworking the loop or the tool interface); `db/DbModule` is the single global `TenantDbService` provider
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

Chat replies need `defaults.modelId` / `defaults.titleGenerationModelId` in
`apps/api/llame.config.json` (one-time: `cp apps/api/llame.config.json.example
apps/api/llame.config.json` — the example's `{env:…:-default}` tokens keep the familiar
`.env.local` variables working as interpolation inputs). `OPENAI_API_KEY` is needed only
when the configured OpenAI-compatible endpoint requires a key. Missing or invalid
model-id configuration fails visibly as server configuration; provider
credential/reachability problems fail at request time. Per-user BYOK is v0.4 (#37).

The config file (config-as-code, JSONC) also carries the run timers and
`http.trustProxy`; bare env vars are NOT a config source for these settings — the
environment reaches them only via `{env:…}` tokens in the file. Precedence is file >
built-in default. The live file is gitignored (per-deploy, like `.env.local`), read from
`apps/api` by default (override with `LLAME_CONFIG_PATH`), and applies on restart only.

Migrations run as a **non-superuser `app` role that owns the schema** (provisioned by
`docker/postgres/initdb/01-app-role.sql`), so RLS is exercised in dev as in production:

- RLS is `ENABLE`d **and** `FORCE`d on `chats`/`messages`. Without `FORCE` the table owner
  bypasses RLS, so a single-role self-hosted deployment would silently lose tenant isolation.
- Every request must run inside `TenantDbService.runAs(userId, …)`, which sets
  `app.current_user_id` transaction-locally. If it is unset, every RLS policy denies all rows.
- `scripts/rls-test.sh` re-proves cross-tenant isolation **and** runs the auth e2e
  (real HTTP via supertest) against a throwaway Postgres (non-superuser owner + FORCE).
  Run it after touching the schema, RLS, `TenantDbService`, or the auth/HTTP surface.

### `app_rls` (BYPASSRLS) — required for org-unit/membership RLS

The org-units/memberships policies (`memberships_select`/`update`/`delete`, and the
owner-tier branch of `insert`) call `llame_role_on_unit_path(unit_id, roles[])`, a
`SECURITY DEFINER STABLE` function that must run AS a dedicated **`app_rls`** role
with **`BYPASSRLS`** to work at all. This is the only way to check "member/admin on
the unit's path" from _inside_ a `memberships` policy without RLS policy recursion
(`org_units`' SELECT policy already scans `memberships`; a `memberships` policy
scanning `org_units` back would close the cycle — Postgres rejects that as 42P17).
A plain `SECURITY DEFINER` function owned by `app` would **not** work here: `FORCE
ROW LEVEL SECURITY` applies policies to the table owner too, and `app` owns every
table — `BYPASSRLS` is the only thing that outranks `FORCE`.

**Provisioning is split across two steps, deliberately not one migration:**

1. Migration `0019` (run as `app`, like every migration) `CREATE FUNCTION`s
   `llame_role_on_unit_path` — owned by `app` at this point, same as any other
   migration-created object — and grants it `SELECT` on `org_units`/`memberships`
   (a privilege grant, which the table owner can do for any role with no
   membership needed).
2. `docker/postgres/rls-function-owner.sql`, run as the `postgres` **superuser**
   (`pnpm db:provision-rls`; `scripts/rls-test.sh` runs the equivalent against its
   own throwaway container), reassigns the function's ownership to `app_rls`.

Why not just do the ownership reassignment in the migration too: `ALTER FUNCTION
... OWNER TO app_rls` requires the current role (`app`) to be a **member** of
`app_rls`. Granting that membership would ALSO let `app` `SET ROLE app_rls` and
assume `BYPASSRLS` directly — Postgres reuses the exact same permission check for
both, and restricting it with `GRANT app_rls TO app WITH SET FALSE` doesn't avoid
it either (verified empirically: `ALTER FUNCTION` still fails with "must be able to
SET ROLE" under `WITH SET FALSE`). Rather than hand `app` a path around FORCE ROW
LEVEL SECURITY just to work around that, the ownership reassignment runs as
`postgres` (superuser), which bypasses the membership check entirely — no grant on
`app`'s behalf needed. Function evolution for this one function is therefore a
**provisioning** concern, not a migration concern.

**Run `pnpm db:provision-rls` immediately after every fresh `db:migrate`** — until
it runs, `llame_role_on_unit_path` is (harmlessly) owned by `app` and does **not**
bypass RLS, so the memberships policies that call it won't see the rows they need
(roster/owner-tier-grant checks will behave as if the caller has no membership
anywhere). `pnpm db:reset && pnpm db:migrate && pnpm db:provision-rls` is the full
sequence on a fresh volume.

**Existing dev volumes**: `docker/postgres/initdb/02-app-rls-role.sql` (which
creates the `app_rls` role) runs only on a **fresh** Postgres data volume (same as
`01-app-role.sql`). If your local `llame-pgdata` volume predates this change,
`db:migrate` itself will fail first — migration `0019` `GRANT SELECT`s straight
to `app_rls`, which errors if the role doesn't exist yet — before `db:provision-rls`
ever runs. Run `pnpm db:reset` (or hand-run `02-app-rls-role.sql` as the `postgres`
superuser) first.

**Deployment requirement**: provisioning `app_rls` and reassigning the function's
ownership both need `postgres` superuser access — fine for the primary self-hosted
target (docker compose's `postgres` service, whose superuser credentials are already
known/used by `01-app-role.sql`). **Managed Postgres without superuser access**
(e.g. some managed cloud offerings restrict `BYPASSRLS` and superuser entirely)
cannot provision this role or run the ownership reassignment — the documented
fallback is a service-context connection with elevated privileges, used only by the
roster/admin-ops code paths _after_ app-layer authorization has already run. That
fallback is weaker defense-in-depth (no independent datastore-level check) and must
be called out explicitly wherever it's used, not silently substituted. `app`
gaining `app_rls` membership (or any other path to `SET ROLE app_rls`) is NOT an
acceptable substitute — that reopens the exact `SET ROLE`-around-FORCE-RLS hole
this split exists to avoid.

## Conventions

- One NestJS module per feature (controller / service / module); wire via DI and register in `app.module.ts`.
- Schema lives in `src/db/schema`; change it, then `db:generate`. Don't hand-edit generated migration SQL or `meta/_journal.json` — the exceptions (`0004`, `0006`, `0010`, `0011`, `0012`, `0013`, `0018`, `0019`, `0020`, `0021`, `0022`, `0023`, `20260712055209_search_projection`, `20260713020237_rename_search_documents`) are documented in Gotchas.
- **API contract — code-first OpenAPI** (decision + rationale: SPEC §22.0; established by #60). Every `/auth/v1`·`/api/v1` endpoint takes a class-validator **DTO** behind the global `ValidationPipe` and returns an **explicit response type** (never an ad-hoc object — mirror the `toPublicUser` egress allowlist), so `@nestjs/swagger` can emit a complete `openapi.json`. Add a DTO + response type with every new endpoint. Client/SDK codegen is **deferred** (post-v0.1) — don't hand-write or generate an API client yet; the spec is the source of truth. The live spec is served at `/docs` (UI), `/docs/json`, `/docs/yaml`.
- **RESTful resource design — design the surface deliberately.** Model the API as resources + standard verbs (`GET`/`POST`/`PATCH`/`DELETE`), JSON:API-ish. Partial updates are `PATCH /resource/:id` — **not** RPC-style verb handles (`/chats/:id/title`, `/x/rename`). Nullable response fields are modeled explicitly (`@ApiProperty({ type, nullable: true })`, required-not-optional). Path ids backed by a typed DB column get `ParseUUIDPipe` + `@ApiParam`. Think about the resource model before adding a handle; don't bolt on verbs.

## Gotchas

- `apps/api/src/db` is the **sole** schema; `apps/web` owns no database.
- Linting is oxlint with type-aware rules (`.oxlintrc.json`, `options.typeAware`) running on **tsgo** (TypeScript 7). tsgo rejects `baseUrl`, so `tsconfig.json` must not reintroduce it, and global test/node types are declared explicitly via `"types": ["node", "jest"]` (tsgo does not auto-include `@types/*` under pnpm the way tsc does). Formatting is prettier (`pnpm format`), checked in CI via the root `format:check` — it is no longer an ESLint rule.
- Migrations are `drizzle-kit`-generated (`0005`+). Hand-authored exceptions: `0004` (the PoC → multi-tenant transition — drizzle-kit's interactive column-rename can't be driven non-interactively; `FORCE ROW LEVEL SECURITY` is hand-maintained here too, Drizzle can't express it), `0006` (the sessions hashing migration carries a manual `DELETE FROM sessions` — raw tokens can't be carried into the hashed-at-rest model), `0010` (the nullable-title migration carries a manual `UPDATE` backfilling old default-literal titles to NULL, and drops a spurious generated DROP/CREATE of the unchanged `sessions_user_created_idx`), `0011` (the durable-runs migration hand-appends `FORCE ROW LEVEL SECURITY` for `runs`/`run_events` — Drizzle emits ENABLE only — and hand-reorders the composite-key unique indexes before the FKs that reference them), `0012` (the single-flight migration carries a manual `UPDATE` cancelling all but the newest non-terminal run per chat — the partial unique index cannot be created over duplicates — plus matching `run.cancelled` events, applied inside a NO FORCE RLS window since migrations run as the owning role), `0013` (the `in_reply_to` reply-integrity trigger, #73 — Drizzle can't express triggers), `0018` (the identity/org-units migration hand-appends `FORCE ROW LEVEL SECURITY` for `org_units`/`memberships`/`external_identities`, same as `0004`/`0011`), and `0019` (org-units production-grade invariants — hand-appends the `llame_role_on_unit_path` `SECURITY DEFINER` function (owned by `app` until the separate `pnpm db:provision-rls` step reassigns it to `app_rls` — see "`app_rls` (BYPASSRLS)" above) + `GRANT SELECT ... TO app_rls`, the deferred path-integrity constraint trigger on `org_units` (+ a `DO`-block assertion that pre-existing rows already satisfy it), and the last-owner `BEFORE UPDATE OR DELETE` trigger on `memberships` — Drizzle can express none of CREATE FUNCTION or CREATE [CONSTRAINT] TRIGGER), and `0020` (the `runs.model_id` migration carries a manual `UPDATE` backfilling existing rows to the canonical default `system:openai:gpt-5.4-mini` before `SET NOT NULL` — drizzle-kit emits only `ADD COLUMN` + `SET NOT NULL` — inside a NO FORCE RLS window, same as `0012`, since migrations run as the owning `app` role with no `app.current_user_id` and FORCE would silently no-op the update), `0021` (the projects migration hand-appends `FORCE ROW LEVEL SECURITY` for `projects`, same as `0004`/`0011`/`0018`), and `0022` (the `org_unit_type` recreate dropping `'project'` from the vocabulary, admin-area-org-tree D5 — drizzle-kit's generated enum-recreate converts the column to `text`, drops/recreates the enum, then casts back with a `USING` clause; it doesn't account for existing rows holding a value about to be dropped, so a manual `UPDATE org_units SET type = 'group' WHERE type = 'project'` is hand-inserted while the column is still plain `text`, before the project-less enum exists — otherwise the final `USING` cast would fail on any stray `project`-typed row; the UPDATE runs inside a NO FORCE RLS window, same as `0012`/`0020`, since `org_units` is FORCE RLS (`0018`) and migrations run with no `app.current_user_id` — without the window the backfill silently no-ops and the cast aborts), and `0023` (the rework-item-pinning migration hand-appends `FORCE ROW LEVEL SECURITY` for `pins`, same as `0021` — it also drops `chats.pinned_at` + `chats_owner_pinned_updated_idx`, replacing row-level chat pinning with the per-user `pins` table; no data backfill by design), and `20260712055209_search_projection` (chat-search-platform #195 — hand-prepends `CREATE EXTENSION IF NOT EXISTS pg_trgm` (trusted contrib, creatable by the non-superuser `app` role; MUST precede the `gin_trgm_ops` index), hand-appends `FORCE ROW LEVEL SECURITY` for `search_documents`/`search_chat_state` (same as `0004`/`0011`/`0018`/`0021`/`0023`), and the `llame_search_stale_chats(integer, integer)` `SECURITY DEFINER` staleness-discovery function — owned by `app` until `pnpm db:provision-rls` reassigns it to `app_rls`, same lifecycle as `0019`'s `llame_role_on_unit_path`, plus `GRANT SELECT ON chats, messages, search_chat_state TO app_rls` (the function's message-time staleness subquery reads `messages`); the function returns only identifiers + timestamps, never content), and `20260713020237_rename_search_documents` (chat-search-platform D1 naming — a hand-authored, **non-destructive** `ALTER TABLE "search_documents" RENAME TO "search_chat_documents"` plus every dependent object rename: the 5 indexes, the pkey + 2 FK constraints (renaming the pkey constraint auto-renames its backing index), and the RLS policy. drizzle-kit can't emit a table rename non-interactively, and this rename **must** preserve the rows already shipped to existing databases under the old name — so it is a forward ALTER on top of `20260712055209_search_projection`, NOT a regenerated create. `search_chat_state` is unchanged; `llame_search_stale_chats` reads `search_chat_state`/`chats`/`messages`, never this table, so it needs no change. Proven non-destructive against a live DB in a rolled-back transaction; FORCE RLS survives the rename). `drizzle-kit check` passes for all. Re-add the manual steps if you ever regenerate these.
- Migration filenames: `0000`–`0023` are index-prefixed; `drizzle.config.ts` now sets `migrations.prefix: 'timestamp'`, so newer migrations are named `YYYYMMDDHHMMSS_<name>.sql` and parallel branches no longer collide on the next sequential number — only `meta/_journal.json` still conflicts (append-only entries; resolve a merge by keeping both and renumbering `idx`). Apply **order comes from the journal, not filenames**, and the migrator applies an entry only when its `when` is newer than the newest already-applied migration — an out-of-order entry is **silently skipped on existing databases**. `src/db/migration-journal.spec.ts` pins both invariants (contiguous `idx`, strictly increasing `when`); if it fails after a rebase because master gained newer migrations, regenerate your migration (or re-stamp its journal `when`) so it sorts last. `0004`'s hand-stamped `when` originally violated this (older than `0003`'s — a database parked at `0003` would have silently skipped it) and was re-stamped when the guard landed.
