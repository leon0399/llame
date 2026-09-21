---
type: Reference
title: "jcode"
description: "Host-detected gateway headers, per-instance session identity, and a bash-only risk gate"
resource: "https://github.com/1jehuang/jcode"
observed:
  date: "2026-09-21"
  revision: "2a4edaa02057ac994a601311c4f03ed450e1b3c9"
sources:
  - id: crates-jcode-provider-openrouter-runtime-src-lib-rs-l433-l462
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/lib.rs#L433-L462"
    title: "is_opencode_api_base and apply_opencode_session_header"
  - id: crates-jcode-provider-openrouter-runtime-src-lib-rs-l928-l932
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/lib.rs#L928-L932"
    title: "conversation_id refreshed on fork"
  - id: crates-jcode-provider-openrouter-runtime-src-openrouter-provider-impl-rs-l790-l793
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/openrouter_provider_impl.rs#L790-L793"
    title: "a fork is a new conversation"
  - id: crates-jcode-provider-openrouter-runtime-src-openrouter-sse-stream-rs-l198
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/openrouter_sse_stream.rs#L198"
    title: "the only call site of the session header"
  - id: crates-jcode-provider-openrouter-runtime-src-openrouter-sse-stream-rs-l311-l320
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/openrouter_sse_stream.rs#L311-L320"
    title: "status-based retry classification"
  - id: crates-jcode-provider-metadata-src-catalog-rs-l17-l25
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-metadata/src/catalog.rs#L17-L25"
    title: "OpenCode Go profile constant"
  - id: crates-jcode-provider-metadata-src-catalog-rs-l674-l696
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-metadata/src/catalog.rs#L674-L696"
    title: "login descriptors and aliases for both relays"
  - id: crates-jcode-base-src-auth-external-rs-l613-l614
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-base/src/auth/external.rs#L613-L614"
    title: "OPENCODE_GO_API_KEY aliases into both profiles"
  - id: crates-jcode-provider-openrouter-runtime-src-lib-rs-l539-l548
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/lib.rs#L539-L548"
    title: "models fetched from the profile's own base URL"
  - id: crates-jcode-base-src-provider-catalog-routes-rs-l1264-l1295
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-base/src/provider/catalog_routes.rs#L1264-L1295"
    title: "per-profile model cache validated against the profile base URL"
  - id: crates-jcode-base-src-provider-catalog-rs-l360-l367
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-base/src/provider_catalog.rs#L360-L367"
    title: "OpenCode Go static model floor"
  - id: crates-jcode-base-src-model-pricing-rs-l110-l112
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-base/src/model_pricing.rs#L110-L112"
    title: "pricing delegated to the models.dev provider id"
  - id: crates-jcode-provider-openrouter-runtime-src-lib-rs-l994-l1020
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/lib.rs#L994-L1020"
    title: "DeepSeek reasoning_effort chosen by model slug"
  - id: crates-jcode-tui-src-tui-app-commands-auto-poke-errors-rs-l1-l67
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-tui/src/tui/app/commands_auto_poke_errors.rs#L1-L67"
    title: "string-marker quota and permission classification"
  - id: crates-jcode-provider-core-src-lib-rs-l594-l595
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-core/src/lib.rs#L594-L595"
    title: "JCODE_USER_AGENT"
  - id: changelog-v0-81-6-json-l1-l8
    resource: "https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/changelog/v0.81.6.json#L1-L8"
    title: "session-header fix entry"
  - id: crates-jcode-command-risk-src-lib-rs-l1-l33
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-command-risk/src/lib.rs#L1-L33"
    title: "command risk classifier rationale"
  - id: crates-jcode-app-core-src-tool-mod-rs-l799-l824
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-app-core/src/tool/mod.rs#L799-L824"
    title: "opt-in pre_tool hook"
  - id: crates-jcode-base-src-session-persistence-rs-l300-l396
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-base/src/session/persistence.rs#L300-L396"
    title: "snapshot plus journal persistence"
  - id: crates-jcode-base-src-mcp-protocol-rs-l189-l249
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-base/src/mcp/protocol.rs#L189-L249"
    title: "stdio-only MCP config"
  - id: src-main-rs-l1-l53
    resource: "https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/src/main.rs#L1-L53"
    title: "allocator tuning"
---

# jcode

- **Stack:** Rust workspace (about 90 crates), single binary per session; MIT

Single-user terminal agent advertising RAM efficiency. Listed by OpenCode Go
as a validated client from v0.81.6. Useful mainly as a compact example of
gateway-specific header injection and as a cautionary tool-gating model.

**Study**

1. **Two profiles, one wire, and a header gated on the host.** Zen and Go are
   separate `OpenAiCompatibleProfile` constants: `opencode` at
   `https://opencode.ai/zen/v1` with `OPENCODE_API_KEY` and `opencode-go` at
   `https://opencode.ai/zen/go/v1` with its own `OPENCODE_GO_API_KEY`, env file,
   and default model[^crates-jcode-provider-metadata-src-catalog-rs-l17-l25], each with
   its own login descriptor and aliases (`opencode-zen`, `zen`, and
   `opencodego`)[^crates-jcode-provider-metadata-src-catalog-rs-l674-l696]. Both resolve
   to `openai-compatible:<profile>` routes, and the session header is attached only
   when the URL host is `opencode.ai` or a subdomain of
   it[^crates-jcode-provider-openrouter-runtime-src-lib-rs-l433-l462], so a proxy
   serving the same model set does not receive it. One environment variable is
   accepted for both profiles[^crates-jcode-base-src-auth-external-rs-l613-l614]. High
   confidence for #809: a gateway is a base URL plus a per-profile header rule, and
   host detection is the fallback when the profile id is not authoritative.
2. **The session value is provider-instance state, so it dies with the process.**
   `conversation_id` is a v4 UUID minted in every constructor and re-minted on
   fork, on the stated theory that a fork is a new conversation (new session or
   subagent)[^crates-jcode-provider-openrouter-runtime-src-lib-rs-l928-l932][^crates-jcode-provider-openrouter-runtime-src-openrouter-provider-impl-rs-l790-l793].
   It is applied at exactly one place, the SSE stream entry, so every call that
   reuses the provider instance, title and compaction included, shares the
   value[^crates-jcode-provider-openrouter-runtime-src-openrouter-sse-stream-rs-l198], and
   nothing persists it across restarts. The User-Agent is the crate-wide
   `jcode/<version>`[^crates-jcode-provider-core-src-lib-rs-l594-l595]. The fix shipped
   against the gateway's 2026-09-05 enforcement
   date[^changelog-v0-81-6-json-l1-l8]. High confidence as a negative example for
   #809: exact requests matter more than durable identity here, so a restart or a
   subagent re-mints the affinity key mid-conversation.
3. **Catalogue: per-profile live list over a static floor.** The runtime issues
   `GET {api_base}/models`[^crates-jcode-provider-openrouter-runtime-src-lib-rs-l539-l548], so Go
   gets its own discovery namespace rather than sharing Zen's; the cached list is
   accepted only when its recorded source base URL matches the resolved profile,
   and a small static floor (Go: `minimax-m2.7`, `kimi-k2.5`, `glm-5`, `glm-5.1`,
   `deepseek-v4-flash`, `qwen3.5-plus`) fills the gaps[^crates-jcode-base-src-provider-catalog-routes-rs-l1264-l1295][^crates-jcode-base-src-provider-catalog-rs-l360-l367].
   Pricing is not local at all: the provider id passes through to models.dev
   unchanged[^crates-jcode-base-src-model-pricing-rs-l110-l112]. Moderate confidence for
   #809: separate per-relay caches keyed by profile, with a validated source URL.
4. **A reasoning field chosen by model family, not by vendor.** DeepSeek models
   get the DeepSeek-style top-level `reasoning_effort` on any OpenAI-compatible
   gateway, because the profile-id-only check rejected `opencode-go` serving
   DeepSeek V4 (issue #352)[^crates-jcode-provider-openrouter-runtime-src-lib-rs-l994-l1020].
   Moderate confidence for #809 and for llame's per-model request tuning: the
   deciding fact was the model slug.
5. **Failure handling is generic and string-based.** Retryability is decided from
   the parsed HTTP status, with 429 retryable and the 4xx set treated as futile,
   before loose body-substring heuristics[^crates-jcode-provider-openrouter-runtime-src-openrouter-sse-stream-rs-l311-l320],
   and user-facing quota or permission classification matches literal markers such
   as `quota exceeded`[^crates-jcode-tui-src-tui-app-commands-auto-poke-errors-rs-l1-l67].
   No typed missing-session error exists anywhere, because the header is attached
   proactively rather than detected on failure. Moderate confidence for #809's
   error mapping: a dedicated gateway error name would be more precise than
   substring matching.
6. **Snapshot plus journal persistence.** Each session writes a JSON snapshot
   and an append-only journal, with a startup-stub load that skips the
   transcript[^crates-jcode-base-src-session-persistence-rs-l300-l396].
   Low applicability; llame's Runs are Postgres rows, but the cheap partial
   reload is a pattern for list views.
7. **Allocator tuning.** jemalloc or glibc `mallopt` settings return freed
   pages quickly for a long-running process[^src-main-rs-l1-l53]. Moderate
   confidence that the same knobs apply to llame's long-lived API and worker
   processes; the PSS-sharing effect across per-session processes does not.

**Caution**

- Tool execution is fail-open by default. Only `bash` has a built-in risk
  gate, added because the tool otherwise ran with no gate of its
  own[^crates-jcode-command-risk-src-lib-rs-l1-l33]; every other tool relies
  on an off-by-default `pre_tool`
  hook[^crates-jcode-app-core-src-tool-mod-rs-l799-l824].
- MCP is stdio-only; HTTP and SSE entries parse and are silently
  skipped[^crates-jcode-base-src-mcp-protocol-rs-l189-l249], so valid-looking
  config can do nothing.
- Sessions and credentials are plain local files with no tenant model.
- There is no deprecation or delisting handling for OpenCode models; whatever the
  live list and models.dev say is what the picker offers, so a slug the relay
  still lists but no longer serves is routed and fails at request time.
- The Go connection has no client-identification strategy beyond the global
  `jcode/<version>` string, and no per-profile User-Agent or client header exists.
- Error classification for quota and permissions is literal string matching over
  the error text, so gateway wording changes silently degrade it.

[^crates-jcode-provider-openrouter-runtime-src-lib-rs-l433-l462]: [`is_opencode_api_base` and `apply_opencode_session_header`](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/lib.rs#L433-L462)

[^crates-jcode-provider-openrouter-runtime-src-lib-rs-l928-l932]: [`conversation_id` refreshed on fork](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/lib.rs#L928-L932)

[^crates-jcode-provider-openrouter-runtime-src-openrouter-provider-impl-rs-l790-l793]: [a fork is a new conversation](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/openrouter_provider_impl.rs#L790-L793)

[^crates-jcode-provider-openrouter-runtime-src-openrouter-sse-stream-rs-l198]: [the only call site of the session header](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/openrouter_sse_stream.rs#L198)

[^crates-jcode-provider-openrouter-runtime-src-openrouter-sse-stream-rs-l311-l320]: [status-based retry classification](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/openrouter_sse_stream.rs#L311-L320)

[^crates-jcode-provider-metadata-src-catalog-rs-l17-l25]: [OpenCode Go profile constant](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-metadata/src/catalog.rs#L17-L25)

[^crates-jcode-provider-metadata-src-catalog-rs-l674-l696]: [login descriptors and aliases for both relays](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-metadata/src/catalog.rs#L674-L696)

[^crates-jcode-base-src-auth-external-rs-l613-l614]: [`OPENCODE_GO_API_KEY` aliases into both profiles](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-base/src/auth/external.rs#L613-L614)

[^crates-jcode-provider-openrouter-runtime-src-lib-rs-l539-l548]: [models fetched from the profile's own base URL](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/lib.rs#L539-L548)

[^crates-jcode-base-src-provider-catalog-routes-rs-l1264-l1295]: [per-profile model cache validated against the profile base URL](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-base/src/provider/catalog_routes.rs#L1264-L1295)

[^crates-jcode-base-src-provider-catalog-rs-l360-l367]: [OpenCode Go static model floor](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-base/src/provider_catalog.rs#L360-L367)

[^crates-jcode-base-src-model-pricing-rs-l110-l112]: [pricing delegated to the models.dev provider id](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-base/src/model_pricing.rs#L110-L112)

[^crates-jcode-provider-openrouter-runtime-src-lib-rs-l994-l1020]: [DeepSeek `reasoning_effort` chosen by model slug](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-openrouter-runtime/src/lib.rs#L994-L1020)

[^crates-jcode-tui-src-tui-app-commands-auto-poke-errors-rs-l1-l67]: [string-marker quota and permission classification](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-tui/src/tui/app/commands_auto_poke_errors.rs#L1-L67)

[^crates-jcode-provider-core-src-lib-rs-l594-l595]: [`JCODE_USER_AGENT`](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/crates/jcode-provider-core/src/lib.rs#L594-L595)

[^changelog-v0-81-6-json-l1-l8]: [session-header fix entry](https://github.com/1jehuang/jcode/blob/2a4edaa02057ac994a601311c4f03ed450e1b3c9/changelog/v0.81.6.json#L1-L8)

[^crates-jcode-command-risk-src-lib-rs-l1-l33]: [command risk classifier rationale](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-command-risk/src/lib.rs#L1-L33)

[^crates-jcode-app-core-src-tool-mod-rs-l799-l824]: [opt-in `pre_tool` hook](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-app-core/src/tool/mod.rs#L799-L824)

[^crates-jcode-base-src-session-persistence-rs-l300-l396]: [snapshot plus journal persistence](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-base/src/session/persistence.rs#L300-L396)

[^crates-jcode-base-src-mcp-protocol-rs-l189-l249]: [stdio-only MCP config](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/crates/jcode-base/src/mcp/protocol.rs#L189-L249)

[^src-main-rs-l1-l53]: [allocator tuning](https://github.com/1jehuang/jcode/blob/752df77d3c13fa7a648eda257dbfcb8d3ea5974d/src/main.rs#L1-L53)
