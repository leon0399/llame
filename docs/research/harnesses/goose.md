---
type: Reference
title: "goose"
description: "ACP peer integration and tool approval boundaries"
resource: "https://github.com/aaif-goose/goose"
observed:
  date: "2026-09-21"
  revision: "e629eea1dd37b611870cce249974da7849096bc1"
sources:
  - id: crates-goose-src-tool-inspection-rs-l10-l118
    resource: "https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/tool_inspection.rs#L10-L118"
    title: "ToolInspector and result types"
  - id: crates-goose-src-tool-inspection-rs-l168-l257
    resource: "https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/tool_inspection.rs#L168-L257"
    title: "inspection composition"
  - id: crates-goose-src-context-mgmt-mod-rs-l367-l505
    resource: "https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/context_mgmt/mod.rs#L367-L505"
    title: "context reduction"
  - id: crates-goose-providers-src-declarative-definitions-opencode-go-json-l1-l12
    resource: "https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-providers/src/declarative/definitions/opencode_go.json#L1-L12"
    title: "OpenCode Go declarative provider entry"
  - id: crates-goose-providers-src-declarative-definitions-opencode-zen-json-l1-l12
    resource: "https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-providers/src/declarative/definitions/opencode_zen.json#L1-L12"
    title: "OpenCode Zen declarative provider entry"
  - id: crates-goose-provider-types-src-canonical-name-builder-rs-l53-l56
    resource: "https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-provider-types/src/canonical/name_builder.rs#L53-L56"
    title: "opencode_go and opencode_zen canonical provider names"
  - id: crates-goose-provider-types-src-canonical-data-provider-metadata-json-l1306-l1322
    resource: "https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-provider-types/src/canonical/data/provider_metadata.json#L1306-L1322"
    title: "Zen and Go as separate catalogue providers"
  - id: crates-goose-src-session-context-rs-l3-l55
    resource: "https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose/src/session_context.rs#L3-L55"
    title: "default session header, task-local, and header-name override"
  - id: crates-goose-src-providers-openai-def-rs-l209-l213
    resource: "https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose/src/providers/openai_def.rs#L209-L213"
    title: "declarative openai engine installs the session decorator"
  - id: crates-goose-providers-src-openai-rs-l737-l757
    resource: "https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-providers/src/openai.rs#L737-L757"
    title: "dynamic model list with a static fallback"
  - id: crates-goose-src-platform-extensions-summarize-rs-l201-l204
    resource: "https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose/src/agents/platform_extensions/summarize.rs#L201-L204"
    title: "summarization runs inside the session scope"
  - id: crates-goose-providers-src-api-client-rs-l314-l318
    resource: "https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-providers/src/api_client.rs#L314-L318"
    title: "client builder sets only timeouts"
  - id: crates-goose-providers-src-http-status-rs-l268-l284
    resource: "https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-providers/src/http_status.rs#L268-L284"
    title: "generic status-to-error mapping"
---

# goose

- **Stack:** Rust workspace with React/TypeScript desktop; Apache-2.0

Local agent with desktop, CLI, API, MCP, and ACP surfaces, a high-confidence
reference for typed inspection outcomes and selective context reduction. Its
execution model stays distinct from llame's durable Runs.

**Study**

1. **Typed inspection outcomes.** `ToolInspector` and result types[^crates-goose-src-tool-inspection-rs-l10-l118]
   give each inspection a typed `Allow`, `Deny`, or `RequireApproval` result with
   reason, confidence, inspector name, and finding id. Inspectors run in order,
   and restrictive composition preserves deny and approval
   decisions[^crates-goose-src-tool-inspection-rs-l168-l257], a concrete shape for
   llame approval policy, except the manager logs an inspector error and
   continues, so the pipeline is fail-open.
2. **Selective context reduction.** Context management summarizes old
   tool-call/result pairs before whole-conversation summarization: it computes a
   cutoff, preserves active calls, and processes bounded
   batches[^crates-goose-src-context-mgmt-mod-rs-l367-l505]. llame would keep its
   canonical Chat/Run history alongside any executor-context reduction.
3. **Go and Zen are declarative provider rows.** Both are JSON entries on one
   `openai` engine. Go sets `base_url: https://opencode.ai/zen/go/v1`,
   `session_id_header_override: x-opencode-session`, `catalog_provider_id: opencode-go`,
   and `dynamic_models: true`[^crates-goose-providers-src-declarative-definitions-opencode-go-json-l1-l12];
   Zen is that engine at `https://opencode.ai/zen/v1` with
   `catalog_provider_id: opencode` and `dynamic_models: false` plus a static model
   list[^crates-goose-providers-src-declarative-definitions-opencode-zen-json-l1-l12].
   The catalogue ids map to distinct models.dev providers[^crates-goose-provider-types-src-canonical-name-builder-rs-l53-l56]
   with separate `api` URLs and model counts behind one shared
   `OPENCODE_API_KEY`[^crates-goose-provider-types-src-canonical-data-provider-metadata-json-l1306-l1322].
   Go's `dynamic_models: true` sends its entry to the provider's `/v1/models`
   listing, falling back to bundled names only on a not-found
   answer[^crates-goose-providers-src-openai-rs-l737-l757]. High confidence for
   #809: "a `baseUrl`, not a second type" also covers a vendor whose header name
   differs, because the header name is configuration. Moderate confidence for
   llame's catalogue layer: live discovery with a documented fallback path, no
   pricing in the live call.
4. **A generic session header named in per-provider data.** The default
   correlation header is `agent-session-id`[^crates-goose-src-session-context-rs-l3-l55];
   the request-builder decorator deletes it and re-inserts it only when a session
   id exists in a tokio task-local, so a call with no session goes out with no
   header, not an empty one. Declarative OpenAI-engine providers build the
   decorator from `config.session_id_header_override`, which turns the one file
   above into `x-opencode-session` with no Go
   branch[^crates-goose-src-providers-openai-def-rs-l209-l213]. Auxiliary calls
   share that scope: summarization wraps its LLM call in
   `with_session_id`[^crates-goose-src-platform-extensions-summarize-rs-l201-l204], as do
   permission judging, subagents, and the security inspector. High confidence for
   #881: name the header in data, resolve the value from ambient scope, and read
   a missing scope as "do not send it".

**Caution**

Goose is a single-user local application with SQLite and local configuration; no
tenant or RLS model was found in its own Rust/documentation tree. Copy the typed
result shape and restrictive merge rule only behind llame's fail-closed,
owner-scoped authorization boundary.

Go's OpenAI-engine requests carry no client-identification header: the shared
client builder sets timeouts only[^crates-goose-providers-src-api-client-rs-l314-l318],
so a gateway requiring a product User-Agent rejects them and llame must set its
own. Error handling is not Go-aware either: 402 maps to `CreditsExhausted` and
429 to `RateLimitExceeded` for every OpenAI-compatible vendor, so "missing
session id" arrives as a generic 400 with no dedicated
classification[^crates-goose-providers-src-http-status-rs-l268-l284].

[^crates-goose-src-tool-inspection-rs-l10-l118]: [`ToolInspector` and result types](https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/tool_inspection.rs#L10-L118)

[^crates-goose-src-tool-inspection-rs-l168-l257]: [inspection composition](https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/tool_inspection.rs#L168-L257)

[^crates-goose-src-context-mgmt-mod-rs-l367-l505]: [context reduction](https://github.com/aaif-goose/goose/blob/bea9954b9378d5129c5b2ba8ae8d663d034b6c52/crates/goose/src/context_mgmt/mod.rs#L367-L505)

[^crates-goose-providers-src-declarative-definitions-opencode-go-json-l1-l12]: [OpenCode Go declarative provider entry](https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-providers/src/declarative/definitions/opencode_go.json#L1-L12)

[^crates-goose-providers-src-declarative-definitions-opencode-zen-json-l1-l12]: [OpenCode Zen declarative provider entry](https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-providers/src/declarative/definitions/opencode_zen.json#L1-L12)

[^crates-goose-provider-types-src-canonical-name-builder-rs-l53-l56]: [`opencode_go` and `opencode_zen` canonical provider names](https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-provider-types/src/canonical/name_builder.rs#L53-L56)

[^crates-goose-provider-types-src-canonical-data-provider-metadata-json-l1306-l1322]: [Zen and Go as separate catalogue providers](https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-provider-types/src/canonical/data/provider_metadata.json#L1306-L1322)

[^crates-goose-src-session-context-rs-l3-l55]: [default session header, task-local, and header-name override](https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose/src/session_context.rs#L3-L55)

[^crates-goose-src-providers-openai-def-rs-l209-l213]: [declarative openai engine installs the session decorator](https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose/src/providers/openai_def.rs#L209-L213)

[^crates-goose-providers-src-openai-rs-l737-l757]: [dynamic model list with a static fallback](https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-providers/src/openai.rs#L737-L757)

[^crates-goose-src-platform-extensions-summarize-rs-l201-l204]: [summarization runs inside the session scope](https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose/src/agents/platform_extensions/summarize.rs#L201-L204)

[^crates-goose-providers-src-api-client-rs-l314-l318]: [client builder sets only timeouts](https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-providers/src/api_client.rs#L314-L318)

[^crates-goose-providers-src-http-status-rs-l268-l284]: [generic status-to-error mapping](https://github.com/aaif-goose/goose/blob/e629eea1dd37b611870cce249974da7849096bc1/crates/goose-providers/src/http_status.rs#L268-L284)
