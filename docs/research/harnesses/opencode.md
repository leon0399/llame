---
type: Reference
title: "OpenCode"
description: "TypeScript coding harness; provider, session, permission, and Go/Zen gateway boundaries"
resource: "https://github.com/anomalyco/opencode/tree/70a24697ea0028e19f22712fd63059538cb4bee7"
observed:
  date: "2026-09-21"
  revision: "70a24697ea0028e19f22712fd63059538cb4bee7"
sources:
  - id: packages-core-src-session-sql-ts-l22-l176
    resource: "https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/sql.ts#L22-L176"
    title: "Session, message, part, sequence, and context tables"
  - id: packages-core-src-session-history-ts-l13-l99
    resource: "https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/history.ts#L13-L99"
    title: "baseline-aware history loading"
  - id: packages-core-src-permission-ts-l76-l85
    resource: "https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/permission.ts#L76-L85"
    title: "Wildcard evaluation and default ask behavior"
  - id: packages-core-src-permission-ts-l190-l283
    resource: "https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/permission.ts#L190-L283"
    title: "pending approvals with saved rules"
  - id: packages-opencode-test-tool-fixtures-models-api-json-l33606-l33612
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/test/tool/fixtures/models-api.json#L33606-L33612"
    title: "committed catalogue snapshot for the Go provider"
  - id: packages-opencode-test-tool-fixtures-models-api-json-l90322-l90328
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/test/tool/fixtures/models-api.json#L90322-L90328"
    title: "committed catalogue snapshot for the Zen provider"
  - id: packages-console-app-src-routes-zen-go-v1-chat-completions-ts-l5-l13
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/go/v1/chat/completions.ts#L5-L13"
    title: "Go route pins the compatible format and the lite tier"
  - id: packages-console-app-src-routes-zen-util-handler-ts-l125-l136
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L125-L136"
    title: "gateway reads the session header and logs the tier"
  - id: packages-console-app-src-routes-zen-util-handler-ts-l234-l257
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L234-L257"
    title: "upstream header forwarding and billing marker"
  - id: packages-opencode-src-tool-registry-ts-l59-l66
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/tool/registry.ts#L59-L66"
    title: "web search enabled for the opencode providers"
  - id: packages-opencode-src-session-retry-ts-l99-l145
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/retry.ts#L99-L145"
    title: "Go quota errors become subscription actions"
  - id: packages-opencode-src-provider-provider-ts-l1499-l1516
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/provider.ts#L1499-L1516"
    title: "per-model npm and URL resolution"
  - id: packages-opencode-src-provider-provider-ts-l1755-l1779
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/provider.ts#L1755-L1779"
    title: "compatible options: includeUsage and catalog base URL"
  - id: packages-opencode-src-provider-provider-ts-l1896-l1916
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/provider.ts#L1896-L1916"
    title: "language model construction and provider loaders"
  - id: packages-opencode-src-provider-provider-ts-l1692-l1695
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/provider.ts#L1692-L1695"
    title: "deprecated catalogue models are dropped"
  - id: packages-opencode-src-provider-provider-ts-l1221-l1252
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/provider.ts#L1221-L1252"
    title: "catalogue cost mapping with tiers"
  - id: packages-web-src-content-docs-go-mdx-l285-l325
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/web/src/content/docs/go.mdx#L285-L325"
    title: "published endpoint-to-package table"
  - id: packages-web-src-content-docs-go-mdx-l100-l105
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/web/src/content/docs/go.mdx#L100-L105"
    title: "Go client requirements"
  - id: packages-opencode-src-session-llm-request-ts-l177-l202
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/llm/request.ts#L177-L202"
    title: "provider-scoped session headers"
  - id: packages-opencode-src-session-llm-request-ts-l18
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/llm/request.ts#L18"
    title: "user agent constant"
  - id: packages-opencode-src-session-prompt-ts-l226-l236
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/prompt.ts#L226-L236"
    title: "title request reuses the session id"
  - id: packages-opencode-src-session-compaction-ts-l420-l430
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/compaction.ts#L420-L430"
    title: "compaction processor keeps the parent session id"
  - id: packages-opencode-src-session-prompt-ts-l1277
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/prompt.ts#L1277"
    title: "subagent requests carry the parent session id"
  - id: packages-opencode-src-provider-transform-ts-l303-l317
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/transform.ts#L303-L317"
    title: "deepseek assistant messages get a reasoning part"
  - id: packages-opencode-src-provider-transform-ts-l322-l347
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/transform.ts#L322-L347"
    title: "interleaved reasoning field replay"
  - id: packages-opencode-src-provider-transform-ts-l553-l558
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/transform.ts#L553-L558"
    title: "deepseek-v4-flash topP for opencode providers"
  - id: packages-opencode-src-provider-transform-ts-l1367-l1371
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/transform.ts#L1367-L1371"
    title: "opencode gpt-5 cache key and reasoning summary"
  - id: packages-opencode-src-session-session-ts-l380-l401
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/session.ts#L380-L401"
    title: "local cost computation from catalogue prices"
  - id: packages-core-src-models-dev-ts-l160-l166
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/models-dev.ts#L160-L166"
    title: "catalogue source and freshness window"
  - id: packages-core-src-models-dev-ts-l217-l232
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/models-dev.ts#L217-L232"
    title: "disk cache, build-time snapshot, then fetch"
  - id: packages-console-app-src-routes-zen-util-trainingConsent-ts-l1-l3
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/trainingConsent.ts#L1-L3"
    title: "Go training consent models"
  - id: packages-console-app-src-routes-zen-util-handler-ts-l546-l560
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L546-L560"
    title: "model and format gate"
  - id: packages-console-app-src-routes-zen-util-handler-ts-l478-l536
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L478-L536"
    title: "error envelope and status codes"
  - id: packages-console-app-src-routes-zen-util-handler-ts-l172-l174
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L172-L174"
    title: "sticky routing id fallback"
  - id: packages-console-app-src-routes-zen-util-handler-ts-l641-l651
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L641-L651"
    title: "provider index from the sticky id hash"
  - id: packages-console-app-src-routes-zen-util-stickyProviderTracker-ts-l4-l11
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/stickyProviderTracker.ts#L4-L11"
    title: "sticky provider keyed by model and routing id"
  - id: packages-console-app-src-routes-zen-util-provider-openai-compatible-ts-l27-l35
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts#L27-L35"
    title: "compat helper sets affinity and include_usage"
  - id: packages-console-app-src-lib-inference-proxy-ts-l7-l19
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/lib/inference-proxy.ts#L7-L19"
    title: "Go and Zen path table"
  - id: packages-console-app-src-routes-zen-util-provider-provider-ts-l169-l180
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/provider/provider.ts#L169-L180"
    title: "cost chunk injection"
---

# OpenCode

- **Stack:** Bun/TypeScript, Effect, Drizzle/SQLite, AI SDK, Solid; MIT

A TypeScript AI SDK harness with session projections and suspendable approvals.
High confidence for comparing replay and permission UX; moderate for direct reuse
because it is a local SQLite coding client. The same upstream repository also
carries a second generation — the `packages/core` and `packages/llm` rewrite — in
[OpenCode V2](./opencode-v2.md), and the OpenCode Go / Zen gateway under
`packages/console`, so this document records both ends of the Go wire: the client
that mints the session header and the handler that reads it.

**Study**

1. **Session history.** Session, message, part, sequence, and context tables[^packages-core-src-session-sql-ts-l22-l176] plus baseline-aware history loading[^packages-core-src-session-history-ts-l13-l99] are useful comparators for llame's replay and compaction projection.
2. **Approval policy.** Wildcard evaluation and default ask behavior[^packages-core-src-permission-ts-l76-l85] and pending approvals with saved rules[^packages-core-src-permission-ts-l190-l283] show a compact permission-to-suspension seam.
3. **Go is a catalogue provider, not a client abstraction.** The tier is one entry in the provider catalogue: `opencode-go` carries `env: ["OPENCODE_API_KEY"]`, `npm: "@ai-sdk/openai-compatible"`, and `api: "https://opencode.ai/zen/go/v1"`[^packages-opencode-test-tool-fixtures-models-api-json-l33606-l33612], beside Zen's `opencode` at `https://opencode.ai/zen/v1`[^packages-opencode-test-tool-fixtures-models-api-json-l90322-l90328]. Client code barely branches on the id at all: web search is enabled for both opencode ids[^packages-opencode-src-tool-registry-ts-l59-l66], and Go-specific failures are recognised by an error-string match rather than by provider name[^packages-opencode-src-session-retry-ts-l99-l145]. On the server the tier is a property of the route, not of the model: `/zen/go/v1/*` handlers pass `modelList: "lite"` and a fixed wire per URL, so chat completions is `oa-compat`, responses is `openai`, and messages is `anthropic`[^packages-console-app-src-routes-zen-go-v1-chat-completions-ts-l5-l13], which the handler reports as `model.tier: go` and stamps upstream as `x-zen-billing-source: go`[^packages-console-app-src-routes-zen-util-handler-ts-l125-l136]. The same path table forwards legacy keys to a migration endpoint per format, including `/go/anthropic/v1/messages`[^packages-console-app-src-lib-inference-proxy-ts-l7-l19]. High confidence for #809: Go belongs to llame's provider type as a `baseUrl` plus per-model wire choice, with the tier expressed in the URL rather than the provider name.
4. **Wire selection is a resolved field, not a request-time branch.** Resolution lives in `packages/opencode/src/provider/provider.ts` and reads the catalogue columns in a fixed order: `model.provider?.npm ?? provider.npm ?? existingModel?.api.npm ?? ... ?? "@ai-sdk/openai-compatible"` for the package and `model.provider?.api ?? provider?.api ?? ... ?? modelsDev[providerID]?.api ?? ""` for the URL[^packages-opencode-src-provider-provider-ts-l1499-l1516]. Compatible transports then receive `includeUsage: true` unless the config disables it, and the URL becomes `baseURL` after variable substitution[^packages-opencode-src-provider-provider-ts-l1755-l1779]. Model construction uses `sdk.languageModel(model.api.id)` unless the provider registered a loader, which no opencode provider does[^packages-opencode-src-provider-provider-ts-l1896-l1916]. The per-model override is exactly how Go mixes wires: Grok 4.6, GPT 5.6 Luna, and the two Muse Spark contributors are published on `/responses` with `@ai-sdk/openai`, MiniMax and Qwen on `/messages` with `@ai-sdk/anthropic`, and the rest on `/chat/completions` with `@ai-sdk/openai-compatible`[^packages-web-src-content-docs-go-mdx-l285-l325]. High confidence for #809: the model entry, and only the model entry, decides the wire.
5. **One session header, set at the single request-preparation seam.** `LLMRequestPrep.prepare` emits a provider-scoped or generic header set: for provider ids starting with `opencode` it sends `x-opencode-project` (instance project id), `x-opencode-session` (session id), `x-opencode-request` (the triggering user message id), `x-opencode-client` (`OPENCODE_CLIENT`, default `cli`), and `User-Agent`; every other provider gets `x-session-affinity` and `X-Session-Id` with the same session id; a parent session adds `x-parent-session-id` on both paths, and catalogue-supplied `model.headers` merge last[^packages-opencode-src-session-llm-request-ts-l177-l202]. Because `LLM.stream()` is the only caller of `prepare`, auxiliary work inherits the identical headers: the title call passes `small: true` with the conversation's `sessionID`[^packages-opencode-src-session-prompt-ts-l226-l236], compaction builds its processor with the parent `sessionID`[^packages-opencode-src-session-compaction-ts-l420-l430], and a subagent passes `parentSessionID`[^packages-opencode-src-session-prompt-ts-l1277]. The value is the raw session id: no hash, lane suffix, or per-instance UUID, and a session always exists on this path, so Go never sees an empty header. High confidence: this is the per-request header channel llame lacks (#809).
6. **Client identification is the OpenCode user agent plus a project id.** `User-Agent: opencode/<InstallationVersion>` is a module constant in the request builder[^packages-opencode-src-session-llm-request-ts-l18], and the project header is derived from the instance context only for `opencode*` providers[^packages-opencode-src-session-llm-request-ts-l177-l202]. Go's operator documentation requires exactly this pair of behaviours: a product user agent rather than a generic SDK or HTTP-library name, and a stable `x-opencode-session` per conversation[^packages-web-src-content-docs-go-mdx-l100-l105]. The gateway does not enforce either: it reads `user-agent` only to record a metric[^packages-console-app-src-routes-zen-util-handler-ts-l125-l136], so the contract is documented rather than validated in the code available here. High confidence for item 4: identify the client with its own product string.
7. **Reasoning replay repairs are keyed on the model dialect, not on Go.** Any model id containing `deepseek` gets a `reasoning` part appended to every assistant message that lacks one, including an empty part, so the replay payload always carries the field[^packages-opencode-src-provider-transform-ts-l303-l317]; when the catalogue marks a model `interleaved: { field: "reasoning_content" }`, which Go's DeepSeek entries do, reasoning parts are stripped from content and re-emitted as `providerOptions.openaiCompatible[field]`[^packages-opencode-src-provider-transform-ts-l322-l347]; `deepseek-v4-flash` also gets `topP: 0.95` when the provider id starts with `opencode`[^packages-opencode-src-provider-transform-ts-l553-l558]; and the `gpt-5` family on opencode providers gets `promptCacheKey: <sessionID>`, encrypted-reasoning inclusion, and `reasoningSummary: "auto"`[^packages-opencode-src-provider-transform-ts-l1367-l1371]. The gateway writes an extra `cost` field into the stream as a `ping` event or an empty chat chunk[^packages-console-app-src-routes-zen-util-provider-provider-ts-l169-l180], but no client-side consumer reads it; cost is recomputed locally from catalogue prices[^packages-opencode-src-session-session-ts-l380-l401]. Moderate-to-high confidence for item 5: repair by dialect, never by provider name.
8. **The catalogue is OpenCode's own mirror, with a build-time floor.** The client fetches `${OPENCODE_MODELS_URL ?? "https://models.opencode.ai"}/api.json` into `<cache>/models.json` with a five-minute freshness window and an hourly refresh, and falls back to a build-time-injected `OPENCODE_MODELS_DEV` snapshot or an empty catalogue when fetching is disabled[^packages-core-src-models-dev-ts-l160-l166][^packages-core-src-models-dev-ts-l217-l232]. Models marked `status: "deprecated"` are deleted from the catalogue before selection[^packages-opencode-src-provider-provider-ts-l1692-l1695]; prices come from the same entries, mapped with cache reads and writes, context tiers, and an `experimentalOver200K` fallback[^packages-opencode-src-provider-provider-ts-l1221-l1252], and the local cost computation divides by million-token prices with reasoning tokens billed as output[^packages-opencode-src-session-session-ts-l380-l401]. Go-specific privacy is enforced server-side: the two Muse Spark contributors require training consent on a lite key, and the handler raises a 403 `DataPolicyError` when the workspace has not granted it[^packages-console-app-src-routes-zen-util-trainingConsent-ts-l1-l3]. Moderate confidence: copy the status and cost semantics, not the fetch pipeline.
9. **Failures are classified by the gateway's error envelope.** The handler serializes its own error classes as `{ type: "error", error: { type, message }, metadata }`: 401 for `AuthError`, `CreditsError`, `MonthlyLimitError`, `UserLimitError`, and `ModelError`; 429 with a `retry-after` header and `metadata: { workspace, limitName }` for `RateLimitError`, `FreeUsageLimitError`, `GoUsageLimitError`, and `BlackUsageLimitError`; 403 for `RegionError` and `DataPolicyError`[^packages-console-app-src-routes-zen-util-handler-ts-l478-l536]. The format gate is a `ModelError` whose message reads `Model <id> is not supported for format <format>` when the id exists in another format and `Model <id> is not supported` when it does not[^packages-console-app-src-routes-zen-util-handler-ts-l546-l560]. The client does not parse the envelope: it substring-matches `FreeUsageLimitError` and `GoUsageLimitError` in the response body, then reads `metadata.workspace`, `metadata.limitName`, and `retry-after` to build the subscribe-to-Go action or the reset-time message[^packages-opencode-src-session-retry-ts-l99-l145]. Moderate confidence for #339: a named error type plus a body-carried envelope is a cheap, copyable taxonomy.
10. **The gateway pins a conversation to a provider by hashing the session header.** `sessionId` comes from `x-opencode-session` (the request, client, and project headers are logged and available as forwarding templates such as `$session` and `$caller`)[^packages-console-app-src-routes-zen-util-handler-ts-l125-l136], the sticky-routing id is `sessionId || workspaceID || ip`[^packages-console-app-src-routes-zen-util-handler-ts-l172-l174], the chosen provider is remembered per `modelId/stickyId` in a sticky-provider table[^packages-console-app-src-routes-zen-util-stickyProviderTracker-ts-l4-l11], and the initial candidate index is a hash of the last four characters of that id[^packages-console-app-src-routes-zen-util-handler-ts-l641-l651]. Upstream, the compat helper rewrites the URL to `/chat/completions`, sets `authorization` and `x-session-affinity: <stickyId>`, and adds `stream_options.include_usage` for streaming requests[^packages-console-app-src-routes-zen-util-provider-openai-compatible-ts-l27-l35]; the `x-opencode-*` headers survive to the target only when it is the new inference stack, which also receives `x-zen-model` and the billing marker[^packages-console-app-src-routes-zen-util-handler-ts-l234-l257]. Moderate-to-high confidence: routing is why the header matters, and it is entirely server-side, so llame only needs to send one stable value.

**Caution:** The cited local SQLite implementation does not demonstrate llame's datastore isolation requirements. Validate schema and migration assumptions separately before adapting its session model. The repository contains no missing-session gate: nothing in the tree matches `MissingSessionID`, and the handler degrades to workspace id or IP when the session header is absent[^packages-console-app-src-routes-zen-util-handler-ts-l172-l174], so a live `400 MissingSessionID` must come from the inference service behind the `console-go.*` providers rather than from code readable here; llame should treat the header as required by contract, not by the sources cited. Zen and Go also share client code and catalogue shape, so provider-name checks would be a mistake: only the URL and the wire per model distinguish them.

[^packages-core-src-session-sql-ts-l22-l176]: [Session, message, part, sequence, and context tables](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/sql.ts#L22-L176)

[^packages-core-src-session-history-ts-l13-l99]: [baseline-aware history loading](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/session/history.ts#L13-L99)

[^packages-core-src-permission-ts-l76-l85]: [Wildcard evaluation and default ask behavior](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/permission.ts#L76-L85)

[^packages-core-src-permission-ts-l190-l283]: [pending approvals with saved rules](https://github.com/anomalyco/opencode/blob/b3f1a96c6dd7adeb28b36dd11add1998fc84d67b/packages/core/src/permission.ts#L190-L283)

[^packages-opencode-test-tool-fixtures-models-api-json-l33606-l33612]: [committed catalogue snapshot for the Go provider](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/test/tool/fixtures/models-api.json#L33606-L33612)

[^packages-opencode-test-tool-fixtures-models-api-json-l90322-l90328]: [committed catalogue snapshot for the Zen provider](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/test/tool/fixtures/models-api.json#L90322-L90328)

[^packages-opencode-src-tool-registry-ts-l59-l66]: [web search enabled for the opencode providers](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/tool/registry.ts#L59-L66)

[^packages-opencode-src-session-retry-ts-l99-l145]: [Go quota errors become subscription actions](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/retry.ts#L99-L145)

[^packages-console-app-src-routes-zen-go-v1-chat-completions-ts-l5-l13]: [Go route pins the compatible format and the lite tier](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/go/v1/chat/completions.ts#L5-L13)

[^packages-console-app-src-routes-zen-util-handler-ts-l125-l136]: [gateway reads the session header and logs the tier](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L125-L136)

[^packages-console-app-src-routes-zen-util-handler-ts-l234-l257]: [upstream header forwarding and billing marker](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L234-L257)

[^packages-opencode-src-provider-provider-ts-l1499-l1516]: [per-model npm and URL resolution](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/provider.ts#L1499-L1516)

[^packages-opencode-src-provider-provider-ts-l1755-l1779]: [compatible options: includeUsage and catalog base URL](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/provider.ts#L1755-L1779)

[^packages-opencode-src-provider-provider-ts-l1896-l1916]: [language model construction and provider loaders](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/provider.ts#L1896-L1916)

[^packages-opencode-src-provider-provider-ts-l1692-l1695]: [deprecated catalogue models are dropped](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/provider.ts#L1692-L1695)

[^packages-opencode-src-provider-provider-ts-l1221-l1252]: [catalogue cost mapping with tiers](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/provider.ts#L1221-L1252)

[^packages-web-src-content-docs-go-mdx-l285-l325]: [published endpoint-to-package table](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/web/src/content/docs/go.mdx#L285-L325)

[^packages-web-src-content-docs-go-mdx-l100-l105]: [Go client requirements](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/web/src/content/docs/go.mdx#L100-L105)

[^packages-opencode-src-session-llm-request-ts-l177-l202]: [provider-scoped session headers](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/llm/request.ts#L177-L202)

[^packages-opencode-src-session-llm-request-ts-l18]: [user agent constant](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/llm/request.ts#L18)

[^packages-opencode-src-session-prompt-ts-l226-l236]: [title request reuses the session id](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/prompt.ts#L226-L236)

[^packages-opencode-src-session-compaction-ts-l420-l430]: [compaction processor keeps the parent session id](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/compaction.ts#L420-L430)

[^packages-opencode-src-session-prompt-ts-l1277]: [subagent requests carry the parent session id](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/prompt.ts#L1277)

[^packages-opencode-src-provider-transform-ts-l303-l317]: [deepseek assistant messages get a reasoning part](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/transform.ts#L303-L317)

[^packages-opencode-src-provider-transform-ts-l322-l347]: [interleaved reasoning field replay](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/transform.ts#L322-L347)

[^packages-opencode-src-provider-transform-ts-l553-l558]: [deepseek-v4-flash topP for opencode providers](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/transform.ts#L553-L558)

[^packages-opencode-src-provider-transform-ts-l1367-l1371]: [opencode gpt-5 cache key and reasoning summary](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/provider/transform.ts#L1367-L1371)

[^packages-opencode-src-session-session-ts-l380-l401]: [local cost computation from catalogue prices](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/opencode/src/session/session.ts#L380-L401)

[^packages-core-src-models-dev-ts-l160-l166]: [catalogue source and freshness window](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/models-dev.ts#L160-L166)

[^packages-core-src-models-dev-ts-l217-l232]: [disk cache, build-time snapshot, then fetch](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/models-dev.ts#L217-L232)

[^packages-console-app-src-routes-zen-util-trainingConsent-ts-l1-l3]: [Go training consent models](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/trainingConsent.ts#L1-L3)

[^packages-console-app-src-routes-zen-util-handler-ts-l546-l560]: [model and format gate](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L546-L560)

[^packages-console-app-src-routes-zen-util-handler-ts-l478-l536]: [error envelope and status codes](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L478-L536)

[^packages-console-app-src-routes-zen-util-handler-ts-l172-l174]: [sticky routing id fallback](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L172-L174)

[^packages-console-app-src-routes-zen-util-handler-ts-l641-l651]: [provider index from the sticky id hash](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L641-L651)

[^packages-console-app-src-routes-zen-util-stickyProviderTracker-ts-l4-l11]: [sticky provider keyed by model and routing id](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/stickyProviderTracker.ts#L4-L11)

[^packages-console-app-src-routes-zen-util-provider-openai-compatible-ts-l27-l35]: [compat helper sets affinity and include_usage](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/provider/openai-compatible.ts#L27-L35)

[^packages-console-app-src-lib-inference-proxy-ts-l7-l19]: [Go and Zen path table](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/lib/inference-proxy.ts#L7-L19)

[^packages-console-app-src-routes-zen-util-provider-provider-ts-l169-l180]: [cost chunk injection](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/provider/provider.ts#L169-L180)
