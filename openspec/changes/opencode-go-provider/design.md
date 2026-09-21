## Context

See [proposal.md](proposal.md) for motivation and scope; the delta specs under
`specs/` are the behavior contract this design implements.

On master after `openai-compatible-provider` and `anthropic-provider`,
`providers[]` is discriminated by `type` and the schema's `$defs.providerType`
enum is strict-closed to `["openai-responses", "openai-completions",
"anthropic-messages", "openai-codex"]`
(`apps/api/src/instance-config/llame.config.schema.json:77-86`), each named
after the wire it speaks. The per-type variants live in one `allOf` of
`if`/`then` conditionals over the shared `providerEntry` object
(`:112-135`): `openai-completions` requires `baseUrl`, `openai-codex` requires
`key` and `accountId` and forbids `baseUrl` with `"properties": { "baseUrl":
false }`. `llame-config.ts:35-81` normalizes entries into
`OpenAIResponsesProviderConfig { id, type, key, baseUrl | null }`,
`OpenAICompletionsProviderConfig { id, type, key, baseUrl }`,
`AnthropicMessagesProviderConfig { id, type, key, baseUrl | null }`, and
`OpenAICodexProviderConfig { id, type, key, accountId }`, with `key: null`
meaning keyless. `config-loader.ts:1198-1234` switches on `entry.type` into one
resolver per type, each of which resolves interpolation through
`resolveNullableString` and, where a value must survive interpolation nonblank,
`requireNonBlankString` (`:1236-1345`); the switch's `default` branch is a
`never` exhaustiveness guard. `model-client-factory.ts:53-72` dispatches on
`provider.type` the same way, and each type owns a client module.

The substrate this change builds on:

- `ModelStreamInput` and `ModelObjectInput`
  (`apps/api/src/models/model-client.ts:21`, `:122`) carry no per-request
  header field and no Chat identifier. Three production modules make four
  calls: the run loop's streaming call
  (`apps/api/src/runs/run-execution.service.ts:1125`, inside `executeRun`, whose
  input carries `chatId` at `:188`), the single summarization call shared by
  both compaction paths (`apps/api/src/compaction/compaction.service.ts:566`,
  inside `summarize`, reached from `maybeCompact` and from
  `compactForTransition`, both of which already hold `chatId`), and the title
  service's two calls (`apps/api/src/titles/title.service.ts:117` and `:136`,
  inside `requestTitle`, reached from `generate`, which holds `input.chatId`).
- The Chat Completions client
  (`apps/api/src/models/openai-completions-model-client.ts`) builds one
  `createOpenAICompatible({ name, baseURL, apiKey })` provider at construction
  (`:197-203`) and passes no `headers`; its streaming request assembles
  `streamOptions` (`:145-161`) and its structured path delegates to the shared
  `generateToolBoundObject` (`:216-221`).
- The Responses client's config already accepts fixed transport `headers` and a
  `fetch` wrapper (`apps/api/src/models/openai-model-client.ts:360-405`),
  forwards both into `createOpenAI` (`:653-661`), and the Codex client is the
  precedent for a fixed transport built on a wire client: it pins
  `CODEX_RESPONSES_BASE_URL`, its own `headers`, a redirect-rejecting `fetch`,
  and its provider-option invariants
  (`apps/api/src/models/openai-codex-model-client.ts:66-105`).
  `generateToolBoundObject`'s `callSettings` parameter is a
  `Pick<Parameters<typeof streamText>[0], 'maxOutputTokens' | 'providerOptions'>`
  (`openai-model-client.ts:604-611`), so the structured path carries no
  headers today.
- The AI SDK accepts a per-call `headers` option:
  `CallSettings.headers?: Record<string, string | undefined>`
  (`apps/api/node_modules/ai/dist/index.d.ts:459`), consumed by `streamText`
  (`:2650`), `generateObject` (`:5204`), and `generateText` (`:1361`).
  `@ai-sdk/openai-compatible` merges provider settings headers with per-call
  headers, per-call winning (`dist/index.js:580`, `:666`;
  `dist/index.d.ts:271` declares the provider-level `headers`), and appends its
  own token to whatever `User-Agent` is present
  (`@ai-sdk/provider-utils` `withUserAgentSuffix`, `dist/index.js:884-892`,
  called at `@ai-sdk/openai-compatible/dist/index.js:1789`,
  `@ai-sdk/openai/dist/index.js:7372`, and
  `@ai-sdk/anthropic/dist/index.js:6099`). llame sends no `User-Agent` today,
  so every request presents as the bare adapter.
- `chats.id` is `uuid('id').primaryKey().defaultRandom()`
  (`apps/api/src/db/schema/chats.ts:87`), a random v4 UUID that carries no
  owner, tenant, or sequence information.
- The embedding restriction is an allowlist in code, not a denylist:
  `config-loader.ts:1736-1743` rejects any embedding model whose provider type
  is neither `openai-responses` nor `openai-completions`, and
  `apps/api/src/search/search-embed.worker.ts:96-102` enforces the same
  allowlist when the backend is built, with the comment that it is "an
  allowlist, not a denial of the one type known when it was written".

Gateway facts, recorded from the research bundle and live probes and used
throughout: OpenCode Go serves three protocols under one base URL and one
credential (`https://opencode.ai/zen/go/v1/chat/completions`, `/responses`,
`/messages`); its format gate runs before authentication, so a rejected
model/format pairing is observable without a key; the session header is read
only as `x-opencode-session`, with `x-opencode-request`, `x-opencode-client`,
`x-opencode-project`, and `user-agent` logged but not required; the routing
identity is `sessionId || workspaceID || ip`, and the first upstream candidate
is chosen by a hash of that identity's last four characters; quota exhaustion
returns 429 with `retry-after` and body type `GoUsageLimitError` carrying
workspace metadata. Sources: `docs/research/harnesses/opencode.md`,
`opencode-v2.md`, `openclaw.md`, `pi-mono.md`, `oh-my-pi.md`,
`hermes-agent.md`, `goose.md`, `jcode.md`, and `kilocode.md`.

## Goals / Non-Goals

**Goals:**

- Reach Go's chat-accepted models with llame-owned Run semantics — streaming,
  tool round trips, cancellation, durable observations, reasoning under the
  shipped `reasoning-output` contract — unchanged.
- Carry a stable conversation identity on every request llame makes for a Chat,
  through one transport-neutral field that any later provider can consume.
- Identify llame on every provider request, not only Go's.
- Keep Go's provider identity, catalogue, and billing distinct from Zen, and
  keep the type constructible from `{ type, key }` alone so BYOK adds no schema.
- Keep configuration behavior operator-owned: shape validation only, no vendor
  heuristics, no model-family or route tables, no credential or reachability
  prevalidation.

**Non-Goals:**

- The `/responses` and `/messages` routes (#904), a compiled or fetched
  catalogue (#903), Zen (#808), a generic sticky-session header (#881), BYOK
  (#37, #18), OpenRouter (#82), the subscription lanes (#751, #754), a typed
  quota error or quota ledger, per-model privacy fields, and any overage
  control.
- Boot-time eligibility, reachability, or credential validation of any kind.
- A new dependency, a new adapter, or any change to the run lifecycle, the
  persisted part shape, or a frontend surface.

## Decisions

### D1: One product-named type, `opencode-go`, with a fixed destination and a required key

`providers[].type: "opencode-go"` accepts `{ id, type, key }` and nothing else:
`key` is schema-required and must resolve nonblank, `baseUrl` is rejected at
boot, and the endpoint `https://opencode.ai/zen/go/v1` is fixed in llame's
code. The entry is constructible from `{ type, key }` alone.

Rationale: the per-conversation header cannot come from static configuration,
so a generic `type: "openai-completions"` entry cannot express Go; and a
distinct type keeps Go's fixed destination and subscription billing from sharing
a config shape with an ordinary OpenAI-compatible endpoint, where an operator
could point a Go key at the wrong path and only discover it at request time. The
fixed destination follows the Codex precedent of a fixed transport with its own
failure taxonomy (`openai-codex-model-client.ts:66-105`), and rejecting
`baseUrl` is the same shape that type already uses in the schema
(`llame.config.schema.json:128-134`). Requiring a nonblank key states the
gateway's actual contract: it authenticates every request, so a keyless Go
entry is not a usable configuration and must fail at boot naming the entry and
field rather than at the first request. Constructibility from `{ type, key }`
is deliberate: a BYOK account (#18) can offer "insert your Go key" without a
schema change.

Rejected:

- **Three ordinary wire-typed entries sharing one key.** Each would need the
  session header, so each would be broken by default; and BYOK could not offer
  a single "insert Go key" flow for a provider spread across three entries.
- **A generic multi-route gateway type with operator-supplied header
  templates.** It generalizes a one-provider requirement into an operator-facing
  templating language, and it would let an operator attach an arbitrary header
  to any endpoint.
- **Host inference.** Deriving Go's behavior from a `baseUrl` host would
  contradict the shipped rule that `type` alone selects the wire
  (`provider-api-selection`), and would silently re-point an entry.
- **Accepting `baseUrl` for a self-hosted Go-compatible gateway.** No such
  deployment exists; the console is the only issuer, and a second type can be
  added later if one appears.

### D2: The first layer is the Chat Completions route only

The Go client executes Chat Completions through the existing
`openai-completions` client module composed with the Go base URL, the entry's
key, and Go's fixed headers, exactly as the Codex client composes the Responses
module with its own fixed transport. `/responses` and `/messages` follow as
later layers.

Rationale, from the format-gate survey recorded in the parked draft and
confirmed by the open-source gateway (`anomalyco/opencode` at `70a24697ea`):
`/chat/completions` is registered with format `oa-compat` over the lite
catalogue (`packages/console/app/src/routes/zen/go/v1/chat/completions.ts:5-13`),
the gate rejects an unsupported pairing with `ModelError` before authentication,
and a survey of the live catalogue on 2026-09-17 found `/chat/completions`
accepts 37 of 38 models. Only `grok-4.6` is exclusive to `/responses`. The
published endpoint table is a recommendation, not the gateway's constraint
matrix: it lists 28 models where `GET /zen/go/v1/models` returns 38, and
models.dev carries 37 including at least one the gateway rejects outright. One
route reaches all but one model, so the layer that adds routing would be
carrying a table that is stale on arrival for a single model.

Consequence to hold: `grok-4.6` is unreachable in this change, and the runbook
says so and names #904. A model the operator declares that the gate rejects
arrives as an upstream 401 (D7), not as a boot error.

Rejected:

- **A compiled-in model-to-route table.** It is stale on arrival by the
  survey's own evidence, and `available-models` forbids a compiled catalogue.
- **Fetching the catalogue at boot.** It adds a network dependency to startup,
  makes boot depend on the provider's availability, and is #903's job.
- **Routing per model through a `models[].providerOptions` key.** Routing is
  not a request option; it selects the endpoint path, which a client owns.
- **Serving `/responses` first.** Its accepted set is smaller (the Qwen family
  plus `kimi-k3`, `minimax-m3`, and `minimax-m2.5` are rejected by
  `/responses`), and it would need `@ai-sdk/openai`'s Responses model rather
  than the compatible adapter.

### D3: One required, transport-neutral `chat` field on the model-client input

`ModelStreamInput` and `ModelObjectInput` each gain one required field:
`chat: ChatIdentity`, where
`ChatIdentity = { id: string; lane: ChatLane }` and
`ChatLane = 'main' | 'title'`. Call sites hand over facts — the Chat's id and
which lane the request belongs to — and each client renders or ignores them.
The main turn and both compaction paths send `main`; title generation sends
`title`.

Rationale: the field is the whole channel. It is required, not optional, so the
compiler enumerates every construction site and every test double rather than
letting a silent default creep in; there is no call today that lacks a Chat, so
no fallback is needed and a fallback would be a bug hider. It is
transport-neutral because the same fact has several future consumers, listed as
evidence rather than scope: the OpenAI Responses `promptCacheKey` body option,
the Codex `session-id` header, the generic `X-Session-Id` (#881), and child
agents (`parentId`). Only the Go client renders it today.

Rejected:

- **A caller-built headers map on the input.** Call sites would have to know
  provider header names, which puts transport vocabulary in the run loop and
  makes every caller a place where a header can be wrong.
- **A pre-rendered `chatKey: string`.** Rendering belongs to the client that
  owns the header, and a string would have to be un-parsed by a consumer that
  needs the parts: a Responses `promptCacheKey` needs the raw id, a lane-split
  consumer needs the lane, and a child agent needs the parent.
- **An optional field with a per-call default.** The compiler would not
  enumerate anything, and a missed call site would silently send no identity,
  which is the exact defect Go records against several peer harnesses.
- **Threading the value through the existing `system` or a provider option.**
  Both are model-visible or operator-visible surfaces; the identity is neither.

### D4: The session value is the raw `chats.id`

`x-opencode-session` carries the Chat's own id, sent verbatim for `main` and as
`<id>:title` for `title`. It is stable across retries, worker restarts,
compaction, and model switches within the Chat.

Rationale: the reference implementations send raw internal session ids, and
llame's `chats.id` is a random v4 UUID
(`apps/api/src/db/schema/chats.ts:87`) carrying no owner or tenant information,
while authorization never depends on its secrecy. It is also the only value
that stays stable across every path that must share a cache identity: the run
loop, the compaction summarizer, and a worker restart all have the Chat id in
hand and nothing else in common.

Consequence to hold onto: sending the Chat id to a third party makes "chat ids
are unguessable" permanently unavailable as a security assumption. Any later
feature that would rely on it — share links, invite-by-id — must not. The
design records this so it is not rediscovered as a finding.

Rejected:

- **Unsalted `sha256(chatId)`.** Rejected on simplicity: the native UUID is
  already opaque, and a hash remains available later without a secret if a
  reason appears. The gateway's first upstream candidate is chosen by a hash of the
  identity's last four characters, so a hex tail would still be uniformly
  distributed; the choice was made on simplicity, not on distribution.
- **An HMAC with a durable instance secret.** It adds a secret shared by API
  and worker processes whose rotation silently resets every Chat's cache
  affinity, which is a new failure mode against a non-threat.
- **A per-install static id.** It makes Go work while collapsing every Chat
  onto one cache identity, which looks like success and forfeits the benefit
  the header exists to provide.
- **A per-process or per-instance UUID** (jcode's shape). The cache identity is
  lost on every restart, and nothing about llame's Chat lifetime maps onto a
  process lifetime.
- **A fresh id for auxiliary calls** (pi-mono's compaction behavior). It
  forfeits the prefix cache exactly where the request reuses the parent
  prefix.

### D5: Lanes are a `:title` suffix, and compaction shares `main`

The only lane marker is `:title`, and only title generation carries it.
Compaction shares `main` because its request prefix is the conversation's
prefix; sharing is what makes it a cache hit.

Rationale: the title prompt is a different conversation over the same Chat, so
giving it its own lane keeps it from competing with the turn's cache identity,
while compaction exists to reuse the turn's prefix and therefore must not get
its own. OpenCode shares the conversation id across auxiliary work; pi-mono
mints a fresh id for compaction and forfeits the hit. No other lane exists,
because no other auxiliary request exists.

Rejected:

- **A lane per auxiliary call kind** (`:compaction`, `:title`, `:subagent`). It
  multiplies identities the gateway cannot know about, and the only lane that
  needs separating is the one whose prompt is unrelated to the conversation.
- **No lane at all.** The title prompt shares no prefix with the conversation,
  so sharing gains nothing, and an unrelated prompt would then take part in the
  gateway's per-session routing and cache state for the conversation.

### D6: Every client identifies llame

Every client — `openai-responses`, `openai-completions`, `anthropic-messages`,
`openai-codex`, and Go — sends `User-Agent: llame/<version>`, where the version
is the API package's `version` (`apps/api/package.json`), read once at module
load by a small helper resolved from the module's own location (the compiled
entry point and the source tree both sit one directory below the manifest, so
one relative read covers `nest build`, `nest start`, and Vitest). A manifest
that cannot be read is a startup error, not a silent fallback to a generic
name. The Go client additionally sends `x-opencode-client: llame`.

Rationale: Go's documentation requires a client to identify itself with its own
user agent "rather than a generic SDK or HTTP-library name", and llame sends
none today, so every request presents as the bare adapter after
`withUserAgentSuffix` appends its token. Every peer Go lists as a validated
client sends one (goose, which Go does not list, sends none). The
change is made for all clients rather than only Go because it is one fact about
llame, and a per-type switch would be the second convention.

Recorded fact: the adapters append their own `<pkg>/<version>` token after
whatever `User-Agent` llame sets (`@ai-sdk/provider-utils` `dist/index.js:884-892`),
so the wire value is `llame/<version> <adapter>/<version>`. The requirement is
therefore stated as the value naming llame and its version and never being the
adapter's identifier alone; suppressing the adapter's suffix is not in llame's
control and not worth a `fetch` wrapper.

Not sent: `x-opencode-request` (a message id llame would have to define a
meaning for), `x-opencode-project` (llame has Projects, and the grouping
structure is not the provider's business), and the generic
`X-Session-Id` / `x-session-affinity` pair (#881).

Rejected:

- **A `User-Agent` only on the Go client.** The same request shape reaches
  every provider, and a per-provider identity would have to be repeated for
  each new type.
- **A hardcoded version constant.** It drifts from the manifest silently, and
  the manifest is already the version's source of truth.
- **Reading the version from `process.env.npm_package_version`.** It exists
  only when the process was started through a package script, so production
  would send a different value from development.
- **`x-opencode-client` as a product-version string** (`llame/0.0.1`). The
  header is a client identifier; the version belongs in the `User-Agent`.

### D7: Failures are mirrored, not pre-empted

No boot-time eligibility check, no compiled route or capability table, no
Go-specific error classification, no typed quota error, no quota ledger, and no
retry beyond the existing rules. An upstream failure surfaces at request time
with sanitized diagnostics under the existing failure contract, exactly as it
does for any other type.

Rationale: the three published sources for Go's catalogue disagree with each
other and with the gateway, so any table llame ships is stale on arrival, and
`available-models` already forbids a compiled-in catalogue. Classification adds
a mapping llame would have to keep aligned with an undocumented gateway, and a
typed quota error would promise owner-visible quota state that the gateway does
not return in a form llame can use.

Accepted risks, documented in the runbook and here:

- A model the format gate rejects arrives as HTTP 401 with body `{"type":
"error","error":{"type":"ModelError","message":"Model <id> is not supported
for format oa-compat"}}`, which reads like a bad key until the operator reads
  the body. The runbook states this first, because a misdeclared
  model is the likeliest operator error.
- A request missing the session header surfaces on some models as
  `400 "Model is unavailable"` rather than a named session error. This cannot
  happen through llame after this change, since the field is required, so the
  risk is recorded only so the runbook can name it when a hand-made request is
  being debugged.
- Quota exhaustion is 429 with `retry-after` and body type `GoUsageLimitError`.
  The workspace metadata the gateway attaches is never surfaced, and llame
  reports no quota state of its own.

Rejected:

- **A boot-time eligibility probe.** It contacts the network at startup, makes
  boot depend on the provider, and still cannot know the route matrix (D2).
- **A typed quota error and a quota ledger.** The gateway's monthly, weekly,
  and five-hour windows are per model and are not returned as response
  headers; llame would be inventing state.
- **A `MissingSessionID` invariant error.** llame cannot produce that request
  after this change, so the error path would be dead code guarding a state the
  type system already excludes.
- **Falling back to another provider or wire on a Go failure.** It contradicts
  the shipped failure contract and would silently change the model that
  answered.

### D8: Caching is gateway-side, and llame sends no cache control

The Go client sends no cache-control field and no block-level cache marker.
Caching is the gateway's, keyed on the session header.

Rationale, with the earlier argument recorded because it was retracted: routing
the Qwen and MiniMax families over Chat Completions was suspected to forfeit
explicit cache writes and burn the dollar-denominated quota roughly sevenfold.
That is wrong. A third-party A/B on `glm-5.3-flash` over `/chat/completions`
showed that with the session header a second identical request cache-hit 5568
of 5630 input tokens with no `cache_control` anywhere in the request; both
OpenCode generations confirm it by omission, since their cache-breakpoint
injection is gated to Anthropic-shaped routes and never fires for a Go model,
yet Go's published per-request estimates land exactly on its monthly caps. The
retracted argument is preserved here so the question is not re-litigated from
the pricing table alone.

Rejected:

- **Sending Anthropic-style `cache_control`.** The adapter has no such option
  for this wire, and the gateway needs none.
- **A Go-specific cache option in `models[].providerOptions`.** The generic
  operator channel already reaches the adapter; llame adds no field and no
  default.

### D9: Cost is unknown unless the operator declares pricing

The example configuration declares no `pricingUsdPer1M` for Go models, so
`costUsd` is `null`, the Codex unknown-cost precedent. An operator may declare
one, and the runbook says it is quota accounting rather than money paid per
token.

Rationale: Go bills a subscription with per-model monthly, weekly, and
five-hour windows, not a per-token invoice, so a llame-authored price would
turn a quota into a fake dollar figure. The parked draft's older rationale —
that the pricing shape could not express a cache-write premium — is retired:
`pricingUsdPer1M.cacheWrite` now exists
(`anthropic-provider`, D8), so the surviving reason is the billing model, not
the schema. Usage and latency are still recorded; only the dollar figure is
absent.

Rejected:

- **Computing cost from the published token prices.** The published table has
  peak and off-peak tiers and context-length tiers, and Go's own estimates are
  the quota arithmetic, not a bill.
- **Reporting `costUsd: 0`.** It claims a free request where llame simply does
  not know.
- **A quota ledger derived from usage.** D7's reasoning: the windows are not
  observable per request.

### D10: The catalogue is operator-declared, with no compiled table and no boot-time network

`models[]` entries reference the Go provider as they reference any other; llame
compiles in no Go model list, ships no route table, and contacts no endpoint at
boot.

Rationale: the gateway's catalogue is behind device OAuth in the console, and
the three published sources disagree, so a compiled table is wrong on arrival.
The committed models.dev snapshot that would make declaration cheaper is #903,
explicitly deferred.

Rejected:

- **A compiled-in Go catalogue** (`available-models` forbids it).
- **Live `/v1/models` discovery at boot or on demand.** It adds a network
  dependency, a cache, and a staleness policy, all of which #903 owns.

### D11: An embedding model cannot reference the type

An `embeddingModels[]` entry whose `provider` names an `opencode-go` provider
fails startup, naming the unsupported binding.

Rationale: the gateway serves no embeddings route, and the existing code
already enforces this by allowlist: `config-loader.ts:1736-1743` accepts only
`openai-responses` and `openai-completions`, and
`search-embed.worker.ts:96-102` re-checks the same allowlist when the backend
is built. So the loader needs no code change; the requirement text names the
type so the exclusion is stated rather than inferred, and the layer adds the
focused test that proves the allowlist rejects it.

Rejected:

- **A denylist in the loader.** The allowlist is strictly safer and already
  shipped; adding a second convention beside it would be worse than leaving the
  code alone.
- **An embeddings route on the type.** None exists upstream.

### D12: The example configuration ships two models, and privacy divergence is documented rather than modelled

`glm-5.3-flash` and `deepseek-v4.1-flash`, both chat-accepted, with
`reasoning` declared where the model reasons. The Muse Spark Contributor models
are excluded.

Rationale: `glm-5.3-flash` is the model with published live evidence for the
session header and gateway caching; `deepseek-v4.1-flash` is the second
cheapest useful coding model on the route. The Contributor models train on
prompts and are not zero-retention, and retention also differs inside the
provider: most models are 0 days while `grok-4.6` and `gpt-5.6-luna` retain 30
days for abuse monitoring. A per-model retention and training field in the
owner-facing catalogue is a genuine product question, so it does not ride in on
a provider slice; the divergence is explained in `docs/opencode-go.md`
instead.

Note for the runbook: `deepseek-v4.1-flash`'s $60 monthly cap was promotional
with a stated end of 2026-09-20; its base cap is $15, so the runbook must not
quote $60.

Rejected:

- **Modelling retention and training per model.** A catalogue field with no
  consumer yet, and the honest answer (a table maintained by hand) is
  documentation.
- **Shipping the Contributor models with a warning.** A warning is not a
  consent gate, and the operator-facing surface for training consent does not
  exist.
- **Shipping only one model.** Two entries show the entry shape is duplicable
  and give the operator a second route when one model is exhausted.

### D13: No Go-specific reasoning work

The Go client inherits reasoning from the shipped Chat Completions path:
`@ai-sdk/openai-compatible@2.0.75` normalizes `reasoning_content ?? reasoning`
inbound and re-injects `reasoning_content` on outbound assistant messages, and
the result persists and replays under the `reasoning-output` contract, as the
2026-09-18 changelog entry records. The example models declare `reasoning` where
the model reasons, which is the whole llame-side configuration.

Rationale: reasoning on this wire is already normalized by the adapter llame
ships, and the shipped contract forbids llame-authored vendor parsers. Go
serves the same families through the same wire, so a Go-specific path would be
a second convention with no difference to implement. Peer harnesses that do
add a Go-gated repair (pi-mono's delta-field remap, OpenClaw's Kimi strippers)
do so because they own their own stream parsers, which llame does not.

Rejected:

- **A Go-gated reasoning sanitizer or field remap.** `reasoning-output` and the
  completions client's comments forbid llame parsing reasoning; the adapter
  already covers both field names.
- **Suppressing `reasoning_content` replay for Go.** DeepSeek rejects a request
  whose earlier assistant turn omits it while tools are present, which is the
  shipped replay path's reason to exist.

### D14: Zen is a follow-up over the same module

OpenCode Zen (#808) becomes its own type over the same client module, with its
own base URL (`https://opencode.ai/zen/v1`) and its own catalogue and billing.
This change adds nothing Zen-specific and nothing that would block it: the
fixed destination is a constant in the Go module, and the session rendering is
shared by the module the Zen type will reuse.

Rationale: the two share credential infrastructure and a header scheme but
differ in endpoint, catalogue, and billing source, which is the same reason Go
is not a `baseUrl` under a generic type. Keeping the endpoint a constant in the
Go module means the Zen slice changes one constant and one type, not the
transport.

Rejected: **one `opencode` type with a mode field.** A mode is a
configuration-shaped type switch, and the two catalogues and billing sources
never overlap.

### D15: The generic session header stays #881, and `chat` is its channel

No generic `X-Session-Id` or `x-session-affinity` header is added, and #881
stays open. When it lands, it reads the same `chat` field this change
introduces, so no call site changes again.

Rationale: the gateway reads `x-opencode-session` only; the generic pair
belongs to OpenCode v2's own client scheme and to other sticky gateways, and
adding it now would send a header no configured endpoint reads. The field is
the durable part of the design and the header name is the per-provider part, so
splitting them this way means #881 is a client change, not a call-site change.

Rejected:

- **Adding the generic header now with no consumer.** An unread header is
  untestable behavior and a guess about other gateways' semantics.
- **Making the header name configurable per provider.** That is the generic
  multi-route gateway type D1 rejected, arriving through the back door.

## Deferred to later layers, with their issues

- **#904**: a per-model route override (Responses, Messages) on this type. The
  `opencode-go-provider` capability's requirement names the route ceiling
  explicitly so the follow-up has a stated contract to extend.
- **#903**: a committed models.dev catalogue snapshot as the source of routes,
  limits, and pricing. It is also the prerequisite for a cheap BYOK flow.
- **#808**: OpenCode Zen as a second type over the same module (D14).
- **#881**: the generic session or sticky-affinity header; `chat` is its
  channel (D15).
- **#18**: user BYOK accounts; the `{ type, key }` entry shape is designed so
  the account adds no schema (D1). #37 is the parent track.
- **#82**: OpenRouter as a native sibling, whose own provider requirements stay
  separate.
- **#810**: tool-loop usage and cost accounting. **#593**: the effort-change
  cache-invalidation warning. Neither is re-scoped here.

## Risks / Trade-offs

- [A model the operator declares is rejected by the gateway's format gate] →
  it surfaces at request time as a 401 `ModelError`, documented in the runbook
  as the first thing to check; #904 owns the route override that would reach
  the one Responses-only model.
- [The Chat id becomes third-party-visible] → recorded as an explicit
  non-assumption in D4 and in the capability's requirement, so no later feature
  treats a chat id as a secret.
- [A missing session header is misreported on some models] → cannot occur
  through llame after this change because the field is required (D3); the
  runbook names it for hand-made requests, and the accepted risk is recorded in
  D7.
- [Quota exhaustion is reported as an ordinary upstream failure] → accepted and
  documented; llame reports no quota state, so no owner surface can be wrong
  about it.
- [An operator declares a `pricingUsdPer1M` and reads it as a bill] → the
  runbook states it is quota accounting, and the example ships none, so the
  default posture is `costUsd: null`.
- [Muse Spark Contributor models train on prompts] → excluded from the example
  and called out in the runbook; no catalogue field models consent.
- [The `chat` field is required on an internal seam with many test doubles] →
  that is the point (D3): `tsgo --noEmit` enumerates every construction site,
  and the chat-key layer updates each one mechanically rather than leaving a
  default that hides a missed call.
- [A per-request header renderer on the completions client widens a shared
  module for one provider] → it is the same shape the Responses client already
  exposes for the Codex transport (`headers` plus `fetch`), it is optional, and
  an entry that sets nothing sends the requests it sends today.
- [The adapter appends its own token to `User-Agent`] → recorded in D6; the
  requirement is stated against what llame controls, and the focused test
  asserts the leading llame token.
- [Upstream overage through "Use balance" is not controllable from llame] →
  stated plainly in the runbook rather than implied to be prevented.
- [The gateway's first upstream candidate is chosen by a hash of the identity's
  last four characters] → the raw UUID is uniform there, so no distribution
  problem exists; recorded in D4's rejected alternatives so the hash question is
  not reopened.

## Migration Plan

Additive and configuration-only. Existing providers and models are untouched;
the four existing clients gain a `User-Agent` and nothing else observable, and
the two new client config fields are set only by the Go client. An
operator adds an `opencode-go` provider and model entries that reference it,
then restarts. No database migration and no dependency change. Rollback is
removal of the added entries plus a restart; historical runs keep their
recorded model ids and null costs, and queued work naming a removed model
follows the existing unavailable-model contract.

The one cross-cutting change is the required `chat` field on the model-client
input contract. It has no operator surface and no persisted form: every call
site derives it from the Chat it already serves, so no stored data changes and
no chat history needs reprocessing.

## Revision history

- v1 (2026-09-21): Initial proposal, written after the `openai-compatible` and
  `anthropic-provider` slices merged. Replaces the parked draft of 2026-09-17,
  which is preserved outside the repository: the parked draft's open question
  (whether a model may override its provider's protocol) is settled by #904 and
  D2, its `subscription-access-opencode-go` capability name becomes
  `opencode-go-provider`, its per-model header channel becomes the
  transport-neutral `chat` field, its `@ai-sdk/openai-compatible` dependency is
  already installed, and its cost rationale is restated against the billing
  model because the pricing shape gained a cache-write rate in the meantime.
