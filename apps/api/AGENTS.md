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
pnpm --filter api lint         # oxlint --deny-warnings --report-unused-disable-directives; type-aware via tsgolint (lint:fix to autofix)
pnpm --filter api typecheck    # tsgo --noEmit — full program incl. specs (nest build excludes them)
pnpm --filter api test              # vitest unit project — zero external deps, always safe
pnpm --filter api test:mutation:dry # bounded Stryker pilot preflight; diagnostic, foreground only
pnpm --filter api test:mutation     # bounded Stryker pilot; diagnostic, foreground only
pnpm --filter api test:integration  # everything needing real Postgres incl. RLS proof + HTTP suites; self-provisions via Testcontainers (docker), TEST_DATABASE_URL overrides
pnpm --filter api test:evals        # opt-in model-graded evals — bring model credentials; DB self-provisions (TEST_DATABASE_URL overrides)
pnpm --filter api db:generate  # drizzle-kit generate from src/db/schema
pnpm --filter api db:migrate   # tsx src/db/migrate.ts
pnpm --filter api db:studio    # drizzle-kit studio (also db:push / db:check)
```

### Mutation-testing pilot

The mutation pilot is a bounded API diagnostic that follows the direct unit tests;
it is not a coverage substitute and is not a CI gate. It targets only
`src/mcp/tool-id.ts`, `src/mcp/protected-values.ts`, and
`src/mcp/mcp-bounded-fetch.ts`, with only their direct unit tests:
`src/mcp/tool-id.test.ts`, `src/mcp/protected-values.test.ts`, and
`src/mcp/mcp-bounded-fetch.test.ts`. It does not expand to the monorepo,
integration, Docker, browser, or product-e2e suites.

Run both commands in the foreground from the repository root. Stryker is limited
to one worker (`concurrency: 1`). The repository pins
`@stryker-mutator/vitest-runner@9.6.1` in `apps/api/package.json` and the
lockfile; the installed 9.6.1 runner source's runtime options force
`maxThreads`, `maxWorkers`, and `maxConcurrency` to 1. This pin plus installed
source is the repo-reproducible evidence. Do not increase either concurrency
setting without new measured peak-memory evidence; any runner upgrade must
reverify those three options and the peak-memory budget before it can change the
pilot's limit.

Stryker's native clear-text summary is emitted by the command. Native HTML and
JSON reports are written to `apps/api/reports/mutation/mutation.html` and
`apps/api/reports/mutation/mutation.json`; the entire directory is ignored. Do
not replace this configuration with a bespoke wrapper, reporter, checker, or
threshold gate.

The full mutation run opens Stryker's internal logging server with Node `listen`.
In a restricted sandbox, that local bind may need a narrowly scoped network
permission. This is a sandbox execution detail only: neither llame nor these
tests require external network access. The dry run may not open the logging
server at all.

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

## MCP tools

The top-level `mcpServers` config is a restart-applied, instance-scoped map with
two transport variants, discriminated on a required `type`. A local entry is
`{ type: "stdio", command, args?, env?, cwd? }`, run as a child process with no
shell. A remote entry is exactly `{ type, url, headers? }`. `http` and `streamable-http` are aliases
for Streamable HTTP. Header values may use `{env:...}` / `{path:...}` secret
interpolation; resolved values and MCP session ids are transport-only. URL
userinfo is rejected. `tools.allowed` accepts exact namespaced ids or only
`mcp__<configured-server>__*`. Exact ids are the safer default. A wildcard is
the operator's read-only attestation for every current and future safely
admitted tool from that server, so it can silently authorize a newly added
remote tool; use it only for an entirely read-only server. Remote metadata does
not classify or authorize tools. Write, send, delete, execute, financial, and
administrative MCP tools remain prohibited.

**stdio specifics.** The child's environment is the declared `env` merged over
the MCP SDK's base allowlist (POSIX `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`,
`USER`, and only where llame itself defines them) and nothing else — llame's own
environment is not passed through, so `POSTGRES_URL` and provider keys stay out
unless an entry names them. Protected values come only from resolved
`{env:…}`/`{path:…}` tokens in `command`/`args`/`env`, never from literal text,
and only the substituted segment: protecting a low-entropy literal would refuse
tool calls naming it and corrupt results containing it. The child's stderr is
captured (`stderr: 'pipe'`, never inherited), bounded, sanitized, and logged
with the server id. Retry differs from remote on purpose: a stdio server gets a
bounded burst of fast attempts then settles, staying on the periodic occasion so
a transient host condition still recovers without a restart — remote reconnect
is unchanged and unbounded. A stdio child runs unsandboxed as the llame user.

Exact and wildcard entries are raw filters over each process's safely admitted
exact inventory; neither creates an identity. A fresh offline process has no
synthetic unavailable ids. After prior discovery, a process remembers the last
admitted exact ids for unavailable/reconnected transitions while withdrawing
stale declarations and executors; complete discovery replaces that set, so
omitted or refused ids are absent/`Removed`. Provider requests, manifests,
receipts, snapshots, and execution binding remain exact-only. Configuration is
restart-applied. Deploy compatible API and workers before adding a wildcard;
rollback restores exact entries and restarts the fleet before any older binary.
See [docs/mcp-tools.md](../../docs/mcp-tools.md) for the protocol, trust,
lifecycle, rollout, and troubleshooting contract.

## Local database & RLS (dev)

The repo-root `compose.yaml` runs Postgres for dev; root scripts wrap it (`pnpm db:up` /
`db:migrate` / `db:studio` / `db:psql` / `db:reset`). One-time: `cp apps/api/.env.example
apps/api/.env.local`.

**Postgres must ship the `vector` extension (pgvector).** `compose.yaml` is pinned to
`pgvector/pgvector:pg17` by digest, not stock `postgres:17-alpine` — embeddings-backed
search needs `vector` alongside the already-required `pg_trgm`. This is a **breaking**
requirement for existing self-hosters running their own Postgres: move to a
pgvector-capable image (or an equivalent managed Postgres that ships `vector`) before
upgrading, or migrations that create the extension will fail.

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
issue #167) — `providers[]` (duplicable `{ id, type, key, baseUrl }`; `type` is `"openai"`
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

**Reasoning effort is operator-declared, per model.** An optional
`models[].reasoning` object — `{ effortLevels, defaultEffort,
cacheInvalidatedByEffortChange? }` — declares that a model accepts a
per-request effort and which values it accepts. Its presence IS the
declaration; there is no separate availability flag, and a model that omits it
accepts no effort. `effortLevels` are the PROVIDER's own tokens, published and
sent verbatim: llame imposes no enum, no character pattern, no casing rule, and
never normalizes, sorts, or deduplicates them, because OpenAI and Anthropic
disagree on the vocabulary and each changes it between releases — any
constraint here would make a provider release a llame release. Only three rules
apply, all integrity rather than format: a level is nonblank, levels are unique
within an entry, and `defaultEffort` must be one of them (a cross-field check
JSON Schema can't express, so `resolveModels` owns it and fails boot naming the
model). Order is normative — it is the only scale a client gets, since a token
carries no comparable magnitude. `cacheInvalidatedByEffortChange` (default
`false`) records whether _changing_ effort mid-conversation costs a prompt-cache
prefix re-read on this model; it is operator-declared because the behavior is
model-specific and partly undocumented, and it is advisory metadata that never
affects execution. The retired `reasoning: true` boolean is rejected outright
rather than coerced — a boolean carries no vocabulary, so any inferred one would
be a guess about the provider.

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
`{{model.id}}`/`{{model.name}}`, the unconditional temporal-anchor paths
`{{context.systemTime}}`/`{{context.systemTimezone}}`, the requesting owner's
per-user paths, and the requesting chat's top-level `chats` digest paths;
`${...}` has no meaning and is ordinary text.

- **The renderable allowlist** is `PROMPT_CONTEXT_PATHS` in
  `instance-config/prompt-loader.ts` — later capabilities extend that constant,
  not the validator. It holds `{{model.id}}`, `{{model.name}}`, and the scalar
  paths documented below. Collections and their item fields are declared
  separately beside it.
- **Validation is deny-by-default and happens at boot**, walking the parsed AST.
  Permitted node kinds: literal content, value expressions, block expressions,
  comments. Everything else aborts boot naming the model id and the construct —
  including partials, which exist in three syntactic forms (`{{> x}}`,
  `{{#> x}}…{{/x}}`, and an inline partial via `{{#*inline}}`) and would
  otherwise reintroduce the prompt composition `model-system-prompts` forbids.
  Only `if`/`unless` blocks and bounded `each` over a declared collection are
  allowed; a value expression carrying parameters is a helper invocation and
  is rejected. Unescaped output (`{{{ … }}}`) is rejected.
- **An unknown path aborts boot; an absent value does not.** A typo fails loudly,
  but `{{model.name}}` on a model with no configured name renders empty, so that
  `{{#if model.name}}…{{model.name}}…{{/if}}` is expressible.
- **Absent and empty values are omitted from the render context**, never passed
  as empty strings: rendered values are `SafeString`s, and a `SafeString` is
  truthy _even when empty_, so a wrapped empty value would make every `{{#if}}`
  over it evaluate true. Values are trimmed, and whitespace-only counts as
  absent.
- **Neutralization is split by field kind**, applied when the context is built.
  Model, account-identity, temporal-anchor, and digest-metadata values
  (`model.*`, `user.name`, `user.email`, `context.*`, `chats.*Shown`,
  `chats.*Total`, `chats.compiledOn`) escape exactly `&`, `<`, `>` and nothing
  else. Owner-authored values
  (`user.personalization.*`) and all digest item fields instead pass through
  the tag-balance sanitizer
  (`instance-config/authored-text.ts`, mirrored byte-for-byte in
  `apps/web/lib/services/personalization/sanitize.ts` — keep both in sync).
  Two rules: **a value can never close a tag it did not open within that same
  value** (unmatched, malformed, or whitespace-padded closers are escaped
  fail-closed regardless of stack state), and **a reserved tag name is never
  emitted as a tag at all** — the balance rule alone accepts a value that both
  opens and closes a packaged fence, which forges a whole fence inside the real
  one, so both `<user_personalization>` and `<user_chat_history>` are reserved
  outright. Everything
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
- **Digest paths are a separate top-level namespace**: `chats.pinned` and
  `chats.recent` are declared collections whose item scope exposes exactly
  `title`, `date`, `messageCount`, and `excerpt`; the scalar metadata paths are
  `chats.pinnedShown`, `chats.pinnedTotal`, `chats.recentShown`,
  `chats.recentTotal`, and `chats.compiledOn`. `each` takes exactly one declared
  collection, cannot nest or bind block/data variables, and makes only those
  single-segment item fields reachable in its body. Collections are legal as
  condition/iteration subjects but rejected as values.
- **`chats` is deliberately not nested beneath `user`**. A digest can exist for
  an owner who authored no personalization and shares no account identity;
  nesting it would make `{{#if user}}` true and render the operator's
  personalization framing around no personalization content. Empty collections
  are omitted, then `chats` itself is omitted when neither list would render;
  metadata has no meaning and is omitted with it.
- **Temporal-anchor paths are unconditional**: `context.systemTime` renders an
  absolute timestamp with a numeric UTC offset (e.g. `2026-08-19 16:36+02:00`),
  and `context.systemTimezone` renders the IANA identifier (e.g.
  `Europe/Madrid`). Both are always present. `context` is NOT a gate-only
  subject — `{{#if context}}` fails boot. The anchor is derived from the latest
  compaction's `createdAt` (falling back to `chat.createdAt`), frozen until the
  next compaction, and formatted in the instance's local timezone (the OS
  timezone when `TZ` is unset, or the `TZ` value when set; an invalid `TZ`
  that resolves to no real zone falls back to UTC with a logged warning).
- **Boot renders the cross product of the `user` and `chats` gates**, absent and
  populated for each, and keeps the `rendered prompt is empty` failure. The
  gates are independent and `unless` can invert either, so varying them in
  lockstep misses templates that are empty for digest-only owners.
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

### The context-injection rail

Every server-authored contribution to a chat's model-visible conversation that is
not part of the system prompt is a **context item** on one rail: a single
`<system-reminder producer="…" form="…">` envelope carrying a one-line
provenance statement no operator config can remove. Producers supply the body,
never the framing, so escaping and provenance are enforced in one place.

`producer` says who authored an item; `form` says what kind of content it is
(`notice`, `snapshot`, `checkpoint` — the forms that have a producer). An
unrecognized `form` is treated as absent and an unrecognized `producer` parses,
is recorded, and renders **nothing**. That tolerance is what makes adding either
an additive change rather than a coordinated API/worker revision boundary; do not
"tighten" it into a rejection. Anticipated forms without a producer are recorded
in `docs/research/harness-transparency/2026-08-21-context-form-design-space.md`
rather than specified.

**Producers, in the rail's fixed precedence order:**
`effective-context-change`, `tool-availability`, `recency-digest`, `temporal`
for items attached to a turn, plus `compaction`, whose checkpoint is ordered by
its placement rule (it leads the history it supersedes) rather than by this
list. A producer added later is appended.

`temporal` stamps **every** user message with when its turn was received —
`Message received: 2026-08-19 18:36+02:00 (Europe/Madrid)`, the anchor's shape.
Three properties are load-bearing and easy to break:

- The payload stores the **instant and the zone together**. Rendering therefore
  reads neither the clock nor `TZ`, so a worker cannot disagree with the api that
  accepted the turn, and moving the instance's timezone does not rewrite rows
  already sent. Do not "simplify" this into re-resolving the zone at render.
- The wording says **received**, never "current", and is identical on the newest
  turn and the oldest. A row that claimed the present instant would be false on
  replay, and wording that changed once a turn stopped being newest would mutate
  a persisted message's rendering — losing the byte-identity that keeps the
  provider's prefix cache valid across turns. That byte-identity is the entire
  reason this row is stored rather than computed per request.
- The zone must be an **IANA identifier**: `Intl` also accepts a bare UTC offset
  (`+02:00`), which carries no daylight-saving rule. `resolveInstanceTimezone`
  rejects an offset at the source — a POSIX `TZ` such as `GMT+2` really does
  resolve to `+02:00`, and stamping it would both mis-render half the year and
  break the IANA identifier the anchor promises — falling back to UTC with the
  same logged warning as a degenerate zone. The producer revalidates anyway,
  because a persisted row is checked on every replay.

The rows are ordinary turn content: they are superseded with the turns a
checkpoint absorbs, and `COMPACTION_INSTRUCTION` deliberately says nothing about
them (unlike the standing-context exclusions, which exist for values re-supplied
every request).

**Residency decides whether a change re-renders the prompt or appends an item.**
Prefix-resident content is re-supplied in full every request inside the cached
prefix: cheap to read, expensive to change, because a change invalidates the
prefix for the whole conversation. Rail-resident content is appended once and
paid for in every later turn until compaction. Classify a new context surface
with this procedure:

1. An account of something that happened → rail-resident.
2. A complete statement of current state that changes **less often** than
   compaction → prefix-resident.
3. A complete statement of current state that changes **more often** than
   compaction → a frozen prefix baseline plus rail deltas, re-baked at
   compaction. Never put a frequently-changing complete statement in the prefix.

Independently: a prefix change is **silent to the model by default**. It earns a
rail notice only when history was conditioned on the old value — announce
**assertional** changes (facts the model may previously have denied or lacked),
stay silent on **behavioral** ones (tone, format, working style), where the only
history conditioned on them is the model's own non-authoritative output.

**Every run records what it injected**, as rendered, in `runs.context_items`,
including the bind-time compaction checkpoint and any item this reader could not
interpret — the latter with empty text, so a version-skew omission is auditable
rather than invisible. The record is written once the request is final, after a
transition compaction may have replaced it, so it states what the model actually
received or nothing at all.
This is written rather than derived because an item's wording is not reproducible
from its durable part once a renderer changes, and a bind-time item is not
reproducible at all. It is owner-only (`runs` carries `runs_owner` and no
public-read policy) and is deliberately absent from `toRunResponse` — nothing
reads it yet.

**Disclosed limit:** an item whose content originates outside the chat it was
injected into is **not erasable through that content's own source**. Deleting the
source chat, or withdrawing consent for it, does not reach a record already
written — the same property the recency digest already documents for prompts and
receipts, stated once here so every producer carrying such content inherits it
rather than rediscovering it.

**Rollout.** Adding a producer or a form is additive in the sense that an older
worker will not reject the part — but **deploy producer-aware workers before any
API authors that producer**, because an older worker renders nothing for a
producer it does not know and the item is silently absent from the model's view
for that Run. Changing the envelope itself (a new field on `data-context`) is a
coordinated API/worker revision boundary outright: exact-key-set validation
rejects it. Land backward-compatible readers
first, deploy workers that understand the change before any API authors it,
then quiesce old writers and drain accepted Runs before the writer cutover. On
rollback, stop new authoring first and drain Runs accepted by the newer API
before rolling binaries back. Note that the `20260821030000_context_item_cutover`
migration **deleted** legacy parts rather than reshaping them: rollback restores
the code path, not the rows.

### Memory settings consent

`shareRecentChats` defaults off and is independent of personalization. Enabling it sends
titles and opening excerpts from the owner's other chats to the model provider configured by
the operator, which in a multi-user instance may be a third party with no relationship to that
user. The consent contract is incomplete unless all three consequences are presented together:

1. **Enabling is retroactive over the whole existing corpus.** Chats created long before the
   setting was turned on become eligible immediately, including their opening excerpts.
2. **Disabling is not retroactive.** It stops new baselines, re-bakes, and appends, but a chat
   that already carries a baseline keeps sending it.
3. **Deleting a chat is not erasure.** Its title and excerpt survive in other chats'
   already-bound prompts, in persisted appends, and in receipts already issued.

### Recency-digest baseline lifecycle

An opted-in owner's first accepted Run for a chat resolves two owner-scoped, disjoint
lists (pinned and recent), freezes their rendered fields and ratio metadata in the nullable
`chats.recency_digest_baseline`, and initializes the separate `recency_digest_told`
bookkeeping set in the same binding transaction. Null means no sharing epoch and needs no
backfill. The baseline contains no chat identifiers; ids exist only in the non-rendered
told-set. Later turns render that stored baseline unchanged, preserving snapshot reuse.
Compaction is the sole re-bake boundary: when consent remains enabled it replaces both
fields with a fresh epoch; disabling never rewrites an already-bound baseline.

Between re-bakes, `data-recency-digest` message parts append a server-authored event
log. Fresh capped pinned/recent views may add previously untold chats; pin corrections
read the accumulated told ids against actual `pins` membership, so a cap displacement is
not fabricated as an unpin. The append log is deliberately unbounded: a long-lived chat
that never compacts can accumulate one event per newly relevant chat. Do not cap it
silently; a future adaptive policy must be specified separately.

`data-recency-digest` is a coordinated API/worker revision boundary. Deploy workers that
render it before an API can author it. On rollback, stop authoring first, drain accepted
Runs, then roll binaries back; persisted parts remain as history and must not be deleted.

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

## Chat search embeddings

Off by default (#196): with no `embeddingModels[]` entry declared and no corpus
selection, search behavior and the boot sequence are unchanged — no provider
request is possible. Requires the `pgvector`-capable image documented above;
`db:migrate` fails outright on `postgres:17-alpine`.

**Declaring a model.** Add an entry to top-level `embeddingModels[]` in
`llame.config.json`, reusing a `providers[]` connection by id (see
`llame.config.json.example`'s commented block). Required: `id` (a stable
internal key — never exposed to the provider), `provider`, `providerModelId`,
`dimensions`. Optional: `batchSize` (default 32), `distanceMetric` (only
`"cosine"` today), `revision`, `documentPrefix`/`queryPrefix` (asymmetric
embedding conventions some models require). A dangling `provider` reference or
a duplicate `id` fails startup naming the bad path, same as `models[]`.

**Selecting a model per corpus.** `search.chats.embeddingModelId` names an
`embeddingModels[].id`; the shape (`search.<corpus>.embeddingModelId`) is ready
for a later corpus to add its own key with no shape change. `chats` is the only
populated corpus today. Leaving it unset means nothing is scheduled for that
corpus even if models are declared elsewhere.

**Changing or removing a model.** A model `id`'s provider/model/revision/
dimensions/distanceMetric/prefixes are checked against a small database ledger
the first time a vector is actually persisted under that key (`batchSize` is
excluded — a throughput knob, not part of the embedding space); redefining an
already-bound key with different values fails startup naming the field, never
the value, rather than silently reinterpreting existing vectors as something
they aren't. To move a corpus to a new model: declare a new `id`, point
`search.<corpus>.embeddingModelId` at it, run `search:backfill` to populate
under the new key, confirm with `search:coverage`, then remove the old entry
from `embeddingModels[]` and run `search:prune` to reclaim its vectors —
**undeclaring a model alone never deletes its data**; startup only warns
(non-fatally) that a ledger key is no longer declared, so its vectors sit
unread until pruned.

**The four operator commands** (`pnpm --filter api search:*`, `src/search/operations/cli.ts`):

- `search:backfill` — enumerates chats with outstanding work for the selected
  model and enqueues one `search-embed` job per chat. A pure producer: it
  issues no provider request itself and is safe to re-run (a chat with nothing
  outstanding is never re-enqueued). The actual embedding call and persist run
  later, in a worker process (the co-located `all` profile or the dedicated
  `worker.ts` entrypoint) consuming the `search-embed` queue.
- `search:coverage` — prints per-chat embedded / failed / outstanding counts
  for the selected model, including chats whose every document failed (not
  just chats with something outstanding).
- `search:retry-failed` — clears the attempt-metadata (not the content) of
  every document that failed terminally under the current model/version, so
  the next backfill or the automatic sweep picks it up again instead of it
  staying silently suppressed.
- `search:prune` — clears the vector and attempt-metadata columns of any
  document embedded under a model key no longer present in `embeddingModels[]`.

All four fail loudly (non-zero exit, naming what's wrong) rather than
succeeding having silently done less than reported — including when
`pnpm db:provision-rls` hasn't been run yet, which `backfill`/`coverage` need to
read through their `SECURITY DEFINER` discovery functions.

**Nothing in the query path reads a vector yet.** `ChatsRepository.searchByOwner`
is unchanged and stays purely lexical (FTS + trigram + title, RRF-fused) —
populating embeddings is invisible to search results by construction, not by
convention. Query-time retrieval is a later change (#197).

## Conventions

- One NestJS module per feature (controller / service / module); wire via DI and register in `app.module.ts`.
- Place each constructor-parameter `@Inject(...)` decorator on its own line,
  immediately before the parameter. `pnpm lint:ast-grep` enforces the all-split
  form; Prettier preserves but does not choose decorator line placement.
- Schema lives in `src/db/schema`; change it, then `db:generate`. Don't hand-edit generated migration SQL or `meta/_journal.json` — the exceptions (`0004`, `0006`, `0010`, `0011`, `0012`, `0013`, `0018`, `0019`, `0020`, `0021`, `0022`, `0023`, `20260712055209_search_projection`, `20260713020237_rename_search_documents`, `20260718134220_flashy_infant_terrible`, `20260803201518_good_pixie`, `20260810154617_perfect_wrecker`, `20260812195546_romantic_lake`) are documented in Gotchas.
- **API contract — code-first OpenAPI** (the client/server boundary lives in SPEC §22.0; established by #60). Every `/auth/v1`·`/api/v1` endpoint takes a class-validator **DTO** behind the global `ValidationPipe` and returns an **explicit response type** (never an ad-hoc object — mirror the `toPublicUser` egress allowlist), so `@nestjs/swagger` can emit a complete `openapi.json`. Add a DTO + response type with every new endpoint. The generated OpenAPI document is the API source of truth. Client/SDK codegen remains deferred — don't hand-write or generate an API client yet. The live spec is served at `/docs` (UI), `/docs/json`, `/docs/yaml`.

  **`apps/api/openapi.json` is a generated artifact that is COMMITTED to the repo, and `pnpm --filter api build` regenerates it.** Any change to an endpoint, DTO, response type, or Swagger annotation — including a `@ApiPropertyOptional` description — changes that file. CI's Build job runs `git diff --exit-code` after building, so a stale checked-in copy fails the build; it is deliberately a failure rather than a silent fixup, because the document is the API source of truth and a drifted copy misrepresents the contract.

  **Therefore `pnpm --filter api build` is part of the definition of done for any API-touching change**, alongside lint/typecheck/test. `lint`, `typecheck`, and the test suites all pass with a stale `openapi.json` — none of them regenerate it — so a change can look completely green locally and still fail CI. Run the workspace-scoped build and commit the regenerated `openapi.json` in the same commit as the endpoint change. Do not substitute the root `pnpm build`; that unbounded aggregate runs unrelated applications concurrently.

- **RESTful resource design — design the surface deliberately.** Model the API as resources + standard verbs (`GET`/`POST`/`PATCH`/`DELETE`), JSON:API-ish. Partial updates are `PATCH /resource/:id` — **not** RPC-style verb handles (`/chats/:id/title`, `/x/rename`). Nullable response fields are modeled explicitly (`@ApiProperty({ type, nullable: true })`, required-not-optional). Path ids backed by a typed DB column get `ParseUUIDPipe` + `@ApiParam`. Think about the resource model before adding a handle; don't bolt on verbs.
- **Chained type assertions, including `as unknown as T`, are banned project-wide** (#268) — they switch off the compiler at exactly the point a refactor most needs it: a fixture built through a double cast compiles clean and fails at runtime instead of surfacing every consumer to `tsgo`. The maintained anti-slop rule runs through the normal root and workspace Oxlint commands in Lefthook and CI. Almost every API occurrence had the same shape — a class with private state, faked in a test — and a structural double can never satisfy a whole class, so narrow the _dependency_, not the fake:

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

  Derive the `Pick<>` field list from what the class under test actually calls (tsgo will tell you if you under-narrow), not from the whole interface. Type the **constructor parameter**, not the fixture — if the fixture is asserted on (`expect(x).toHaveBeenCalledWith(...)`), annotating it as the narrow type erases the `Mock` type and breaks the assertion; let it stay inferred, since it satisfies the interface structurally either way. `PromptUserResolver` (`personalization/personalization.service.ts`) and `RunStreamResponder` (`runs/run-stream-bridge.ts`) are the shipped exemplars. The two former production exceptions are gone: `compaction.service.ts`'s `toolCalls` cast in #214 and `chat-loop.service.ts`'s bridge-`Response` adapter in #310. Do not reintroduce their whole-library return types where a structural consumer surface is sufficient. The `ReturnType<typeof streamText>` hand-forged model doubles are a separate, unrelated migration (`ai/test`'s `MockLanguageModelV3` — see [docs/testing.md](../../docs/testing.md)'s follow-ups), not this recipe either.

## Gotchas

- `apps/api/src/db` is the **sole** schema; `apps/web` owns no database.
- Linting is oxlint with type-aware rules (`.oxlintrc.json`, `options.typeAware`) running on **tsgo** (TypeScript 7). tsgo rejects `baseUrl`, so `tsconfig.json` must not reintroduce it, and global test/node types are declared explicitly via `"types": ["node", "vitest/globals"]` (tsgo does not auto-include `@types/*` under pnpm the way tsc does). Formatting is prettier (`pnpm format`), checked in CI via the root `format:check` — it is no longer an ESLint rule.
- Migrations are `drizzle-kit`-generated (`0005`+). Hand-authored exceptions: `0004` (the PoC → multi-tenant transition — drizzle-kit's interactive column-rename can't be driven non-interactively; `FORCE ROW LEVEL SECURITY` is hand-maintained here too, Drizzle can't express it), `0006` (the sessions hashing migration carries a manual `DELETE FROM sessions` — raw tokens can't be carried into the hashed-at-rest model), `0010` (the nullable-title migration carries a manual `UPDATE` backfilling old default-literal titles to NULL, and drops a spurious generated DROP/CREATE of the unchanged `sessions_user_created_idx`), `0011` (the durable-runs migration hand-appends `FORCE ROW LEVEL SECURITY` for `runs`/`run_events` — Drizzle emits ENABLE only — and hand-reorders the composite-key unique indexes before the FKs that reference them), `0012` (the single-flight migration carries a manual `UPDATE` cancelling all but the newest non-terminal run per chat — the partial unique index cannot be created over duplicates — plus matching `run.cancelled` events, applied inside a NO FORCE RLS window since migrations run as the owning role), `0013` (the `in_reply_to` reply-integrity trigger, #73 — Drizzle can't express triggers), `0018` (the identity/org-units migration hand-appends `FORCE ROW LEVEL SECURITY` for `org_units`/`memberships`/`external_identities`, same as `0004`/`0011`), and `0019` (org-units production-grade invariants — hand-appends the `llame_role_on_unit_path` `SECURITY DEFINER` function (owned by `app` until the separate `pnpm db:provision-rls` step reassigns it to `app_rls` — see "`app_rls` (BYPASSRLS)" above) + `GRANT SELECT ... TO app_rls`, the deferred path-integrity constraint trigger on `org_units` (+ a `DO`-block assertion that pre-existing rows already satisfy it), and the last-owner `BEFORE UPDATE OR DELETE` trigger on `memberships` — Drizzle can express none of CREATE FUNCTION or CREATE [CONSTRAINT] TRIGGER), and `0020` (the `runs.model_id` migration carries a manual `UPDATE` backfilling existing rows to the canonical default `system:openai:gpt-5.4-mini` before `SET NOT NULL` — drizzle-kit emits only `ADD COLUMN` + `SET NOT NULL` — inside a NO FORCE RLS window, same as `0012`, since migrations run as the owning `app` role with no `app.current_user_id` and FORCE would silently no-op the update), `0021` (the projects migration hand-appends `FORCE ROW LEVEL SECURITY` for `projects`, same as `0004`/`0011`/`0018`), and `0022` (the `org_unit_type` recreate dropping `'project'` from the vocabulary, admin-area-org-tree D5 — drizzle-kit's generated enum-recreate converts the column to `text`, drops/recreates the enum, then casts back with a `USING` clause; it doesn't account for existing rows holding a value about to be dropped, so a manual `UPDATE org_units SET type = 'group' WHERE type = 'project'` is hand-inserted while the column is still plain `text`, before the project-less enum exists — otherwise the final `USING` cast would fail on any stray `project`-typed row; the UPDATE runs inside a NO FORCE RLS window, same as `0012`/`0020`, since `org_units` is FORCE RLS (`0018`) and migrations run with no `app.current_user_id` — without the window the backfill silently no-ops and the cast aborts), and `0023` (the rework-item-pinning migration hand-appends `FORCE ROW LEVEL SECURITY` for `pins`, same as `0021` — it also drops `chats.pinned_at` + `chats_owner_pinned_updated_idx`, replacing row-level chat pinning with the per-user `pins` table; no data backfill by design), and `20260712055209_search_projection` (chat-search-platform #195 — hand-prepends `CREATE EXTENSION IF NOT EXISTS pg_trgm` (trusted contrib, creatable by the non-superuser `app` role; MUST precede the `gin_trgm_ops` index), hand-appends `FORCE ROW LEVEL SECURITY` for `search_documents`/`search_chat_state` (same as `0004`/`0011`/`0018`/`0021`/`0023`), and the `llame_search_stale_chats(integer, integer)` `SECURITY DEFINER` staleness-discovery function — owned by `app` until `pnpm db:provision-rls` reassigns it to `app_rls`, same lifecycle as `0019`'s `llame_role_on_unit_path`, plus `GRANT SELECT ON chats, messages, search_chat_state TO app_rls` (the function's message-time staleness subquery reads `messages`); the function returns only identifiers + timestamps, never content), and `20260713020237_rename_search_documents` (chat-search-platform D1 naming — a hand-authored, **non-destructive** `ALTER TABLE "search_documents" RENAME TO "search_chat_documents"` plus every dependent object rename: the 5 indexes, the pkey + 2 FK constraints (renaming the pkey constraint auto-renames its backing index), and the RLS policy. drizzle-kit can't emit a table rename non-interactively, and this rename **must** preserve the rows already shipped to existing databases under the old name — so it is a forward ALTER on top of `20260712055209_search_projection`, NOT a regenerated create. `search_chat_state` is unchanged; `llame_search_stale_chats` reads `search_chat_state`/`chats`/`messages`, never this table, so it needs no change. Proven non-destructive against a live DB in a rolled-back transaction; FORCE RLS survives the rename), and `20260823014832_friendly_swarm` (chat-search-embeddings, design D2/D10 — hand-prepends `CREATE EXTENSION IF NOT EXISTS vector`. Unlike `pg_trgm`, `vector` (pgvector) is **NOT** a trusted extension — its control file carries no `trusted = true`, so PostgreSQL requires superuser to install it (verified empirically against pgvector/pgvector:pg17's 0.8.6 package: "permission denied to create extension \"vector\" ... Must be superuser"). The non-superuser `app` role that runs every migration cannot create it itself, so `docker/postgres/initdb/03-vector-extension.sql` provisions it ONCE as the `postgres` superuser on a fresh volume, before any migration runs — same shape as `02-app-rls-role.sql` provisioning `app_rls`; existing dev volumes that predate this change will fail `db:migrate` on this statement until that script is hand-run as `postgres` (or `pnpm db:reset`). `apps/api/vitest.integration.global-setup.mts` mirrors the same provisioning step before `test:integration`'s Testcontainers-provisioned database migrates. The migration also hand-appends `GRANT SELECT ON search_chat_documents TO app_rls` (that table was never granted in `20260712055209_search_projection` — only `chats, messages, search_chat_state` were) and the `llame_search_embedding_coverage(text, integer, integer)` `SECURITY DEFINER` embedding-coverage-discovery function — owned by `app` until `pnpm db:provision-rls` reassigns it to `app_rls`, same lifecycle as the other cross-tenant discovery functions above; its predicate uses `IS DISTINCT FROM` throughout (a never-embedded row's NULL `embedding_model_key` would make a plain `=`-based negated conjunction evaluate to NULL and silently exclude the row); it returns only identifiers + counts, never content or vectors), and `20260823033714_stormy_gorgon` (chat-search-embeddings, task 6.5/trap 5 — fully Drizzle-generated for the partial index `search_chat_documents_embedding_backlog_idx` on `(chat_id, owner_user_id) WHERE embedding IS NULL AND embedding_fail_reason IS NULL`, then hand-appends the `llame_search_embedding_backlog(integer)` `SECURITY DEFINER` function — same ownership lifecycle as the other cross-tenant discovery functions above (owned by `app` until `pnpm db:provision-rls` reassigns it to `app_rls`); unlike `llame_search_embedding_coverage`, which reads all four branches of the coverage predicate with no `WHERE` and full-scans, this function reads ONLY the static never-attempted branch, so it is servable by the partial index above rather than merely declared alongside it; needs no new `GRANT` since `20260823014832_friendly_swarm` already granted `SELECT ON search_chat_documents TO app_rls`), and `20260823083954_embedding_report_function` (chat-search-embeddings/operations, layer 7 — a `drizzle-kit generate --custom` empty migration (no schema.ts change; nothing else to generate), hand-authored entirely: the `llame_search_embedding_report(text, integer, integer)` `SECURITY DEFINER` function backing the `search:coverage` operator readout, a same-signature sibling of `llame_search_embedding_coverage` with only the `HAVING`/`ORDER BY` widened so a chat with zero outstanding but nonzero failed is still reported (`outstanding_count > 0 OR failed_count > 0`) — the fully-failed-corpus visibility gap `llame_search_embedding_coverage`'s own `HAVING` leaves. Deliberately a NEW function rather than `CREATE OR REPLACE` on `llame_search_embedding_coverage` itself: `CREATE OR REPLACE FUNCTION` requires the executing role to already own the function, and any instance that ran `pnpm db:provision-rls` after `20260823014832_friendly_swarm` landed has already reassigned that function's ownership to `app_rls` — `app` (the migrating role) is deliberately never granted membership in `app_rls`, so an in-place edit would fail `db:migrate` outright on exactly the instances that deployed correctly. Same ownership lifecycle as the other cross-tenant discovery functions above (owned by `app` until `pnpm db:provision-rls` reassigns it to `app_rls`); needs no new `GRANT` since `20260823014832_friendly_swarm` already granted `SELECT ON search_chat_documents TO app_rls`; returns only identifiers + counts, never content or vectors. The duplication between the two functions' CTEs is an accepted, closed-door cost of this ownership hazard, not a precedent — the migration's own header is explicit that a THIRD predicate variant must NOT be added as a fourth sibling; it belongs in a single parameterized function defined fresh, before that new function has ever been provisioned). `drizzle-kit check` passes for all. Re-add the manual steps if you ever regenerate these.
- `20260718134220_flashy_infant_terrible` is otherwise Drizzle-generated, but hand-appends `FORCE ROW LEVEL SECURITY` for `model_context_snapshots` because `.enableRLS()` emits only `ENABLE`; re-add that statement if the migration is regenerated.
- `20260803201518_good_pixie` (add-user-personalization) is the same exception for `personalization`: Drizzle-generated, then hand-appended `FORCE ROW LEVEL SECURITY`. Without it the owning `app` role bypasses all four owner policies, which in a single-role self-hosted deployment means no isolation at all on a table holding owner-authored profile text. Re-add the statement if the migration is regenerated.
- `20260810154617_perfect_wrecker` prepares immutable model-context snapshots for availability authoring. It adds non-null manifest/hash columns with exact canonical v0 `{"version":0,"state":"unobserved"}` defaults, explicitly backfills that sentinel and its domain hash inside a temporary `NO FORCE ROW LEVEL SECURITY` window, creates the availability-aware reuse index, and deliberately retains the legacy reuse index so old writers remain valid. Historical `content_hash` values are untouched. Re-add the defaults, backfill/RLS window, and both-index preparation state if the migration is regenerated. A later cutover migration removes the legacy index and temporary defaults only after old API writers are quiesced.
- `20260811084012_thankful_gwen_stacy` is that generated writer cutover: it drops only the legacy owner/content/source conflict index and the two temporary v0 defaults. Apply it only after old API writers are quiesced and accepted Runs are drained; after it lands, every snapshot writer must supply the observed availability manifest/hash and target the availability-aware index.
- `20260812195546_romantic_lake` adds owner-scoped `memory_settings`. It is Drizzle-generated, then hand-appends `FORCE ROW LEVEL SECURITY` because `.enableRLS()` emits only `ENABLE`; without FORCE the owning `app` role bypasses all four policies and destroys isolation in the single-role self-hosted topology. Re-add the statement if the migration is regenerated.
- `20260821030000_context_item_cutover` is hand-authored: it strips the retired `data-model-context`, `data-tool-availability`, and `data-recency-digest` parts out of `messages.parts`, which drizzle-kit cannot express (a jsonb array filter, and data rather than schema). The parts are DELETED rather than reshaped — no compatibility layer is retained and no instance holds history worth carrying through the boundary — so a chat predating the cutover loses its context parts and its model-switch boundary stops rendering; rollback restores the code path, not the rows. The UPDATE runs inside a `NO FORCE ROW LEVEL SECURITY` window for the same reason as `0012`/`0020`/`0022`: migrations run as the owning `app` role with no `app.current_user_id`, and `messages` is FORCE RLS, so without the window every policy denies and the update silently no-ops. Re-add the window and the filter if this migration is regenerated.
- `20260812205345_nervous_apocalypse` adds nullable `chats.recency_digest_baseline` and `chats.recency_digest_told`. It is fully Drizzle-generated: nullable columns deliberately require no data backfill and no hand-appended RLS statement because `chats` is already FORCE RLS.
- `20260822233014_curved_gwen_stacy` adds owner-scoped `knowledge_spaces`. It is Drizzle-generated, then hand-appends `FORCE ROW LEVEL SECURITY` because `.enableRLS()` emits only `ENABLE`; without FORCE the table-owning `app` role bypasses the owner policies. If the schema is regenerated, re-add the FORCE statement before applying the migration.
- `20260823195052_yummy_sinister_six` extends `knowledge_spaces` in place with the `Personal` name backfill, millisecond-precision timestamps, and owner/creation keyset index while dropping the retired owner uniqueness constraint. Deploy the `multiple-kb/compat` writer to every provisioning API replica and wait for older requests to finish before applying it; after application, that compatibility release is the rollback floor because older targeted `ON CONFLICT (owner_user_id)` writers fail without the unique arbiter. No Run drain is required. It is otherwise Drizzle-generated, then hand-appends `ENABLE` + `FORCE ROW LEVEL SECURITY` to keep the table invariant explicit across upgrade paths; re-add those statements if the migration is regenerated.
- Runtime tool-availability parts require a coordinated API/worker rollout. First apply the backward-compatible preparation migration while old writers remain active. Deploy compatible readers/workers if desired, then quiesce old API writers and drain accepted Runs before applying the writer-cutover migration that removes the legacy conflict index/defaults. Deploy workers that render `data-tool-availability` before any API authors it. This is an explicit writer cutover, not mixed-revision writer compatibility. On rollback, stop new authoring first and drain Runs accepted by the newer API before rolling binaries back; retained semantic parts and snapshot columns stay in place.
- Enabling `mcpServers` adds a second coordinated runtime boundary: keep it empty while upgrading. In a split deployment, deploy every dedicated worker capable of exact dynamic declaration binding before the `web` API can accept MCP-enabled Runs. In the default co-located topology, quiesce sends and drain Runs before each binary/config restart, or first move Run consumption to compatible dedicated workers. Give every process the same restarted config, secret inputs, and endpoint reachability. API and worker catalogs/sessions are process-local; mismatches settle a requested dynamic tool as unavailable. For split rollback, remove MCP ids from the accepting API first and drain bound Runs on still-capable workers before config removal. For co-located rollback, quiesce and drain before any restart or config removal. Do not restart workers without their MCP config before the drain unless non-fatal unavailability is the intended outcome.
- Migration filenames: `0000`–`0023` are index-prefixed; `drizzle.config.ts` now sets `migrations.prefix: 'timestamp'`, so newer migrations are named `YYYYMMDDHHMMSS_<name>.sql` and parallel branches no longer collide on the next sequential number — only `meta/_journal.json` still conflicts (append-only entries; resolve a merge by keeping both and renumbering `idx`). Apply **order comes from the journal, not filenames**, and the migrator applies an entry only when its `when` is newer than the newest already-applied migration — an out-of-order entry is **silently skipped on existing databases**. `src/db/migration-journal.test.ts` pins both invariants (contiguous `idx`, strictly increasing `when`); if it fails after a rebase because master gained newer migrations, regenerate your migration (or re-stamp its journal `when`) so it sorts last. `0004`'s hand-stamped `when` originally violated this (older than `0003`'s — a database parked at `0003` would have silently skipped it) and was re-stamped when the guard landed.
