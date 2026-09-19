## Why

llame can execute OpenAI-family models but cannot reach Anthropic at all:
`providers[].type` is a strict-closed enum of `openai-responses`,
`openai-completions`, and `openai-codex`, so an operator holding usage-billed
Anthropic API credentials has no supported path to Claude models. This change
implements issue #208 as the provider change that follows the shipped
`openai-compatible-provider` change, and unblocks the Claude subscription lane
(#754): API-credential access must be proven before subscription execution is
designed.

The Messages wire also exposes the second gap. Its request options that decide
whether reasoning is visible at all (thinking mode, display) are per model and
undocumented in places, while llame's clients hardcode their provider-native
options (`reasoningSummary: 'auto'`, codex `store: false`) with no operator
channel. Adding an Anthropic-only configuration field would fragment the
catalog per provider, so this change adds one channel for every provider
instead.

## What Changes

- Add one provider type, `anthropic-messages`: the Anthropic Messages wire
  through `@ai-sdk/anthropic@3.0.118`, with `baseUrl` optional and defaulting to
  the Anthropic API. A proxy, gateway, or third-party server that speaks the
  Messages wire is a `baseUrl`, not a second type, exactly as `openai-responses`
  already treats non-OpenAI Responses servers. The type is named after the
  wire, like the two OpenAI types, because the same entry serves non-Anthropic
  endpoints. The provider `type` alone selects the client: no inference from
  `id`, `baseUrl`, or host.
- Add `models[].providerOptions`: a server-only, operator-authored object of
  provider-native request options, forwarded verbatim into the adapter
  namespace the entry's provider `type` selects, under one precedence for every
  client — client invariants, then the run's effort, then the operator's
  options, then client defaults; `null` removes a default. The three existing
  clients are refactored onto it, which turns `reasoningSummary: 'auto'` into
  an overridable default and keeps codex's `store: false` as an invariant. Boot
  validates only that it is an object and rejects interpolation syntax inside
  it; keys and values are the provider's vocabulary and are never validated or
  published.
- Extend the provider configuration contract and the `type`-dispatch client
  factory, and add one Anthropic model client implementing the existing
  `ModelClient` seam (`streamText`/`generateObject`, context window, pricing,
  compaction threshold).
- Thinking output: persist thinking and redacted-thinking blocks as reasoning
  parts carrying the block's signature (and redacted payload) as opaque provider
  metadata through the per-part channel `reasoning-output` now defines, replay
  them complete and unmodified on later requests for the same chat, including
  after a model switch, and never prune them llame-side. Every request carries
  the provider's drop-on-prefix-mismatch instruction as a client invariant, so a
  compaction or prompt-receipt change never turns a replay into a rejected run.
  A block whose text the provider withheld persists with its signature; the web
  renderer draws no Thinking panel for a segment without text.
- Reasoning effort: forward the operator-declared effort token as the
  adapter's `effort` option, the same shape the OpenAI clients use for
  `reasoningEffort`. When a model declares a `reasoning` vocabulary, the client
  defaults thinking to adaptive with summarized display; otherwise it sends no
  thinking mode. Both are defaults an operator can replace through
  `providerOptions`. No llame-owned level vocabulary, thinking budget, or
  model-family table.
- Request-level prompt caching as a client default: the top-level ephemeral
  `cache_control` (Anthropic's automatic caching) with the provider's 5-minute
  lifetime, replaceable or removable per model through `providerOptions`. llame
  authors no block-level breakpoints.
- Cost accounting: add an optional `cacheWrite` rate to `pricingUsdPer1M` and
  consume it in cost computation, because the adapter reports a real
  cache-creation count that is billed and is the largest line on a cached turn.
  The field is optional and additive; only a model that declares it prices
  cache writes differently, which the changelog records.
- Structured output: request the adapter's JSON response format and let it
  choose the provider's native output format or its own JSON tool. No forced
  tool choice on the Messages wire, because current Claude models reject forced
  tool use; a rejection falls through to the caller's existing plain-text
  fallback.
- Failure boundaries: authentication, invalid-model, rate-limit, and rejected
  request options surface at request time with sanitized diagnostics, no silent
  provider fallback, and no credential disclosure. An option key the adapter
  does not recognize is the adapter's to drop or forward; llame never rewrites
  or retargets a request because of it.

## Capabilities

### New Capabilities

- `anthropic-messages-provider`: what the Messages wire adds on top of the
  shared contracts — thinking persistence and unmodified replay with the drop
  invariant, the caching default, cache-write reporting and cost, the effort and
  thinking defaults, structured output through the adapter's native path, and
  failure boundaries.

### Modified Capabilities

- `instance-config`: the provider-list requirement gains the
  `anthropic-messages` type, its variant shape, and its embedding exclusion; the
  model-catalog requirement gains the server-only `providerOptions` object and
  its boot rules.
- `provider-api-selection`: the wire-selection requirement gains the Messages
  clause and its scenarios, and a new requirement specifies how
  `providerOptions` reach the adapter and what takes precedence over them.
- `available-models`: the dispatch requirement's wire sentence covers every
  wire-named type, and the endpoint clause covers the Anthropic default.
- `reasoning-output`: the UI requirement renders no Thinking panel for a
  segment whose parts carry no text; persistence and replay are unchanged.

Destination selection, the operator-owned configuration posture, and credential
non-disclosure are not restated in the new capability: `provider-api-selection`
and `instance-config` already own them for every type, and this change extends
those requirements in place rather than fragmenting one contract across two
capabilities.

## Dependencies and delivery order

- `openai-compatible-provider` is merged and archived (PRs #883, #886, #890;
  `openspec/changes/archive/2026-09-18-openai-compatible-provider`). It shipped
  the wire-named types `openai-responses` and `openai-completions`, deleted the
  `openai` type and its id-derived discriminant, bumped the lockfile to carry
  `@ai-sdk/provider@3.0.16` / `@ai-sdk/provider-utils@4.0.51` alongside the
  3.0.15 / 4.0.46 pair, and defined the per-reasoning-part provider-metadata
  channel this change is the second producer of. Nothing here duplicates or
  reverses it, and this change writes no metadata channel of its own.
- Delivery stack, in order:

  ```text
  master <- anthropic-provider/proposal <- anthropic-provider/provider-options <- anthropic-provider/messages <- anthropic-provider/finalize
  ```

  The provider-options layer owns the catalog field and the refactor of the
  three existing clients; the messages layer owns the Anthropic type end to end
  and closes #208; the finalize layer syncs and archives.

- GitHub issue #208 defines the accepted scope and is closed by the messages
  layer. #754 is blocked by #208 and is not delivered here.

## Non-goals

- A second Anthropic type for gateways. One wire, one type; a gateway is a
  `baseUrl`.
- The Claude subscription path (#754). Its credential (an OAuth token), fixed
  endpoint, and request fingerprint make it a sibling type with a shape of its
  own, the way `openai-codex` sits beside `openai-responses`; nothing here
  constrains it.
- A bearer-token authentication option. The adapter supports one; no
  configured target needs it yet, and adding it later is additive.
- Per-user BYOK (#37, #18): the credential stays an operator-level
  `providers[].key`.
- OpenRouter (#82), OpenCode Zen and Go (#808, #809): provider entries, not
  provider types.
- The v4 AI SDK migration (#882). Tool-loop usage and cost accounting (#810).
  The effort-change cache warning (#593).
- A llame-owned effort vocabulary, a per-model thinking mode field, a thinking
  budget, or any model-family capability table. Per-level option bundles are
  recorded as the extension point for a non-string level and not implemented.
- Boot-time validation, warning, or reinterpretation of a `baseUrl` or of
  `providerOptions` keys and values, and any credential prevalidation.
- Publishing `providerOptions` or letting it carry interpolated values.
- The `models[]` schema beyond the two optional additions (`providerOptions`,
  `pricingUsdPer1M.cacheWrite`).

## Impact

- `apps/api/src/instance-config/llame.config.schema.json` (`providerType`
  enum, provider entry variant, `models[].providerOptions`, `modelPricing`) and
  `apps/api/src/instance-config/llame-config.ts` (`ProviderConfig` union and
  its normalized variants), plus loader normalization of the new field.
- `apps/api/src/models/model-catalog.ts` (server-only `providerOptions`,
  `ModelPricingUsdPer1M`, `toTokenPrice`), the public model DTO (price shape
  only), and `apps/api/src/models/model-client-factory.ts` (one dispatch case).
- `apps/api/src/models/openai-model-client.ts`,
  `openai-completions-model-client.ts`, and `openai-codex-model-client.ts`:
  provider-options composition replaces the hardcoded per-client options.
- A new Anthropic model client module, and
  `apps/api/src/chats/turn-telemetry.ts` (cache-write cost).
- `apps/web/app/(chat)/components/chat-message-row.tsx`: no panel for a
  reasoning segment without text.
- `apps/api/package.json` and the lockfile (one new dependency).
- Configuration and DTO fixtures, focused provider and composition tests, one
  bounded live proof, operator documentation for the type and the field.
- No database migration.
