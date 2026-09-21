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
  options, then client defaults; object values merge key by key and `null`
  removes a default at any depth. Keys that would change what a request is
  (the wire model id and its raw output-limit field, provider-side
  continuation and container identifiers, an instructions or system-message
  override, a tool-choice override, server-side fallbacks, provider-attached
  tool servers, and the Anthropic thinking block binding llame owns) are
  reserved and stripped. The three existing clients are refactored onto it,
  which turns the Responses client's `reasoningSummary: 'auto'` into an
  overridable default while codex keeps `store: false` and its summarized
  reasoning as invariants; an entry without options sends the bodies it sends
  today. Boot validates only that it is an object and rejects interpolation
  syntax inside it; keys and values are the provider's vocabulary and are never
  validated or published. Alongside it, an optional `models[].maxOutputTokens`
  is forwarded as the request's `maxOutputTokens` setting, because the
  Messages wire requires an output limit and the adapter's default for an
  unrecognized model id is 4096; each adapter derives its wire field from it as
  it documents.
- Extend the provider configuration contract and the `type`-dispatch client
  factory, and add one Anthropic model client implementing the existing
  `ModelClient` seam (`streamText`/`generateObject`, context window, pricing,
  compaction threshold).
- Thinking output: persist thinking and redacted-thinking blocks as reasoning
  parts carrying the block's signature (and redacted payload) as opaque provider
  metadata through the per-part channel `reasoning-output` now defines, replay
  them complete and unmodified on later requests for the same chat within the
  retained model context (a compacted prefix's blocks go with the prefix),
  including after a model switch, and never prune them llame-side; the
  adapter's replay switch is an invariant. Every request that carries adaptive thinking carries
  the provider's drop-on-prefix-mismatch instruction as a client invariant, so
  a compaction or prompt-receipt change never turns a replay into a rejected
  run; an entry that declares no `reasoning`, or an operator override to a
  manual-budget or disabled shape, carries none, which the documentation
  states together with the remedy. A block whose text the provider withheld persists
  with its signature; the web renderer draws no Thinking panel for a segment
  without text.
- Reasoning effort: forward the operator-declared effort token as the
  adapter's `effort` option, the way the OpenAI clients forward
  `reasoningEffort`; the Anthropic option is a closed enumeration of the
  provider's levels, so a level outside it fails at the adapter. When a model
  declares a `reasoning` vocabulary, the client defaults thinking to adaptive
  with summarized display; otherwise it sends no thinking configuration and
  no effort. Both are defaults an operator can adjust through
  `providerOptions` (`{ "thinking": { "display": null } }` removes the display,
  a manual-budget shape replaces adaptive thinking). No llame-owned level
  vocabulary, thinking budget, or model-family table.
- Request-level prompt caching as a client default: the top-level ephemeral
  `cache_control` (Anthropic's automatic caching) with the provider's 5-minute
  lifetime, replaceable or removable per model through `providerOptions`. llame
  authors no block-level breakpoints.
- Cost accounting: add an optional `cacheWrite` rate to `pricingUsdPer1M` and
  consume it in cost computation, because the adapter reports a real
  cache-creation count that is billed and is the largest line on a cached turn.
  The adapter's input total already includes those tokens, so cost subtracts
  them from the uncached term and prices them once: at the declared rate, or at
  the input rate when none is declared, which leaves today's cost unchanged.
  The field is optional and additive; only a model that declares it prices
  cache writes differently, which the changelog records.
- Structured output: request the adapter's JSON response format and let it
  choose the provider's native output format on models its capability table
  marks as supporting it, or its own JSON tool with a required tool choice
  otherwise. llame itself authors no forced tool choice on the Messages wire,
  because the current flagship models (Fable 5.1, Mythos 5.1) reject forced
  tool use and every model rejects it under manual thinking; a rejection,
  including of the adapter's JSON-tool path, falls through to the caller's
  existing plain-text fallback.
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
  `anthropic-messages` type, its variant shape, and its embedding exclusion,
  and its shipped unsupported-type example is reworded from "`"anthropic"`
  before the adapter exists" to "a bare `"anthropic"`"; the model-catalog
  requirement gains the server-only `providerOptions` object with its boot
  rules, the optional `maxOutputTokens`, and the optional
  `pricingUsdPer1M.cacheWrite` rate.
- `provider-api-selection`: the wire-selection requirement gains the Messages
  clause and its scenarios, its shipped structured-generation sentence and
  scenario are reworded from "forced-tool structured generation" to each wire's
  own mechanism (the OpenAI wires keep the forced tool choice), and a new
  requirement specifies how `providerOptions` and `maxOutputTokens` reach the
  adapter, the reserved keys, and what takes precedence over them.
- `available-models`: the dispatch requirement's wire sentence covers every
  wire-named type, and the endpoint clause covers the Anthropic default.
- `reasoning-output`: the part-identity requirement starts a reasoning part
  for an empty delivery that carries provider metadata under a new defined id
  (a thinking block whose text the provider withheld, or a Responses reasoning
  item with an empty summary, which today is discarded), requires unique
  in-order part ids from every client, and states that such a part produces no
  live chunk; the UI requirement renders no Thinking panel for a segment whose
  parts carry no text.

Destination selection, the operator-owned configuration posture, and credential
non-disclosure are not restated in the new capability: `provider-api-selection`
and `instance-config` already own them for every type, and this change extends
those requirements in place rather than fragmenting one contract across two
capabilities.

## Dependencies and delivery order

- `openai-compatible-provider` is merged and archived (PRs #884, #886, #888,
  #889, #890, closing issue #883;
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
- The Claude subscription path (#754). Its issue text scopes it to an
  unmodified Claude Code execution path with Anthropic-owned sign-in; OMP and
  OpenClaw carry it as an OAuth credential on the Messages wire instead. Either
  way it is not this type: `anthropic-messages` leaves the vendor name and the
  enum free for whatever shape #754 settles on, and the naming argument here
  stands on the gateway case alone.
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
- The `models[]` schema beyond the three optional additions (`providerOptions`,
  `maxOutputTokens`, `pricingUsdPer1M.cacheWrite`).

## Impact

- `apps/api/src/instance-config/llame.config.schema.json` (`providerType`
  enum, provider entry variant, `models[].providerOptions`,
  `models[].maxOutputTokens`, `modelPricing`) and
  `apps/api/src/instance-config/llame-config.ts` (`ProviderConfig` union and
  its normalized variants), plus loader normalization of the new fields.
- `apps/api/src/models/model-catalog.ts` (server-only `providerOptions`,
  `maxOutputTokens`, `ModelPricingUsdPer1M`, `toTokenPrice`), the public model
  DTO (price shape only), and `apps/api/src/models/model-client-factory.ts`
  (one dispatch case).
- `apps/api/src/models/openai-model-client.ts`,
  `openai-completions-model-client.ts`, and `openai-codex-model-client.ts`:
  provider-options composition replaces the hardcoded per-client options.
- A new Anthropic model client module (a single `fullStream` consumer with
  per-invocation reasoning part ids), `apps/api/src/runs/assistant-transcript.ts`
  (a metadata-only delivery under a new part id starts an empty reasoning
  part), `apps/api/src/runs/run-execution.service.ts` (buffered text flushed
  before a part-starting metadata delivery), the Responses client's reasoning
  forwarding in `openai-model-client.ts` (moved off its `tee()` onto the same
  single consumer), and
  `apps/api/src/chats/turn-telemetry.ts` (`TurnTelemetry` gains cache-write
  tokens; cost subtracts them from the uncached term and prices them once).
- `apps/web/app/(chat)/components/chat-message-row.tsx`: no panel for a
  reasoning segment without text; `message-usage.tsx` and the
  `assistant_turn_completed` telemetry log line, which enumerate usage fields,
  gain the cache-write count.
- `apps/api/package.json` and the lockfile (one new dependency).
- Configuration and DTO fixtures, focused provider and composition tests, one
  bounded live proof, operator documentation for the type and the field.
- No database migration.
