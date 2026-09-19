## Context

See [proposal.md](proposal.md) for motivation and scope; the delta specs under
`specs/` are the behavior contract this design implements.

On master after `openai-compatible-provider` (#883, #886, #890), `providers[]`
is discriminated by `type` and the schema's `$defs.providerType` enum is
strict-closed to `["openai-responses", "openai-completions", "openai-codex"]`,
each named after the wire it speaks; its description still calls Anthropic a
follow-up. `llame-config.ts` normalizes entries into
`OpenAIProviderConfig { id, type: 'openai-responses', key, baseUrl | null }`,
`OpenAICompletionsProviderConfig { id, type, key, baseUrl }`, and
`OpenAICodexProviderConfig { id, type, key, accountId }`, with `key: null`
meaning keyless. `model-client-factory.ts` switches on `provider.type` and its
`default` branch is a `never` exhaustiveness guard. Each type owns a client
module; the Responses and Codex clients share `openai-model-client.ts`, whose
`applyReasoningOptions` (`:248-256`) hardcodes
`providerOptions.openai = { reasoningSummary: 'auto', reasoningEffort, store }`,
and `openai-completions-model-client.ts:76-80` hardcodes
`providerOptions.openaiCompatible = { reasoningEffort }`. No catalog field
reaches those objects.

The catalog's `reasoning` object (`model-catalog.ts:33-57`) declares an ordered
list of opaque provider-native effort tokens with a default; the run's resolved
token is forwarded verbatim by each client. The shipped decision is explicit:
"OpenAI and Anthropic disagree on the value set and both change it between
releases, so constraining the strings here … would make every provider release
a llame release."

Cost flows from the catalog entry through `toTokenPrice(model.pricingUsdPer1M)`
to `ModelClient.pricing`, and `calculateCostUsd` in
`apps/api/src/chats/turn-telemetry.ts:131-153` prices only
`uncachedInput × input + cachedInput × (cachedInput ?? input) + output × output`.
llame's usage telemetry already carries `inputTokenDetails.cacheWriteTokens`,
and `LanguageModelV3Usage.inputTokens.cacheWrite` exists on the provider
interface; neither is priced.

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
`https://api.anthropic.com/v1`), `apiKey` (sent as `x-api-key`), `authToken`
(sent as `Authorization: Bearer`), and `headers`; request-level
`providerOptions.anthropic.cacheControl` is emitted as a top-level
`cache_control` body field; `effort` is emitted as `output_config.effort`
independently of `thinking`; `thinking` accepts `{ type: 'adaptive', display?,
blockBinding? }`, `{ type: 'enabled', budgetTokens? }`, `{ type: 'disabled' }`,
or `{ blockBinding }` alone, with the `thinking-binding-controls-2026-08-01`
beta added automatically; `structuredOutputMode` defaults to `auto`, which
emits `output_config.format` for a JSON response format on models its
capability table marks as supporting structured output and otherwise adds a
`json` tool with a required tool choice; reasoning replay reads
`providerOptions.anthropic.{signature, redactedData}` on reasoning parts and
warns on anything else; the signature of a streamed thinking block arrives on a
`reasoning-delta` part with an empty delta. Its language-model option schema is
a non-strict zod object, as is `@ai-sdk/openai@3.0.97`'s, so unknown keys are
dropped and invalid values throw; `@ai-sdk/openai-compatible@2.0.75` instead
spreads unknown keys of its namespace into the request body.

Anthropic's documentation, read 2026-09-19: `tool_choice` `any` and `tool`
return a 400 on Claude Fable 5.1 and Mythos 5.1; `thinking.type: "enabled"`
returns a 400 on Opus 4.7, 4.8, 5, Sonnet 5, and Fable and Mythos 5.x, and
`budget_tokens` is deprecated on Opus 4.6 and Sonnet 4.6, with depth controlled
by `output_config.effort` ("no beta header required"); `display` defaults to
`"omitted"` on Opus 4.7 and later, Sonnet 5, and Fable and Mythos 5.x, returning
thinking blocks with an empty `thinking` field whose `signature` "still carries
the encrypted full thinking for multi-turn continuity"; automatic caching is
"a single `cache_control` field at the top level of your request body"; the
prefix check "is enforced by default for accounts created on or after August
31, 2026" and otherwise only on requests that set
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
enum so the shipped unsupported-type example stays true. The subscription path
(#754) will be a sibling type with its own credential shape, fixed endpoint, and
request fingerprint, the way `openai-codex` sits beside `openai-responses`;
`anthropic-messages` beside a product-named sibling reads the same way.
Rejected: `anthropic` plus `anthropic-compatible` (as first drafted); a bare
`anthropic` (vendor name on gateway entries, ambiguous next to the subscription
sibling); inferring a gateway from the host.

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
set. The credential is sent as `x-api-key`. Rejected: requiring `key` (breaks
keyless gateways); a bearer-token option (`authToken` exists in the adapter and
some gateways want it, but no configured target needs it and the field is
additive later); separate field names for the compatible case, which no longer
exists.

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
invariants (codex `store: false`; the Anthropic drop-on-prefix-mismatch
instruction), the run's resolved effort in the adapter's effort option, the
operator's object, and the client's defaults (`reasoningSummary: 'auto'` on the
Responses wire; adaptive thinking with summarized display and the top-level
cache control on the Messages wire). Object-valued options merge key by key;
`null` removes a client default and cannot remove an invariant. Boot validates
"is an object" and rejects interpolation syntax inside it, so the object can
never carry a credential; it is never published. The adapter is the validator:
an invalid value for a known option throws `InvalidArgumentError` at request
time, an unknown key is dropped by the OpenAI and Anthropic adapters and
forwarded by `openai-compatible`, and llame never rewrites or retargets a
request because of either.

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

### D8: Cache-write pricing is an optional additive field, consumed in cost

Add `cacheWrite` to `ModelPricingUsdPer1M` (today `{ input, cachedInput, output
}`), carry it through `toTokenPrice`, and price provider-reported
cache-creation tokens at that rate, falling back to the entry's `input` rate
when absent — the same fallback shape as `cachedInput`. The adapter populates
the count from `cache_creation_input_tokens`, a real field that is billed and
is the largest line on a cached turn; llame's usage shape already carries
`cacheWriteTokens`, so the work is persisting and pricing it. The public model
DTO mirrors the field so the published price stays inspectable. Rejected: a
required field; deriving a write rate as a fixed multiple of input; exposing it
server-only.

### D9: Signatures are durable per-part metadata and are replayed unmodified

The client surfaces thinking and redacted thinking as reasoning parts through
the existing normalized-reasoning path, persists each block's signature (and
redacted payload) as opaque provider metadata on that part through the channel
`reasoning-output` defines, and replays the blocks on later requests for the
same chat. Anthropic's tiers, verbatim: "**Required:** within a tool-use turn,
pass thinking blocks back. **Recommended:** across turns, pass everything back.
**Allowed:** outside tool use, omit prior turns' thinking." llame follows the
recommendation and does not prune, because "the API automatically filters them,
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
and end parts, so the collector reads metadata from deltas; the adapter reads
only `providerOptions.anthropic.{signature, redactedData}` on replay and warns
on anything else, so metadata another wire attached to a part is skipped, not
sent. Rejected: run-scoped state that dies with the run; llame-side pruning;
coercing or stripping a signed block on a model switch; dropping empty-text
parts (they carry the signature).

### D10: Prefix binding is handled by an explicit drop instruction, as an invariant

Anthropic's rule, verbatim: a block "stays valid only while the top-level
`system` prompt, the `tools`, and the messages before it are unchanged. If any
of them changes, that block and every later thinking block are invalid, and the
API rejects the request with a 400 error or drops the invalid blocks, whichever
you choose." Enforcement is default-on for accounts created on or after
2026-08-31 and opt-in on older accounts through
`thinking.block_binding.prefix_mismatch_behavior`. llame is not append-only —
compaction rewrites the prefix, and it can do so mid-run — so every request
sets `thinking.blockBinding.prefixMismatchBehavior: 'drop_block'` through the
adapter (which adds the beta header), sent alone when no thinking mode is
configured. It is a D5 invariant: an operator cannot set it to `error` or
remove it. Rationale: a compaction must never convert a working chat into a
failed run, and the behavior must not depend on when the operator's account was
created or on a catalog edit. Rejected: inheriting the account default;
llame-side pruning; surfacing the 400 as a normal run failure; letting
`providerOptions` override it.

### D11: Effort maps onto the provider's `effort` option; adaptive thinking is the default

llame's `effort` is one opaque token gated by `resolveEffortSelection`, which
throws `EffortNotAvailableError` (422) when a model declares no `reasoning`
config. The client forwards the token as `providerOptions.anthropic.effort`,
the same shape the OpenAI clients use for `reasoningEffort`; the adapter emits
it as `output_config.effort`, which is generally available with no beta header
on Opus 4.5 and later, Sonnet 4.6 and later, and Fable and Mythos 5.x. When the
entry declares `reasoning`, the client defaults `thinking` to `{ type:
'adaptive', display: 'summarized' }`; when it does not, the client sends no
thinking mode and no effort. Rationale: on Opus 4.7+, Sonnet 5, and Fable and
Mythos 5.x `thinking.type: "enabled"` is a 400, `budget_tokens` is deprecated on
the 4.6 generation, and depth is controlled by effort — the shape Claude Code and
OMP both send. `display` must be requested because those models default to
`omitted`, which hides reasoning from the owner while still billing it; Claude
Code makes the same opt-in through `showThinkingSummaries`. The operator's
`reasoning` declaration is the switch, mirroring Claude Code's setting: a model
without one runs on its own default (Fable thinks regardless; Sonnet 4.5 does
not) and the drop invariant still rides along.

Ceilings, recorded rather than tabled: OMP gates `display` per model after
observing 400s on the 4.6 generation, while Anthropic's current documentation
lists no rejection; an operator on Opus 4.6 or Sonnet 4.6 removes the display
default through `providerOptions` (`{ "thinking": { "type": "adaptive" } }`)
if the live proof or their own run confirms it. Budget-only models (Sonnet 4.5,
Opus 4.5, Haiku 4.5 and older) get no llame-authored thinking; an operator who
needs it declares `{ "thinking": { "type": "enabled", "budgetTokens": N } }`
per model, without a llame table or an invented budget. Rejected: mapping the
token onto `thinking` as first drafted (the deprecated lever, and it never said
how a token becomes a budget); a llame-owned `low`/`medium`/`high` scale; a
per-model mode field; always sending adaptive regardless of the declaration
(400s every budget-only model on every request).

### D12: Structured output uses the adapter's JSON response format

Issue #208 asked whether the forced-tool-choice mechanism
`generateToolBoundObject` depends on exists for Anthropic, "or design a
fallback". The mechanism exists in the adapter but the current flagship rejects
it: `tool_choice` `any` and `tool` return a 400 on Fable 5.1 and Mythos 5.1, so
every chat title on that model would pay a rejected call and a warning line
before `title.service.ts:113-142` falls back to free text. The Messages client
therefore implements `generateObject` through the AI SDK's JSON response
format, and the adapter's `structuredOutputMode: 'auto'` emits
`output_config.format` on models with native structured output (Fable and
Mythos 5.x, Sonnet 5, 4.6, 4.5, Opus 5, 4.8, 4.7, 4.6, 4.5, Haiku 4.5) and its
own `json` tool with a required tool choice on older models, where forced tool
use still works. No llame-side fallback is designed; the caller's existing
plain-text fallback is unchanged. The `ModelClient.generateObject` doc comment,
which describes the forced tool call, becomes a description of the OpenAI
clients only and is edited in the messages layer. Rejected: the forced tool
choice as first drafted; a prompt-injected schema or text-parsing fallback.

### D13: An empty reasoning segment renders no panel

On Opus 4.7 and later, Sonnet 5, and Fable and Mythos 5.x a model without a
declared `reasoning` still thinks with `display` omitted, so every response
carries signed thinking blocks with empty text that must persist and replay
(D9). `chat-message-row.tsx` groups consecutive reasoning parts into one
Thinking panel with no text guard, so the owner would see empty panels. The
renderer skips a segment whose grouped text is empty; persistence, replay,
export, and search are unchanged. This is a one-line web change and a
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
`providerOptions` forwarding and precedence rule, because that rule is request
behavior shared by every type. `instance-config` owns configuration shape, so
its provider-list requirement gains the type, the variant, and the embedding
exclusion, and its model-catalog requirement gains the `providerOptions` field
and its boot rules; both reproduce master's text and every shipped scenario.
`available-models`' dispatch requirement is restated because its wire sentence
named "the OpenAI wire types" and its endpoint clause listed every type.
`reasoning-output`'s UI requirement is restated for D13. The new
`anthropic-messages-provider` capability keeps only what the Messages wire
adds: thinking persistence and replay with the drop invariant, the caching
default, cache-write cost, the effort and thinking defaults, structured output,
and failure boundaries. Its first draft also restated destination selection,
the operator-owned posture, and credential non-disclosure; those are dropped
because `provider-api-selection` and `instance-config` already own them for
every type, and two owners of one contract is what the shipped D12 rejected.
Rejected: a fourth spec file for one catalog field; a vendor-named capability
that repeats generic contracts.

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

## Risks / Trade-offs

- [Gateways implement the Messages wire imperfectly] → failures surface at
  request time with bounded diagnostics; a gateway that rejects the cache
  control is fixed by removing the default per model (D7); the posture does not
  speculate.
- [`display` is rejected on the 4.6 generation] → moderate-confidence risk from
  OMP's observation; the operator removes the default per model (D11), and the
  live proof records what the API does today.
- [A misspelled `providerOptions` key is silently dropped] → the OpenAI and
  Anthropic adapters strip unknown keys; documented as a ceiling, and the
  request fixtures show the actual body so a proof never assumes.
- [Thinking signatures break continuations after a prefix rewrite] → the drop
  instruction is an invariant on every request (D10), block order and bytes are
  preserved, and both the within-turn and post-compaction paths carry
  fixture-covered scenarios.
- [A model declares a wrong `cacheWrite` rate] → cost is only as right as the
  operator's declaration, exactly like `input`/`output`; absent rates fall back
  to input rather than to null, and persisted costs are never recomputed.
- [Refactoring three shipped clients onto the composition helper regresses an
  existing option] → the provider-options layer carries request fixtures for
  the Responses summary default, the codex `store` invariant, and the
  completions effort, and merges before the new adapter lands.

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
