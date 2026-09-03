# apps/api

NestJS 11 API, application services, sole database owner, and host for
co-located or no-HTTP workers. OpenSpec owns behavior; this file owns commands,
boundaries, and traps. DB work follows [`src/db/AGENTS.md`](src/db/AGENTS.md).

## Ownership

| Path                   | Owns                                                  |
| ---------------------- | ----------------------------------------------------- |
| `src/runs/`            | dispatch, execution, workers, stream bridge           |
| `src/queue/`           | pg-boss for Runs, search workers, and session cleanup |
| `src/chats/`           | Chat/message API; dispatches via `RunDispatchService` |
| `src/db/`              | schema, migrations, global `TenantDbService`          |
| `src/tools/`           | registry and advertised-tool gate                     |
| `src/instance-config/` | JSONC config, prompts, secret interpolation           |
| `src/testing/`         | HTTP integration helpers; excluded from build         |
| `evals/`               | opt-in model-graded tests; never CI                   |

Each feature owns one Nest module and exports services consumers need; never
re-provide them. `RunExecutionService` stays transport-neutral. The current tool
gate is exactly `allowlisted intersect read_only`; do not restore removed policy
or env toggles.

## Commands

```bash
pnpm --filter api dev
pnpm --filter api build        # also regenerates openapi.json
pnpm --filter api lint
pnpm --filter api typecheck
pnpm --filter api test
pnpm --filter api test:integration
pnpm --filter api test:evals
pnpm --filter api test:mutation:dry
pnpm --filter api test:mutation
```

Integration tests self-provision Postgres; `TEST_DATABASE_URL` overrides.
Mutation testing is the existing three-file MCP diagnostic. Reports are ignored
under `apps/api/reports/mutation/`; a restricted sandbox may need local-bind
permission for Stryker's logging server.

## Instance configuration

`llame.config.json` is restart-applied JSONC. It owns providers, models, run
timers, trust proxy, tools, MCP, embeddings, and worker profiles. Default path is
under `apps/api`; `LLAME_CONFIG_PATH` overrides. Bare env vars are not config;
only `{env:...}` and `{path:...}` interpolation expose environment values and
mark them secret.

Traps:

- Schema/reference errors fail boot with the bad path; provider reachability
  fails at request time. An empty provider key means keyless.
- Compaction is per model. Reasoning values are provider-owned, ordered tokens;
  presence of `models[].reasoning` declares availability.
- Prompt context is an explicit projection, never a user/database record.
- Never patch shared `Handlebars.Utils`. Sanitize in
  `instance-config/authored-text.ts` and keep the web mirror byte-identical.
- `SafeString("")` is truthy; omit absent/trimmed-empty keys.

Specs: [instance config](../../openspec/specs/instance-config/spec.md),
[model prompts](../../openspec/specs/model-system-prompts/spec.md),
[models](../../openspec/specs/available-models/spec.md), and
[personalization](../../openspec/specs/personalization/spec.md).

## Model-context rail

Every newly authored `data-context` contribution stores its complete
model-facing envelope in `data.text`.

- Replay non-empty stored text and part order verbatim, including unknown
  producers/forms. Metadata never regenerates text; missing or empty text is
  inert.
- Temporal items persist instant and IANA zone and say "received", not
  "current".
- Historical events use the rail. Slowly changing complete state uses the
  prefix; faster state uses a frozen baseline plus rail deltas, rebaked only at
  compaction.
- Prefix changes notify the rail only for factual/assertional changes, not tone
  or format.
- Cross-chat content already persisted is not erased by deleting its source or
  withdrawing future consent.

Deploy producer-aware workers before authoring a new producer. Envelope changes
are a hard API/worker revision boundary. Specs:
[context injection](../../openspec/specs/context-injection/spec.md),
[temporal anchor](../../openspec/specs/temporal-anchor/spec.md),
[memory](../../openspec/specs/memory/spec.md), and
[recency digest](../../openspec/specs/chat-recency-digest/spec.md).

`shareRecentChats` defaults off. Consent must state together: enabling scans
existing chats; disabling does not remove already-bound baselines; deleting a
source chat does not erase copies in prompts, appends, or receipts.

## Tool schemas and MCP

- Preserve raw JSON Schema and `$schema`; compile before the immutable Run
  snapshot. Invalid tools fail individually. SDK validation is primary; local
  parse is defense in depth.
- Every OpenAI function/dynamic tool is lowered with `strict: false`; do this at
  the provider boundary, never by rewriting persisted schemas.
- Queue retry restarts the tool loop, so write-capable tools require checkpoint
  or dedupe semantics.
- MCP config supports stdio and Streamable HTTP. Wildcards
  `mcp__<server>__*` attest that every current and future tool is read-only;
  exact IDs are safer. Remote metadata grants no authority.
- Stdio children receive only the SDK base env plus declared `env`, run
  unsandboxed as llame, and have bounded/sanitized stderr. Only interpolated
  segments are protected.
- Declarations and execution bind exact IDs; config patterns never become
  durable/model identities.

Specs: [tool calling](../../openspec/specs/tool-calling/spec.md) and
[MCP tools](../../openspec/specs/mcp-tools/spec.md). Operator procedure:
[docs/mcp-tools.md](../../docs/mcp-tools.md).

## Search and recall

Lexical FTS/trigram/title search is live; embeddings are produced but not read
until #197. Embeddings default off. Once a vector key persists, its provider,
model, revision, dimensions, metric, and prefixes cannot be redefined. To move
a corpus: declare a new ID, repoint, backfill, verify coverage, remove the old
entry, then prune.

`search:*` commands fail closed, including when RLS helpers are unprovisioned.
`search:backfill` only enqueues; it never calls a provider. Removing an embedding
model does not delete vectors; use `search:prune` explicitly.
`search_conversations` always returns canonical results; HTTP admission and
every `runs` consumer enforce projection coverage. `conversation_read` is
independently allowlisted. See [the runbook](../../docs/conversation-recall.md)
and the chat-search/search-projection/conversation-read OpenSpecs.

## API conventions

- Constructor `@Inject(...)` decorators get their own line before the
  parameter.
- Endpoints use resource verbs, class-validator DTOs, and explicit response
  allowlists. IDs use typed pipes. Nullable fields are explicit and required.
- `apps/api/openapi.json` is generated and committed. Any DTO/controller/Swagger
  change must run API build and commit the result. Lint, types, and tests do not
  regenerate it.
- Chained casts are banned. Narrow consumer dependencies with exported `Pick<>`
  capabilities and explicit Nest tokens; let mock fixtures retain inferred
  Vitest types.
- API uses tsgo type-aware lint. Keep explicit node/vitest types and no
  `baseUrl`.
