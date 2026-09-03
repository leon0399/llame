# apps/api

NestJS 11 backend: HTTP API, application services, sole owner of the database schema/migrations, and host of both co-located worker consumers and the shipped no-HTTP worker entrypoint (SPEC.md §9.5).

**Where behavior is defined.** This file holds what an agent needs while editing
`apps/api`: commands, boundaries, and traps. Normative capability behavior lives
in [`openspec/specs`](../../openspec/specs) and is linked from each section
below — read the spec before changing a contract, and treat any disagreement
between the two as a bug in this file. Schema, migrations, and RLS provisioning
have their own directory file: [`src/db/AGENTS.md`](src/db/AGENTS.md).

## Stack

- NestJS 11 (`@nestjs/*`), Express platform
- DB: Drizzle ORM via `@knaadh/nestjs-drizzle-postgres` + `postgres.js`; migrations with `drizzle-kit`
- Tests: Vitest (unplugin-swc emits the decorator metadata Nest DI needs); projects `unit` / `integration` — layers, naming, and commands in [docs/testing.md](../../docs/testing.md)

## Structure

One directory per feature, each a NestJS module. A feature another feature
consumes exports its service from its own module and is never re-provided
elsewhere.

| Path                   | Owns                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/runs/`            | The whole execution domain: executor, worker consumers, dispatch, stream bridge. `RunWorkerModule` backs both co-located consumers and `src/worker.ts` |
| `src/queue/`           | pg-boss primitives used by runs, search workers, and session cleanup                                                                                   |
| `src/chats/`           | Chat/message surface. Dispatches via `RunDispatchService`; never sees queue names or payloads                                                          |
| `src/db/`              | Schema, migrations, `TenantDbService`. `DbModule` is the single global provider — see [`src/db/AGENTS.md`](src/db/AGENTS.md)                           |
| `src/tools/`           | `registry.ts` and `resolveAdvertisedTools`, the tool-loop gate                                                                                         |
| `src/instance-config/` | `llame.config.json` loading, prompt rendering, secret interpolation                                                                                    |
| `src/testing/`         | Shared helpers for HTTP-boundary integration suites; excluded from the build                                                                           |
| `evals/`               | Opt-in model-graded suites (`test:evals`), never run by CI                                                                                             |

`RunExecutionService` is transport-agnostic — do not couple it to HTTP.

**The tool gate is deliberately trivial.** The advertised and executable toolset
is exactly `allowlisted ∩ read_only`, sourced from `tools.allowed` in
`llame.config.json`. There is no policy-verdict composition and no
`TOOLS_ENABLED` env var; that machinery is gone. A real policy engine (org/user
capability grants, deny-overrides-allow) is a later slice (#133), and the gate is
shaped so it can become "capability composition minus denies" without reworking
the loop or the tool interface.

## Commands

```bash
pnpm --filter api dev          # nest start --watch
pnpm --filter api build        # nest build (start:prod -> node dist/main) — ALSO regenerates openapi.json
pnpm --filter api lint         # oxlint --deny-warnings --report-unused-disable-directives; type-aware via tsgolint
pnpm --filter api typecheck    # tsgo --noEmit — full program incl. specs (nest build excludes them)
pnpm --filter api test              # vitest unit project — zero external deps, always safe
pnpm --filter api test:integration  # everything needing real Postgres incl. RLS proof + HTTP suites; self-provisions via Testcontainers, TEST_DATABASE_URL overrides
pnpm --filter api test:evals        # opt-in model-graded evals — bring model credentials
pnpm --filter api test:mutation     # bounded Stryker pilot; diagnostic, foreground only (:dry preflights)
```

Database commands live in [`src/db/AGENTS.md`](src/db/AGENTS.md).

### Mutation-testing pilot

A bounded diagnostic that follows the direct unit tests. Not a coverage
substitute, not a CI gate. It targets only `src/mcp/tool-id.ts`,
`protected-values.ts`, and `mcp-bounded-fetch.ts` with their direct unit tests,
and does not expand to the monorepo, integration, Docker, browser, or e2e suites.

Run both commands in the foreground from the repository root. Stryker is limited
to one worker (`concurrency: 1`); `@stryker-mutator/vitest-runner@9.6.1` is
pinned in `apps/api/package.json` and the lockfile, and the installed runner's
runtime options force `maxThreads`, `maxWorkers`, and `maxConcurrency` to 1.
That pin plus installed source is the repo-reproducible evidence. **Do not raise
either concurrency setting without new measured peak-memory evidence**; a runner
upgrade must reverify those three options and the memory budget first. Reports
land in the ignored `apps/api/reports/mutation/`. Do not replace this with a
bespoke wrapper, reporter, checker, or threshold gate.

The full run opens Stryker's internal logging server with Node `listen`; a
restricted sandbox may need a narrowly scoped local-bind permission. Neither
llame nor these tests need external network access.

## Instance configuration

`llame.config.json` (JSONC, gitignored, per-deploy) is config-as-code: providers,
the model catalog, run timers, `http.trustProxy`, tool allowlists, MCP servers,
and embedding models. Read from `apps/api` by default; override with
`LLAME_CONFIG_PATH`. Precedence is file > built-in default, applied on restart
only. **Bare env vars are not a config source** — the environment reaches
settings only through `{env:…}` / `{path:…}` tokens in the file, and
interpolating a value is what marks it secret.

One-time: `cp apps/api/llame.config.json.example apps/api/llame.config.json`.
The example's `{env:…:-default}` tokens keep the familiar `.env.local` variables
working as interpolation inputs.

The traps worth knowing before you touch it:

- **Config errors fail boot, naming the bad path.** A dangling
  `models[].provider`, a `defaults.modelId` pointing at no model, a duplicate
  embedding-model `id`, an unreadable `systemPromptFile` — all abort startup.
  Nothing silently falls back. Provider credential and reachability problems, by
  contrast, fail at request time.
- **A provider whose `key` resolves empty is keyless**, not broken — that is how
  a local Ollama runs without a `LoadAPIKeyError`.
- **Compaction is per-model.** Each entry's required `contextWindowTokens` sizes
  the trigger unless `compactionThresholdTokens` overrides it. There is no
  instance-level knob; `COMPACTION_TOKEN_THRESHOLD` and
  `MODEL_CONTEXT_WINDOW_TOKENS` are gone.
- **Reasoning effort values are the provider's own tokens.** llame imposes no
  enum, casing, or pattern and never normalizes, sorts, or rewrites them,
  because OpenAI and Anthropic disagree and each changes the vocabulary between
  releases — a constraint here would make a provider release a llame release.
  `models[].reasoning`'s presence _is_ the declaration; there is no separate
  availability flag. Order is normative: it is the only scale a client gets.
- **The render context is a hand-built projection, never a record.** `users` has
  a `password` column; passing a row would put a credential hash into a system
  prompt, an immutable snapshot, and the owner-visible receipt.
- **Do not patch `Handlebars.Utils.escapeExpression`.** `Handlebars.create()`
  shares `Utils` by reference with the global export, so patching it changes
  escaping for every consumer in the process. Neutralization happens when the
  context is built, split by field kind, in
  `instance-config/authored-text.ts` — mirrored byte-for-byte in
  `apps/web/lib/services/personalization/sanitize.ts`; **keep both in sync**.
- **Rendered values are `SafeString`s, and a `SafeString` is truthy even when
  empty.** Absent and empty-after-trimming values are therefore omitted from the
  context rather than passed as empty strings, at every level of the projection.

Specs: [instance-config](../../openspec/specs/instance-config/spec.md),
[model-system-prompts](../../openspec/specs/model-system-prompts/spec.md),
[available-models](../../openspec/specs/available-models/spec.md),
[personalization](../../openspec/specs/personalization/spec.md). The renderable
allowlist is `PROMPT_CONTEXT_PATHS` in `instance-config/prompt-loader.ts` —
later capabilities extend that constant, not the validator.

## The context-injection rail

Every server-authored contribution to a chat's model-visible conversation that is
not part of the system prompt is a **context item** on one rail: a single
`<system-reminder producer="…" form="…">` envelope carrying a provenance
statement no operator config can remove. Producers supply the body, never the
framing.

Working rules, in order of how easily they are broken:

- **Stored text is the sole replay authority for `data-context`.** Each item
  stores its complete final model-facing envelope in `data.text`. Producer, form, Run
  linkage, and payload are non-rendering metadata. An item with an unrecognized
  producer still replays its stored text verbatim; a metadata-only or empty-text
  item is inert and is never regenerated. **Never gate replay on current producer
  knowledge or rebuild text from metadata.**
- **Replay preserves stored part order.** It never re-sorts old messages through
  the current author-time precedence list.
- **`temporal` says "received", never "current"**, and its payload stores the
  instant and the IANA zone _together_, so a worker cannot disagree with the API
  that accepted the turn and moving the instance timezone does not rewrite
  shipped rows. Do not "simplify" this into re-resolving the zone at replay.
- **Residency decides prompt vs rail.** An account of something that happened →
  rail. A complete statement of current state that changes less often than
  compaction → prefix. One that changes _more_ often → frozen prefix baseline
  plus rail deltas, re-baked at compaction. Never put a frequently-changing
  complete statement in the cached prefix.
- **A prefix change is silent by default.** It earns a rail notice only for
  **assertional** changes (facts the model may have denied or lacked), never
  **behavioral** ones (tone, format, working style).
- **Content injected from outside a chat is not erasable through its own
  source.** Deleting the source chat, or withdrawing consent, does not reach a
  record already written. Every producer carrying cross-chat content inherits
  this.

Adding a producer or form is additive to the schema but **not** to the fleet:
deploy producer-aware workers _before_ any API authors that producer, or the
item is silently absent from the model's view for that Run. Changing the
envelope itself is a coordinated revision boundary outright — exact-key-set
validation rejects it.

Specs: [context-injection](../../openspec/specs/context-injection/spec.md),
[temporal-anchor](../../openspec/specs/temporal-anchor/spec.md),
[memory](../../openspec/specs/memory/spec.md),
[chat-recency-digest](../../openspec/specs/chat-recency-digest/spec.md).
Anticipated forms without a producer are recorded in
`docs/research/harness-transparency/2026-08-21-context-form-design-space.md`
rather than specified.

### Recency-digest consent

`shareRecentChats` defaults off and is independent of personalization. Enabling
it sends titles and opening excerpts from the owner's _other_ chats to the
operator-configured provider — in a multi-user instance, possibly a third party
with no relationship to that user. The consent contract is incomplete unless all
three consequences are presented **together**:

1. Enabling is **retroactive** over the whole existing corpus.
2. Disabling is **not** retroactive — a chat already carrying a baseline keeps
   sending it.
3. Deleting a chat is **not** erasure — its title and excerpt survive in other
   chats' bound prompts, persisted appends, and issued receipts.

Compaction is the sole re-bake boundary. The baseline contains no chat
identifiers; ids exist only in the non-rendered told-set.

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
- Every function/dynamic tool sent through the OpenAI model client MUST be
  lowered with `strict: false`, including code-owned and MCP declarations.
  Omitting `strict` is not equivalent: native Responses may normalize the
  schema into strict mode, where every property is required and omission-style
  optional fields become required nullable fields. That model-facing rewrite
  diverges from the exact persisted schema and llame's SDK/local validators.
  Keep the policy at the OpenAI provider boundary; never mutate persisted raw
  JSON Schema to fit OpenAI's strict subset. Provider-defined tools are
  excluded. Chat Completions ignores the flag, so the same lowering is safe
  for compatible endpoints.
- Queue retries restart a still-claimable Run's tool loop from the first step.
  Read-only classification is therefore load-bearing: the first write-capable
  tool must ship checkpoint-or-dedupe semantics, not merely an approval gate.

Spec: [tool-calling](../../openspec/specs/tool-calling/spec.md).

## MCP tools

`mcpServers` is a restart-applied, instance-scoped map with two transports,
discriminated on a required `type`: `{ type: "stdio", command, args?, env?, cwd? }`
runs a child process with no shell, and `{ type, url, headers? }` is Streamable
HTTP (`http` and `streamable-http` are aliases). URL userinfo is rejected.

- **`tools.allowed` accepts exact namespaced ids or `mcp__<server>__*`.** Exact
  ids are the safer default. A wildcard is the operator's read-only attestation
  for every current _and future_ tool from that server, so it silently
  authorizes newly added remote tools — use it only for an entirely read-only
  server. Remote metadata never classifies or authorizes. Write, send, delete,
  execute, financial, and administrative MCP tools remain prohibited.
- **A stdio child gets only its declared `env`** merged over the MCP SDK's small
  base allowlist — llame's own environment is not passed through, so
  `POSTGRES_URL` and provider keys stay out unless an entry names them. It runs
  unsandboxed as the llame user. Its stderr is captured (`stderr: 'pipe'`, never
  inherited), bounded, sanitized, and logged with the server id.
- **Protected values come only from resolved `{env:…}`/`{path:…}` tokens**, never
  from literal text, and cover only the substituted segment: protecting a
  low-entropy literal would refuse tool calls naming it and corrupt results
  containing it.
- **Neither entry form creates an identity.** Both are raw filters over each
  process's safely admitted exact inventory. A fresh offline process has no
  synthetic unavailable ids. Provider requests, manifests, receipts, snapshots,
  and execution binding remain exact-only.

Enabling `mcpServers` is a second coordinated runtime boundary — keep it empty
while upgrading, and see Rollout below.

Spec: [mcp-tools](../../openspec/specs/mcp-tools/spec.md). Protocol, trust
boundaries, lifecycle, and troubleshooting:
[docs/mcp-tools.md](../../docs/mcp-tools.md).

## Chat search and recall

Lexical search (FTS + trigram + title, RRF-fused in
`ChatsRepository.searchByOwner`) is what the query path reads. **Embeddings are
populated but not yet read** — that is true by construction, not by convention;
query-time retrieval is #197.

Embeddings are off by default: with no `embeddingModels[]` entry and no
`search.<corpus>.embeddingModelId`, no provider request is possible. An
embedding key's provider/model/revision/dimensions/metric/prefixes are bound in a
database ledger the first time a vector persists under it; redefining a bound key
fails startup naming the field, never the value. **Undeclaring a model never
deletes its data** — startup only warns, and the vectors sit unread until
`search:prune`. To move a corpus: declare a new `id`, repoint, `search:backfill`,
confirm with `search:coverage`, then remove the old entry and prune.

Operator commands (`pnpm --filter api search:*`,
`src/search/operations/cli.ts`): `backfill` (pure producer — enqueues, never
calls a provider), `coverage`, `retry-failed`, `prune`,
`projection-coverage` (the cutover gate for canonical conversation reads;
returns no identifiers or content). `backfill`, `coverage`, and
`projection-coverage` fail loudly without provisioned discovery functions;
`retry-failed` and `prune` use owner-scoped writes.

`search_conversations` has one canonical model result contract and no activation
flag or legacy preview; its exact allowlist entry gates HTTP Run admission, and
every process consuming `runs` applies the same projection-coverage gate.
`conversation_read` is independently exact-allowlisted.

Specs: [chat-search](../../openspec/specs/chat-search/spec.md),
[search-embeddings](../../openspec/specs/search-embeddings/spec.md),
[search-projection](../../openspec/specs/search-projection/spec.md),
[conversation-reads](../../openspec/specs/conversation-reads/spec.md).
Operator runbook: [docs/conversation-recall.md](../../docs/conversation-recall.md).

## Conventions

- One NestJS module per feature (controller / service / module); wire via DI and register in `app.module.ts`.
- Place each constructor-parameter `@Inject(...)` decorator on its own line,
  immediately before the parameter. `pnpm lint:ast-grep` enforces the all-split
  form; Prettier preserves but does not choose decorator line placement.
- Schema lives in `src/db/schema`; change it, then `db:generate`. A hand-authored
  migration step records its own rationale in the migration's SQL comment — see
  [`src/db/AGENTS.md`](src/db/AGENTS.md).
- **API contract — code-first OpenAPI** (the client/server boundary lives in SPEC §22.0; established by #60). Every `/auth/v1`·`/api/v1` endpoint takes a class-validator **DTO** behind the global `ValidationPipe` and returns an **explicit response type** (never an ad-hoc object — mirror the `toPublicUser` egress allowlist), so `@nestjs/swagger` can emit a complete `openapi.json`. Add a DTO + response type with every new endpoint. The generated OpenAPI document is the API source of truth. The live spec is served at `/docs` (UI), `/docs/json`, `/docs/yaml`.

  **`apps/api/openapi.json` is a generated artifact that is COMMITTED to the repo, and `pnpm --filter api build` regenerates it.** Any change to an endpoint, DTO, response type, or Swagger annotation — including a `@ApiPropertyOptional` description — changes that file. CI's Build job runs `git diff --exit-code` after building, so a stale checked-in copy fails the build; it is deliberately a failure rather than a silent fixup, because the document is the API source of truth and a drifted copy misrepresents the contract.

  **Therefore `pnpm --filter api build` is part of the definition of done for any API-touching change**, alongside lint/typecheck/test. `lint`, `typecheck`, and the test suites all pass with a stale `openapi.json` — none of them regenerate it — so a change can look completely green locally and still fail CI. Run the workspace-scoped build and commit the regenerated `openapi.json` in the same commit as the endpoint change. Do not substitute the root `pnpm build`; that unbounded aggregate runs unrelated applications concurrently.

- **RESTful resource design — design the surface deliberately.** Model the API as resources + standard verbs (`GET`/`POST`/`PATCH`/`DELETE`), JSON:API-ish. Partial updates are `PATCH /resource/:id` — **not** RPC-style verb handles (`/chats/:id/title`, `/x/rename`). Nullable response fields are modeled explicitly (`@ApiProperty({ type, nullable: true })`, required-not-optional). Path ids backed by a typed DB column get `ParseUUIDPipe` + `@ApiParam`. Think about the resource model before adding a handle; don't bolt on verbs.
- **Chained type assertions, including `as unknown as T`, are banned project-wide** (#268) — they switch off the compiler at exactly the point a refactor most needs it: a fixture built through a double cast compiles clean and fails at runtime instead of surfacing every consumer to `tsgo`. Almost every API occurrence had the same shape — a class with private state, faked in a test — and a structural double can never satisfy a whole class, so narrow the _dependency_, not the fake:

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

  Derive the `Pick<>` field list from what the class under test actually calls (tsgo will tell you if you under-narrow), not from the whole interface. Type the **constructor parameter**, not the fixture — if the fixture is asserted on (`expect(x).toHaveBeenCalledWith(...)`), annotating it as the narrow type erases the `Mock` type and breaks the assertion; let it stay inferred, since it satisfies the interface structurally either way. `PromptUserResolver` (`personalization/personalization.service.ts`) and `RunStreamResponder` (`runs/run-stream-bridge.ts`) are the shipped exemplars. The `ReturnType<typeof streamText>` hand-forged model doubles are a separate, unrelated migration (`ai/test`'s `MockLanguageModelV3` — see [docs/testing.md](../../docs/testing.md)'s follow-ups), not this recipe.

## Gotchas

- `apps/api/src/db` is the **sole** schema; `apps/web` owns no database.
- Linting is oxlint with type-aware rules (`.oxlintrc.json`, `options.typeAware`) running on **tsgo** (TypeScript 7). tsgo rejects `baseUrl`, so `tsconfig.json` must not reintroduce it, and global test/node types are declared explicitly via `"types": ["node", "vitest/globals"]` (tsgo does not auto-include `@types/*` under pnpm the way tsc does). Formatting is prettier (`pnpm format`), checked in CI via the root `format:check`.
- Migration traps, the RLS role model, and the hand-authored-migration rules:
  [`src/db/AGENTS.md`](src/db/AGENTS.md).

### Rollout boundaries

**Pre-launch, [the repository policy](../../AGENTS.md#pre-launch-evolution)
outranks this section**: a single-revision hard cutover is the default, and the
sequencing below is what you record in the migration's header rather than what
you execute. It becomes binding at the first production deployment.

A change that alters what server-authored data _means_ is a coordinated
API/worker revision boundary, not a schema-only change. The shape is always the
same:

1. Land backward-compatible readers/preparation while old writers stay active.
2. Deploy workers that understand the change.
3. Quiesce old API writers and drain accepted Runs.
4. Apply the writer cutover; deploy schema and application revisions together.

On rollback, reverse it: stop new authoring first, drain Runs accepted by the
newer API on still-capable workers, then roll binaries back.

Two surfaces have extra conditions:

- **New context producers/forms** — deploy producer-aware workers before any API
  authors the producer (an older worker renders nothing and the item is silently
  absent). Envelope changes are a hard boundary: exact-key-set validation
  rejects them.
- **MCP** — keep `mcpServers` empty while upgrading. Split deployments must
  deploy every dedicated worker capable of exact dynamic declaration binding
  before the API can accept MCP-enabled Runs; co-located deployments must
  quiesce sends and drain Runs before each binary/config restart. Every process
  needs the same restarted config, secret inputs, and endpoint reachability —
  catalogs and sessions are process-local, and a mismatch settles a requested
  dynamic tool as unavailable. Roll back by removing MCP ids from the accepting
  API first, then draining bound Runs on still-capable workers.

Per-migration steps and operator SQL: [`src/db/AGENTS.md`](src/db/AGENTS.md) and
[docs/scaling.md](../../docs/scaling.md).
