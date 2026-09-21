---
type: Reference
title: "pi-mono"
description: "Lane-as-branch session tree, composable provider session headers, and a fail-open hook registry"
resource: "https://github.com/badlogic/pi-mono"
observed:
  date: "2026-09-21"
  revision: "c7cdb460aa8a0cebef3446c4166729b8a0d97ead"
sources:
  - id: packages-ai-src-providers-opencode-headers-ts-l9-l24
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/ai/src/providers/opencode-headers.ts#L9-L24"
    title: "withOpenCodeSessionHeader"
  - id: packages-ai-src-providers-opencode-go-ts-l9-l19
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/ai/src/providers/opencode-go.ts#L9-L19"
    title: "OpenCode Go provider"
  - id: packages-agent-src-harness-runtime-drive-generation-ts-l217-l219
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/runtime/drive/generation.ts#L217-L219"
    title: "lane-namespaced session id"
  - id: packages-ai-src-utils-pi-user-agent-ts-l17-l19
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/ai/src/utils/pi-user-agent.ts#L17-L19"
    title: "getPiUserAgent"
  - id: packages-agent-src-harness-session-session-ts-l225-l264
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/session/session.ts#L225-L264"
    title: "single-writer mutation line"
  - id: packages-agent-src-harness-session-fork-ts-l29-l121
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/session/fork.ts#L29-L121"
    title: "createForkSnapshot"
  - id: packages-agent-src-harness-execution-tools-ts-l76-l176
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/execution/tools.ts#L76-L176"
    title: "four-phase tool execution"
  - id: packages-agent-src-harness-hooks-ts-l156-l184
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/hooks.ts#L156-L184"
    title: "before_tool fails closed"
  - id: packages-agent-src-harness-hooks-ts-l229-l330
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/hooks.ts#L229-L330"
    title: "other hooks fail open"
  - id: packages-coding-agent-docs-security-md-l9-l25
    resource: "https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/coding-agent/docs/security.md#L9-L25"
    title: "no sandbox, project trust"
  - id: packages-ai-src-providers-opencode-headers-ts-l3-l25
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/providers/opencode-headers.ts#L3-L25"
    title: "withOpenCodeSessionHeader at the refreshed revision"
  - id: packages-ai-src-providers-opencode-go-ts-l9-l21
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/providers/opencode-go.ts#L9-L21"
    title: "OpenCode Go provider: three wires, one key"
  - id: packages-ai-src-providers-opencode-ts-l13-l25
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/providers/opencode.ts#L13-L25"
    title: "OpenCode Zen provider adds Google"
  - id: packages-ai-scripts-generate-models-ts-l2204-l2245
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/scripts/generate-models.ts#L2204-L2245"
    title: "models.dev npm field to wire mapping"
  - id: packages-ai-scripts-generate-models-ts-l2246-l2296
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/scripts/generate-models.ts#L2246-L2296"
    title: "Go route and thinking overrides"
  - id: packages-ai-scripts-generate-models-ts-l2225-l2235
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/scripts/generate-models.ts#L2225-L2235"
    title: "Responses models opt out of session-affinity headers"
  - id: packages-ai-src-api-openai-completions-ts-l617-l625
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/api/openai-completions.ts#L617-L625"
    title: "Go reasoning field ingest remap"
  - id: packages-ai-src-api-openai-completions-ts-l1330-l1338
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/api/openai-completions.ts#L1330-L1338"
    title: "Go reasoning field replay remap"
  - id: packages-ai-src-api-openai-completions-ts-l770-l782
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/api/openai-completions.ts#L770-L782"
    title: "generic session-affinity header trio"
  - id: packages-coding-agent-src-core-provider-attribution-ts-l67-l95
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/coding-agent/src/core/provider-attribution.ts#L67-L95"
    title: "OpenCode session and client headers"
  - id: packages-coding-agent-src-core-sdk-ts-l325-l336
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/coding-agent/src/core/sdk.ts#L325-L336"
    title: "transformHeaders wiring"
  - id: packages-ai-src-models-ts-l663-l675
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/models.ts#L663-L675"
    title: "headers transform runs before dispatch"
  - id: packages-coding-agent-src-core-compaction-compaction-ts-l591-l606
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/coding-agent/src/core/compaction/compaction.ts#L591-L606"
    title: "summarization gets its own routing id"
  - id: packages-agent-src-harness-runtime-drive-generation-ts-l211-l222
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/agent/src/harness/runtime/drive/generation.ts#L211-L222"
    title: "lane-namespaced session id at the refreshed revision"
  - id: packages-coding-agent-src-core-remote-catalog-provider-ts-l6-l12
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/coding-agent/src/core/remote-catalog-provider.ts#L6-L12"
    title: "catalog overlay constants"
  - id: packages-coding-agent-src-core-remote-catalog-provider-ts-l66-l83
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/coding-agent/src/core/remote-catalog-provider.ts#L66-L83"
    title: "per-provider overlay fetch with conditional revalidation"
  - id: packages-coding-agent-src-core-model-runtime-ts-l185-l192
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/coding-agent/src/core/model-runtime.ts#L185-L192"
    title: "overlay applied to static built-ins"
  - id: packages-ai-src-utils-retry-ts-l7-l20
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/utils/retry.ts#L7-L20"
    title: "Go usage limits are non-retryable"
  - id: packages-ai-test-opencode-provider-headers-test-ts-l44-l86
    resource: "https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/test/opencode-provider-headers.test.ts#L44-L86"
    title: "session header regression tests"
  - id: packages-web-src-content-docs-go-mdx-l104-l120
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/web/src/content/docs/go.mdx#L104-L120"
    title: "Go client requirements and validated clients"
  - id: packages-console-app-src-routes-zen-util-handler-ts-l125-l131
    resource: "https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L125-L131"
    title: "gateway reads the session header"
---

# pi-mono

- **Stack:** TypeScript monorepo (unified LLM API, agent loop, TUI, coding CLI); MIT

Upstream of [oh-my-pi](./oh-my-pi.md), which forks it. Listed by OpenCode Go
as a validated client[^packages-web-src-content-docs-go-mdx-l104-l120], and the
gateway reads `x-opencode-session` for routing and
metrics[^packages-console-app-src-routes-zen-util-handler-ts-l125-l131]. Study
it for the mechanisms OMP inherited unchanged; OMP remains the primary coding
reference.

**Study**

1. **Composable provider session header.** One wrapper sets
   `x-opencode-session` from the request's `sessionId` unless the caller
   already supplied the header, and never fabricates one
   (`withOpenCodeSessionHeader`[^packages-ai-src-providers-opencode-headers-ts-l9-l24]);
   the Go provider is an ordinary provider declaration wrapping the same
   adapters[^packages-ai-src-providers-opencode-go-ts-l9-l19]. Subagent lanes
   send `<sessionId>:<lane>` so each lane has its own routing and cache
   identity[^packages-agent-src-harness-runtime-drive-generation-ts-l217-l219].
   The User-Agent is a generic `pi (<platform>; <arch>)`
   string[^packages-ai-src-utils-pi-user-agent-ts-l17-l19]. High confidence as
   the shape for llame's Go provider (#809): header injection as a provider
   wrapper, session id derived from Chat identity, per-child identity for
   subagents.
2. **Lane-as-branch session tree.** Sessions are append-only entry trees; a
   single-writer mutation line serializes
   commits[^packages-agent-src-harness-session-session-ts-l225-l264], and
   subagents are named lanes (branches) inside the same tree rather than new
   top-level identities. Forking clones the whole tree or one branch and
   validates lane config and tip
   integrity[^packages-agent-src-harness-session-fork-ts-l29-l121]. Moderate
   confidence as a comparison for how llame represents child agents (#765)
   under one Chat without a second session system.
3. **Four-phase tool execution.** Prepare, hook decision, gated execution,
   finalize are separate
   steps[^packages-agent-src-harness-execution-tools-ts-l76-l176]; a
   synchronous gate admits each effect and supports cooperative abort.
   Moderate confidence for llame's `runTool()` structure, which already has
   the same gates in one function.
4. **Go and Zen are separate providers over one generated wire table.**
   `opencode-go` and `opencode` are distinct provider ids sharing
   `OPENCODE_API_KEY`; Go declares three wires (chat completions, Responses,
   Anthropic messages) under `https://opencode.ai/zen/go/v1`, while Zen adds
   Google[^packages-ai-src-providers-opencode-go-ts-l9-l21][^packages-ai-src-providers-opencode-ts-l13-l25].
   Wire selection is a generated per-model column, not a request-time
   decision: the catalogue generator maps models.dev `provider.npm` to a wire
   (`@ai-sdk/openai` to Responses, `@ai-sdk/anthropic` to Messages with the SDK
   appending `/v1/messages`, `@ai-sdk/google` to Google, everything else to
   chat completions)[^packages-ai-scripts-generate-models-ts-l2204-l2245], then
   corrects stale metadata: Go's MiniMax M2.7 and Qwen 3.5/3.6 Plus move to
   chat completions, Kimi K2.6 switches to the DeepSeek thinking dialect, chat
   completions ids pin `max_tokens`, and named ids opt out of long cache
   retention[^packages-ai-scripts-generate-models-ts-l2246-l2296].
   Responses-routed OpenCode models also set `sessionAffinityFormat` to
   `openai-nosession` so `session_id` and `x-session-affinity` never ride
   along with the OpenCode
   header[^packages-ai-scripts-generate-models-ts-l2225-l2235]. Models ship as
   generated shards from the bundled catalogue, with an overlay fetched from
   pi.dev at most every four hours and cached
   locally[^packages-coding-agent-src-core-remote-catalog-provider-ts-l6-l12][^packages-coding-agent-src-core-remote-catalog-provider-ts-l66-l83][^packages-coding-agent-src-core-model-runtime-ts-l185-l192].
   Moderate confidence for llame's provider-type model: the transferable part
   is the table, not the generation pipeline, and llame's
   `openai-completions` type already carries the `baseUrl` this needs.
5. **Three-layer session identity, two wire repairs, and fail-fast quota.**
   The header is written twice by design: the provider wrapper adds
   `x-opencode-session` from `options.sessionId` unless the caller already set
   that name in any casing, and never fabricates
   one[^packages-ai-src-providers-opencode-headers-ts-l3-l25]; the coding agent
   adds `x-opencode-session` plus `x-opencode-client: pi` for OpenCode
   providers and any `opencode.ai`
   host[^packages-coding-agent-src-core-provider-attribution-ts-l67-l95],
   running last through `transformHeaders` before
   dispatch[^packages-coding-agent-src-core-sdk-ts-l325-l336][^packages-ai-src-models-ts-l663-l675].
   A regression test pins the case-insensitive override and the
   no-fabrication rule[^packages-ai-test-opencode-provider-headers-test-ts-l44-l86].
   The value is the session's uuidv7 id; the agent harness namespaces it per
   lane as
   `<sessionId>:<lane>`[^packages-agent-src-harness-runtime-drive-generation-ts-l211-l222],
   and compaction or summarization calls mint a fresh uuidv7 when the caller
   passes none and request `cacheRetention: "none"`, so aux calls route on
   their own
   identity[^packages-coding-agent-src-core-compaction-compaction-ts-l591-l606].
   Client identification is the literal `pi (<platform> <release>; <arch>)`
   string[^packages-ai-src-utils-pi-user-agent-ts-l17-l19]. Two repairs are
   gated on `opencode-go`: chat completions stores a `reasoning` delta field as
   the `reasoning_content` signature and rewrites that signature back on
   replay, so DeepSeek-family lanes keep accepting replayed
   reasoning[^packages-ai-src-api-openai-completions-ts-l617-l625][^packages-ai-src-api-openai-completions-ts-l1330-l1338],
   while Responses models skip the generic session-affinity
   trio[^packages-ai-src-api-openai-completions-ts-l770-l782]. Failures are
   classified by wire text, not by provider: `GoUsageLimitError`,
   `FreeUsageLimitError`, and monthly-limit wording are non-retryable provider
   limits rather than transient
   throttles[^packages-ai-src-utils-retry-ts-l7-l20]. High confidence for
   llame's Go provider (#809): header injection belongs in a provider wrapper,
   the value belongs to durable Chat identity, and per-lane namespacing is the
   precedent for child agents.

**Caution**

- Hooks fail open by default. Only `before_tool` and `before_drive` fail
  closed[^packages-agent-src-harness-hooks-ts-l156-l184]; every other hook
  reports and swallows
  errors[^packages-agent-src-harness-hooks-ts-l229-l330]. A misbehaving
  extension degrades silently.
- No sandbox and no MCP. Extensions are in-process TypeScript with the OS
  user's full permissions; "project trust" gates whether project settings
  load, not what a tool may do[^packages-coding-agent-docs-security-md-l9-l25].
  llame's allowlist and tenancy model has no counterpart here.

[^packages-ai-src-providers-opencode-headers-ts-l9-l24]: [`withOpenCodeSessionHeader`](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/ai/src/providers/opencode-headers.ts#L9-L24)

[^packages-ai-src-providers-opencode-go-ts-l9-l19]: [OpenCode Go provider](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/ai/src/providers/opencode-go.ts#L9-L19)

[^packages-agent-src-harness-runtime-drive-generation-ts-l217-l219]: [lane-namespaced session id](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/runtime/drive/generation.ts#L217-L219)

[^packages-ai-src-utils-pi-user-agent-ts-l17-l19]: [`getPiUserAgent`](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/ai/src/utils/pi-user-agent.ts#L17-L19)

[^packages-agent-src-harness-session-session-ts-l225-l264]: [single-writer mutation line](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/session/session.ts#L225-L264)

[^packages-agent-src-harness-session-fork-ts-l29-l121]: [`createForkSnapshot`](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/session/fork.ts#L29-L121)

[^packages-agent-src-harness-execution-tools-ts-l76-l176]: [four-phase tool execution](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/execution/tools.ts#L76-L176)

[^packages-agent-src-harness-hooks-ts-l156-l184]: [`before_tool` fails closed](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/hooks.ts#L156-L184)

[^packages-agent-src-harness-hooks-ts-l229-l330]: [other hooks fail open](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/agent/src/harness/hooks.ts#L229-L330)

[^packages-coding-agent-docs-security-md-l9-l25]: [no sandbox, project trust](https://github.com/badlogic/pi-mono/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/coding-agent/docs/security.md#L9-L25)

[^packages-ai-src-providers-opencode-headers-ts-l3-l25]: [`withOpenCodeSessionHeader`](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/providers/opencode-headers.ts#L3-L25)

[^packages-ai-src-providers-opencode-go-ts-l9-l21]: [OpenCode Go provider](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/providers/opencode-go.ts#L9-L21)

[^packages-ai-src-providers-opencode-ts-l13-l25]: [OpenCode Zen provider](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/providers/opencode.ts#L13-L25)

[^packages-ai-scripts-generate-models-ts-l2204-l2245]: [models.dev npm field to wire mapping](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/scripts/generate-models.ts#L2204-L2245)

[^packages-ai-scripts-generate-models-ts-l2246-l2296]: [Go route and thinking overrides](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/scripts/generate-models.ts#L2246-L2296)

[^packages-ai-scripts-generate-models-ts-l2225-l2235]: [Responses models opt out of session-affinity headers](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/scripts/generate-models.ts#L2225-L2235)

[^packages-ai-src-api-openai-completions-ts-l617-l625]: [Go reasoning field ingest remap](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/api/openai-completions.ts#L617-L625)

[^packages-ai-src-api-openai-completions-ts-l1330-l1338]: [Go reasoning field replay remap](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/api/openai-completions.ts#L1330-L1338)

[^packages-ai-src-api-openai-completions-ts-l770-l782]: [generic session-affinity header trio](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/api/openai-completions.ts#L770-L782)

[^packages-coding-agent-src-core-provider-attribution-ts-l67-l95]: [OpenCode session and client headers](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/coding-agent/src/core/provider-attribution.ts#L67-L95)

[^packages-coding-agent-src-core-sdk-ts-l325-l336]: [transformHeaders wiring](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/coding-agent/src/core/sdk.ts#L325-L336)

[^packages-ai-src-models-ts-l663-l675]: [headers transform runs before dispatch](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/models.ts#L663-L675)

[^packages-coding-agent-src-core-compaction-compaction-ts-l591-l606]: [summarization gets its own routing id](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/coding-agent/src/core/compaction/compaction.ts#L591-L606)

[^packages-agent-src-harness-runtime-drive-generation-ts-l211-l222]: [lane-namespaced session id at the refreshed revision](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/agent/src/harness/runtime/drive/generation.ts#L211-L222)

[^packages-coding-agent-src-core-remote-catalog-provider-ts-l6-l12]: [catalog overlay constants](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/coding-agent/src/core/remote-catalog-provider.ts#L6-L12)

[^packages-coding-agent-src-core-remote-catalog-provider-ts-l66-l83]: [per-provider overlay fetch](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/coding-agent/src/core/remote-catalog-provider.ts#L66-L83)

[^packages-coding-agent-src-core-model-runtime-ts-l185-l192]: [overlay applied to static built-ins](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/coding-agent/src/core/model-runtime.ts#L185-L192)

[^packages-ai-src-utils-retry-ts-l7-l20]: [Go usage limits are non-retryable](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/src/utils/retry.ts#L7-L20)

[^packages-ai-test-opencode-provider-headers-test-ts-l44-l86]: [session header regression tests](https://github.com/badlogic/pi-mono/blob/c7cdb460aa8a0cebef3446c4166729b8a0d97ead/packages/ai/test/opencode-provider-headers.test.ts#L44-L86)

[^packages-web-src-content-docs-go-mdx-l104-l120]: [Go client requirements and validated clients](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/web/src/content/docs/go.mdx#L104-L120)

[^packages-console-app-src-routes-zen-util-handler-ts-l125-l131]: [gateway reads the session header](https://github.com/anomalyco/opencode/blob/70a24697ea0028e19f22712fd63059538cb4bee7/packages/console/app/src/routes/zen/util/handler.ts#L125-L131)
