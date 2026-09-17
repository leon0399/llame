## Why

llame can execute OpenAI-family models but cannot reach Anthropic at all:
`providers[].type` is a strict-closed enum that contains no Anthropic type, so an
operator holding usage-billed Anthropic API credentials has no supported path to
Claude models. This change implements issue #208 as the second of two provider
changes and unblocks the Claude subscription lane (#754): API-credential access
must be proven before subscription execution is designed.

## What Changes

- Add two provider types in one linear stack: `anthropic` (Anthropic's own
  Messages API, optional `baseUrl` meaning "Anthropic behind a proxy") and
  `anthropic-compatible` (the Messages wire format at a required
  operator-supplied base URL, for proxies and gateways).
- Extend the provider configuration contract and the `type`-dispatch client
  factory, and add one Anthropic model client implementing the existing
  `ModelClient` seam (`streamText`/`generateObject`, context window, pricing,
  compaction threshold). The provider `type` alone selects the client: no host
  inference and no derivation from a provider's `id`.
- Add `@ai-sdk/anthropic@3.0.118`, the newest release on the repository's v3
  specification line (3.0.119 and 3.0.120 do not exist). It declares
  `@ai-sdk/provider@3.0.16` and `@ai-sdk/provider-utils@4.0.51` — the same pair
  `openai-compatible-provider` already bumps to, so the two changes converge. No
  zod change is needed: it peers on `^3.25.76 || ^4.1.8` and llame resolves both
  3.25.76 and 4.6.5.
- Request-level prompt caching for both types:
  `providerOptions.anthropic.cacheControl = { type: 'ephemeral' }` at the top
  level of the call, with the provider's default 5-minute TTL. llame places no
  per-part breakpoints, counts none, and exposes no 1-hour bucket.
- Cost accounting: add an optional `cacheWrite` rate to `pricingUsdPer1M` and
  consume it in cost computation, because `@ai-sdk/anthropic` reports a real
  cache-creation count that is billed and is the largest line on a cached turn.
  The field is optional and additive: no existing configuration becomes invalid
  and no model entry must change. Only a model that declares the new field prices
  cache writes differently, which the changelog records.
- Thinking output: persist thinking and redacted-thinking blocks as displayable
  reasoning parts, store each block's signature (and redacted payload, where
  present) as opaque provider metadata on that part through the per-part channel
  `openai-compatible-provider` introduces for #883, and replay the blocks —
  complete, unmodified, and in their original order — on later requests for the
  same chat, including after a model switch, which the provider resolves because
  a block is readable only by the model that produced it or a newer one. llame
  does not prune thinking itself. Requests explicitly ask the provider to drop
  blocks whose bound prefix no longer matches, so a compaction or prompt-receipt
  change never turns a replay into a failed run.
- Reasoning effort: keep mapping the operator-declared effort token onto the
  adapter's thinking option. No second effort vocabulary and no new config
  shape.
- Structured output closure: `generateToolBoundObject`'s forced-tool-choice
  mechanism has a native Anthropic equivalent, so no fallback is designed or
  needed.
- Failure boundaries: authentication, invalid-model, rate-limit, and
  unsupported-option failures surface at request time with sanitized
  diagnostics, with no silent provider fallback and no credential disclosure.

Thinking signatures are durable: the per-part provider-metadata channel and the
`reasoning-output` amendments that make a persisted signature lawful are owned by
`openai-compatible-provider` (#883), so this change is that channel's first
producer and defines no second channel of its own.

## Capabilities

### New Capabilities

- `anthropic-messages-provider`: observable behavior of both Anthropic provider
  types — destination selection, operator-owned configuration posture,
  credential non-disclosure, thinking persistence and unmodified replay,
  request-level prompt caching, cache-write reporting and cost, effort mapping,
  structured output, and failure boundaries.

### Modified Capabilities

- `instance-config`: the provider-list requirement — the `type` enum, the two
  new variant shapes, and the embedding restriction (an embedding model's
  provider must be the `openai` type).

`available-models` is deliberately not modified: type dispatch there is unchanged
and the `openai-codex` provider change did not amend it either. `reasoning-output`
is deliberately not modified either, but for the opposite reason: its per-part
provider-metadata channel plus MODIFIED deltas to "Reasoning is an ordered private
assistant part" and "Opaque continuation state is transient and private" are owned
by `openai-compatible-provider` for #883, and this change depends on them. Writing
a second delta against the same requirements here would collide with that
amendment, and this change adds no reasoning-storage rule of its own — it is the
channel's first producer and specifies only the Anthropic-visible behavior
(persistence, unmodified replay, no pruning, no coercion on a model switch, and
drop-on-prefix-mismatch).

## Dependencies and delivery order

- `openai-compatible-provider` merges first. It introduces the `openai` (official
  OpenAI) and `openai-compatible` types, deletes the `nativeOpenAI` /
  `provider.id === 'openai'` discriminant, bumps `@ai-sdk/provider` 3.0.15 →
  3.0.16 and `@ai-sdk/provider-utils` 4.0.46 → 4.0.51, and owns the
  per-reasoning-part provider-metadata channel from #883 together with the
  `reasoning-output` amendments a persisted signature requires. This change
  depends on all of it and must not duplicate any of it: it defines no metadata
  channel of its own and writes no `reasoning-output` delta, and it is that
  channel's first producer.
- GitHub issue #208 defines the accepted scope and is closed by the
  `anthropic-compatible` layer of this change, after the native layer has proven
  the adapter. Issue #883 owns the per-part metadata channel; #754 is blocked by
  #208 and is not delivered here.

## Non-goals

- Per-user BYOK (#37, #18): the credential stays an operator-level
  `providers[].key`.
- The Claude subscription execution path (#754). #208 is the API-credential
  adapter that #754 depends on; subscription authentication is a different
  topology.
- OpenRouter (#82), which explicitly refuses the compatible path for itself.
- The v4 AI SDK migration (#882).
- OpenCode Go and Zen (#808, #809). Go's later `/messages` route adds a provider
  entry, not a provider type — which is why `anthropic-compatible` ships here.
- Tool-loop usage and cost accounting (#810), and the effort-change cache warning
  (#593).
- Boot-time validation, warning, or reinterpretation of whether a base URL "looks
  like" Anthropic, and any credential prevalidation.
- The `models[]` schema, which is unchanged: an Anthropic-routed model entry works
  exactly like any other provider's, apart from the optional price field.

## Impact

- `apps/api/src/instance-config/llame.config.schema.json` (`providerType` enum,
  provider entry variants, `modelPricing`) and
  `apps/api/src/instance-config/llame-config.ts` (`ProviderConfig` union and its
  normalized variants).
- `apps/api/src/models/model-client-factory.ts` (two dispatch cases) and a new
  Anthropic model client module, `apps/api/src/models/model-catalog.ts`
  (`ModelPricingUsdPer1M`, `toTokenPrice`), `apps/api/src/chats/turn-telemetry.ts`
  (cost computation), and the public model DTO's price shape.
- `apps/api/package.json` and the lockfile (one new dependency).
- Configuration and DTO fixtures, focused provider tests, one bounded live proof,
  and operator documentation.
- No database migration, no web UI change, and no `models[]` schema change.
