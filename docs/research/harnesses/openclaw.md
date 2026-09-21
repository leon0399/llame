---
type: Reference
title: "OpenClaw"
description: "Primary alpha implementation reference for capabilities and behavior"
resource: "https://github.com/openclaw/openclaw"
observed:
  date: "2026-09-21"
  revision: "34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5"
sources:
  - id: docs-concepts-memory-md-l9-l62
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/memory.md#L9-L62"
    title: "Core/episodic files and bootstrap limits"
  - id: docs-concepts-memory-md-l64-l89
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/memory.md#L64-L89"
    title: "imports remain source-specific"
  - id: src-routing-resolve-route-ts-l592-l680
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/routing/resolve-route.ts#L592-L680"
    title: "resolveAgentRoute"
  - id: src-routing-resolve-route-ts-l725-l799
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/routing/resolve-route.ts#L725-L799"
    title: "Ordered binding tiers"
  - id: src-config-sessions-session-accessor-sqlite-transcript-store-ts-l76-l89
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/config/sessions/session-accessor.sqlite-transcript-store.ts#L76-L89"
    title: "Transcript events are inserted into SQLite"
  - id: docs-concepts-session-search-md-l43-l53
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/session-search.md#L43-L53"
    title: "search contract"
  - id: docs-concepts-session-search-md-l26-l38
    resource: "https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/session-search.md#L26-L38"
    title: "Default session visibility"
  - id: src-agents-code-mode-ts-l69-l133
    resource: "https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/src/agents/code-mode.ts#L69-L133"
    title: "bounded catalog index"
  - id: docs-tools-code-mode-internals-md
    resource: "https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/docs/tools/code-mode/internals.md"
    title: "Code Mode runtime and security boundary"
  - id: src-agents-code-mode-execution-ts-l598-l604
    resource: "https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/src/agents/code-mode-execution.ts#L598-L604"
    title: "resume ownership check"
  - id: docs-providers-opencode-md-l21-l36
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/docs/providers/opencode.md#L21-L36"
    title: "stable conversation header and standalone generation"
  - id: docs-providers-opencode-go-md-l74-l102
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/docs/providers/opencode-go.md#L74-L102"
    title: "Go catalog discovery, entitlement, and privacy"
  - id: docs-plugins-sdk-runtime-models-md-l192-l215
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/docs/plugins/sdk-runtime/models.md#L192-L215"
    title: "prepared completion routing header contract"
  - id: extensions-opencode-go-index-ts-l21-l50
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/index.ts#L21-L50"
    title: "provider id, shared key, and profile ids"
  - id: extensions-opencode-go-index-ts-l84-l133
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/index.ts#L84-L133"
    title: "catalog run, replay family, turn state, stream wrappers"
  - id: extensions-opencode-go-provider-catalog-ts-l15-l66
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/provider-catalog.ts#L15-L66"
    title: "endpoint pair, seed catalog, and upstream catalog options"
  - id: extensions-opencode-go-provider-catalog-ts-l108-l171
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/provider-catalog.ts#L108-L171"
    title: "seed-only dynamic resolution and base URL normalization"
  - id: extensions-opencode-go-openclaw-plugin-json-l10-l30
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/openclaw.plugin.json#L10-L30"
    title: "declared endpoints, request family, and catalog head"
  - id: extensions-opencode-go-openclaw-plugin-json-l106-l163
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/openclaw.plugin.json#L106-L163"
    title: "per-model api rows and preview lifecycle"
  - id: extensions-opencode-go-reasoning-sanitizer-ts-l1-l72
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/reasoning-sanitizer.ts#L1-L72"
    title: "Kimi reasoning payload stripper"
  - id: extensions-opencode-go-stream-ts-l18-l123
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/stream.ts#L18-L123"
    title: "attribution, payload patch, thinking, and stalled wrappers"
  - id: extensions-opencode-go-stream-termination-ts-l27-l40
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/stream-termination.ts#L27-L40"
    title: "provider-owned stall timeouts"
  - id: extensions-opencode-go-stream-termination-ts-l164-l184
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/stream-termination.ts#L164-L184"
    title: "stalled stream behavior contract"
  - id: extensions-opencode-go-provider-policy-api-ts-l9-l57
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/provider-policy-api.ts#L9-L57"
    title: "Go thinking profiles"
  - id: src-plugin-sdk-provider-catalog-live-normalize-internal-ts-l370-l432
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/plugin-sdk/provider-catalog-live-normalize.internal.ts#L370-L432"
    title: "npm to api table and origin guard"
  - id: src-plugin-sdk-provider-catalog-snapshot-internal-ts-l20-l92
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/plugin-sdk/provider-catalog-snapshot.internal.ts#L20-L92"
    title: "snapshot projection, lifecycle, and catalog entries"
  - id: src-plugin-sdk-provider-catalog-live-runtime-ts-l239-l318
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/plugin-sdk/provider-catalog-live-runtime.ts#L239-L318"
    title: "upstream catalog owner"
  - id: packages-ai-src-transports-session-affinity-ts-l5-l33
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/packages/ai/src/transports/session-affinity.ts#L5-L33"
    title: "opencode.ai endpoint gate and header injection"
  - id: packages-ai-src-transports-provider-transport-turn-state-ts-l33-l67
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/packages/ai/src/transports/provider-transport-turn-state.ts#L33-L67"
    title: "turn header filtering and simple completion headers"
  - id: packages-ai-src-transports-simple-completion-transport-ts-l20-l30
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/packages/ai/src/transports/simple-completion-transport.ts#L20-L30"
    title: "synthetic UUID header only"
  - id: packages-ai-src-transports-openai-completions-transport-ts-l207-l263
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/packages/ai/src/transports/openai-completions-transport.ts#L207-L263"
    title: "turn state resolution and header merge"
  - id: src-agents-provider-attribution-ts-l394-l410
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/provider-attribution.ts#L394-L410"
    title: "Go User-Agent policy"
  - id: src-agents-provider-attribution-ts-l493-l536
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/provider-attribution.ts#L493-L536"
    title: "endpoint-class gating for Go attribution"
  - id: src-commands-doctor-config-analysis-ts-l263-l303
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/commands/doctor-config-analysis.ts#L263-L303"
    title: "OpenCode provider override warning"
  - id: src-agents-embedded-agent-runner-stream-resolution-ts-l160-l200
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/embedded-agent-runner/stream-resolution.ts#L160-L200"
    title: "session id into stream options"
  - id: src-agents-embedded-agent-runner-compaction-session-agent-ts-l63-l74
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/embedded-agent-runner/compaction-session-agent.ts#L63-L74"
    title: "compaction reuses the session id"
  - id: src-agents-host-prepared-isolated-completion-ts-l8-l40
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/host-prepared-isolated-completion.ts#L8-L40"
    title: "isolated completion without identity"
  - id: src-agents-failover-message-patterns-ts-l29-l33
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/failover/message-patterns.ts#L29-L33"
    title: "incomplete assistant stream pattern"
  - id: src-agents-embedded-agent-runner-run-attempt-result-ts-l77-l135
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/embedded-agent-runner/run/attempt-result.ts#L77-L135"
    title: "settled-turn finalization context"
  - id: packages-ai-src-transports-openai-completions-stream-ts-l290-l300
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/packages/ai/src/transports/openai-completions-stream.ts#L290-L300"
    title: "Go reasoning signature relabel"
  - id: packages-ai-src-transports-openai-completions-stream-ts-l658-l668
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/packages/ai/src/transports/openai-completions-stream.ts#L658-L668"
    title: "missing finish_reason error"
  - id: src-plugins-provider-replay-helpers-ts-l196-l214
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/plugins/provider-replay-helpers.ts#L196-L214"
    title: "passthrough Gemini sanitizing policy"
  - id: appcast-xml-l4407
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/appcast.xml#L4407"
    title: "routing identities and provider turn headers"
  - id: appcast-xml-l5712
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/appcast.xml#L5712"
    title: "required conversation identity on Go and Zen"
  - id: changelog-2026-9-3-md-l175
    resource: "https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/CHANGELOG/2026.9.3.md#L175"
    title: "recover truncated Go completions after tool use"
---

# OpenClaw

- **Stack:** TypeScript; multi-channel gateway; Markdown memory; SQLite session/transcript state and search

Primary alpha reference for capability behavior, with concrete routing, memory, and transcript-search implementations. High confidence in the cited mechanisms; llame retains canonical Chat/Run identity and its own storage contracts.

For coding capabilities and tool behavior, [OMP (oh-my-pi)](./oh-my-pi.md) has
primary reference priority.

**Study**

1. **F28: Canonical files and explicit imports.** Core/episodic files and bootstrap limits[^docs-concepts-memory-md-l9-l62] distinguish curated root memory from daily notes; imports remain source-specific[^docs-concepts-memory-md-l64-l89]. High confidence applicability to llame's source/projection boundary and Knowledge imports.
2. **F29: Deterministic inbound routing.** `resolveAgentRoute`[^src-routing-resolve-route-ts-l592-l680] normalizes channel/account/peer inputs, derives a stable session key and last-route policy. Ordered binding tiers[^src-routing-resolve-route-ts-l725-l799] resolve peer, parent-peer, wildcard, guild/role, team, account, and channel matches. Moderate-confidence comparison for future llame inbound routing; OpenClaw's channel peers are not executor-adapter identities.

3. **F30: Transcript authority and search.** Transcript events are inserted into SQLite[^src-config-sessions-session-accessor-sqlite-transcript-store-ts-l76-l89]. The search contract[^docs-concepts-session-search-md-l43-l53] indexes new messages transactionally and reports incomplete reconciliation. Compare these source/projection boundaries with llame's canonical messages and search coverage.
4. **F31: Code Mode sandbox and bounded catalog index.** Opt-in `exec`/`wait` tools run model-authored JS/TS in a QuickJS-WASI guest inside a worker thread with no filesystem, network, imports, or environment; native tools are guest globals and MCP tools sit under `MCP.<server>.<tool>()` (runtime and security boundary[^docs-tools-code-mode-internals-md]). The `exec` description carries an index capped at 8000 chars that skips oversized entries rather than truncating and omits MCP prose so catalog text cannot steer the model[^src-agents-code-mode-ts-l69-l133]; `wait` refuses to resume a run from another session[^src-agents-code-mode-execution-ts-l598-l604]. High confidence for the catalog-index rule and ownership check; the no-imports guest conflicts with llame's dependency-import goal. See the [code-mode deep dive](../tool-harness/2026-09-14-code-mode-eval-tool.md).
5. **F32: One provider per catalogue, a sealed URL pair, and per-model wire selection.** Go keeps its own runtime provider id (`opencode-go`) and shares only credential infrastructure with Zen: the same `OPENCODE_API_KEY`/`OPENCODE_ZEN_API_KEY` env pair and even the same onboarding profile ids (`opencode:default`, `opencode-go:default`)[^extensions-opencode-go-index-ts-l21-l50]. Two endpoints are declared and enforced: `https://opencode.ai/zen/go/v1` for the OpenAI wires and `https://opencode.ai/zen/go` for `anthropic-messages`; configuration that says `https://opencode.ai/go` or `https://opencode.ai/go/v1` is rewritten onto that pair, and an unrecognised base URL is left untouched rather than coerced[^extensions-opencode-go-provider-catalog-ts-l108-l171][^extensions-opencode-go-openclaw-plugin-json-l10-l30]. Wire selection is per model: bundled seed rows take the provider default `openai-completions` unless the row names its own api (`gpt-5.6-luna` is `openai-responses`, `qwen3.8-max` is `anthropic-messages` with the non-`/v1` base URL)[^extensions-opencode-go-openclaw-plugin-json-l106-l163][^extensions-opencode-go-provider-catalog-ts-l15-l66]. Live metadata can move a model between wires: each `models.opencode.ai/api.json` row supplies `provider.npm`, resolved through a closed table (`@ai-sdk/anthropic` to `anthropic-messages`, `@ai-sdk/google` to `google-generative-ai`, `@ai-sdk/openai` to `openai-responses`, `@ai-sdk/openai-compatible` to `openai-completions`), and a row whose provider or model `api` URL leaves the canonical origin is dropped instead of redirecting an authenticated request elsewhere[^src-plugin-sdk-provider-catalog-live-normalize-internal-ts-l370-l432]. Confidence: high. This is llame's "a gateway that speaks a wire is a `baseUrl`, not a second type" rule with the extra discipline that upstream metadata may choose a wire but never a host.
6. **F33: Conversation identity is a per-request turn state, not a client header.** `resolveTransportTurnState` returns `x-opencode-session` per request, and only when the model's base URL normalises to one of the Go endpoints and when neither the model headers nor the stream options already carry that name (compared case-insensitively); the value is `sessionId.trim() || turnId.trim()`[^extensions-opencode-go-index-ts-l84-l133][^extensions-opencode-go-provider-catalog-ts-l108-l171]. The completion transport resolves that state with a fresh `randomUUID()` turn id and merges `{ ...turnHeaders, ...optionHeaders }`, where `optionHeaders` come from the caller and model, so an explicit header wins and the generated copy is filtered out of the turn set first[^packages-ai-src-transports-openai-completions-transport-ts-l207-l263][^packages-ai-src-transports-provider-transport-turn-state-ts-l33-l67]. The shared seam for both catalogues is `resolveOpencodeSessionHeaders`, which refuses anything that is not `https://opencode.ai` (trailing dot tolerated; `http://`, userinfo, and host-suffix lookalikes rejected) and stays active when prompt caching is off[^packages-ai-src-transports-session-affinity-ts-l5-l33][^docs-providers-opencode-md-l21-l36]. In the agent loop the value is the OpenClaw session id, carried into stream options by attempt resolution and by compaction, so a turn and its summarisation request share one upstream conversation[^src-agents-embedded-agent-runner-stream-resolution-ts-l160-l200][^src-agents-embedded-agent-runner-compaction-session-agent-ts-l63-l74]. Confidence: high. Identity is computed per call from an explicit session, and the caller-wins escape hatch plus case-insensitive comparison are cheap to copy.
7. **F34: Standalone completions synthesize an identity, and product identification is a separate gated policy.** When a standalone completion carries no `sessionId`, `prepareHeadersForSimpleCompletion` substitutes `randomUUID()` for the header only, and the adjacent comment states why: a stream `sessionId` would also switch on unrelated cache and WebSocket session ownership[^packages-ai-src-transports-simple-completion-transport-ts-l20-l30]. The documented contract matches: one fresh opaque value per invocation, suppressed by any explicit model or caller routing header regardless of casing, caller precedence over model headers, no conversation or cache created, and transport retries reusing the invocation header[^docs-plugins-sdk-runtime-models-md-l192-l215][^docs-providers-opencode-md-l21-l36]. Host-prepared isolated completions, the zero-tool surface exposed to plugin and other one-shot callers, build their options with neither `headers` nor `sessionId`, so each takes the generated path[^src-agents-host-prepared-isolated-completion-ts-l8-l40]. Identification is separate from identity: the Go attribution policy sends `User-Agent: openclaw/<version>` with hook `request-headers`, verification `vendor-documented`, and the review note that Go requires coding agents to identify themselves, and it applies only when the resolved endpoint class is `opencode-go-native`, so a custom base URL is treated as a proxy and inherits no attribution[^src-agents-provider-attribution-ts-l394-l410][^src-agents-provider-attribution-ts-l493-l536]. Confidence: high. A synthetic per-call value is safe exactly while it lives in the header and nowhere else.
8. **F35: Go repairs are keyed to the model family, not the provider.** A payload patch for Kimi K2.x ids deletes `reasoning_details`, `reasoning_content`, `reasoning`, `reasoning_text`, and both `reasoning_effort` spellings at the top level and inside every `messages`/`input` entry, drops `thinking`, `redacted_thinking`, and `reasoning` content parts, and substitutes `[assistant reasoning omitted]` when a content array empties[^extensions-opencode-go-reasoning-sanitizer-ts-l1-l72][^extensions-opencode-go-stream-ts-l18-l123]. Fixed-thinking Anthropic ids (`minimax-m2.5`, `minimax-m2.7`) instead lose `thinking` and `output_config`, `kimi-k3` gets the completions thinking-off wrapper, and the thinking profile publishes `off` only for Kimi K2, effort levels from `compat.supportedReasoningEfforts` when upstream advertises them, `off`/`high` for `minimax-m3`, and an always-on `high` for the fixed Anthropic pair[^extensions-opencode-go-provider-policy-api-ts-l9-l57][^extensions-opencode-go-stream-ts-l18-l123]. The provider-owned stalled-stream wrapper aborts the underlying request through an injected `AbortController` after 120s without a progress event (300s before the first event; `requestTimeoutMs` overrides both), emits a terminal error event carrying either a Go-specific stall message or `opencode-go stream ended without a terminal event`, and is registered on the agent path only, not for simple completions[^extensions-opencode-go-stream-termination-ts-l27-l40][^extensions-opencode-go-stream-termination-ts-l164-l184][^extensions-opencode-go-stream-ts-l18-l123]. Truncation after tool use is handled above the transport: the completions stream raises `Stream ended without finish_reason` when direct mode or an expected DONE frame is missing[^packages-ai-src-transports-openai-completions-stream-ts-l658-l668], an anchored `INCOMPLETE_ASSISTANT_STREAM_RE` recognises that wording[^src-agents-failover-message-patterns-ts-l29-l33], and the settled-turn finalization context keeps a post-tool attempt eligible for the tool-free finalizer while refusing to treat pre-tool commentary as an answer[^src-agents-embedded-agent-runner-run-attempt-result-ts-l77-l135]. Go also relabels a reasoning delta whose signature is the literal `reasoning` as `reasoning_content`[^packages-ai-src-transports-openai-completions-stream-ts-l290-l300]. Confidence: moderate-to-high on the repair inventory; the stalled-stream wrapper duplicates a policy llame would rather own once per transport.
9. **F36: A named replay family carries the Gemini thought-signature work.** Both catalogues opt into `buildProviderReplayFamilyHooks({ family: "passthrough-gemini" })`[^extensions-opencode-go-index-ts-l84-l133]. That family disables the assistant-first ordering fix and both turn validators, and attaches `sanitizeThoughtSignatures { allowBase64Only: true, includeCamelCase: true }` only when the model id contains `gemini`, so a proxied Gemini keeps thought signatures without native replay validation or bootstrap rewrites while every other id gets the minimal policy[^src-plugins-provider-replay-helpers-ts-l196-l214]. Confidence: moderate. One named family per transcript dialect is cheaper than assembling per-model hooks, provided the family stays small enough to read.
10. **F37: A seed catalogue intersected with a trusted metadata snapshot.** The bundled manifest seeds Go rows with per-model wire, cost, compat, and lifecycle, as `hy3-preview`'s `status: "preview"` shows[^extensions-opencode-go-openclaw-plugin-json-l106-l163]. `createUpstreamProviderCatalog` owns that lifecycle: it builds a static provider from the seed, refreshes the metadata snapshot from `models.opencode.ai/api.json`, derives static eligibility after that refresh, and builds the live provider from the account's `/models` list intersected with the snapshot in endpoint order[^src-plugin-sdk-provider-catalog-live-runtime-ts-l239-l318][^src-plugin-sdk-provider-catalog-snapshot-internal-ts-l20-l92]. Lifecycle comes only from an accepted upstream row, so deprecated entries leave active discovery and its offline fallback while the catalogue list still reports `status` and `replacedBy`, and preview seed rows stay hidden behind `isStaticEntryActive: (entry) => !entry?.status` until upstream metadata accepts them[^src-plugin-sdk-provider-catalog-snapshot-internal-ts-l20-l92][^extensions-opencode-go-provider-catalog-ts-l15-l66]. Dynamic resolution reads the bundled seed only, with the comment that public upstream metadata does not establish another account's Go entitlement, matching the docs' warning that the model list is an inventory rather than an entitlement check[^extensions-opencode-go-provider-catalog-ts-l108-l171][^docs-providers-opencode-go-md-l74-l102]. Cost is per-million with context tiers, and the docs present the numbers as advertised-price estimates while leaving retention and training policy to the operator reading the Go privacy table[^src-plugin-sdk-provider-catalog-live-normalize-internal-ts-l370-l432][^docs-providers-opencode-go-md-l74-l102]. Confidence: high for the seed-versus-account split and for never letting metadata grant entitlement.
11. **F38: Failures are prevented or classified, and doctor guards hand-written provider blocks.** Nothing branches on the gateway's missing-session rejection: OpenClaw prevents it by construction, so such a failure would surface as an ordinary provider HTTP error[^packages-ai-src-transports-session-affinity-ts-l5-l33]. Stream trouble does get first-class treatment: the Go stall and unterminated messages are matched as incomplete assistant streams for timeout classification and failover[^src-agents-failover-message-patterns-ts-l29-l33][^src-agents-embedded-agent-runner-run-attempt-result-ts-l77-l135]. The release record names the two shipped behaviours: preserving stable routing identities for standalone OpenCode and Go turns with provider turn headers retained for explicit sessions[^appcast-xml-l4407], including the required conversation identity on Go and Zen requests[^appcast-xml-l5712], and recovering truncated Go completions after tool use[^changelog-2026-9-3-md-l175]. At configuration time doctor warns when `models.providers.opencode`, `opencode-zen`, or `opencode-go` shadows an active plugin, prints the offending `api` value, and tells the operator to remove the entry to restore per-model API routing and costs[^src-commands-doctor-config-analysis-ts-l263-l303]. Confidence: high. An explicit override warning is the cheapest protection a per-model routing table can have.

**Caution:** Default session visibility[^docs-concepts-session-search-md-l26-l38] permits broad cross-agent access. Preserve llame's owner-scoped datastore authorization rather than copying those defaults. Code Mode caps (64 suspended runs, one worker pool) are per process, not per tenant. For Go, do not copy the two-sided identity handling without deciding precedence: a synthetic per-invocation value is safe only while it stays a header and never becomes session ownership[^packages-ai-src-transports-simple-completion-transport-ts-l20-l30], and Go attribution headers are protected from caller overrides by a defaults-win merge[^src-agents-provider-attribution-ts-l493-l536], so a header channel that inherits either policy silently will either send a false conversation or drop a caller value.

[^docs-concepts-memory-md-l9-l62]: [Core/episodic files and bootstrap limits](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/memory.md#L9-L62)

[^docs-concepts-memory-md-l64-l89]: [imports remain source-specific](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/memory.md#L64-L89)

[^src-routing-resolve-route-ts-l592-l680]: [`resolveAgentRoute`](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/routing/resolve-route.ts#L592-L680)

[^src-routing-resolve-route-ts-l725-l799]: [Ordered binding tiers](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/routing/resolve-route.ts#L725-L799)

[^src-config-sessions-session-accessor-sqlite-transcript-store-ts-l76-l89]: [Transcript events are inserted into SQLite](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/src/config/sessions/session-accessor.sqlite-transcript-store.ts#L76-L89)

[^docs-concepts-session-search-md-l43-l53]: [search contract](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/session-search.md#L43-L53)

[^docs-concepts-session-search-md-l26-l38]: [Default session visibility](https://github.com/openclaw/openclaw/blob/f3c230c208d9f48a102ab457c0669e01341d91d1/docs/concepts/session-search.md#L26-L38)

[^src-agents-code-mode-ts-l69-l133]: [bounded catalog index](https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/src/agents/code-mode.ts#L69-L133)

[^docs-tools-code-mode-internals-md]: [Code Mode runtime and security boundary](https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/docs/tools/code-mode/internals.md)

[^src-agents-code-mode-execution-ts-l598-l604]: [resume ownership check](https://github.com/openclaw/openclaw/blob/e3db9654277ba8ac19a6cd6bccbda57d13931924/src/agents/code-mode-execution.ts#L598-L604)

[^docs-providers-opencode-md-l21-l36]: [stable conversation header and standalone generation](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/docs/providers/opencode.md#L21-L36)

[^docs-providers-opencode-go-md-l74-l102]: [Go catalog discovery, entitlement, and privacy](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/docs/providers/opencode-go.md#L74-L102)

[^docs-plugins-sdk-runtime-models-md-l192-l215]: [prepared completion routing header contract](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/docs/plugins/sdk-runtime/models.md#L192-L215)

[^extensions-opencode-go-index-ts-l21-l50]: [provider id, shared key, and profile ids](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/index.ts#L21-L50)

[^extensions-opencode-go-index-ts-l84-l133]: [catalog run, replay family, turn state, stream wrappers](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/index.ts#L84-L133)

[^extensions-opencode-go-provider-catalog-ts-l15-l66]: [endpoint pair, seed catalog, and upstream catalog options](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/provider-catalog.ts#L15-L66)

[^extensions-opencode-go-provider-catalog-ts-l108-l171]: [seed-only dynamic resolution and base URL normalization](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/provider-catalog.ts#L108-L171)

[^extensions-opencode-go-openclaw-plugin-json-l10-l30]: [declared endpoints, request family, and catalog head](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/openclaw.plugin.json#L10-L30)

[^extensions-opencode-go-openclaw-plugin-json-l106-l163]: [per-model api rows and preview lifecycle](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/openclaw.plugin.json#L106-L163)

[^extensions-opencode-go-reasoning-sanitizer-ts-l1-l72]: [Kimi reasoning payload stripper](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/reasoning-sanitizer.ts#L1-L72)

[^extensions-opencode-go-stream-ts-l18-l123]: [attribution, payload patch, thinking, and stalled wrappers](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/stream.ts#L18-L123)

[^extensions-opencode-go-stream-termination-ts-l27-l40]: [provider-owned stall timeouts](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/stream-termination.ts#L27-L40)

[^extensions-opencode-go-stream-termination-ts-l164-l184]: [stalled stream behavior contract](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/stream-termination.ts#L164-L184)

[^extensions-opencode-go-provider-policy-api-ts-l9-l57]: [Go thinking profiles](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/extensions/opencode-go/provider-policy-api.ts#L9-L57)

[^src-plugin-sdk-provider-catalog-live-normalize-internal-ts-l370-l432]: [npm to api table and origin guard](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/plugin-sdk/provider-catalog-live-normalize.internal.ts#L370-L432)

[^src-plugin-sdk-provider-catalog-snapshot-internal-ts-l20-l92]: [snapshot projection, lifecycle, and catalog entries](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/plugin-sdk/provider-catalog-snapshot.internal.ts#L20-L92)

[^src-plugin-sdk-provider-catalog-live-runtime-ts-l239-l318]: [upstream catalog owner](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/plugin-sdk/provider-catalog-live-runtime.ts#L239-L318)

[^packages-ai-src-transports-session-affinity-ts-l5-l33]: [opencode.ai endpoint gate and header injection](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/packages/ai/src/transports/session-affinity.ts#L5-L33)

[^packages-ai-src-transports-provider-transport-turn-state-ts-l33-l67]: [turn header filtering and simple completion headers](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/packages/ai/src/transports/provider-transport-turn-state.ts#L33-L67)

[^packages-ai-src-transports-simple-completion-transport-ts-l20-l30]: [synthetic UUID header only](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/packages/ai/src/transports/simple-completion-transport.ts#L20-L30)

[^packages-ai-src-transports-openai-completions-transport-ts-l207-l263]: [turn state resolution and header merge](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/packages/ai/src/transports/openai-completions-transport.ts#L207-L263)

[^src-agents-provider-attribution-ts-l394-l410]: [Go User-Agent policy](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/provider-attribution.ts#L394-L410)

[^src-agents-provider-attribution-ts-l493-l536]: [endpoint-class gating for Go attribution](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/provider-attribution.ts#L493-L536)

[^src-commands-doctor-config-analysis-ts-l263-l303]: [OpenCode provider override warning](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/commands/doctor-config-analysis.ts#L263-L303)

[^src-agents-embedded-agent-runner-stream-resolution-ts-l160-l200]: [session id into stream options](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/embedded-agent-runner/stream-resolution.ts#L160-L200)

[^src-agents-embedded-agent-runner-compaction-session-agent-ts-l63-l74]: [compaction reuses the session id](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/embedded-agent-runner/compaction-session-agent.ts#L63-L74)

[^src-agents-host-prepared-isolated-completion-ts-l8-l40]: [isolated completion without identity](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/host-prepared-isolated-completion.ts#L8-L40)

[^src-agents-failover-message-patterns-ts-l29-l33]: [incomplete assistant stream pattern](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/failover/message-patterns.ts#L29-L33)

[^src-agents-embedded-agent-runner-run-attempt-result-ts-l77-l135]: [settled-turn finalization context](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/agents/embedded-agent-runner/run/attempt-result.ts#L77-L135)

[^packages-ai-src-transports-openai-completions-stream-ts-l290-l300]: [Go reasoning signature relabel](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/packages/ai/src/transports/openai-completions-stream.ts#L290-L300)

[^packages-ai-src-transports-openai-completions-stream-ts-l658-l668]: [missing finish_reason error](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/packages/ai/src/transports/openai-completions-stream.ts#L658-L668)

[^src-plugins-provider-replay-helpers-ts-l196-l214]: [passthrough Gemini sanitizing policy](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/src/plugins/provider-replay-helpers.ts#L196-L214)

[^appcast-xml-l4407]: [routing identities and provider turn headers](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/appcast.xml#L4407)

[^appcast-xml-l5712]: [required conversation identity on Go and Zen](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/appcast.xml#L5712)

[^changelog-2026-9-3-md-l175]: [recover truncated Go completions after tool use](https://github.com/openclaw/openclaw/blob/34a3d4a1f883ae34d4fbb6ec8ab9c91213d496b5/CHANGELOG/2026.9.3.md#L175)
