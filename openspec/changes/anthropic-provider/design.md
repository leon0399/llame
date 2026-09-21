## Context

See [proposal.md](proposal.md) for motivation and scope; the delta specs under
`specs/` are the behavior contract this design implements.

On master after `openai-compatible-provider` (PRs #884, #886, #888, #889, #890,
closing issue #883), `providers[]` is discriminated by `type` and the schema's
`$defs.providerType` enum is strict-closed to
`["openai-responses", "openai-completions", "openai-codex"]`, each named after
the wire it speaks; its description still calls Anthropic a follow-up.
`llame-config.ts` normalizes entries into
`OpenAIResponsesProviderConfig { id, type, key, baseUrl | null }`,
`OpenAICompletionsProviderConfig { id, type, key, baseUrl }`, and
`OpenAICodexProviderConfig { id, type, key, accountId }`, with `key: null`
meaning keyless. `model-client-factory.ts` switches on `provider.type` and its
`default` branch is a `never` exhaustiveness guard. Each type owns a client
module; the Responses and Codex clients share `openai-model-client.ts`, whose
`applyReasoningOptions` (`:249-257`) hardcodes
`providerOptions.openai = { reasoningSummary: 'auto', reasoningEffort, store }`
on streaming and compaction requests, while its `generateToolBoundObject`
(`:372-389`) sends no provider options at all; and
`openai-completions-model-client.ts:76-80` hardcodes
`providerOptions.openaiCompatible = { reasoningEffort }`. No catalog field
reaches those objects. llame passes no `maxOutputTokens` to any request:
`runs.maxOutputTokens` is an admission reserve (`run-execution.service.ts:1710`)
that "does not cap provider output".

The catalog's `reasoning` object (`model-catalog.ts:33-57`) declares an ordered
list of opaque provider-native effort tokens with a default; the run's resolved
token is forwarded verbatim by each client. The shipped decision is explicit:
"OpenAI and Anthropic disagree on the value set and both change it between
releases, so constraining the strings here … would make every provider release
a llame release."

Cost flows from the catalog entry through `toTokenPrice(model.pricingUsdPer1M)`
to `ModelClient.pricing`, and `calculateCostUsd` in
`apps/api/src/chats/turn-telemetry.ts:131-153` prices only
`uncachedInput × input + cachedInput × (cachedInput ?? input) + output × output`,
with `uncachedInput = inputTokens − cachedInputTokens`. The AI SDK's usage
shape carries `inputTokenDetails.cacheWriteTokens` and the provider interface
carries `inputTokens.cacheWrite`, but llame's own `TurnTelemetry`
(`turn-telemetry.ts:11-17`) does not: `buildTurnTelemetry` reads
`inputTokens`, `cachedInputTokens`, `outputTokens`, and `reasoningTokens` only,
and the assistant-message and compaction telemetry share that shape; the
`assistant_turn_completed` log line (`turn-telemetry.ts:105-125`) and the web
usage panel (`apps/web/app/(chat)/components/message-usage.tsx`) enumerate
their fields one by one and inherit nothing. Because
`ai@6.0.256` maps `inputTokens` to the provider's input total and
`cachedInputTokens` to its cache-read count, every cache-write token is priced
today inside the uncached term at the input rate.

`reasoning-output` now defines the per-part provider-metadata channel: a
reasoning part persists opaque adapter metadata, replays it byte-identically on
later requests for the same Chat, and never renders or logs it. Its UI
requirement renders one Thinking panel per group of consecutive reasoning
parts; `apps/web/app/(chat)/components/chat-message-row.tsx:220-225` has no
guard for a group whose text is empty.

`@ai-sdk/anthropic@3.0.118` is the `ai-v6` dist-tag and declares
`@ai-sdk/provider@3.0.16` / `@ai-sdk/provider-utils@4.0.51`, a pair the
lockfile already carries next to the 3.0.15 / 4.0.46 pair `ai`, `@ai-sdk/openai`,
`@ai-sdk/gateway`, `@ai-sdk/mcp`, and `@ai-sdk/react` pin. Inspected in its
built source: `createAnthropic` takes `baseURL` (default
`https://api.anthropic.com/v1`), `apiKey` (always sent as `x-api-key`, falling
back to the `ANTHROPIC_API_KEY` environment variable only when `apiKey` is
omitted), `authToken` (sent as `Authorization: Bearer`), and `headers`;
request-level `providerOptions.anthropic.cacheControl` is emitted as a
top-level `cache_control` body field; `effort` is emitted as
`output_config.effort` independently of `thinking`, lowered from `xhigh`/`max`
to `high` with a warning when thinking is disabled on a model the adapter
knows rejects that combination; `thinking` is a zod union of
`{ type: 'adaptive', display?, blockBinding? }`,
`{ type: 'enabled', budgetTokens? }`, `{ type: 'disabled' }`, and
`{ blockBinding }` alone, so a `blockBinding` merged into the `enabled` or
`disabled` shape is stripped silently and neither the field nor the
`thinking-binding-controls-2026-08-01` beta header is sent; `sendReasoning`
(default true) gates whether persisted thinking blocks are converted for
replay; `fallbacks` names other models for server-side fallback and
`mcpServers` attaches provider-side tool servers; `structuredOutputMode`
defaults to `auto`, which emits `output_config.format` for a JSON response
format on models its own capability table marks as supporting structured
output (every `claude-` id except the Sonnet 4, Opus 4, and Claude 3
generations, so including Opus 4.1 and any unrecognized `claude-` id) and
otherwise adds a `json` tool with a required tool choice; the same table sets
`max_tokens` when the request carries no `maxOutputTokens` (the rows D17
enumerates: 128k for the current generations and any unrecognized `claude-`
id, 64k or 32k for the 4.5 and older 4.x rows, 4096 for the Claude 3 Haiku,
Claude 2, and Claude Instant rows and for any id without `claude-`); reasoning
replay reads `providerOptions.anthropic.{signature, redactedData}` on
reasoning parts and warns on anything else; the signature of a streamed
thinking block arrives on a `reasoning-delta` part with an empty delta; the
usage it reports has `inputTokens.total = input + cache_creation +
cache_read`. Its language-model option schema is a non-strict zod object, as
is `@ai-sdk/openai@3.0.97`'s, so unknown keys are dropped and invalid values
throw; `@ai-sdk/openai` forwards `conversation`, `previousResponseId`,
`instructions`, `systemMessageMode`, and `allowedTools` (which "overrides the
request-level `toolChoice`") from its namespace and maps
`cache_write_tokens` from both its wires' usage; `@ai-sdk/openai-compatible@2.0.75`
parses its recognized options from the `openaiCompatible` namespace and from
the namespace named after the configured provider (`openai-completions` /
`openaiCompletions` for llame's client), but spreads unknown keys into the
request body only from the provider-name namespaces, after `model`,
`max_tokens`, the sampling fields, `response_format`, `stop`, and `seed`, and
before `reasoning_effort`, `messages`, `tools`, and `tool_choice`. llame's
shipped reasoning collector (`apps/api/src/runs/assistant-transcript.ts:106-152`)
starts a part only on a delivery with text: "An empty `text` starts no part
and moves no boundary … an id no collected part carries binds nothing", so a
withheld-text thinking block (start, one empty delta carrying the signature,
end) is dropped by the collector as shipped.

Anthropic's documentation, read 2026-09-19: `tool_choice` `any` and `tool`
return a 400 on Claude Fable 5.1 and Mythos 5.1, and "are not supported and
result in an error" with manual extended thinking (`thinking: {type:
"enabled"}`) on any model; `thinking.type: "enabled"` returns a 400 on Opus
4.7, 4.8, 5, Sonnet 5, and Fable and Mythos 5.x, and `budget_tokens` is
deprecated on Opus 4.6 and Sonnet 4.6, with depth controlled by
`output_config.effort` ("no beta header required"); thinking "is already on and
needs no configuration" on Opus 5, Sonnet 5, Fable and Mythos 5.x, and Mythos
Preview, while on Opus 4.8, 4.7, 4.6, and Sonnet 4.6 it "is off until you set
`thinking: {type: "adaptive"}`"; `display` defaults to `"omitted"` on Opus 4.7
and later, Sonnet 5, and Fable and Mythos 5.x, returning thinking blocks with
an empty `thinking` field whose `signature` "still carries the encrypted full
thinking for multi-turn continuity", and an adaptive turn that skips thinking
produces no block at all; `block_binding` is accepted alongside both
`thinking.type: "adaptive"` and `"enabled"`; the structured-outputs page lists
Fable and Mythos 5.x, Mythos Preview, Opus 5, 4.8, 4.7, 4.6, 4.5, Sonnet 5,
4.6, 4.5, and Haiku 4.5, without Opus 4.1; automatic caching is "a single
`cache_control` field at the top level of your request body"; the prefix check
"is enforced by default for accounts created on or after August 31, 2026" and
otherwise only on requests that set
`thinking.block_binding.prefix_mismatch_behavior`; "A thinking block is readable
only by the model that produced it or a newer one, and the API ignores or drops
the blocks the target model can't read."

Prior art consulted: Claude Code drives adaptive models by effort level
(`low…max`, per-model subsets), cannot turn thinking off on Fable, and exposes
summaries only behind `showThinkingSummaries: true`; OMP's catalog carries a
per-model `thinking.mode` (`anthropic-adaptive` for 4.6+, `budget` below),
`supportsDisplay` (true from Opus 4.7), and an effort ladder, and its adapter
sends adaptive + `output_config.effort` + `display: "summarized"` where
supported (commit `421ff27eb` gated `display` per model after observed 400s);
OpenCode's per-model `options` passes provider options through and its
`variants` are named option bundles; OpenRouter's unified `reasoning` object
accepts an effort enum or a token budget and publishes per-model
`supported_efforts`, `default_effort`, `supports_max_tokens`, and `mandatory`.
Across the providers llame may add next (Gemini `thinking_level`, xAI, Kimi,
Mistral, DeepSeek's official `reasoning_effort` tiers, Z.AI's
`thinking.type` toggle, Qwen's `enable_thinking` and `thinking_budget`), the
controls are an ordinal ladder, a token budget, a boolean toggle, a display
switch, and in one case an integer intensity (DeepSeek V4.1-Flash weights on
self-hosted inference, 1–100).

## Goals / Non-Goals

Goals:

- One wire-named provider type, one client module, one dispatch case, under
  the existing `ModelClient` seam and run lifecycle.
- One operator channel for provider-native request options that every client
  honors under one precedence, replacing the hardcoded per-client options.
- Configuration behavior that stays operator-owned: shape validation only, no
  vendor heuristics, no model-family tables, no credential or reachability
  prevalidation.
- Reasoning that is visible by default on current Claude models, effort that is
  the operator's declared vocabulary forwarded verbatim, and thinking blocks
  replayed exactly as the provider requires.
- Cost accounting that reports the cache-write spend the provider bills.
- Structured output through the mechanism current Claude models accept.

Non-goals:

- A second Anthropic type, a bearer-token option, the subscription path
  (#754), OpenRouter (#82), OpenCode Zen and Go (#808, #809), BYOK (#37, #18),
  the v4 AI SDK line (#882), tool-loop usage and cost accounting (#810), and the
  effort-change cache warning (#593).
- A llame-owned effort vocabulary, a per-model thinking mode field, an
  authored thinking budget, per-level option bundles, or a continuous effort
  control.
- Validating, publishing, or interpolating `providerOptions`.
- Changing the run lifecycle, the reasoning part shape, or any frontend
  rendering beyond hiding an empty Thinking panel.

## Decisions

### D1: One wire-named type, `anthropic-messages`, and no gateway sibling

`type: "anthropic-messages"` executes the Messages wire through
`@ai-sdk/anthropic` at the entry's `baseUrl`, defaulting to the Anthropic API.
Rationale: a gateway or proxy that speaks the Messages wire differs from
Anthropic only in `baseUrl`, so a second type would be the "two dead
combinations" the shipped D1 rejected for a `surface` field — `{ type:
"anthropic", baseUrl: X }` and `{ type: "anthropic-compatible", baseUrl: X }`
produce byte-identical requests. `openai-responses` already covers Ollama,
vLLM, and proxies through `baseUrl`, and `provider-api-selection` has the
scenario for it. Issue #208 scopes one type; #808 and #809 are entries. The
name is the wire, not the vendor, because after this decision the type serves
non-Anthropic endpoints (`{ type: "anthropic-messages", baseUrl:
"https://api.z.ai/api/anthropic" }` is true; `type: "anthropic"` on that line is
not), it matches the enum description ("named after the wire API it speaks")
and omp's `api` vocabulary, and it leaves the bare `"anthropic"` outside the
enum, so the shipped unsupported-type example only needs its parenthetical
updated from "before the adapter exists" to "a bare `"anthropic"`". The subscription path
(#754) is not this type whatever shape it settles on: its issue text scopes it
to an unmodified Claude Code execution path with Anthropic-owned sign-in, while
OMP and OpenClaw carry it as an OAuth credential on the Messages wire with a
fixed endpoint and a request fingerprint — a codex-like sibling if llame ever
chose that shape. `anthropic-messages` leaves the vendor name and the enum free
for either, and the naming argument stands on the gateway case alone.
Rejected: `anthropic` plus `anthropic-compatible` (as first drafted); a bare
`anthropic` (vendor name on gateway entries); inferring a gateway from the
host.

### D2: The configuration posture stays operator-owned

Boot validates shape only. It does not judge whether a `baseUrl` serves the
Messages wire, does not warn about a mismatch, and does not migrate or
reinterpret an entry. Rationale: unchanged from the shipped posture; llame
cannot know every gateway's host or path layout, and a heuristic that is wrong
either blocks a working endpoint or reassures an operator about a broken one.
Rejected: host allow-lists and boot warnings.

### D3: Variant shape and credential semantics mirror `openai-responses`

`anthropic-messages` accepts `{ id, type, key?, baseUrl? }`. `key` and
`baseUrl` use the existing `{env:…}` / `{path:…}` interpolation, an empty
resolution means keyless, and the client passes the same non-empty placeholder
the OpenAI clients pass (`KEYLESS_PLACEHOLDER_API_KEY`) because the adapter's
`loadApiKey` throws when `apiKey` is omitted and no environment variable is
set. The credential is sent as `x-api-key`. The client always passes an
explicit `baseURL` — the configured value or the Anthropic default — because
`createAnthropic` reads `ANTHROPIC_BASE_URL` from the environment when the
option is omitted, and an ambient variable must never move a request off the
configured destination. Rejected: requiring `key` (breaks keyless gateways); a
bearer-token option (`authToken` exists in the adapter and some gateways want
it, but no configured target needs it and the field is additive later);
separate field names for the compatible case, which no longer exists; omitting
`baseURL` on the default path, as the OpenAI client does (its adapter reads no
environment variable for it).

### D4: Pin `@ai-sdk/anthropic@3.0.118`

It is the `ai-v6` dist-tag, the newest release on the repository's v3
specification line, and it declares `@ai-sdk/provider@3.0.16` /
`@ai-sdk/provider-utils@4.0.51`. The lockfile already carries that pair next to
3.0.15 / 4.0.46, so this adds no third pair and changes nothing about the
existing two; the claim that the two changes would "converge" on one pair was
wrong and is withdrawn. It peers on zod `^3.25.76 || ^4.1.8`, which llame
resolves. Rejected: the v4 line (#882) and an unpinned range.

### D5: Per-model `providerOptions`, forwarded under one precedence

`models[].providerOptions` is a server-only JSON object of provider-native
request options for the adapter the entry's provider `type` selects. Every
client composes its request options from four layers, highest first: client
invariants (codex: `store: false` and `reasoningSummary: 'auto'`, the latter
because `subscription-access-openai-codex` mandates persisting that display
text; the Messages client: the drop-on-prefix-mismatch instruction and
`sendReasoning: true`), the run's resolved effort in the adapter's effort
option, the operator's object, and the client's defaults (`reasoningSummary:
'auto'` on the Responses client's streaming and compaction requests; adaptive
thinking with summarized display and the top-level cache control on the
Messages wire). Defaults are defined per request kind, and an entry without
`providerOptions` produces exactly the bodies its client produced before this
change — in particular the Responses client's structured-generation path,
which sends no provider options today, gains none. Object-valued options merge
key by key, recursively; `null` at any depth removes a client default and
cannot remove an invariant. Reserved keys are stripped from the operator's
object before composition, because they change what the request is rather than
how the model answers: on the Responses wire, for the Responses client and the
codex client alike, `conversation`, `previousResponseId`, and `instructions`
(shared provider-side continuation state would cross Chat and owner
boundaries, and `instructions` replaces llame's prompt) and
`systemMessageMode` (its `remove` value strips llame's system prompt with only
a warning); on the Chat Completions wire `model` (the adapter spreads unknown
keys over its own `model` field, so an operator key would execute another
model under this entry's identity, pricing, and context window) and
`max_tokens` (spread over the catalog's output limit the same way); on the
Messages wire `fallbacks` (server-side execution on another model),
`mcpServers` (tools outside llame's gate), `container` (a provider-side
container identifier every owner's requests would share), and
`thinking.blockBinding` (llame's invariant; an operator value would otherwise
reach the adapter as a type-less thinking object on an entry without
`reasoning`); on the Responses wire also `allowedTools`, which the adapter
lets override the request's tool choice and so would strip the forced choice
structured generation relies on. The completions client composes into the
`openaiCompletions` namespace: the adapter parses recognized options and
forwards unknown keys from both its configured provider name
(`openai-completions`) and that name's camel-case form, and llame picks the
camel-case form by convention. Boot validates "is an object" and
rejects interpolation syntax in any string value at any depth, so no
interpolated secret can reach the object; the object is not a credential
channel and is not redacted, and it is never published. The adapter is the
validator: an invalid value for a known option throws `InvalidArgumentError`
at request time, an unknown key is dropped by the OpenAI and Anthropic
adapters and forwarded by `openai-compatible`, and llame never rewrites or
retargets a request because of either.

Rationale: the fact underneath every provider's reasoning controls is that the
AI SDK already takes a namespaced options object per adapter, and llame hid it
behind hardcoded per-client policy. One field serves the adaptive/display
matrix on the Messages wire, the summary mode on Responses, vendor toggles on
Chat Completions backends, and whatever the next adapter documents, without a
llame vocabulary, a model table, or a per-provider schema — which is what an
Anthropic-only `mode` field would have been. OpenCode's per-model `options` is
the direct precedent. Precedence is fixed so an operator cannot break a
correctness invariant or override the owner's effort choice, and `null` exists
because "remove the default" is otherwise inexpressible with a merge.

Rejected: an Anthropic-only `reasoning.mode` / display flag (fragments the
catalog per provider); a llame-owned universal effort ladder with per-client
mapping (reverses the shipped opaque-token decision, needs invented
effort-to-budget constants for budget-only models, and still needs this field
for mode, display, and toggles); validating keys at boot against the adapter
schema (couples every adapter release to a llame release); allowing
interpolation inside the object (a request option is not a secret channel);
publishing it (server-only, like `providerModelId`).

### D6: Per-level option bundles are the recorded extension, not implemented

When a level needs more than a string in the adapter's effort field — an
integer intensity such as DeepSeek V4.1-Flash's 1–100 on self-hosted inference,
a per-level token budget, or a per-level toggle — an `effortLevels` item may
grow an `options` object merged over the entry's `providerOptions` for that
level, OpenCode's `variants` shape, with the bare string kept as the shorthand.
Not implemented now: every official API llame targets today exposes a ladder,
so the shorthand covers them, and an unused extension point is prohibited.
Rejected: a continuous effort control (`reasoning.range`), which is a new UI
surface no reference harness offers.

### D7: Prompt caching is an overridable client default

The Messages client defaults `providerOptions.anthropic.cacheControl = { type:
'ephemeral' }` at the request level, which the adapter emits as the top-level
`cache_control` field of Anthropic's automatic caching: the provider places the
breakpoint on the last cacheable block and moves it forward as the conversation
grows, so llame places no breakpoints, counts none, and the adapter's
four-breakpoint limit never applies. The lifetime stays the provider default;
under D5 an operator may set the longer lifetime or remove the option with
`null` for a gateway that rejects it. Rationale for defaulting on: a stable
prefix is otherwise re-paid in full every turn; with cache reads at 0.1× input
(0.025× on Fable 5.1 and Mythos 5.1) and a 5-minute write at 1.25× input, a
50k-token prefix over 20 turns costs about 1,000k input-token-equivalents
uncached versus about 157k cached. Moderate confidence on the exact ratios,
high on the order of magnitude. Rejected: block-level breakpoints authored by
llame; a mandatory option with no operator remedy for a rejecting gateway (as
first drafted); omitting caching.

### D8: Cache-write pricing is an optional additive field, consumed once in cost

Add `cacheWrite` to `ModelPricingUsdPer1M` (today `{ input, cachedInput, output
}`), carry it through `toTokenPrice`, add cache-write tokens to
`TurnTelemetry` from the AI SDK's `inputTokenDetails.cacheWriteTokens`, and
price them at that rate, falling back to the entry's `input` rate when absent —
the same fallback shape as `cachedInput`. Because the adapter's input total
already includes cache-creation tokens and today's formula prices them inside
the uncached term, the uncached term becomes
`inputTokens − cacheRead − cacheWrite` at the same time, with the same
bounding the shipped formula applies to cached input — reads capped at the
input total, writes at the remainder — so a cache-write token is charged
exactly once, an endpoint that reports inconsistent counts cannot drive the
uncached term or the cost below zero, and the fallback case reproduces today's
cost to the dollar rather than doubling it. The adapter populates the count from
`cache_creation_input_tokens`, a real field that is billed and is the largest
line on a cached turn. The public model DTO mirrors the field so the published
price stays inspectable; the assistant-message and compaction telemetry share
`TurnTelemetry`'s shape and gain the field with it, the telemetry log line and
the web usage panel enumerate their fields and gain it explicitly, and the
`usage` columns are `jsonb`, so no migration follows. The OpenAI adapters map
`cache_write_tokens` from their usage as well, so the count is recorded on
every wire that reports it and the input-rate fallback keeps every wire's cost
identical to today's; a model entry that declares `cacheWrite` on an
OpenAI-wire model reprices those tokens deliberately. Rejected:
a required field; deriving a write rate as a fixed multiple of input; exposing
it server-only; adding the term without the subtraction (double-counts every
cache write).

### D9: Signatures are durable per-part metadata and are replayed unmodified

The client surfaces thinking and redacted thinking as reasoning parts through
the existing normalized-reasoning path, persists each block's signature (and
redacted payload) as opaque provider metadata on that part through the channel
`reasoning-output` defines, and replays the blocks on later requests for the
same chat. Anthropic's tiers, verbatim: "**Required:** within a tool-use turn,
pass thinking blocks back. **Recommended:** across turns, pass everything back.
**Allowed:** outside tool use, omit prior turns' thinking." llame follows the
recommendation within the model context a request is built from and does not
prune there, because "the API automatically filters them,
keeps the blocks needed to preserve the model's reasoning, and bills input
tokens only for the blocks actually shown to Claude." On a model switch the
blocks are replayed unchanged, since a block "is readable only by the model
that produced it or a newer one, and the API ignores or drops the blocks the
target model can't read" (on Fable 5.1 and Mythos 5.1 the direction matters:
they read every earlier model's blocks and no earlier model reads theirs).
Blocks are replayed complete and unmodified in their original order, because a
modified block is rejected with a 400. A block whose text was withheld persists
with empty text and its signature; the signature is what the replay needs.

Implementation facts the messages layer must respect: the adapter delivers the
signature on a `reasoning-delta` part with an empty delta, not only on start
and end parts, so the collector reads metadata from deltas; a withheld-text
block is exactly one such delivery under a new id, which the shipped collector
drops, and its ids restart per response, so D18 changes the collector rule and
scopes the ids; the adapter reads only
`providerOptions.anthropic.{signature, redactedData}` on replay and warns on
anything else, so metadata another wire attached to a part is skipped, not
sent. Rejected: run-scoped state that dies with the run; llame-side pruning;
coercing or stripping a signed block on a model switch; dropping empty-text
parts (they carry the signature).

### D10: Prefix binding is handled by an explicit drop instruction, as an invariant where the adapter can carry it

Anthropic's rule, verbatim: a block "stays valid only while the top-level
`system` prompt, the `tools`, and the messages before it are unchanged. If any
of them changes, that block and every later thinking block are invalid, and the
API rejects the request with a 400 error or drops the invalid blocks, whichever
you choose." Enforcement is default-on for accounts created on or after
2026-08-31 and opt-in on older accounts through
`thinking.block_binding.prefix_mismatch_behavior`. llame is not append-only —
compaction rewrites the prefix, and it can do so mid-run — so every request
that carries adaptive thinking sets
`thinking.blockBinding.prefixMismatchBehavior: 'drop_block'` through the
adapter (which adds the beta header). The binding is llame's: it is a
reserved key under D5, stripped from the operator's object whatever value or
thinking type accompanies it, so an operator can neither set it to `error`,
remove it, nor smuggle the adapter's type-less shape in through
`providerOptions` on an entry without `reasoning`. Two ceilings bound it.
The adapter's `thinking` union has no `blockBinding` on its `enabled` and
`disabled` branches and strips it silently (Anthropic itself accepts
`block_binding` with `enabled`), so an operator who overrides `thinking` to a
manual budget or to disabled gives up the instruction. And the adapter's
standalone `{ blockBinding }` shape, which the first review round proposed for
entries that declare no `reasoning`, is not used: Anthropic documents
`block_binding` "alongside `thinking.type: "adaptive"` and `thinking.type:
"enabled"`" only, its API reference models `thinking` as a tagged union whose
every variant requires `type`, and neither OMP nor OpenClaw sends a type-less
thinking object, so relying on it would risk a 400 on every request of every
entry without `reasoning`. An entry that declares no `reasoning` therefore
sends no thinking configuration at all and carries no instruction, and the
documentation says so together with the consequence — a prefix rewrite can
then be rejected under the account's default enforcement on a model that
thinks by default — and the remedy, declaring `reasoning` for such a model.
The messages layer proves the wire body for the adaptive, adaptive-without-
display, manual-budget, and no-configuration cases, not the composed options
object. Rationale: a compaction must never convert a working chat into a
failed run, and the behavior must not depend on when the operator's account
was created or on a catalog edit; where the adapter or the provider cannot
express the instruction, the honest contract is a documented ceiling rather
than a promise. Rejected: inheriting the account default; llame-side pruning;
surfacing the 400 as a normal run failure; letting `providerOptions` override
it on the adaptive shape; rewriting the request body around the adapter to
inject the field (llame-authored wire handling the shipped decisions reject);
refusing manual-budget overrides outright (removes the only thinking path for
budget-only models); sending adaptive thinking on entries without `reasoning`
to carry the instruction (a 400 on every budget-only model).

### D11: Effort maps onto the provider's `effort` option; adaptive thinking is the default

llame's `effort` is one opaque token gated by `resolveEffortSelection`, which
throws `EffortNotAvailableError` (422) when a model declares no `reasoning`
config and otherwise resolves the requested level or the entry's default. The
client forwards the token as `providerOptions.anthropic.effort`, the way the
OpenAI clients forward `reasoningEffort`, with one difference the OpenAI
adapters do not have: the Anthropic option is a closed enumeration
(`low`, `medium`, `high`, `xhigh`, `max`), so a declared level outside it
throws `InvalidArgumentError` at the adapter before any call — a gateway whose
vocabulary is not Anthropic's cannot be driven through this option, which is
the shipped "misdeclared level surfaces at request time" rule and is
documented. The adapter emits the option as `output_config.effort`, generally
available with no beta header on Opus 4.5 and later, Sonnet 4.6 and later, and
Fable and Mythos 5.x. Because an entry that declares `reasoning` always
resolves an effort, the run's token always outranks an operator `effort` key
there; on an entry without `reasoning` the run resolves none, the client's
default is "no effort", and an operator `effort` in `providerOptions` is
forwarded like any other default override. When the entry declares
`reasoning`, the client defaults `thinking` to `{ type: 'adaptive', display:
'summarized' }`; when it does not, the client sends no thinking configuration
at all. Rationale: on Opus 4.7+, Sonnet 5, and Fable and Mythos 5.x
`thinking.type: "enabled"` is a 400, `budget_tokens` is deprecated on the 4.6
generation, and depth is controlled by effort — the shape Claude Code and OMP
both send. `display` must be requested because those models default to
`omitted`, which hides reasoning from the owner while still billing it; Claude
Code makes the same opt-in through `showThinkingSummaries`. The operator's
`reasoning` declaration is the switch, mirroring Claude Code's setting: a
model without one runs on its own default (Opus 5, Sonnet 5, and Fable and
Mythos 5.x think regardless; Opus 4.7, 4.8, 4.6, Sonnet 4.6, and every
budget-only model do not) and, per D10, carries no drop instruction, so an
operator running a model that thinks by default should declare `reasoning`.

The thinking default is an object-valued default under D5, so an operator's
`thinking` merges into it key by key: `{ "thinking": { "display": null } }`
removes the display default and keeps adaptive thinking and the drop
instruction; `{ "thinking": { "type": "enabled", "budgetTokens": N } }`
replaces the type and, per D10, gives up the drop instruction. When thinking is
disabled on a model the adapter knows rejects top efforts without thinking, the
adapter lowers `xhigh`/`max` to `high` and warns; the client surfaces the
warning and neither retries nor rewrites the catalog.

Ceilings, recorded rather than tabled: OMP gates `display` per model after
observing 400s on the 4.6 generation, while Anthropic's current documentation
lists no rejection; an operator on Opus 4.6 or Sonnet 4.6 removes the display
default with `{ "thinking": { "display": null } }` if the live proof or their
own run confirms it. Budget-only models (Sonnet 4.5, Opus 4.5, Haiku 4.5 and
older) get no llame-authored thinking; an operator who needs it declares the
manual-budget shape per model, without a llame table or an invented budget,
accepting the D10 ceiling and that forced tool use is rejected under manual
thinking (D12). Rejected: mapping the token onto `thinking` as first drafted
(the deprecated lever, and it never said how a token becomes a budget); a
llame-owned `low`/`medium`/`high` scale; a per-model mode field; always
sending adaptive regardless of the declaration (400s every budget-only model
on every request); treating an operator `thinking` as a whole-value
replacement, which the previous revision's recipe
(`{ "thinking": { "type": "adaptive" } }` to drop the display) assumed —
under the merge actually specified that recipe keeps the display default, so
the recipe, not the merge, was wrong.

### D12: Structured output uses the adapter's JSON response format

Issue #208 asked whether the forced-tool-choice mechanism
`generateToolBoundObject` depends on exists for Anthropic, "or design a
fallback". The mechanism exists in the adapter but the current flagship rejects
it: `tool_choice` `any` and `tool` return a 400 on Fable 5.1 and Mythos 5.1, so
every chat title on that model would pay a rejected call and a warning line
before `title.service.ts:113-142` falls back to free text. The Messages client
therefore implements `generateObject` through the AI SDK's JSON response
format, and the adapter's `structuredOutputMode: 'auto'` decides the
mechanism from its own capability table: `output_config.format` on the ids it
marks as supporting native structured output (Fable and Mythos 5.x, Sonnet 5,
4.6, 4.5, Opus 5, 4.8, 4.7, 4.6, 4.5, 4.1, Haiku 4.5, and any unrecognized
`claude-` id — a table that diverges from Anthropic's list on Opus 4.1) and
its own `json` tool with a required tool choice on the rest, which includes
the Sonnet 4, Opus 4, and Claude 3 generations and every model id that does
not contain `claude-`, so a gateway-served `glm-5` or `kimi-k3` takes the
JSON-tool path. llame authors no tool choice itself; the adapter's forced
choice on that path is the adapter's, and it fails on a model or a manual
thinking shape that rejects forced tool use, falling through to the caller's
existing plain-text fallback. No llame-side fallback is designed. The
`ModelClient.generateObject` doc comment, which describes the forced tool
call, becomes a description of the OpenAI clients only and is edited in the
messages layer. Rejected: the forced tool choice as first drafted; forcing
`structuredOutputMode: 'outputFormat'` (turns the gateway and older-model
cases from a working JSON tool into a guaranteed rejection); a prompt-injected
schema or text-parsing fallback; promising "no required tool choice ever",
which the adapter's own path contradicts.

### D13: An empty reasoning segment renders no panel

On Opus 5, Sonnet 5, and Fable and Mythos 5.x a model without a declared
`reasoning` still thinks with `display` omitted, so a response that carries a
thinking block carries it with empty text and a signature that must persist
and replay (D9); an adaptive turn that skips thinking carries none. (Opus 4.7
and 4.8 default `display` to omitted too, but think only once adaptive
thinking is requested.) `chat-message-row.tsx` groups consecutive reasoning
parts into one Thinking panel with no text guard, so the owner would see empty
panels. The renderer skips a segment whose grouped text is empty; persistence,
replay, export, and search are unchanged. This is a one-line web change and a
`reasoning-output` UI-requirement delta. Rejected: dropping the parts (the
signature is needed); always requesting `summarized` regardless of declaration
(see D11); rendering the empty panel.

### D14: Failure boundaries are request-time, bounded, and sanitized

Authentication failures, invalid or unknown models, rate limits, and rejected
request options fail the affected request under the existing run contract,
keeping already-recorded parts and tool effects and never substituting another
provider, credential, or type. Diagnostics follow the existing sanitization
contract. The unknown-option rule follows the adapters' real behavior (D5): a
recognized-but-invalid value fails the request; an unrecognized key is the
adapter's to drop or forward and never causes llame to rewrite or retarget.
Rejected: boot probes or credential prevalidation; automatic retry against
another provider; echoing an upstream error body; promising that an unknown key
"fails explicitly", which the OpenAI and Anthropic adapters do not do.

### D15: Spec placement

`provider-api-selection` owns wire selection for every wire-named type, so it
gains the Messages clause and two scenarios, plus a new requirement for the
`providerOptions` forwarding and precedence rule, the reserved keys, and the
`maxOutputTokens` forwarding, because those rules are request behavior shared
by every type. Its shipped structured-generation sentence and scenario are
reworded from "forced-tool structured generation" to each wire's own mechanism,
with the OpenAI wires keeping the forced tool choice, because D12 makes the
Messages wire's mechanism a different one. `instance-config` owns configuration
shape, so its provider-list requirement gains the type, the variant, and the
embedding exclusion, and its model-catalog requirement gains the
`providerOptions` field with its boot rules, the optional `maxOutputTokens`,
and the optional `pricingUsdPer1M.cacheWrite` rate; both reproduce master's
text and every shipped scenario. The embedding-catalog requirement is not
restated: its allowlist ("`openai-responses` or `openai-completions`") already
excludes the new type, so the exclusion is stated once on the provider-list
side and left to the allowlist on the embedding side. The published price
shape needs no `available-models` delta either: no shipped requirement
enumerates the `pricingUsdPer1M` sub-fields, and its "Pricing units are
explicit" scenario fixes only the units, so an added optional `cacheWrite`
key changes no stated contract. `available-models`'
dispatch requirement is restated because its wire sentence named "the OpenAI
wire types" and its endpoint clause listed every type. `reasoning-output`'s
UI requirement is restated for D13 with its shipped bullets intact. The new
`anthropic-messages-provider` capability keeps only what the Messages wire
adds: thinking persistence and replay with the drop invariant, the caching
default, cache-write cost, the effort and thinking defaults, structured output,
and Messages-specific failure boundaries. Its first draft also restated
destination selection, the operator-owned posture, credential non-disclosure,
a host-acceptance sentence, and the generic provider-option failure scenarios;
those are dropped because `provider-api-selection` and `instance-config` own
them for every type, and two owners of one contract is what the shipped D12
rejected. Rejected: a fourth spec file for one catalog field; a vendor-named
capability that repeats generic contracts; a `subscription-access-openai-codex`
delta (its summary mandate is honored by keeping `reasoningSummary: 'auto'` a
codex invariant instead).

### D16: Three delivery layers, with #208 closed by the messages layer

The provider-options layer owns the catalog field, its loader rules, the
composition helper, and the refactor of the three existing clients onto it,
with request fixtures proving precedence — reviewable alone and merged first.
The messages layer owns the Anthropic type end to end (streaming, tools,
thinking, caching, cost, structured output, failures, the renderer guard, the
live proof) and closes #208. The finalize layer syncs specs and archives.
Rationale: the first layer touches three shipped clients and should be reviewed
without the new adapter in the same diff; a separate OpenSpec change for it
would cost a second proposal round for a field this change creates the need
for. The compatible layer of the first draft is gone with its type; the
finalize-time delta rebase of the first draft is done here, in the proposal,
against merged text. Rejected: one combined implementation layer; a separate
change for the field.

### D17: The model output-token limit is a catalog field

The Messages API requires `max_tokens` on every request, and the adapter fills
it from its model-id table when the request carries no `maxOutputTokens`: 128k
for the current generations and for any unrecognized `claude-` id (Mythos ids
match no explicit row, so they take that branch with an "unknown model"
warning on every request that carries no limit), 64k or 32k for the 4.5 and
older 4.x rows, 4096 for the Claude 3 Haiku, Claude 2, and Claude Instant
rows, and 4096 for a model id that does not contain `claude-` — the
gateway-served `glm-5` or `kimi-k3` case D1 leans on — with thinking tokens
counted against it. llame passes no output limit today, because
`runs.maxOutputTokens` is an admission reserve, not a cap, and a provider
option cannot carry it (it is an AI SDK call setting, not a namespaced
option). So `models[].maxOutputTokens` becomes an optional positive-integer
catalog field, accepting a whole-value interpolation token like
`contextWindowTokens`, that every client forwards as the request's
`maxOutputTokens` setting, provider-neutral like `providerOptions`; absent,
each adapter's own default applies, which for the OpenAI wires means none.
What each adapter then puts on the wire is the adapter's: the Messages adapter
adds a manual thinking budget to it silently and lowers a value above a
ceiling it knows for a recognized model, warning only when the entry declared
the limit; the Responses adapter sends it as `max_output_tokens`;
`@ai-sdk/openai-compatible` sends it as `max_tokens` with no
`max_completion_tokens` remapping, so declaring it on an `openai-completions`
entry that fronts an OpenAI-hosted reasoning model is rejected by that model —
a documented ceiling, and the field is optional. The client surfaces the
adapter's warnings when they exist and the documentation records the silent
transformations. Rationale: the operator who
names a model is the one who knows its output ceiling, and a silent 4096 cap on
a gateway entry would contradict the one-type decision in practice. Rejected:
repurposing `runs.maxOutputTokens` as a cap (a semantic change to a shipped
instance setting); a llame model-family table; promising an exact wire value
the adapters do not guarantee; leaving the adapter default undocumented.

### D18: A metadata-only reasoning delivery under a new id starts a part

The shipped collector (`assistant-transcript.ts:106-152`) starts a reasoning
part only on a delivery with text; an empty delivery binds metadata to the
part its id names and otherwise binds nothing. A Messages thinking block with
`display: omitted` — the default on Opus 5, Sonnet 5, and Fable and Mythos
5.x, and therefore every entry without `reasoning` on those models — arrives as
`reasoning-start`, one `reasoning-delta` with an empty delta carrying the
signature, and `reasoning-end`; a redacted block carries its payload on
`reasoning-start` alone. The shipped collector drops both, persists no part,
and the next request inside a tool-use turn replays nothing where Anthropic
marks replay required. The rule is amended, in `reasoning-output`'s
part-identity requirement, by one clause: an empty delivery carrying provider
metadata under a defined id that no collected part carries starts a reasoning
part with empty text and binds the metadata to it; an empty delivery without
metadata, one naming a collected part, or one without an id behaves as before.

Three facts about the shipped pipeline shape the clause and are handled with
it. First, the Anthropic adapter ids reasoning parts by the response's
content-block index (`String(value.index)`), which restarts at zero on every
step of a tool loop, so two withheld-text blocks in consecutive steps would
both arrive as id `"0"` and the second would bind onto the first part's entry
in the collector's id map; the Messages client therefore scopes the adapter's
id to the provider invocation (the `start-step` boundary on `fullStream`), so
every id it hands to the collector is unique within the turn, and the id map
stays correct for the Responses adapter's already-unique `${itemId}:${index}`
ids. Second, the Responses adapter emits a metadata-bearing `reasoning-end`
for an item whose summary was empty — `summaryParts[0]` is registered on
`output_item.added` and concluded on `output_item.done` whether or not a delta
arrived — which the shipped client forwards as a metadata-only delivery under
an id no part carries and the shipped collector silently discards; under the
amended rule that item persists as an empty part and replays (an item
reference on a stored request, the encrypted item on a `store: false` codex
request), which is accepted: the shipped requirement "Reasoning parts carry
durable provider metadata" already promises that replay, the discard was a
gap, and the part renders no panel (D13). Third, the shipped Responses client
forwards metadata-only deliveries from a separate `tee()` of `fullStream`,
out of band with the `onChunk` deltas, and the run loop's metadata-only path
(`run-execution.service.ts:1197-1202`) flushes buffered reasoning but not
buffered text before recording; both were harmless while such a delivery could
not start a part and become ordering hazards once it can. So every client
delivers reasoning text and metadata in stream order from one `fullStream`
consumer — the Messages client from the start, the Responses client by moving
its reasoning forwarding off the tee — and the run loop flushes buffered text
before recording a part-starting metadata delivery, so the live collector and
the durable reconstructor agree on order. The live/reconnect bridge drops
metadata-only events today and keeps doing so: the empty part reaches the
browser only on reload and renders no panel either way, which the amended
requirement states as the one exception to "the same parts".

Rationale: the signature is the block, and D9 already requires it persisted;
the collector, the id scope, and the delivery order are the three places the
block can be lost or misplaced. Rejected: a Messages-only collector (two
identity rules for one part shape); qualifying the bind rule by "no intervening
non-reasoning part" instead of scoping ids (breaks the Responses late-end
binding that is correct today); synthesizing placeholder text (rewrites what
the provider produced and would render); replaying from run-scoped state
(dies with the run, the shape the sibling change amended away); emitting the
empty part on the live stream (the metadata must not reach the browser and
the part has nothing to show).

## Risks / Trade-offs

- [Gateways implement the Messages wire imperfectly] → failures surface at
  request time with bounded diagnostics; a gateway that rejects the cache
  control is fixed by removing the default per model (D7); one that rejects the
  thinking-binding beta header or field is unusable with adaptive thinking
  until the invariant is relaxed, which is recorded rather than worked around;
  the posture does not speculate.
- [A gateway model id is capped at 4096 output tokens by the adapter's table]
  → the operator declares `models[].maxOutputTokens` (D17); the documentation
  states the adapter default, the Messages adapter's budget addition and
  ceiling clamp, and the Chat Completions adapter's missing
  `max_completion_tokens` remap.
- [A gateway vocabulary is not Anthropic's five effort levels] → the Messages
  adapter's closed effort enum rejects any other token before the call (D11);
  documented, and the operator's remedy is to declare Anthropic's levels or
  none.
- [`display` is rejected on the 4.6 generation] → moderate-confidence risk from
  OMP's observation; the operator removes the default per model with
  `{ "thinking": { "display": null } }` (D11), and the live proof records what
  the API does today.
- [A misspelled `providerOptions` key is silently dropped] → the OpenAI and
  Anthropic adapters strip unknown keys; documented as a ceiling, and the
  request fixtures show the actual body so a proof never assumes.
- [A manual-budget or disabled thinking override, or an entry without
  `reasoning`, carries no drop instruction] → an adapter limitation for the
  override and a provider-documentation gap for the type-less shape (D10),
  each documented with its consequence and remedy; the wire fixtures for the
  adaptive, adaptive-without-display, manual-budget, and no-configuration
  cases make the absence visible rather than assumed, the live proof exercises
  an entry without `reasoning`, and an upstream fix to the adapter's
  `thinking` union would remove the override ceiling without a llame change.
- [Thinking signatures break continuations after a prefix rewrite] → the drop
  instruction is an invariant on every request that carries adaptive thinking
  (D10), block order and bytes are preserved, and both the within-turn and
  post-compaction paths carry fixture-covered scenarios.
- [Amending the shared collector rule for metadata-only deliveries changes
  the Responses and codex wires] → it does, deliberately: an empty-summary
  reasoning item now persists and replays instead of being discarded (D18),
  the part renders no panel, and the messages layer carries Responses
  fixtures for the empty-summary item (persisted, replayed as an item
  reference and as an encrypted item on codex) and for a summary-bearing item
  whose end-part metadata binds to the existing part without starting one.
- [Moving the Responses client's metadata forwarding onto the single
  `fullStream` consumer regresses summary delivery] → the deltas the client
  forwards are the same parts in the same order; the fixture asserts identical
  live-collector and durable-reconstructor part sequences for a multi-summary
  item, and the ordering race the tee allowed is closed rather than widened.
- [An ambient `ANTHROPIC_BASE_URL` moves requests off the configured endpoint]
  → the client always passes an explicit `baseURL` (D3), with a fixture that
  sets the variable and asserts the configured destination.
- [A model declares a wrong `cacheWrite` rate] → cost is only as right as the
  operator's declaration, exactly like `input`/`output`; absent rates fall back
  to input rather than to null, the uncached term excludes the tokens so
  nothing is charged twice, and persisted costs are never recomputed.
- [Refactoring three shipped clients onto the composition helper regresses an
  existing option] → the provider-options layer carries request fixtures for
  the Responses summary default, the codex `store` and summary invariants, the
  completions effort, the reserved keys, and the structured-generation path
  that must stay option-free, and merges before the new adapter lands.

## Migration Plan

Additive and configuration-only: existing entries and models are untouched,
existing clients send the same options they send today until an operator adds
`providerOptions`, and operators add an `anthropic-messages` provider and model
entries that reference it. No database migration. Rollback is removal of the
added entries plus a restart; historical runs keep their recorded model ids and
generated-time costs, and queued work naming a removed model follows the
existing unavailable-model contract. The changelog records the new type, the
catalog field, the cache-write cost visibility change, and the hidden empty
Thinking panel.

Because thinking blocks are persisted and replayed, a chat whose history
predates this change holds no signed blocks to replay, and the first Anthropic
turn on that chat starts persisting them. Nothing prunes or rewrites existing
history.

## Revision history

- v7 (2026-09-19): Round 4 of independent review (Codex CLI plus two
  reviewer agents), all on D18. Scoped the Messages client's reasoning part
  ids to the provider invocation, since the adapter numbers blocks per
  response and a tool turn's second withheld-text block would have bound onto
  the first part; accepted that the Responses adapter's empty-summary
  reasoning item now persists and replays instead of being discarded, and
  named it; required every client to deliver reasoning text and metadata in
  stream order from one `fullStream` consumer (the Responses client leaves its
  tee) and the run loop to flush buffered text before a part-starting
  metadata delivery; stated the live/reconnect bridge exception in the
  requirement; conditioned the clause on a defined id so the shipped absent-id
  scenario keeps precedence. Corrected the `openaiCompletions` rationale (the
  adapter reads both the hyphenated and camel-case names) and qualified the
  proposal's replay bullet with the retained-context scope. Rejected:
  qualifying the bind rule by "no intervening non-reasoning part" (breaks the
  Responses late-end binding that is correct today).
- v6 (2026-09-19): PR #885 review round (Codex; CodeRabbit approved without
  findings). Scoped cross-turn replay to the retained model context, since the
  shipped context contract replaces a compacted prefix with its replacement
  history and the unconditional "replays everything it holds" would have
  required resending superseded blocks against a rewritten prefix; added the
  compacted-prefix scenario. Bounded the two cache counts before the cost
  subtraction the way cached input already is, so inconsistent third-party
  usage cannot drive the uncached term or `costUsd` below zero; added the
  scenario and its cost assertion. No decision changed.
- v5 (2026-09-19): Round 3 of independent review (Codex CLI plus one
  reviewer agent). Found the shipped reasoning collector drops a
  withheld-text thinking block outright (empty delivery under a new id binds
  nothing), so added D18 and a `reasoning-output` part-identity delta with an
  owning task and Impact entry. Made the thinking block binding a reserved key
  rather than an invariant the operator could still smuggle in as the type-less
  shape (D5, D10, capability). Corrected the completions client's namespace to
  `openaiCompletions`, since the adapter forwards unknown keys only from the
  configured provider name's namespaces (D5, task 2.3). Reserved the Responses
  `allowedTools` override, which discards the forced tool choice structured
  generation relies on, and made the raw output-limit field unconditionally
  reserved. Corrected D8's claim that the OpenAI wires report no cache-write
  count (their adapters map `cache_write_tokens`; the input-rate fallback is
  what keeps cost identical), the Context copy of the adapter's `max_tokens`
  table, and D17's warning claim (the budget addition is silent; the clamp
  warns only for a declared limit on a recognized model). Gave the tasks
  concrete non-`claude-` and unrecognized-`claude-` fixtures.
- v4 (2026-09-19): Round 2 of independent review (Codex CLI plus two
  reviewer agents). Dropped the adapter's type-less `{ blockBinding }` shape
  from D10 after finding Anthropic documents `block_binding` only alongside
  adaptive and manual thinking and neither reference harness sends it, so an
  entry without `reasoning` sends no thinking configuration and carries no
  drop instruction, with the remedy documented; scoped the prefix-rewrite
  scenarios to requests carrying adaptive thinking. Added `systemMessageMode`
  (its `remove` value strips the system prompt), `container`, and the Chat
  Completions `max_tokens` field to the reserved keys, named the codex client
  as reserving the Responses keys, and made the precedence requirement state
  that an invariant holds in the composed options with the owning capability
  naming any adapter ceiling. Made the Messages client pass an explicit
  `baseURL` because the adapter reads `ANTHROPIC_BASE_URL` when it is omitted
  (D3). Redefined `maxOutputTokens` as the request's `maxOutputTokens`
  setting rather than an exact wire value, recorded the Messages adapter's
  budget addition and ceiling clamp, the Chat Completions adapter's missing
  `max_completion_tokens` remap, the adapter table's real rows (Mythos ids
  unrecognized; Claude 3 Haiku and older at 4096), and made the field accept a
  whole-value interpolation token like `contextWindowTokens` (D17). Recorded
  the Messages adapter's closed five-value effort enum (D11), the telemetry
  log line and web usage panel that enumerate usage fields (D8), the
  closed-schema clause for the free-form `providerOptions` subtree, why the
  published price shape needs no `available-models` delta (D15), and the
  rewording of the shipped unsupported-type example. Narrowed the
  structured-output rationale to Fable 5.1, Mythos 5.1, and manual thinking;
  corrected D11's reversed merge-versus-replacement sentence; and gave the
  Messages reserved keys, invariants, and `cacheWrite` boot validation owning
  tasks. No decision reversed; D10's no-configuration case narrowed.
- v3 (2026-09-19): Round 1 of independent review (Codex CLI plus two
  reviewer agents). Bounded the drop-on-prefix-mismatch invariant to the
  thinking shapes the pinned adapter can carry it on, since its `thinking`
  union strips `blockBinding` from the `enabled` and `disabled` branches (D10),
  and made the adapter's reasoning-replay switch an invariant. Added reserved
  keys to the precedence rule — Responses `conversation`,
  `previousResponseId`, and `instructions`, Chat Completions `model`, Messages
  `fallbacks` and `mcpServers` — because the adapters forward them and each
  would retarget a request, attach it to state shared across Chats and
  owners, or replace llame's prompt (D5). Kept `reasoningSummary: 'auto'` a
  codex invariant because `subscription-access-openai-codex` mandates it, made
  client defaults per request kind so the option-free structured-generation
  path stays option-free, and made `null` recursive with the display recipe
  corrected to `{ "thinking": { "display": null } }` (D5, D11). Scoped the
  structured-output promise to llame-authored tool choices, since the
  adapter's own JSON-tool path uses a required choice on models its table
  marks as unsupported, including every non-`claude-` gateway id, and noted
  the table's divergence from Anthropic's list and the manual-thinking
  rejection (D12). Fixed the cache-write cost formula to subtract the tokens
  from the uncached term so they are priced once (D8), and corrected the
  claim that `TurnTelemetry` already carried them. Added
  `models[].maxOutputTokens` (D17) after finding the adapter's 4096 default
  for unrecognized model ids. Corrected the set of models that think without
  configuration (D11, D13), the predecessor PR list, two stale code
  references, and the effort-clamp behavior; stated what an operator `effort`
  key does; restored the shipped hoisting bullet in the `reasoning-output`
  delta; removed the duplicated host-acceptance sentence and failure
  scenarios; recorded the embedding-side allowlist as intentional; made the
  #754 rationale neutral between its issue text and the OMP/OpenClaw shape;
  reworded the keyless task; and gave the gateway-tolerance and
  invalid-option scenarios owning tasks. Rejected with evidence: forcing
  `structuredOutputMode: 'outputFormat'` (turns the gateway and older-model
  cases into guaranteed rejections); a `subscription-access-openai-codex`
  delta (the invariant satisfies it); a MODIFIED embedding-catalog block (its
  allowlist already excludes the type).
- v2 (2026-09-19): Owner review round. Collapsed the two Anthropic types into
  one wire-named `anthropic-messages` type; added the per-model
  `providerOptions` channel every client composes under one precedence; routed
  structured output through the adapter's JSON response format after finding
  that Fable 5.1 rejects forced tool use; mapped effort onto the provider's
  `effort` option with adaptive thinking and summarized display as the
  default; made the cache control a removable default; hid a Thinking panel
  with no text; rebased the `instance-config` delta onto the merged wire-type
  vocabulary with its two added scenarios; withdrew the lockfile convergence
  claim; and set the delivery stack to proposal, provider-options, messages,
  finalize.
- v1 (2026-09-17): Initial proposal: `anthropic` and `anthropic-compatible`
  types, forced-tool structured output, effort mapped onto the thinking
  option, a mandatory request-level cache control, and a native, compatible,
  finalize delivery stack written against the pre-merge `openai` /
  `openai-compatible` vocabulary.
