# apps/api

NestJS 11 backend: HTTP API, application services, sole owner of the database schema/migrations, and host of both co-located worker consumers and the shipped no-HTTP worker entrypoint (SPEC.md §9.5).

## Stack

- NestJS 11 (`@nestjs/*`), Express platform
- DB: Drizzle ORM via `@knaadh/nestjs-drizzle-postgres` + `postgres.js`; migrations with `drizzle-kit`
- Tests: Vitest (unplugin-swc emits the decorator metadata Nest DI needs); projects `unit` / `integration` — layers, naming, and commands in [docs/testing.md](../../docs/testing.md)

## Structure

- `src/` — one directory per feature, each a NestJS module (`chats/`, `runs/`, `compaction/`, `titles/`, `queue/`, `models/`, `auth/`, `users/`, `db/`, `tools/`); a feature another feature consumes exports its service from its own module, never re-provided elsewhere. Boundary rules: `queue/` is consumed ONLY by `runs/` (chats dispatches runs via `RunDispatchService` and never sees queue names/payloads); `runs/` hosts the whole execution domain (executor, worker consumers, dispatch, stream bridge — `RunWorkerModule` backs both co-located consumers and the shipped dedicated worker entrypoint in `src/worker.ts`; `run-execution.service.ts` also owns the tool-calling loop's gate, `resolveAdvertisedTools` (`src/tools/registry.ts`) — the advertised/executable toolset is simply `allowlisted ∩ read_only`, sourced from `tools.allowed` in `llame.config.json` (no policy-verdict composition, no `TOOLS_ENABLED` env var — that machinery is gone). A real policy engine (org/user capability grants, deny-overrides-allow) is a later slice (#133); the gate is designed so it can later become "capability composition minus denies" without reworking the loop or the tool interface); `db/DbModule` is the single global `TenantDbService` provider
- `src/db/` — `schema/` (`auth.ts`, `chats.ts`), `migrations/` (+ `meta/` journal), `migrate.ts`
- `src/testing/` — shared helpers for the HTTP-boundary integration suites (supertest cookie/SSE/fake-model utilities); excluded from the build
- `evals/` — opt-in model-graded suites (`test:evals`), never run by CI
- `src/main.ts`, `src/worker.ts`, `src/app.module.ts`

## Commands

```bash
pnpm --filter api dev          # nest start --watch
pnpm --filter api build        # nest build  (start:prod -> node dist/main)
pnpm --filter api lint         # oxlint --deny-warnings; type-aware rules via tsgolint (tsgo)  (lint:fix to autofix)
pnpm --filter api typecheck    # tsgo --noEmit — full program incl. specs (nest build excludes them)
pnpm --filter api test              # vitest unit project — zero external deps, always safe
pnpm --filter api test:integration  # everything needing real Postgres incl. RLS proof + HTTP suites; self-provisions via Testcontainers (docker), TEST_DATABASE_URL overrides
pnpm --filter api test:evals        # opt-in model-graded evals — bring model credentials; DB self-provisions (TEST_DATABASE_URL overrides)
pnpm --filter api db:generate  # drizzle-kit generate from src/db/schema
pnpm --filter api db:migrate   # tsx src/db/migrate.ts
pnpm --filter api db:studio    # drizzle-kit studio (also db:push / db:check)
```

## Tool input schemas

- `Tool.inputSchema` accepts either code-authored Zod or a raw JSON Schema
  document. Preserve raw JSON Schema exactly as supplied: do not rewrite
  `$schema` and do not round-trip it through Zod.
- A missing `$schema` defaults to draft-07. Supported declarations are
  draft-07 over HTTP or HTTPS with an optional trailing `#`, draft 2019-09 at
  `https://json-schema.org/draft/2019-09/schema` (optional trailing `#`), and
  draft 2020-12 at `https://json-schema.org/draft/2020-12/schema` (optional
  trailing `#`). URI normalization selects a validator only; it never mutates
  the stored declaration.
- Compile each declaration before it enters the immutable Run snapshot.
  Unsupported or invalid schemas refuse only the affected tool, with an
  operator diagnostic naming its id and declared or assumed dialect; valid
  siblings stay available. Never advertise a schema without an effective
  validator.
- `ajv-formats` enforces its standard formats, including `email`, `uri`, and
  `date-time`. A custom `format` is not a security or correctness constraint
  until it is explicitly registered and tested.
- The SDK validator is the primary model-call gate; the runner's local parse is
  defense-in-depth for callers that bypass the SDK. Keep both paths aligned.
- Queue retries restart a still-claimable Run's tool loop from the first step.
  Read-only classification is therefore load-bearing: the first write-capable
  tool must ship checkpoint-or-dedupe semantics, not merely an approval gate.

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
credential/reachability problems fail at request time. Per-user BYOK is unshipped and
tracked in #37; it has no assigned release here.

The config file (config-as-code, JSONC) also carries the run timers and
`http.trustProxy`; bare env vars are NOT a config source for these settings — the
environment reaches them only via `{env:…}` tokens in the file. Precedence is file >
built-in default. The live file is gitignored (per-deploy, like `.env.local`), read from
`apps/api` by default (override with `LLAME_CONFIG_PATH`), and applies on restart only.

**Providers + the model catalog are config-as-code too** (providers-and-models-as-code,
#167) — `providers[]` (duplicable `{ id, type, key, baseUrl }`; `type` is `"openai"`
only today, covering native OpenAI + any OpenAI-compatible endpoint) and `models[]`
(the executable catalog, superseding the old hardcoded `models/model-catalog.ts`)
supersede `OPENAI_API_KEY`/`OPENAI_BASE_URL` as bare reads — those env vars remain valid
`{env:…}` interpolation inputs referenced from a provider entry. `models[].provider`
must reference a defined `providers[].id`, and `defaults.modelId`/
`titleGenerationModelId` must reference a defined model, or boot fails naming the
dangling reference (config-as-code = deploy-time correctness — the catalog is config
now too). A provider whose `key` resolves empty is **keyless** (e.g. a local Ollama) and
executes without a `LoadAPIKeyError`. Compaction is per-model: each model entry's
required `contextWindowTokens` sizes the trigger (× 0.8) unless the entry's optional
`compactionThresholdTokens` overrides it — `COMPACTION_TOKEN_THRESHOLD` and
`MODEL_CONTEXT_WINDOW_TOKENS` are gone (there is no instance-level compaction knob).
`ModelsService.createClient(modelId)` resolves model → its provider → a client
dispatched by the provider's `type` (`model-client-factory.ts`) — an Anthropic adapter is
a follow-up, not yet supported.

**Model system prompts are config-as-code.** Every model resolves one complete
prompt at boot. Omit `models[].systemPromptFile` to use the packaged project
default; set it to a literal relative path (resolved from the active
`llame.config.json` directory) or absolute host path for a complete per-model
replacement. It is not `{path:...}` secret interpolation. A missing, unreadable,
non-file, or empty override aborts boot; no broken override silently falls back.
Prompt contents are designed to be visible to the chat owner, so they must not
contain credentials or host-sensitive data. The configured path remains
server-only and is stripped from the public model catalog.

**Prompt files are Handlebars templates.** Renderable paths are the model's
`{{model.id}}`/`{{model.name}}` plus the requesting owner's per-user paths;
`${...}` has no meaning and is ordinary text.

- **The renderable allowlist** is `PROMPT_CONTEXT_PATHS` in
  `instance-config/prompt-loader.ts` — later capabilities extend that constant,
  not the validator. It holds `{{model.id}}`, `{{model.name}}`, and the per-user
  paths documented below.
- **Validation is deny-by-default and happens at boot**, walking the parsed AST.
  Permitted node kinds: literal content, value expressions, block expressions,
  comments. Everything else aborts boot naming the model id and the construct —
  including partials, which exist in three syntactic forms (`{{> x}}`,
  `{{#> x}}…{{/x}}`, and an inline partial via `{{#*inline}}`) and would
  otherwise reintroduce the prompt composition `model-system-prompts` forbids.
  Only `if`/`unless` blocks are allowed; a value expression carrying parameters
  is a helper invocation and is rejected. Unescaped output (`{{{ … }}}`) is
  rejected.
- **An unknown path aborts boot; an absent value does not.** A typo fails loudly,
  but `{{model.name}}` on a model with no configured name renders empty, so that
  `{{#if model.name}}…{{model.name}}…{{/if}}` is expressible.
- **Absent and empty values are omitted from the render context**, never passed
  as empty strings: rendered values are `SafeString`s, and a `SafeString` is
  truthy _even when empty_, so a wrapped empty value would make every `{{#if}}`
  over it evaluate true. Values are trimmed, and whitespace-only counts as
  absent.
- **Neutralization is split by field kind**, applied when the context is built.
  Model and account-identity values (`model.*`, `user.name`, `user.email`)
  escape exactly `&`, `<`, `>` and nothing else. Owner-authored values
  (`user.personalization.*`) instead pass through the tag-balance sanitizer
  (`instance-config/authored-text.ts`, mirrored byte-for-byte in
  `apps/web/lib/services/personalization/sanitize.ts` — keep both in sync).
  Two rules: **a value can never close a tag it did not open within that same
  value** (unmatched, malformed, or whitespace-padded closers are escaped
  fail-closed regardless of stack state), and **a reserved tag name is never
  emitted as a tag at all** — the balance rule alone accepts a value that both
  opens and closes `<user_personalization>`, which forges a whole fence inside
  the real one, so the packaged fence's name is reserved outright. Everything
  else (self-contained markup under another name, unmatched openers, prose
  `<`/`&`) passes verbatim, because owners legitimately author tag-structured
  preference text. An operator whose replacement template uses a differently
  named wrapper keeps the balance rule but not the reservation; and markdown
  headings inside authored text are deliberately not touched (see the
  `personalization` spec for why that confers nothing). Handlebars' default escaping is unusable
  either way: it also converts `'`, `"`, `=`, and backticks into character
  references, which mangles prose and code fragments in a natural-language
  prompt. Do **not** patch `Utils.escapeExpression`: `Handlebars.create()`
  shares `Utils` by reference with the global export, so patching it changes
  escaping for every consumer in the process.
- **The render context is a hand-built projection, never a record.** `users` has
  a `password` column; passing a row would put a credential hash into a system
  prompt, an immutable snapshot, and the owner-visible receipt.
  **Per-user context (personalization).** Model paths resolve at boot; per-user
  paths resolve **per run**, because no owner is in scope when the config loads.
  The loader therefore returns `renderSystemPrompt(user?)` rather than a rendered
  string, and `resolveEffectiveContext` renders it before hashing so a snapshot is
  addressed by what was actually sent.

- **Renderable per-user paths**: `user.personalization.preferredName`,
  `user.personalization.about`, `user.personalization.responsePreferences`,
  `user.name`, `user.email`. Names match the API field names exactly, so the
  prompt vocabulary and the API contract cannot drift apart. Neither toggle is
  renderable — they gate content and are not content.
- **`user` and `user.personalization` are gate-only**: legal as a conditional's
  subject (`{{#if user}}`), rejected as output, because emitting one would
  render a stringified object. The split is by POSITION, not by widening the
  value allowlist.
- **Absence is omission, at three levels**: a field with no value, then
  `user.personalization` when nothing authored survives, then `user` itself when
  nothing beneath it would render. The third is what lets one `{{#if user}}`
  gate a whole section including its framing prose. A value empty **after
  trimming** counts as absent — a `SafeString` is truthy even when it wraps `""`.
- **Boot still renders once**, with the model context alone, and keeps the
  `rendered prompt is empty` failure. That probe is the minimum possible output,
  so a template non-empty there is non-empty for every owner — and a prompt
  wrapped entirely in `{{#if user}}` correctly fails startup.
- **Caps** (`personalization.constants.ts`): `preferredName` 255, `about` 8000,
  `responsePreferences` 8000, enforced at the DTO so a change is not a
  migration. Worst case ~16.3k chars (~4k tokens) on every request for that
  owner — noise against a large window, a serious share of a small one, since
  compaction triggers at `contextWindowTokens x COMPACTION_WINDOW_RATIO`.
- **Content policy**: non-sensitive, owner-authored text only. Never inferred or
  auto-populated, never written to operator logs or error responses, never
  exposed to any identity but its owner.
- **An operator prompt referencing no per-user path silently forgoes
  personalization** for that model. It must not fail startup or a run, and
  nothing reports it — per-model activation reporting is deliberately out of
  scope. Replacing `chat-default.md` therefore makes the owner's toggles inert
  for that model.
- **Precedence**: operator prompt and tool/safety constraints > in-conversation
  instructions > authored personalization > future inferred memory. Only the top
  rung is structurally enforced (`resolveAdvertisedTools` receives no
  personalization input, asserted by test); the rest is carried by the packaged
  default's framing prose and model compliance.

- A template whose content is only expressions and whitespace fails boot as
  empty, evaluated against the template rather than rendered output.

Migrations run as a **non-superuser `app` role that owns the schema** (provisioned by
`docker/postgres/initdb/01-app-role.sql`), so RLS is exercised in dev as in production:

- RLS is `ENABLE`d **and** `FORCE`d on `chats`/`messages`. Without `FORCE` the table owner
  bypasses RLS, so a single-role self-hosted deployment would silently lose tenant isolation.
- Every request must run inside `TenantDbService.runAs(userId, …)`, which sets
  `app.current_user_id` transaction-locally. If it is unset, every RLS policy denies all rows.
- `pnpm --filter api test:integration` re-proves cross-tenant isolation **and** runs the
  HTTP-boundary suites (real HTTP via supertest) against a throwaway Postgres its
  Testcontainers globalSetup provisions with the same non-superuser owner + FORCE topology.
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
   (`pnpm db:provision-rls`; `test:integration`'s globalSetup runs the equivalent against its
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
- Schema lives in `src/db/schema`; change it, then `db:generate`. Don't hand-edit generated migration SQL or `meta/_journal.json` — the exceptions (`0004`, `0006`, `0010`, `0011`, `0012`, `0013`, `0018`, `0019`, `0020`, `0021`, `0022`, `0023`, `20260712055209_search_projection`, `20260713020237_rename_search_documents`, `20260718134220_flashy_infant_terrible`, `20260803201518_good_pixie`) are documented in Gotchas.
- **API contract — code-first OpenAPI** (the client/server boundary lives in SPEC §22.0; established by #60). Every `/auth/v1`·`/api/v1` endpoint takes a class-validator **DTO** behind the global `ValidationPipe` and returns an **explicit response type** (never an ad-hoc object — mirror the `toPublicUser` egress allowlist), so `@nestjs/swagger` can emit a complete `openapi.json`. Add a DTO + response type with every new endpoint. The generated OpenAPI document is the API source of truth. Client/SDK codegen remains deferred — don't hand-write or generate an API client yet. The live spec is served at `/docs` (UI), `/docs/json`, `/docs/yaml`.
- **RESTful resource design — design the surface deliberately.** Model the API as resources + standard verbs (`GET`/`POST`/`PATCH`/`DELETE`), JSON:API-ish. Partial updates are `PATCH /resource/:id` — **not** RPC-style verb handles (`/chats/:id/title`, `/x/rename`). Nullable response fields are modeled explicitly (`@ApiProperty({ type, nullable: true })`, required-not-optional). Path ids backed by a typed DB column get `ParseUUIDPipe` + `@ApiParam`. Think about the resource model before adding a handle; don't bolt on verbs.
- **`as unknown as T` is banned** (#268) — it switches off the compiler at exactly the point a refactor most needs it: a fixture built through a double cast compiles clean and fails at runtime instead of surfacing every consumer to `tsgo`. A staged-file lefthook gate enforces this on new code. Almost every occurrence has the same shape — a class with private state, faked in a test — and a structural double can never satisfy a whole class, so narrow the _dependency_, not the fake:

  ```ts
  // personalization.service.ts — export the narrow capability the consumer needs
  export type PromptUserResolver = Pick<PersonalizationService, 'resolvePromptUser'>;

  // chat-loop.service.ts — the annotation carries no DI metadata, so the token is explicit
  @Inject(PersonalizationService)
  private readonly personalization: PromptUserResolver,

  // chat-loop.service.test.ts — plain object, fully typed, no cast possible or needed
  const personalization: PromptUserResolver = {
    resolvePromptUser: () => Promise.resolve(undefined),
  };
  ```

  Derive the `Pick<>` field list from what the class under test actually calls (tsgo will tell you if you under-narrow), not from the whole interface. Type the **constructor parameter**, not the fixture — if the fixture is asserted on (`expect(x).toHaveBeenCalledWith(...)`), annotating it as the narrow type erases the `Mock` type and breaks the assertion; let it stay inferred, since it satisfies the interface structurally either way. `PromptUserResolver` (`personalization/personalization.service.ts`) and `RunStreamResponder` (`runs/run-stream-bridge.ts`) are the shipped exemplars. Two genuine production sites (`compaction.service.ts`'s `toolCalls` cast off an AI SDK result, `chat-loop.service.ts`'s bridge-`Response`-to-`streamText`-return-type adapter cast) are narrow escapes around an external library type, not this pattern — don't force-fit `Pick<>` there; they need a typed adapter at the library boundary instead (#214 owns them). The `ReturnType<typeof streamText>` hand-forged model doubles are a separate, unrelated migration (`ai/test`'s `MockLanguageModelV3` — see [docs/testing.md](../../docs/testing.md)'s follow-ups), not this recipe either.

## Gotchas

- `apps/api/src/db` is the **sole** schema; `apps/web` owns no database.
- Linting is oxlint with type-aware rules (`.oxlintrc.json`, `options.typeAware`) running on **tsgo** (TypeScript 7). tsgo rejects `baseUrl`, so `tsconfig.json` must not reintroduce it, and global test/node types are declared explicitly via `"types": ["node", "vitest/globals"]` (tsgo does not auto-include `@types/*` under pnpm the way tsc does). Formatting is prettier (`pnpm format`), checked in CI via the root `format:check` — it is no longer an ESLint rule.
- Migrations are `drizzle-kit`-generated (`0005`+). Hand-authored exceptions: `0004` (the PoC → multi-tenant transition — drizzle-kit's interactive column-rename can't be driven non-interactively; `FORCE ROW LEVEL SECURITY` is hand-maintained here too, Drizzle can't express it), `0006` (the sessions hashing migration carries a manual `DELETE FROM sessions` — raw tokens can't be carried into the hashed-at-rest model), `0010` (the nullable-title migration carries a manual `UPDATE` backfilling old default-literal titles to NULL, and drops a spurious generated DROP/CREATE of the unchanged `sessions_user_created_idx`), `0011` (the durable-runs migration hand-appends `FORCE ROW LEVEL SECURITY` for `runs`/`run_events` — Drizzle emits ENABLE only — and hand-reorders the composite-key unique indexes before the FKs that reference them), `0012` (the single-flight migration carries a manual `UPDATE` cancelling all but the newest non-terminal run per chat — the partial unique index cannot be created over duplicates — plus matching `run.cancelled` events, applied inside a NO FORCE RLS window since migrations run as the owning role), `0013` (the `in_reply_to` reply-integrity trigger, #73 — Drizzle can't express triggers), `0018` (the identity/org-units migration hand-appends `FORCE ROW LEVEL SECURITY` for `org_units`/`memberships`/`external_identities`, same as `0004`/`0011`), and `0019` (org-units production-grade invariants — hand-appends the `llame_role_on_unit_path` `SECURITY DEFINER` function (owned by `app` until the separate `pnpm db:provision-rls` step reassigns it to `app_rls` — see "`app_rls` (BYPASSRLS)" above) + `GRANT SELECT ... TO app_rls`, the deferred path-integrity constraint trigger on `org_units` (+ a `DO`-block assertion that pre-existing rows already satisfy it), and the last-owner `BEFORE UPDATE OR DELETE` trigger on `memberships` — Drizzle can express none of CREATE FUNCTION or CREATE [CONSTRAINT] TRIGGER), and `0020` (the `runs.model_id` migration carries a manual `UPDATE` backfilling existing rows to the canonical default `system:openai:gpt-5.4-mini` before `SET NOT NULL` — drizzle-kit emits only `ADD COLUMN` + `SET NOT NULL` — inside a NO FORCE RLS window, same as `0012`, since migrations run as the owning `app` role with no `app.current_user_id` and FORCE would silently no-op the update), `0021` (the projects migration hand-appends `FORCE ROW LEVEL SECURITY` for `projects`, same as `0004`/`0011`/`0018`), and `0022` (the `org_unit_type` recreate dropping `'project'` from the vocabulary, admin-area-org-tree D5 — drizzle-kit's generated enum-recreate converts the column to `text`, drops/recreates the enum, then casts back with a `USING` clause; it doesn't account for existing rows holding a value about to be dropped, so a manual `UPDATE org_units SET type = 'group' WHERE type = 'project'` is hand-inserted while the column is still plain `text`, before the project-less enum exists — otherwise the final `USING` cast would fail on any stray `project`-typed row; the UPDATE runs inside a NO FORCE RLS window, same as `0012`/`0020`, since `org_units` is FORCE RLS (`0018`) and migrations run with no `app.current_user_id` — without the window the backfill silently no-ops and the cast aborts), and `0023` (the rework-item-pinning migration hand-appends `FORCE ROW LEVEL SECURITY` for `pins`, same as `0021` — it also drops `chats.pinned_at` + `chats_owner_pinned_updated_idx`, replacing row-level chat pinning with the per-user `pins` table; no data backfill by design), and `20260712055209_search_projection` (chat-search-platform #195 — hand-prepends `CREATE EXTENSION IF NOT EXISTS pg_trgm` (trusted contrib, creatable by the non-superuser `app` role; MUST precede the `gin_trgm_ops` index), hand-appends `FORCE ROW LEVEL SECURITY` for `search_documents`/`search_chat_state` (same as `0004`/`0011`/`0018`/`0021`/`0023`), and the `llame_search_stale_chats(integer, integer)` `SECURITY DEFINER` staleness-discovery function — owned by `app` until `pnpm db:provision-rls` reassigns it to `app_rls`, same lifecycle as `0019`'s `llame_role_on_unit_path`, plus `GRANT SELECT ON chats, messages, search_chat_state TO app_rls` (the function's message-time staleness subquery reads `messages`); the function returns only identifiers + timestamps, never content), and `20260713020237_rename_search_documents` (chat-search-platform D1 naming — a hand-authored, **non-destructive** `ALTER TABLE "search_documents" RENAME TO "search_chat_documents"` plus every dependent object rename: the 5 indexes, the pkey + 2 FK constraints (renaming the pkey constraint auto-renames its backing index), and the RLS policy. drizzle-kit can't emit a table rename non-interactively, and this rename **must** preserve the rows already shipped to existing databases under the old name — so it is a forward ALTER on top of `20260712055209_search_projection`, NOT a regenerated create. `search_chat_state` is unchanged; `llame_search_stale_chats` reads `search_chat_state`/`chats`/`messages`, never this table, so it needs no change. Proven non-destructive against a live DB in a rolled-back transaction; FORCE RLS survives the rename). `drizzle-kit check` passes for all. Re-add the manual steps if you ever regenerate these.
- `20260718134220_flashy_infant_terrible` is otherwise Drizzle-generated, but hand-appends `FORCE ROW LEVEL SECURITY` for `model_context_snapshots` because `.enableRLS()` emits only `ENABLE`; re-add that statement if the migration is regenerated.
- `20260803201518_good_pixie` (add-user-personalization) is the same exception for `personalization`: Drizzle-generated, then hand-appended `FORCE ROW LEVEL SECURITY`. Without it the owning `app` role bypasses all four owner policies, which in a single-role self-hosted deployment means no isolation at all on a table holding owner-authored profile text. Re-add the statement if the migration is regenerated.
- Migration filenames: `0000`–`0023` are index-prefixed; `drizzle.config.ts` now sets `migrations.prefix: 'timestamp'`, so newer migrations are named `YYYYMMDDHHMMSS_<name>.sql` and parallel branches no longer collide on the next sequential number — only `meta/_journal.json` still conflicts (append-only entries; resolve a merge by keeping both and renumbering `idx`). Apply **order comes from the journal, not filenames**, and the migrator applies an entry only when its `when` is newer than the newest already-applied migration — an out-of-order entry is **silently skipped on existing databases**. `src/db/migration-journal.test.ts` pins both invariants (contiguous `idx`, strictly increasing `when`); if it fails after a rebase because master gained newer migrations, regenerate your migration (or re-stamp its journal `when`) so it sorts last. `0004`'s hand-stamped `when` originally violated this (older than `0003`'s — a database parked at `0003` would have silently skipped it) and was re-stamped when the guard landed.
