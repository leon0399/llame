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
gate admits allowlisted read-only tools, the exact configured native file
capability, and allowlisted alpha host `bash` under the same
`tools.nativeExecutorId` gate. Native mutations require durable pre-effect
fencing. Native `read` also fetches an absolute `http://` or `https://` locator
through the API process's own outbound HTTP, so `read` is advertised whenever
`tools.allowed` names it and a web locator binds no executor identity. Every
derived locator — a redirect hop, an announced alternate, a suffix candidate, an
`llms.txt` candidate — is admitted through the `read` permission group before
its request, with each decision recorded beside the call decision and never
through the model-visible result. Those requests carry
`User-Agent: llame/<version>`, are never retried, and stay inside the
10 s header, 30 s call, 5 MiB body, and 20-redirect bounds. Do not restore
removed policy or env toggles.

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
Mutation testing covers API source with unit tests and the TypeScript checker.
CI mutates the lines a diff changed and requires 80% of the mutants on them to
be detected; a diff with no mutable line runs nothing. Manual full
runs report without a score threshold. Reports are ignored under `reports/`.
Restricted sandboxes may need local-bind permission for Stryker.

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

Provider `type` names the wire API the entry speaks and is the only input to
wire selection: nothing is inferred from `id`, `baseUrl`, or host, and no entry
is rewritten at load time. Every language-model request the entry makes —
streaming chat, forced-tool structured generation (titles), compaction — uses
its declared wire; embedding requests are wire-independent and exempt from it.
Boot validates shape only, so an endpoint that does not serve its declared wire
fails on the first request under the existing failure contract, never at boot.

| `type`               | Wire             | Client                       | Credential                          | `baseUrl`                       |
| -------------------- | ---------------- | ---------------------------- | ----------------------------------- | ------------------------------- |
| `openai-responses`   | Responses        | `@ai-sdk/openai`             | optional `key`                      | optional; defaults to OpenAI    |
| `openai-completions` | Chat Completions | `@ai-sdk/openai-compatible`  | optional `key`                      | required                        |
| `anthropic-messages` | Messages         | `@ai-sdk/anthropic`          | optional `key`; sent as `x-api-key` | optional; defaults to Anthropic |
| `openai-codex`       | Responses        | Codex subscription transport | `key` and `accountId`               | rejected                        |
| `opencode-go`        | Chat Completions | Go subscription transport    | `key`                               | rejected; fixed in code         |

An `openai-completions` `baseUrl` is required and must resolve non-blank after
interpolation; an `openai-responses` `baseUrl` is optional and falls back to
the OpenAI API; an `anthropic-messages` `baseUrl` is optional and defaults to
the Anthropic API. `openai-codex` and `opencode-go` reject `baseUrl` because
each endpoint is fixed in code: the Codex Responses endpoint, and the OpenCode
Go gateway at `https://opencode.ai/zen/go/v1`, whose `type` executes the Chat
Completions module with the Go transport (a fixed base URL, its own headers,
redirect rejection, and a required credential). `accountId` is accepted by
`openai-codex` alone; every other variant rejects it. A `key` is optional for
the two OpenAI wires and for Messages, where an absent or empty resolution is
keyless; `openai-codex` requires nonblank `key` and `accountId`, and
`opencode-go` requires a nonblank `key`, because the gateway authenticates
every request. Operator procedure:
[docs/opencode-go.md](../../docs/opencode-go.md).

`openai-responses` is not "official OpenAI": Ollama >= 0.13.3,
vLLM, and llama.cpp serve `/v1/responses`, while DeepSeek, GLM, LM Studio,
older Ollama, and most gateways serve Chat Completions.

Reasoning renders in the chat's Thinking panel on both wires and exports to
markdown with it, and it always comes from the adapter, never from llame
parsing: `@ai-sdk/openai`'s Responses path supplies reasoning summaries and
encrypted reasoning, and `@ai-sdk/openai-compatible` normalizes
`reasoning_content ?? reasoning` inbound and re-injects `reasoning_content` on
outbound assistant messages. Never add a vendor parser, raw SSE parser, tag
extraction, or middleware for it. Persisted reasoning text is replayed on
later requests that continue the same Chat.

Accepted differences on the completions wire, none compensated by a shim: no
reasoning-model parameter handling (`max_tokens` to `max_completion_tokens`
remapping, stripping temperature/logprobs/penalties), so an OpenAI-shaped
reasoning model can be rejected for an unsupported parameter where the
Responses wire would have adapted the request; `logprobs`, `logit_bias`,
`prediction`, `service_tier`, `store`, `safety_identifier`,
`parallel_tool_calls`, prompt-cache fields, and web-search `source` parts are
unsupported; its usage converter has no `cacheWrite` field, which no cost
formula reads. Forced tool choice with `strict` tool schemas, error schemas,
and cache-read usage are not regressed.

**Breaking**: `type: "openai"` is deleted. Every existing entry fails boot as
an out-of-enum type until it is re-declared as `openai-responses` or
`openai-completions`; there is no shim and no migration.

Packaged prompt templates are the model-facing bodies llame authors and ships,
and no operator can replace one. They live at
`apps/api/src/<module>/prompts/<surface-name>.md`, one file per distinct body,
named for the surface as the model sees it, and load through exactly one
module-level constant beside the render function:
`loadPackagedTemplate(__dirname, '<surface-name>')` from
`apps/api/src/prompts/template-engine.ts`. Variants inside one body are
branches on producer-derived booleans in that one file. Exported names keep
their kind and arity so identity comparisons and call sites elsewhere are
untouched: a string constant stays a string rendered from its template, and a
function keeps its parameters.

- `apps/api/src/prompts/tools/` holds operator-replaceable tool descriptions;
  `apps/api/src/tools/prompts/` holds packaged templates the module owns and
  no operator can replace. They are one transposition apart.
  `apps/api/src/prompts/` holds only the replaceable defaults
  (`chat-default.md` and `tools/*.md`); that directory split is what states
  which files an operator may replace.
- Adding a colocated `prompts/` directory is three edits: the directory; one
  glob in `.markdownlint-cli2.jsonc`
  (`apps/api/src/<module>/prompts/**`, the `**` form, because a bare directory
  path does not match in micromatch); and the same directory in
  `.prettierignore` in gitignore directory form. Never a globstar such as
  `apps/api/src/**/prompts/**`: it also swallows
  `apps/api/src/prompts/chat-default.md` and drops its MD033 override. Also add
  one import per colocated directory to
  `apps/api/src/instance-config/prompt-built-runtime.contract.ts`, so a
  directory the `**/prompts/**/*.md` asset rule misses fails the build rather
  than a deployed worker.
- A template renders from its producer's own payload plus view values the
  producer derives in the same module: booleans for closed kinds, labels for
  closed reason codes, pluralized or joined strings. The engine has no
  comparison helper, so every comparison happens in TypeScript first. Derive an
  explicit boolean rather than relying on Handlebars truthiness for a number,
  since zero must be falsy and a `SafeString` wrapping an empty string is
  truthy.
- `user`, `chats`, `skills`, `model`, `context`, and `tools` are reserved names
  and are never supplied to a packaged rail template; the operator surfaces
  keep those projections. A rail item is frozen into `messages.parts`, so
  personalization must never be rendered into one.
- Packaged templates compile with `noEscape`: the engine escapes nothing and
  every mustache renders raw. The producer keeps calling
  `sanitizeAuthoredText` on exactly the values it neutralizes today, before the
  value reaches the template, and keeps grammar-safe identifiers and published
  paths raw. Never write `{{{ }}}`; it is redundant under `noEscape` and a
  false signal.
- The envelope is not template content. `renderContextItem` owns
  `<system-reminder producer= form=>` and `CONTEXT_ITEM_PROVENANCE`; templates
  are body-only.
- Every migrated or new surface needs an exact-output test or a literal pin
  before its constant is deleted: a mistyped variable renders empty silently.
  Precedence and path-guidance sentences differ between producers by design and
  are never copied from one template into another; the exact-output tests, not
  similarity, decide.

Template whitespace:

- The engine strips only whitespace after the last content in the file, so a
  file-final newline is harmless and nothing else is.
- A repeated line carries its separator as a leading newline, and the
  `{{/each}}` sits at the end of the last content line.
- A standalone closing block tag consumes its own line terminator, so a blank
  line that must follow a block needs an extra empty line or an inline
  `{{/if}}`.
- Use `{{~/if}}` only where the block ends the body; no `~` fix is mechanical,
  so re-render and re-diff after every change.
- A plain mustache alone on a line is never standalone-stripped.

Specs: [instance config](../../openspec/specs/instance-config/spec.md),
[model prompts](../../openspec/specs/model-system-prompts/spec.md),
[models](../../openspec/specs/available-models/spec.md), and
[personalization](../../openspec/specs/personalization/spec.md). Operator
procedure: [docs/tool-prompts.md](../../docs/tool-prompts.md).

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

- Preserve raw JSON Schema and `$schema`; compile while the executing worker
  composes the attempt's tool catalog. Invalid tools fail individually. SDK
  validation is primary; local parse is defense in depth.
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

Hybrid FTS/trigram/title/vector search is live. The vector leg embeds the query
at request time (bounded per surface: 10 s tool, 1.5 s web) and falls back to
lexical silently on any failure. Embeddings default off. Once a vector key persists, its provider,
model, revision, dimensions, metric, and prefixes cannot be redefined. To move
a corpus: declare a new ID, repoint, backfill, verify coverage, remove the old
entry, then prune.

`search:backfill`, `search:coverage`, and `search:projection-coverage` fail
closed when RLS discovery helpers are unprovisioned. `search:retry-failed` and
`search:prune` use owner-scoped writes. Backfill only enqueues; it never calls a
provider. Removing an embedding model does not delete vectors; prune explicitly.
`search_conversations` supports two modes (content keyword search with optional
time ranges, and timeline activity-pointer discovery) and always returns
canonical results; HTTP admission and every `runs` consumer enforce projection
coverage. `conversation_read` is independently allowlisted. See
[the runbook](../../docs/conversation-recall.md) and the
chat-search/search-projection/conversation-read OpenSpecs.

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
