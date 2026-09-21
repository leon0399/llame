## Why

llame cannot reach OpenCode Go. `providers[].type` is a strict-closed enum of
`openai-responses`, `openai-completions`, `anthropic-messages`, and
`openai-codex` (`apps/api/src/instance-config/llame.config.schema.json`
`$defs.providerType`), and the gateway requires a stable per-conversation
`x-opencode-session` header on every request, so the provider
is unreachable however it is configured: `ModelStreamInput` carries no
per-request header channel
(`apps/api/src/models/model-client.ts:21`) and `chats.id` is dropped before
the transport.

Go sells low-latency access to the GLM, DeepSeek, Kimi, MiMo, Qwen, and MiniMax
families as a $10/month subscription on one credential and one endpoint, which
is the cheapest way for an operator to reach those models. This change
implements issue #809.

The same gap covers every other provider: no llame client identifies llame.
Each adapter appends its own token to an absent `User-Agent`
(`@ai-sdk/provider-utils` `withUserAgentSuffix`, `dist/index.js:884-892` in the
copy the Responses and Messages adapters resolve, `:914-922` in the copy the
Chat Completions adapter resolves), so llame presents
today as the bare SDK, which Go's documentation explicitly asks clients not to
do.

## What Changes

- Add one provider type, `opencode-go`: an operator-managed `key`, no
  `baseUrl` (the endpoint is fixed in llame's code), and the Chat Completions
  wire through the existing `openai-completions` client module, reporting
  itself as `opencode-go` in run events and telemetry and composing operator
  `providerOptions` under the namespace the adapter derives from that name.
  Redirects are rejected, as the Codex transport rejects them. The entry is
  constructible from `{ type, key }` alone, so a later BYOK account (#18) adds
  no schema. A keyless entry is invalid: the gateway authenticates every
  request.
- Add one required, transport-neutral field to the model-client input
  contract: `chat: { id, lane }` on `ModelStreamInput` and `ModelObjectInput`,
  where `lane` is `main` or `title`. Call sites hand over facts; each client
  renders the identity or ignores it. Required rather than optional so the
  compiler enumerates every construction site and test double instead of
  letting a silent default creep in.
- Send that identity as `x-opencode-session` on every language-model request
  llame makes for a Chat: the Chat's own id verbatim for the main turn and for
  both compaction paths, and `<id>:title` for title generation. The value is
  stable across retries, worker restarts, compaction, and model switches
  within the Chat. The generic sticky-gateway header (#881) reads the same
  field later.
- Identify llame on every language-model request, not only Go's: a
  `User-Agent` naming llame and its version, carried on the per-call headers of
  every streaming and structured request so the SDK appends its own token after
  llame's instead of replacing it. Embedding requests are unchanged. The Go
  client additionally sends the gateway's client header naming llame;
  `x-opencode-request` and `x-opencode-project` are not sent, and no other
  product's client identity is ever claimed.
- Serve the Chat Completions route only. The gateway's pre-authentication
  format gate accepts `/chat/completions` for 37 of the 38 models in its live
  catalogue; `grok-4.6` is reachable only through `/responses` and is out of
  reach until #904 adds a per-model route override. `/messages` and
  `/responses` are not wired in this change.
- Report Go failures exactly as the Chat Completions module reports every
  compatible endpoint's: the gateway's parsed error message is the run's
  failure, after the SDK's own retries; the failure body, its headers, the request body,
  and credential never reach owners or logs. No boot-time eligibility check, no
  compiled model or route table, no Go-specific classification or sanitizer,
  no typed quota error, no quota ledger. The accepted upstream shapes (a
  misdeclared model's "not supported for format" message, quota exhaustion
  after retries) are documented in the operator runbook.
- Send no cache control for Go. Caching is gateway-side and keyed on the
  session header.
- Report cost as unknown unless the operator declares `pricingUsdPer1M`, the
  Codex precedent. An operator-declared price is llame's own accounting of a
  subscription quota, which the runbook says plainly.
- Ship an example configuration with two chat-accepted models and a runbook
  that records the route ceiling, the accepted upstream failure shapes, the per-model
  privacy divergence, the quota windows, and the upstream "Use balance" toggle
  llame cannot observe or set.

No configuration becomes invalid: the provider type is additive, the new
client config fields are optional, and an entry that sets none of them sends the
bodies it sends today. The one observable change for existing providers is the
`User-Agent` on every request. The `chat` field is
required on the input contract, which is an internal seam with no operator
surface; every existing call site gains a value derived from the Chat it
already serves. No new dependency: the Chat Completions adapter
(`@ai-sdk/openai-compatible@2.0.75`) is already installed for
`openai-completions`.

## Capabilities

### New Capabilities

- `opencode-go-provider`: what the fixed Go transport adds on top of the shared
  contracts — the key-only entry and fixed destination, the session identity on
  every request including auxiliary calls, client self-identification, the
  absence of client-side cache control, the failure boundary with its accepted
  upstream shapes, unknown cost unless declared, and the operator runbook.
  Named after the provider type it specifies, as `anthropic-messages-provider`
  is; `subscription-access-openai-codex` is the older, differently named
  sibling for the subscription transport.

### Modified Capabilities

- `instance-config`: the provider-list requirement admits `"opencode-go"` in
  the `type` enum, defines its variant shape (required `key`, rejected
  `baseUrl`), and extends the existing embedding-provider exclusion to it.
- `provider-api-selection`: the wire-selection requirement gains the
  `opencode-go` clause and its scenario, and two requirements are added — every
  provider request identifies llame, and language-model requests carry the Chat
  identity, its required field, its lanes, and its per-client rendering.

## Dependencies and delivery order

- The `openai-compatible-provider` change is merged and archived (PRs #884,
  #886, #888, #889, #890, closing #883): it shipped the wire-named
  `openai-responses` / `openai-completions` types, the type-dispatch client
  factory, and `@ai-sdk/openai-compatible@2.0.75`.
- The `anthropic-provider` change is merged and archived (closing #208): it
  shipped `anthropic-messages`, the per-model `providerOptions` composition
  every client uses, and the per-reasoning-part provider-metadata channel.
  Nothing here duplicates or reverses either change, and this change adds no
  adapter dependency of its own.
- Delivery stack, in order:

  ```text
  master <- opencode-go-provider/research <- opencode-go-provider/proposal <- opencode-go-provider/chat-key <- opencode-go-provider/go-provider <- opencode-go-provider/finalize
  ```

  The `chat-key` layer owns the `chat` field, the derivation at every call
  site, the test doubles, and the `User-Agent` on the four existing clients. It
  closes no issue. The `go-provider` layer owns the provider type end to end
  and is the only layer that closes an issue: it closes #809 after its
  acceptance evidence is recorded. The `finalize` layer syncs and archives
  only.

- No layer closes #903, #904, #808, #881, #810, #593, #751, #754, #18, #82,
  or #37.

## Non-goals

- Per-model protocol routing (#904). One credential and one host serve three
  protocols, and this slice wires one of them; the route override is a
  follow-up over the same client.
- A compiled-in or fetched model catalogue (#903). The operator declares
  `models[]` and llame contacts nothing at boot. `available-models` already
  forbids a compiled catalogue.
- OpenCode Zen (#808). It is a second type over the same module and its own
  slice; Go's provider identity, catalogue, and billing stay separate.
- A generic session or sticky-affinity header for other gateways (#881).
  `chat` is the channel it will read; this change does not add the header.
- Per-user BYOK (#37, #18). The credential stays an operator-level
  `providers[].key`, and the `{ type, key }` shape is designed so a BYOK
  account adds no schema.
- OpenRouter (#82), the Claude subscription lane (#754), and the ChatGPT/Codex
  subscription (#751).
- A typed quota error, a quota ledger, owner-visible quota state, or any
  reading of the gateway's workspace metadata.
- A per-model privacy or retention field in the catalogue; the divergence is
  documented, not modelled.
- Boot-time eligibility, reachability, or credential prevalidation, and any
  llame-side model-family, route, or pricing table.
- Preventing upstream overage. "Use balance" is a console toggle llame cannot
  observe or set.

## Impact

- `apps/api/src/instance-config/llame.config.schema.json` (`$defs.providerType`
  enum, the `opencode-go` conditional), `llame-config.ts`
  (`OpenCodeGoProviderConfig` and the `ProviderConfig` union,
  `RawProviderEntry`), and `config-loader.ts` (one resolver case using the
  existing required-non-blank key path).
- `apps/api/src/models/model-client.ts` (`ChatIdentity`, `ChatLane`, the
  required `chat` field on both inputs), `model-client-factory.ts` (one
  dispatch case, and the product token threaded into every client config), a
  new `opencode-go-model-client.ts` (fixed base URL, fixed headers, the
  session-header renderer, the `opencode-go` provider name, and the
  redirect-rejecting `fetch` composed over the completions client),
  `openai-completions-model-client.ts` (optional `provider` name, optional
  fixed `headers`, an optional per-request session-header renderer, and
  per-call headers on both its streaming and structured requests),
  `openai-model-client.ts` (per-call headers on both paths;
  `generateToolBoundObject` carries `headers`), `anthropic-model-client.ts`
  (per-call headers on both paths), and a version read in
  `apps/api/src/instance-config/` that fails boot as an `InstanceConfigError`
  when `apps/api/package.json` is not beside `dist/`.
- Call sites: `apps/api/src/runs/run-execution.service.ts` (the streaming
  call), `apps/api/src/compaction/compaction.service.ts` (the shared
  summarization call behind `maybeCompact` and `compactForTransition`), and
  `apps/api/src/titles/title.service.ts` (both the structured and the text
  title paths).
- `apps/api/llame.config.json.example`, `docs/opencode-go.md`, the README
  provider section, the `apps/api/AGENTS.md` wire matrix, `docs/scaling.md`
  (the manifest must sit beside `dist/`), and `CHANGELOG.md`.
- Focused configuration, dispatch, header-rendering, and call-site tests, plus
  one bounded live proof recorded in the change directory.
- No database migration, no new dependency, and no `models[]` schema change.
