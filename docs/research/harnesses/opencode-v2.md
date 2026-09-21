---
type: Reference
title: "OpenCode V2"
description: "Per-model protocol dispatch, hand-rolled wire protocols, and a construction-time versus per-request header seam; Go and Zen arrive as catalog entries"
resource: "https://github.com/anomalyco/opencode/tree/70a24697ea0028e19f22712fd63059538cb4bee7"
observed:
  date: "2026-09-21"
  revision: "70a24697ea0028e19f22712fd63059538cb4bee7"
sources:
  - id: packages-cli-package-json-l18-l23
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/cli/package.json#L18-L23"
    title: "CLI depends on the rewrite packages"
  - id: branch-2-0
    resource: "https://github.com/anomalyco/opencode/tree/7a6ce05d0939826aa6c8e1c481489a713b2d633f"
    title: "stale 2.0 branch"
  - id: packages-core-src-session-runner-model-ts-l131-l179
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/session/runner/model.ts#L131-L179"
    title: "per-model package dispatch and UnsupportedApiError"
  - id: v2-docs-providers
    resource: "https://opencode.ai/v2/docs/providers"
    title: "documented package, headers, and per-model overrides"
  - id: packages-llm-package-json-l45-l50
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/package.json#L45-L50"
    title: "packages/llm dependency set"
  - id: packages-llm-src-protocols-index-ts-l1-l6
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/protocols/index.ts#L1-L6"
    title: "hand-rolled protocol modules"
  - id: packages-llm-src-protocols-openai-compatible-chat-ts-l10-l22
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/protocols/openai-compatible-chat.ts#L10-L22"
    title: "compatible route reuses the OpenAI Chat protocol"
  - id: packages-core-package-json-l64-l83
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/core/package.json#L64-L83"
    title: "AI SDK dependencies retained in core"
  - id: packages-llm-src-route-transport-http-ts-l100-l102
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/route/transport/http.ts#L100-L102"
    title: "route headers first, request headers overlay"
  - id: packages-llm-src-protocols-anthropic-messages-ts-l845-l853
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/protocols/anthropic-messages.ts#L845-L853"
    title: "static anthropic-version header at route construction"
  - id: packages-core-src-session-runner-llm-ts-l204-l214
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/session/runner/llm.ts#L204-L214"
    title: "session header trio and promptCacheKey"
  - id: packages-opencode-src-session-llm-request-ts-l187-l201
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/opencode/src/session/llm/request.ts#L187-L201"
    title: "legacy x-opencode-* header scheme"
  - id: packages-llm-src-cache-policy-ts-l42
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/cache-policy.ts#L42"
    title: "RESPECTS_INLINE_HINTS"
  - id: packages-llm-src-cache-policy-ts-l99-l100
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/cache-policy.ts#L99-L100"
    title: "route-id cache gate"
  - id: packages-opencode-src-provider-transform-ts-l468-l484
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/opencode/src/provider/transform.ts#L468-L484"
    title: "legacy name-substring caching heuristic"
  - id: packages-core-src-session-compaction-ts-l203-l209
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/session/compaction.ts#L203-L209"
    title: "compaction reuses the parent request http"
  - id: packages-llm-src-schema-errors-ts-l160-l172
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/schema/errors.ts#L160-L172"
    title: "LLMErrorReason variants"
  - id: packages-llm-src-route-executor-ts-l225-l275
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/route/executor.ts#L225-L275"
    title: "statusReason classification"
  - id: packages-core-src-plugin-provider-opencode-ts-l127
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/plugin/provider/opencode.ts#L127"
    title: "provider headers from the remote catalog"
  - id: packages-core-src-plugin-provider-opencode-ts-l151
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/plugin/provider/opencode.ts#L151"
    title: "model headers from the remote catalog"
  - id: packages-core-src-session-runner-llm-ts-l83
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/session/runner/llm.ts#L83"
    title: "title and summary work pending"
  - id: packages-core-src-tool-builtins-ts-l26-l29
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/tool/builtins.ts#L26-L29"
    title: "task tool not yet ported"
  - id: packages-llm-package-json-l3-l4
    resource: "https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/package.json#L3-L4"
    title: "package name @opencode-ai/llm"
  - id: packages-cli-package-json-l18-l28
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/cli/package.json#L18-L28"
    title: "CLI dependencies at the refreshed revision"
  - id: packages-core-package-json-l63-l94
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/package.json#L63-L94"
    title: "core dependencies include the hand-rolled llm package"
  - id: packages-core-src-session-runner-model-ts-l134-l179
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/session/runner/model.ts#L134-L179"
    title: "three-package dispatch and supported() at the refreshed revision"
  - id: packages-core-src-session-runner-llm-ts-l206-l215
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/session/runner/llm.ts#L206-L215"
    title: "session header trio and prompt cache key at the refreshed revision"
  - id: packages-core-src-session-compaction-ts-l203-l206
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/session/compaction.ts#L203-L206"
    title: "compaction reuses the parent request http at the refreshed revision"
  - id: packages-llm-src-protocols-index-ts-l1-l6-refreshed
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/llm/src/protocols/index.ts#L1-L6"
    title: "six protocol modules at the refreshed revision"
  - id: packages-llm-src-route-transport-http-ts-l95-l105
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/llm/src/route/transport/http.ts#L95-L105"
    title: "header merge at the refreshed revision"
  - id: packages-llm-src-protocols-anthropic-messages-ts-l852
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/llm/src/protocols/anthropic-messages.ts#L852"
    title: "static anthropic-version header at the refreshed revision"
  - id: packages-llm-src-route-executor-ts-l225-l266
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/llm/src/route/executor.ts#L225-L266"
    title: "statusReason classification at the refreshed revision"
  - id: packages-core-src-plugin-provider-opencode-ts-l121-l171
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/plugin/provider/opencode.ts#L121-L171"
    title: "catalog transform: package overrides, headers, deprecation"
  - id: packages-core-src-plugin-provider-opencode-ts-l200-l221
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/plugin/provider/opencode.ts#L200-L221"
    title: "remote catalog fetch behind the credential"
  - id: packages-core-src-tool-builtins-ts-l24-l28
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/tool/builtins.ts#L24-L28"
    title: "task tool still unported at the refreshed revision"
  - id: packages-web-src-content-docs-go-mdx-l285-l325
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/web/src/content/docs/go.mdx#L285-L325"
    title: "published Go endpoint-to-package table"
  - id: packages-web-src-content-docs-go-mdx-l100-l105
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/web/src/content/docs/go.mdx#L100-L105"
    title: "Go client requirements"
  - id: packages-console-app-src-routes-zen-util-handler-ts-l125-l136
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L125-L136"
    title: "gateway reads the session header"
  - id: packages-llm-src-protocols-openai-chat-ts-l211
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/llm/src/protocols/openai-chat.ts#L211"
    title: "reasoning_content is read from native provider output"
  - id: packages-llm-src-protocols-openai-chat-ts-l419-l420
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/llm/src/protocols/openai-chat.ts#L419-L420"
    title: "reasoning delta becomes a reasoning part"
  - id: packages-core-src-session-model-request-ts-l237-l247
    resource: "https://github.com/anomalyco/opencode/blob/4d94777d4d08dedff776e79acef1bdc962049c4f/packages/core/src/session/model-request.ts#L237-L247"
    title: "shipped line sends both header families"
  - id: packages-cli-package-json-l3-l4
    resource: "https://github.com/anomalyco/opencode/blob/4d94777d4d08dedff776e79acef1bdc962049c4f/packages/cli/package.json#L3-L4"
    title: "shipped CLI package and version"
  - id: packages-ai-package-json-l3-l37
    resource: "https://github.com/anomalyco/opencode/blob/4d94777d4d08dedff776e79acef1bdc962049c4f/packages/ai/package.json#L3-L37"
    title: "shipped wire package and dependency set"
  - id: github-workflows-models-snapshot-yml-l9-l40
    resource: "https://github.com/anomalyco/opencode/blob/4d94777d4d08dedff776e79acef1bdc962049c4f/.github/workflows/models-snapshot.yml#L9-L40"
    title: "daily catalog snapshot refresh targets the v2 branch"
  - id: packages-core-src-models-dev-snapshot-txt
    resource: "https://github.com/anomalyco/opencode/blob/4d94777d4d08dedff776e79acef1bdc962049c4f/packages/core/src/models-dev/snapshot.txt"
    title: "bundled catalog snapshot on the shipped line"
---

# OpenCode V2

- **Stack:** Bun/TypeScript, Effect, Drizzle/SQLite, hand-rolled wire protocols; MIT

The rewrite shipping beside [OpenCode](./opencode.md) on the same `dev` line: `packages/core` and
`packages/llm` next to the legacy `packages/opencode` tree. Two observations are recorded here and
they diverge — the operator contract at `/v2/docs` (fetched 2026-09-21) and the public tree at
`70a24697ea` — so the documented surface is wider than what `dev` implements. The refresh also
shows where the contract does hold: branch `v2` carries a rewrite-only tree at version 2.0.12, and
the documented `@opencode/ai/providers/*` packages exist there. Study it for per-model protocol
selection and for how a harness separates provider identity from session correlation in its request
headers.

**Study**

1. **One repository, two generations.** `dev` at `70a24697ea` carries the legacy
   `packages/opencode` tree and the rewrite (`packages/core` and `packages/llm`) side by side;
   the shipping CLI depends on `@opencode-ai/core`, `-sdk`, `-server`, and `-tui` rather than
   on the legacy package[^packages-cli-package-json-l18-l23][^packages-cli-package-json-l18-l28]. Branch `2.0` is not V2: it sits on
   the old line with `packages/opencode` at `1.4.3` and no `core`, `llm`, or `cli`
   package[^branch-2-0]. Branch `v2` is the rewrite's release line: `packages/cli` is
   `@opencode/cli` at `2.0.12`, `packages/ai` replaces `packages/llm`, the legacy tree is
   gone, and tags `v2.0.0` through `v2.0.12` mark its
   releases[^packages-cli-package-json-l3-l4][^packages-ai-package-json-l3-l37]. High confidence: read V2 as `dev` for
   source shape, and as branch `v2` for the shipped contract.
2. **Per-model protocol dispatch.** Model resolution switches on `model.api.package` and
   accepts exactly three values — `@ai-sdk/openai`, `@ai-sdk/anthropic`, and
   `@ai-sdk/openai-compatible` with a URL — failing with `UnsupportedApiError` for everything
   else, including every `native`-API
   model[^packages-core-src-session-runner-model-ts-l131-l179][^packages-core-src-session-runner-model-ts-l134-l179].
   The operator contract exposes the same axis: a provider-level `package` with a per-model
   `package` override, a protocol-suffixed package list (`.../openai/chat`, `.../openai/responses`,
   `.../google-vertex/messages`, and others), and `anthropic-compatible` as a package distinct
   from `anthropic`[^v2-docs-providers]. High confidence as the shape llame needs for #809;
   `anthropic-compatible` is also the documented way to say "Messages wire format at someone
   else's URL" (#339).
3. **A hand-rolled provider layer.** `packages/llm` declares five dependencies and no
   `@ai-sdk/*` package[^packages-llm-package-json-l45-l50]; the wire formats are implemented
   under `packages/llm/src/protocols/`[^packages-llm-src-protocols-index-ts-l1-l6], which now
   holds six modules including `bedrock-converse` and
   `gemini`[^packages-llm-src-protocols-index-ts-l1-l6-refreshed], and the
   compatible-chat route reuses `OpenAIChat.protocol` end to end and overrides only the route
   id, endpoint, and
   framing[^packages-llm-src-protocols-openai-compatible-chat-ts-l10-l22]. The sibling
   `packages/core` still depends on the AI SDK set and now also on the hand-rolled
   `@opencode-ai/llm` package[^packages-core-package-json-l64-l83][^packages-core-package-json-l63-l94]. Moderate-to-high
   confidence for #809: the protocol surface is small enough to own, and the compatible route
   is the pattern for putting a second URL behind an existing wire format.
4. **Construction-time versus per-request headers.** The transport has one merge seam: route
   headers are spread first, then the request's `http.headers`
   overlay[^packages-llm-src-route-transport-http-ts-l100-l102][^packages-llm-src-route-transport-http-ts-l95-l105], so a static protocol header
   such as `anthropic-version` is fixed at route
   construction[^packages-llm-src-protocols-anthropic-messages-ts-l845-l853][^packages-llm-src-protocols-anthropic-messages-ts-l852] while correlation
   arrives per request. The core runner on `dev` adds exactly `x-session-affinity`, `X-Session-Id`, and
   `x-parent-session-id` when a parent
   exists[^packages-core-src-session-runner-llm-ts-l204-l214][^packages-core-src-session-runner-llm-ts-l206-l215], while the shipped rewrite goes
   further and sends the OpenCode client headers too: `x-opencode-session`,
   `x-opencode-project`, `x-opencode-client`, and `User-Agent` from the app identity, beside
   the same affinity pair[^packages-core-src-session-model-request-ts-l237-l247]. The legacy
   `x-opencode-project`/`-session`/`-request`/`-client` scheme also exists on `dev`, in the
   legacy request builder[^packages-opencode-src-session-llm-request-ts-l187-l201]. High
   confidence that this is the separation llame's per-call headers want (#809): provider
   identity at construction, session identity per request.
5. **Cache identity derived from the session.** `promptCacheKey` is the session id minus its
   `ses_` prefix when it matches the `ses_<64 hex>` form (the raw id otherwise), passed through
   provider options rather than a
   header[^packages-core-src-session-runner-llm-ts-l204-l214][^packages-core-src-session-runner-llm-ts-l206-l215]; the shipped line instead derives it
   from the fork root, so nested forks share the root session's cache
   key[^packages-core-src-session-model-request-ts-l237-l247]. Cache-breakpoint injection is
   gated on the route id, matching exactly the `anthropic-messages` and `bedrock-converse`
   protocols[^packages-llm-src-cache-policy-ts-l42][^packages-llm-src-cache-policy-ts-l99-l100],
   where the legacy tree instead guessed from provider ids, model ids, and an
   `@ai-sdk/alibaba` special
   case[^packages-opencode-src-provider-transform-ts-l468-l484]. Moderate confidence for #809:
   it is a concrete alternative to cache keys derived from message content, and Go's own
   caching is keyed on the session header server-side rather than on this
   key[^packages-console-app-src-routes-zen-util-handler-ts-l125-l136].
6. **Auxiliary calls reuse the parent session verbatim.** Compaction builds its summarization
   request with `http: input.request.http`, so it carries the identical headers and session id
   as the conversation it
   summarizes[^packages-core-src-session-compaction-ts-l203-l209][^packages-core-src-session-compaction-ts-l203-l206], with no derived or per-model
   id. Moderate confidence for #809: one Chat, one correlation identity, including for
   background work.
7. **Errors classified by status and body text.** `LLMErrorReason` is a ten-variant tagged
   union with a per-variant
   `retryable`[^packages-llm-src-schema-errors-ts-l160-l172], and `statusReason` assigns it
   from the HTTP status alone (401/403, 429, 400/404/409/413/422, `>=500`) plus regexes over
   the truncated response body for content-policy and quota
   phrasings[^packages-llm-src-route-executor-ts-l225-l275][^packages-llm-src-route-executor-ts-l225-l266]; a structured provider `error.type`
   is never read. Moderate confidence as a comparison for llame's provider error mapping
   (#339).
8. **A remote, auth-gated provider catalog.** The `opencode` provider fetches its catalog
   remotely behind device OAuth (`GET <server>/api/config` with the bearer token and an
   optional org header)[^packages-core-src-plugin-provider-opencode-ts-l200-l221], and that
   response supplies provider-level request headers and per-model
   headers[^packages-core-src-plugin-provider-opencode-ts-l127][^packages-core-src-plugin-provider-opencode-ts-l151],
   so per-model routing and static headers for the Go deployment are decided server-side and
   are not readable from this repository. The transform also carries the catalog's own
   `npm`/`api` fields into `provider.api` and `model.api`, applies per-model `provider.npm`
   overrides, copies per-model and per-variant headers and bodies into the request, maps
   `cost`, and disables a model when its catalog `status` is `deprecated`
   [^packages-core-src-plugin-provider-opencode-ts-l121-l171]. Moderate confidence as a
   boundary comparison: llame's provider configuration is local and static; here routing
   arrives with the credential.
9. **Go and Zen are catalog entries with a per-model wire, not client modes.** The two tiers
   differ only by base URL and package resolution: `opencode-go` is
   `@ai-sdk/openai-compatible` over `https://opencode.ai/zen/go/v1`, Zen's `opencode` is the
   same package over `https://opencode.ai/zen/v1`, and per-model overrides move individual Go
   models to `@ai-sdk/openai` on `/responses` or `@ai-sdk/anthropic` on
   `/messages`[^packages-core-src-plugin-provider-opencode-ts-l121-l171][^packages-web-src-content-docs-go-mdx-l285-l325].
   Nothing in the rewrite branches on the provider id for Go: the session headers are its only
   Go-relevant behaviour, and on `dev` those are the generic affinity pair rather than
   `x-opencode-session`, which the gateway reads[^packages-console-app-src-routes-zen-util-handler-ts-l125-l136].
   High confidence for #809: one provider type, one wire per model, one session header.
10. **The shipped line speaks Go's dialect in both directions.** The released client emits
    `x-session-affinity`, `X-Session-Id`, `x-parent-session-id`, `User-Agent`,
    `x-opencode-project`, `x-opencode-session`, and `x-opencode-client` on the same
    request[^packages-core-src-session-model-request-ts-l237-l247], which is the header
    family the gateway reads and the one Go's operator docs ask
    for[^packages-console-app-src-routes-zen-util-handler-ts-l125-l136][^packages-web-src-content-docs-go-mdx-l100-l105]. Response-side, the hand-rolled
    OpenAI Chat protocol reads a native `reasoning_content` field back as reasoning
    output[^packages-llm-src-protocols-openai-chat-ts-l211] and turns a streamed
    `reasoning_content` delta into a reasoning
    part[^packages-llm-src-protocols-openai-chat-ts-l419-l420], which is the DeepSeek-dialect
    field Go's DeepSeek models emit. The shipped line also bundles the catalog as a checked-in
    snapshot refreshed daily by a workflow that targets the `v2`
    branch[^packages-core-src-models-dev-snapshot-txt][^github-workflows-models-snapshot-yml-l9-l40]. High confidence for #809: both
    ends need nothing beyond a stable session header and dialect-aware reasoning handling.

**Caution:** The rewrite is incomplete, so it is not yet a reference for auxiliary or
delegation behavior: title and summary updates are still a doc-comment
TODO[^packages-core-src-session-runner-llm-ts-l83] and the subagent `task` tool is not yet
ported[^packages-core-src-tool-builtins-ts-l26-l29][^packages-core-src-tool-builtins-ts-l24-l28].
Its error taxonomy collapses typed upstream failures into `InvalidRequest`, because it
classifies by status and body text and never parses a provider
`error.type`[^packages-llm-src-route-executor-ts-l225-l275]. And the documentation leads the
code on `dev`: `/v2/docs` describes a `@opencode/ai/providers/*` namespace that is absent from
this tree[^v2-docs-providers], which ships `@opencode-ai/llm`[^packages-llm-package-json-l3-l4],
so source-only conclusions about the documented contract can be stale. The namespace is real on
branch `v2`, where `packages/ai` is `@opencode/ai` at version
`2.0.12`[^packages-ai-package-json-l3-l37], so cite the branch when the contract matters.

[^packages-cli-package-json-l18-l23]: [CLI depends on the rewrite packages](https://github.com/anomalyco/opencode/blob/5a83358/packages/cli/package.json#L18-L23)

[^branch-2-0]: [stale 2.0 branch](https://github.com/anomalyco/opencode/tree/7a6ce05d0939826aa6c8e1c481489a713b2d633f)

[^packages-core-src-session-runner-model-ts-l131-l179]: [per-model package dispatch and UnsupportedApiError](https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/session/runner/model.ts#L131-L179)

[^v2-docs-providers]: [documented package, headers, and per-model overrides](https://opencode.ai/v2/docs/providers)

[^packages-llm-package-json-l45-l50]: [packages/llm dependency set](https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/package.json#L45-L50)

[^packages-llm-src-protocols-index-ts-l1-l6]: [hand-rolled protocol modules](https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/protocols/index.ts#L1-L6)

[^packages-llm-src-protocols-openai-compatible-chat-ts-l10-l22]: [compatible route reuses the OpenAI Chat protocol](https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/protocols/openai-compatible-chat.ts#L10-L22)

[^packages-core-package-json-l64-l83]: [AI SDK dependencies retained in core](https://github.com/anomalyco/opencode/blob/5a83358/packages/core/package.json#L64-L83)

[^packages-llm-src-route-transport-http-ts-l100-l102]: [route headers first, request headers overlay](https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/route/transport/http.ts#L100-L102)

[^packages-llm-src-protocols-anthropic-messages-ts-l845-l853]: [static anthropic-version header at route construction](https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/protocols/anthropic-messages.ts#L845-L853)

[^packages-core-src-session-runner-llm-ts-l204-l214]: [session header trio and promptCacheKey](https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/session/runner/llm.ts#L204-L214)

[^packages-opencode-src-session-llm-request-ts-l187-l201]: [legacy x-opencode-\* header scheme](https://github.com/anomalyco/opencode/blob/5a83358/packages/opencode/src/session/llm/request.ts#L187-L201)

[^packages-llm-src-cache-policy-ts-l42]: [RESPECTS_INLINE_HINTS](https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/cache-policy.ts#L42)

[^packages-llm-src-cache-policy-ts-l99-l100]: [route-id cache gate](https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/cache-policy.ts#L99-L100)

[^packages-opencode-src-provider-transform-ts-l468-l484]: [legacy name-substring caching heuristic](https://github.com/anomalyco/opencode/blob/5a83358/packages/opencode/src/provider/transform.ts#L468-L484)

[^packages-core-src-session-compaction-ts-l203-l209]: [compaction reuses the parent request http](https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/session/compaction.ts#L203-L209)

[^packages-llm-src-schema-errors-ts-l160-l172]: [LLMErrorReason variants](https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/schema/errors.ts#L160-L172)

[^packages-llm-src-route-executor-ts-l225-l275]: [statusReason classification](https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/src/route/executor.ts#L225-L275)

[^packages-core-src-plugin-provider-opencode-ts-l127]: [provider headers from the remote catalog](https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/plugin/provider/opencode.ts#L127)

[^packages-core-src-plugin-provider-opencode-ts-l151]: [model headers from the remote catalog](https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/plugin/provider/opencode.ts#L151)

[^packages-core-src-session-runner-llm-ts-l83]: [title and summary work pending](https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/session/runner/llm.ts#L83)

[^packages-core-src-tool-builtins-ts-l26-l29]: [task tool not yet ported](https://github.com/anomalyco/opencode/blob/5a83358/packages/core/src/tool/builtins.ts#L26-L29)

[^packages-llm-package-json-l3-l4]: [package name @opencode-ai/llm](https://github.com/anomalyco/opencode/blob/5a83358/packages/llm/package.json#L3-L4)

[^packages-cli-package-json-l18-l28]: [CLI dependencies at the refreshed revision](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/cli/package.json#L18-L28)

[^packages-core-package-json-l63-l94]: [core dependencies include the hand-rolled llm package](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/package.json#L63-L94)

[^packages-core-src-session-runner-model-ts-l134-l179]: [three-package dispatch and supported() at the refreshed revision](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/session/runner/model.ts#L134-L179)

[^packages-core-src-session-runner-llm-ts-l206-l215]: [session header trio and prompt cache key at the refreshed revision](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/session/runner/llm.ts#L206-L215)

[^packages-core-src-session-compaction-ts-l203-l206]: [compaction reuses the parent request http at the refreshed revision](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/session/compaction.ts#L203-L206)

[^packages-llm-src-protocols-index-ts-l1-l6-refreshed]: [six protocol modules at the refreshed revision](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/llm/src/protocols/index.ts#L1-L6)

[^packages-llm-src-route-transport-http-ts-l95-l105]: [header merge at the refreshed revision](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/llm/src/route/transport/http.ts#L95-L105)

[^packages-llm-src-protocols-anthropic-messages-ts-l852]: [static anthropic-version header at the refreshed revision](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/llm/src/protocols/anthropic-messages.ts#L852)

[^packages-llm-src-route-executor-ts-l225-l266]: [statusReason classification at the refreshed revision](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/llm/src/route/executor.ts#L225-L266)

[^packages-core-src-plugin-provider-opencode-ts-l121-l171]: [catalog transform: package overrides, headers, deprecation](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/plugin/provider/opencode.ts#L121-L171)

[^packages-core-src-plugin-provider-opencode-ts-l200-l221]: [remote catalog fetch behind the credential](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/plugin/provider/opencode.ts#L200-L221)

[^packages-core-src-tool-builtins-ts-l24-l28]: [task tool still unported at the refreshed revision](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/core/src/tool/builtins.ts#L24-L28)

[^packages-web-src-content-docs-go-mdx-l285-l325]: [published Go endpoint-to-package table](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/web/src/content/docs/go.mdx#L285-L325)

[^packages-web-src-content-docs-go-mdx-l100-l105]: [Go client requirements](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/web/src/content/docs/go.mdx#L100-L105)

[^packages-console-app-src-routes-zen-util-handler-ts-l125-l136]: [gateway reads the session header](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L125-L136)

[^packages-llm-src-protocols-openai-chat-ts-l211]: [reasoning_content is read from native provider output](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/llm/src/protocols/openai-chat.ts#L211)

[^packages-llm-src-protocols-openai-chat-ts-l419-l420]: [reasoning delta becomes a reasoning part](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/llm/src/protocols/openai-chat.ts#L419-L420)

[^packages-core-src-session-model-request-ts-l237-l247]: [shipped line sends both header families](https://github.com/anomalyco/opencode/blob/4d94777d4d08dedff776e79acef1bdc962049c4f/packages/core/src/session/model-request.ts#L237-L247)

[^packages-cli-package-json-l3-l4]: [shipped CLI package and version](https://github.com/anomalyco/opencode/blob/4d94777d4d08dedff776e79acef1bdc962049c4f/packages/cli/package.json#L3-L4)

[^packages-ai-package-json-l3-l37]: [shipped wire package and dependency set](https://github.com/anomalyco/opencode/blob/4d94777d4d08dedff776e79acef1bdc962049c4f/packages/ai/package.json#L3-L37)

[^github-workflows-models-snapshot-yml-l9-l40]: [daily catalog snapshot refresh targets the v2 branch](https://github.com/anomalyco/opencode/blob/4d94777d4d08dedff776e79acef1bdc962049c4f/.github/workflows/models-snapshot.yml#L9-L40)

[^packages-core-src-models-dev-snapshot-txt]: [bundled catalog snapshot on the shipped line](https://github.com/anomalyco/opencode/blob/4d94777d4d08dedff776e79acef1bdc962049c4f/packages/core/src/models-dev/snapshot.txt)
