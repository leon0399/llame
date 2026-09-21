---
type: Reference
title: "Hermes Agent"
description: "Recall framing and memory-provider lifecycle"
resource: "https://github.com/NousResearch/hermes-agent"
observed:
  date: "2026-09-21"
  revision: "ea0c2b820bd30bace020a3791d8aef0b44002e0d"
sources:
  - id: agent-memory-manager-py-l167-l285
    resource: "https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L167-L285"
    title: "sanitize_context() and StreamingContextScrubber"
  - id: agent-memory-provider-py-l58-l145
    resource: "https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_provider.py#L58-L145"
    title: "MemoryProvider"
  - id: agent-memory-manager-py-l480-l500
    resource: "https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L480-L500"
    title: "ordering"
  - id: hermes-cli-auth-py-l225-l232
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/auth.py#L225-L232"
    title: "Zen and Go as separate built-in provider tuples"
  - id: hermes-cli-models-py-l2268-l2290
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L2268-L2290"
    title: "opencode provider family and model-id normalization"
  - id: hermes-cli-models-py-l2305-l2322
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L2305-L2322"
    title: "per-model API mode prefix table"
  - id: hermes-cli-models-py-l2329-l2352
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L2329-L2352"
    title: "symmetric base-URL healing per family and wire"
  - id: hermes-cli-model-switch-py-l1653-l1661
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/model_switch.py#L1653-L1661"
    title: "model_derived_api_mode for the final model"
  - id: tui-gateway-server-py-l2321-l2333
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/tui_gateway/server.py#L2321-L2333"
    title: "resumed-session route re-derivation"
  - id: agent-opencode-affinity-py-l30-l55
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/opencode_affinity.py#L30-L55"
    title: "session header constant and per-model transport re-derivation"
  - id: agent-opencode-affinity-py-l92-l150
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/opencode_affinity.py#L92-L150"
    title: "session headers, ephemeral fallback, custom header, and merge point"
  - id: agent-chat-completion-helpers-py-l1475-l1490
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/chat_completion_helpers.py#L1475-L1490"
    title: "affinity headers on every transport"
  - id: agent-auxiliary-client-py-l6622-l6624
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/auxiliary_client.py#L6622-L6624"
    title: "auxiliary calls reuse the conversation affinity"
  - id: hermes-cli-config-providers-py-l110-l122
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/config_providers.py#L110-L122"
    title: "sessionAffinityHeader config key"
  - id: hermes-cli-config-providers-py-l512-l524
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/config_providers.py#L512-L524"
    title: "get_custom_provider_session_affinity_header"
  - id: agent-prompt-caching-py-l91-l100
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/prompt_caching.py#L91-L100"
    title: "Qwen cache-marker families and the measured 1h allow-list"
  - id: agent-agent-runtime-helpers-py-l1611-l1616
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/agent_runtime_helpers.py#L1611-L1616"
    title: "cache markers required for Go Qwen routes"
  - id: agent-agent-runtime-helpers-py-l1704-l1710
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/agent_runtime_helpers.py#L1704-L1710"
    title: "Zen rejects Anthropic-style content blocks"
  - id: agent-reasoning-effort-py-l216-l224
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/reasoning_effort.py#L216-L224"
    title: "x-preview-f-free effort translation"
  - id: agent-error-classifier-py-l217-l224
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/error_classifier.py#L217-L224"
    title: "tool-content string coercion for the Go relay"
  - id: agent-vision-message-prep-py-l298-l311
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/vision_message_prep.py#L298-L311"
    title: "dots preserved in non-Claude model ids"
  - id: agent-transports-codex-py-l88-l103
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/transports/codex.py#L88-L103"
    title: "OpenCode responses-backend detection and reserved tool names"
  - id: agent-models-dev-py-l115-l120
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/models_dev.py#L115-L120"
    title: "Zen and Go mapped to separate models.dev providers"
  - id: hermes-cli-models-catalog-static-py-l223-l247
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models_catalog_static.py#L223-L247"
    title: "curated discovery floors for both relays"
  - id: hermes-cli-models-py-l1520-l1532
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L1520-L1532"
    title: "free slugs the relay still lists but no longer serves"
  - id: hermes-cli-models-py-l1590-l1597
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L1590-L1597"
    title: "delisted-id filter applied to the final rows"
  - id: hermes-cli-providers-py-l524-l544
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/providers.py#L524-L544"
    title: "live-first picker providers and models.dev preference"
  - id: hermes-cli-providers-py-l266-l272
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/providers.py#L266-L272"
    title: "flat-namespace resellers are not routing aggregators"
  - id: hermes-cli-doctor-connectivity-py-l80-l84
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/doctor_connectivity.py#L80-L84"
    title: "no shared models endpoint probed for Go"
  - id: hermes-cli-auth-py-l1149-l1154
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/auth.py#L1149-L1154"
    title: "removal note for the keyless free tier"
  - id: plugins-model-providers-opencode-zen-init-py-l16-l20
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L16-L20"
    title: "attribution headers for both relays"
  - id: plugins-model-providers-opencode-zen-init-py-l56-l76
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L56-L76"
    title: "Go subscription usage read from the literal usage endpoint"
  - id: plugins-model-providers-opencode-zen-init-py-l58-l67
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L58-L67"
    title: "per-model output cap for the Go relay"
  - id: plugins-model-providers-opencode-zen-init-py-l120-l127
    resource: "https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L120-L127"
    title: "Go profile registration with attribution defaults and the vision-tool-message gate"
---

# Hermes Agent

- **Stack:** Python; multi-platform gateway; FTS5 session search

Self-improving agent with agent-curated memory, isolated subagents, and a pluggable memory-provider boundary. The useful comparison is lifecycle and context handling: llame owns Chat/Run identity and isolation, while any future memory implementation would be an adapter behind those boundaries.

**Study**

1. **Recall-time framing and scrubbing.** `sanitize_context()` and `StreamingContextScrubber`[^agent-memory-manager-py-l167-l285] remove fake memory/system framing, handle split tags in streams, and wrap recalled data as reference material. High confidence applicability to llame's model-visible context items; this is a framing control, not a write-time content scan.
2. **Provider lifecycle and boundary ordering.** `MemoryProvider`[^agent-memory-provider-py-l58-l145] defines initialization, prefetch, turn sync, and session callbacks. The manager serializes background writes and queues end-of-session extraction before switching sessions (ordering[^agent-memory-manager-py-l480-l500]). Moderate confidence for future executor or memory adapters; Hermes' session lineage differs from llame's Chat/Run model.
3. **Zen and Go are two providers over one relay, and the wire is per model.**
   Both register as separate built-in tuples with their own base URLs, key env
   vars, and comments explaining that Go mixes API
   surfaces[^hermes-cli-auth-py-l225-l232]. Routing is a prefix table keyed by family:
   Go sends `gpt-`/`grok-`/`muse-spark` to Responses and
   `minimax-`/`qwen`/`union-alpha` to Messages, Zen adds `claude-`, and everything
   else falls through to Chat
   Completions[^hermes-cli-models-py-l2305-l2322]. Because a persisted wire format is
   wrong for every model but the one it was saved for, the mode is re-derived from
   the final model on the switch path[^hermes-cli-model-switch-py-l1653-l1661] and again
   on session resume in the TUI gateway[^tui-gateway-server-py-l2321-l2333], and the base
   URL is healed symmetrically per family and
   wire[^hermes-cli-models-py-l2329-l2352]. Family membership also matches custom
   entries named after a built-in family, and config ids are normalized to the bare
   slug used in requests before the table
   lookup[^hermes-cli-models-py-l2268-l2290]. High confidence for #809: never trust a
   stored wire for a gateway that serves several.
4. **One merge point stamps the session header on every request.** The header
   name lives in one constant; the value is a normalized conversation scope
   (host-declared affinity scope, then the ambient conversation root, then the
   session id) and, when nothing resolves, an ephemeral
   `oneshot-<hex>`[^agent-opencode-affinity-py-l92-l150]. The docstring states the reason
   plainly: Go rejects requests without the header, HTTP 400
   `MissingSessionID`[^agent-opencode-affinity-py-l92-l150]. The same module owns the
   per-model transport decision, returning the re-derived wire and healed base URL
   for relay targets and deferring to a custom entry that declares its own
   `api_mode`[^agent-opencode-affinity-py-l30-l55]. Exactly two call sites
   use the merge helper, the main builder for all three
   transports[^agent-chat-completion-helpers-py-l1475-l1490] and the auxiliary client
   used by compression, titles, vision, and MoA[^agent-auxiliary-client-py-l6622-l6624],
   and existing per-call headers win so a caller-pinned value is never
   overwritten[^agent-opencode-affinity-py-l92-l150]. High confidence for #809: the
   value is ambient session state, not a call-site argument, and the fallback keeps
   stateless calls from failing the gateway.
5. **An operator-named affinity header for arbitrary gateways.** A custom
   provider entry may declare `session_affinity_header` (camelCase alias
   `sessionAffinityHeader`)[^hermes-cli-config-providers-py-l110-l122], the name is read
   back per route[^hermes-cli-config-providers-py-l512-l524], and the same merge point
   sends the conversation key under that name
   instead[^agent-opencode-affinity-py-l92-l150]. The documented framing is that the
   identifier is never shipped to an endpoint that did not ask for it, and the
   motivating case is a session-aware proxy re-classifying an agent-loop request as
   a new conversation. High confidence for #881: this is a working prior art for a
   generic per-provider header channel, with the value still owned by the
   harness.
6. **Go-aware caching and format repairs.** Alibaba-family routing clamps
   `cache_control` TTLs to the five-minute tier by default, with Go as the only
   wire-measured exception allowed to keep a one-hour
   marker[^agent-prompt-caching-py-l91-l100]. Without Anthropic-style markers the Go Qwen
   route reports zero cache hits and re-bills the prompt every
   turn[^agent-agent-runtime-helpers-py-l1611-l1616], while Zen's relay rejects the
   block-array content that markers produce, a 400 recorded against
   it[^agent-agent-runtime-helpers-py-l1704-l1710]. Smaller repairs: a translation for
   Zen's `x-preview-f-free` stealth model that accepts only low, high, and
   max[^agent-reasoning-effort-py-l216-l224]; tool-content coercion patterns that name
   the Go relay's pydantic-style 422 wording[^agent-error-classifier-py-l217-l224]; dot
   preservation in non-Claude model ids on the Anthropic
   wire[^agent-vision-message-prep-py-l298-l311]; and reserved tool names stripped on the
   Responses backend behind an OpenCode-host
   check[^agent-transports-codex-py-l88-l103]. The Go provider profile also caps
   `mimo-v2.5-pro` because the relay's default output budget exceeds what that
   vendor accepts[^plugins-model-providers-opencode-zen-init-py-l58-l67], and declares
   that tool messages cannot carry list-type content, since both the console relay
   and the vendor reject it and the rejected row stays in
   history[^plugins-model-providers-opencode-zen-init-py-l120-l127]. Moderate to high
   confidence that llame needs its own equivalents: caching and reasoning-field
   behavior differ per model, not per provider.
7. **Attribution headers through provider defaults, and a usage endpoint.** Both
   relays get fixed `HTTP-Referer`, `X-Title`, and `User-Agent: HermesAgent/<version>`
   headers installed as provider default headers, so they survive model switches
   and credential rotation[^plugins-model-providers-opencode-zen-init-py-l16-l20][^plugins-model-providers-opencode-zen-init-py-l120-l127].
   The Go profile also reads subscription windows from
   `https://opencode.ai/zen/go/v1/usage` with the same bearer key, using the literal
   URL because the runtime base URL loses its `/v1` suffix in Messages
   mode[^plugins-model-providers-opencode-zen-init-py-l56-l76]. High confidence for
   #809 and #765: this is the client-identification and quota pair a Go adapter
   needs, and both belong to the provider profile rather than to individual call
   sites.
8. **Catalogue: live-first with a curated floor, delisting filters, and no Go
   probe.** Go and Zen map to distinct models.dev providers[^agent-models-dev-py-l115-l120];
   both sit in the live-first picker set[^hermes-cli-providers-py-l524-l544] over curated
   floors whose ranges carry their own sync comments[^hermes-cli-models-catalog-static-py-l223-l247];
   retired ids that the relay still lists are filtered from the final
   rows[^hermes-cli-models-py-l1590-l1597] together with free slugs the relay no longer
   serves[^hermes-cli-models-py-l1520-l1532]. The doctor health check deliberately skips
   Go's models endpoint while keeping Zen's[^hermes-cli-doctor-connectivity-py-l80-l84], yet
   the earlier flat-namespace comment treats both as resellers whose live listing
   returns bare model ids[^hermes-cli-providers-py-l266-l272]. Moderate confidence: copy
   the live-first merge and the delisting filter; verify Go's model listing
   yourself before depending on it.

**Caution:** recalled data is described as authoritative reference data inside a known wrapper. That framing does not provide tenant authorization, provenance enforcement, or isolation between users.

For a Go adapter, three things here are specific to Hermes and should not be copied
blindly. Attribution headers are the only client identification, and they are
inherited from the OpenRouter-style profile convention rather than chosen for the
relay; a gateway that validates a specific product token should be given one
explicitly. The `MissingSessionID` failure has no reactive path at all: every call
site must go through the single merge helper, and any new call path that bypasses
it fails closed at the gateway rather than at the harness. And the keyless
`opencode-free` provider was removed after the relay began answering it with a
403, so a free tier is not a stable design
assumption[^hermes-cli-auth-py-l1149-l1154].

[^agent-memory-manager-py-l167-l285]: [`sanitize_context()` and `StreamingContextScrubber`](https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L167-L285)

[^agent-memory-provider-py-l58-l145]: [`MemoryProvider`](https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_provider.py#L58-L145)

[^agent-memory-manager-py-l480-l500]: [ordering](https://github.com/NousResearch/hermes-agent/blob/6271d772d2dab79ec613c08038ecf3039ad27a0c/agent/memory_manager.py#L480-L500)

[^hermes-cli-auth-py-l225-l232]: [Zen and Go as separate built-in provider tuples](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/auth.py#L225-L232)

[^hermes-cli-models-py-l2268-l2290]: [opencode provider family and model-id normalization](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L2268-L2290)

[^hermes-cli-models-py-l2305-l2322]: [per-model API mode prefix table](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L2305-L2322)

[^hermes-cli-models-py-l2329-l2352]: [symmetric base-URL healing per family and wire](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L2329-L2352)

[^hermes-cli-model-switch-py-l1653-l1661]: [`model_derived_api_mode` for the final model](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/model_switch.py#L1653-L1661)

[^tui-gateway-server-py-l2321-l2333]: [resumed-session route re-derivation](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/tui_gateway/server.py#L2321-L2333)

[^agent-opencode-affinity-py-l30-l55]: [session header constant and per-model transport re-derivation](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/opencode_affinity.py#L30-L55)

[^agent-opencode-affinity-py-l92-l150]: [session headers, ephemeral fallback, custom header, and merge point](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/opencode_affinity.py#L92-L150)

[^agent-chat-completion-helpers-py-l1475-l1490]: [affinity headers on every transport](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/chat_completion_helpers.py#L1475-L1490)

[^agent-auxiliary-client-py-l6622-l6624]: [auxiliary calls reuse the conversation affinity](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/auxiliary_client.py#L6622-L6624)

[^hermes-cli-config-providers-py-l110-l122]: [`sessionAffinityHeader` config key](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/config_providers.py#L110-L122)

[^hermes-cli-config-providers-py-l512-l524]: [`get_custom_provider_session_affinity_header`](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/config_providers.py#L512-L524)

[^agent-prompt-caching-py-l91-l100]: [Qwen cache-marker families and the measured 1h allow-list](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/prompt_caching.py#L91-L100)

[^agent-agent-runtime-helpers-py-l1611-l1616]: [cache markers required for Go Qwen routes](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/agent_runtime_helpers.py#L1611-L1616)

[^agent-agent-runtime-helpers-py-l1704-l1710]: [Zen rejects Anthropic-style content blocks](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/agent_runtime_helpers.py#L1704-L1710)

[^agent-reasoning-effort-py-l216-l224]: [`x-preview-f-free` effort translation](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/reasoning_effort.py#L216-L224)

[^agent-error-classifier-py-l217-l224]: [tool-content string coercion for the Go relay](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/error_classifier.py#L217-L224)

[^agent-vision-message-prep-py-l298-l311]: [dots preserved in non-Claude model ids](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/vision_message_prep.py#L298-L311)

[^agent-transports-codex-py-l88-l103]: [OpenCode responses-backend detection and reserved tool names](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/transports/codex.py#L88-L103)

[^agent-models-dev-py-l115-l120]: [Zen and Go mapped to separate models.dev providers](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/agent/models_dev.py#L115-L120)

[^hermes-cli-models-catalog-static-py-l223-l247]: [curated discovery floors for both relays](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models_catalog_static.py#L223-L247)

[^hermes-cli-models-py-l1520-l1532]: [free slugs the relay still lists but no longer serves](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L1520-L1532)

[^hermes-cli-models-py-l1590-l1597]: [delisted-id filter applied to the final rows](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/models.py#L1590-L1597)

[^hermes-cli-providers-py-l524-l544]: [live-first picker providers and models.dev preference](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/providers.py#L524-L544)

[^hermes-cli-providers-py-l266-l272]: [flat-namespace resellers are not routing aggregators](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/providers.py#L266-L272)

[^hermes-cli-doctor-connectivity-py-l80-l84]: [no shared models endpoint probed for Go](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/doctor_connectivity.py#L80-L84)

[^hermes-cli-auth-py-l1149-l1154]: [removal note for the keyless free tier](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/hermes_cli/auth.py#L1149-L1154)

[^plugins-model-providers-opencode-zen-init-py-l16-l20]: [attribution headers for both relays](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L16-L20)

[^plugins-model-providers-opencode-zen-init-py-l56-l76]: [Go subscription usage read from the literal usage endpoint](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L56-L76)

[^plugins-model-providers-opencode-zen-init-py-l58-l67]: [per-model output cap for the Go relay](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L58-L67)

[^plugins-model-providers-opencode-zen-init-py-l120-l127]: [Go profile registration with attribution defaults and the vision-tool-message gate](https://github.com/NousResearch/hermes-agent/blob/ea0c2b820bd30bace020a3791d8aef0b44002e0d/plugins/model-providers/opencode-zen/__init__.py#L120-L127)
