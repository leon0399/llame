---
type: Reference
title: "earendil-pi"
description: "Pi 1.0's codemode, virtual and deferred model surfaces, cache-aware transcript mutations, and the experimental Pi Durable runtime"
resource: "https://github.com/earendil-works/pi/tree/428a12bc775145afa342530a9eaa652efb3e4422"
tags:
  - agent-harness
  - codemode
  - mcp
  - virtual-models
  - prompt-caching
  - durable-execution
status: stable
generated:
  by: "omp/openai-codex-gpt-5.6-luna"
  at: "2026-10-06"
observed:
  date: "2026-10-06"
  revision: "428a12bc775145afa342530a9eaa652efb3e4422"
sources:
  - id: earendil-pi-1-0-post
    resource: "https://earendil.com/posts/pi-1-0/"
    title: "Pi 1.0 announcement"
  - id: earendil-pi-durable-post
    resource: "https://earendil.com/posts/pi-durable/"
    title: "Pi Durable announcement and design tour"
  - id: earendil-pi-readme-stack
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/README.md#L13-L21"
    title: "Pi product surface and package map"
  - id: earendil-pi-readme-permissions
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/README.md#L88-L96"
    title: "Pi permission and containerization boundary"
  - id: earendil-pi-license
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/LICENSE#L1-L15"
    title: "Pi MIT license"
  - id: earendil-pi-agent-changelog
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/agent/CHANGELOG.md#L13-L18"
    title: "Pi 1.0 agent package boundary"
  - id: earendil-pi-coding-agent-package
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/package.json#L49-L55"
    title: "Coding agent dependencies on codemode and MCP"
  - id: earendil-pi-durable-package
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/package.json#L1-L5"
    title: "Pi Durable package metadata"
  - id: earendil-pi-codemode-tool
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/extensions/codemode/tool.ts#L1-L21"
    title: "Codemode nested calls and transcript store"
  - id: earendil-pi-codemode-host
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/codemode/src/runtime/host.ts#L120-L166"
    title: "Codemode worker lifecycle"
  - id: earendil-pi-codemode-worker
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/codemode/src/runtime/worker.ts#L1-L11"
    title: "Codemode QuickJS worker boundary"
  - id: earendil-pi-mcp-extension
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/extensions/mcp/index.ts#L1-L25"
    title: "MCP exposure and tool pipeline"
  - id: earendil-pi-mcp-config
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/core/mcp-servers.ts#L43-L87"
    title: "MCP exposure modes and server configuration"
  - id: earendil-pi-classifier-types
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/ai/src/types.ts#L635-L690"
    title: "Structured non-chat classifier model contract"
  - id: earendil-pi-virtual-model
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/core/virtual-models.ts#L52-L101"
    title: "Virtual model routing contract"
  - id: earendil-pi-virtual-route
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/core/agent-session.ts#L804-L830"
    title: "Per-request virtual routing and persisted router state"
  - id: earendil-pi-tool-search
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/extensions/tool-search/tool.ts#L197-L213"
    title: "BM25 deferred tool loading"
  - id: earendil-pi-cache-warmer-policy
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/core/cache-warmer.ts#L15-L58"
    title: "Cache warming safety policy"
  - id: earendil-pi-cache-warmer-run
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/core/cache-warmer.ts#L157-L225"
    title: "Cache warmer request lifecycle"
  - id: earendil-pi-cache-sdk
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/core/sdk.ts#L349-L412"
    title: "Cache warming integration and current-prefix check"
  - id: earendil-pi-transcript
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/ai/src/utils/transcript.ts#L57-L121"
    title: "Transcript replay and provider fallback"
  - id: earendil-pi-anthropic
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/ai/src/api/anthropic-messages.ts#L1136-L1221"
    title: "Anthropic native mid-conversation tool additions"
  - id: earendil-pi-durable-readme
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/README.md#L1-L5"
    title: "Pi Durable experimental status"
  - id: earendil-pi-durable-session
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/session/session.ts#L53-L58"
    title: "Session mutation line and committed publication"
  - id: earendil-pi-durable-jsonl
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/storage/jsonl/storage.ts#L277-L305"
    title: "JSONL sidecar and commit marker ordering"
  - id: earendil-pi-durable-sqlite
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/storage/sqlite/storage.ts#L162-L185"
    title: "SQLite atomic storage transaction"
  - id: earendil-pi-durable-scheduler
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/scheduler.ts#L230-L262"
    title: "Durable task reopen and resume"
  - id: earendil-pi-durable-tool
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/tool.ts#L35-L111"
    title: "Durable tool intent and replay policy"
  - id: earendil-pi-durable-submissions
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/submissions.ts#L141-L206"
    title: "Exactly-once submission admission and busy queue"
  - id: earendil-pi-durable-inbox
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/inbox.ts#L58-L106"
    title: "Steering and follow-up boundary placement"
  - id: earendil-pi-durable-generation
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/generation.ts#L111-L231"
    title: "Durable generation checkpoints and deferred polling"
  - id: earendil-pi-durable-context
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/context.ts#L53-L82"
    title: "Durable transcript derivation and interrupted tool results"
  - id: earendil-pi-durable-harness
    resource: "https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/harness.ts#L224-L240"
    title: "Per-conversation execution environment and scheduler"
  - id: llame-spec-boundaries
    resource: "../../../SPEC.md#L75-L108"
    title: "llame approvals and installation-local Run lifecycle"
---

# earendil-pi

- **Stack:** TypeScript/npm monorepo with `pi-ai`, `pi-agent-core`, the Pi coding
  agent, codemode, MCP, TUI, and Pi Durable packages; MIT[^earendil-pi-license]
- **Evidence:** Source inspection only; no upstream build, tests, or live
  provider calls were run.

Pi 1.0 is the stable coding-agent line. Its announcement names codemode/MCP,
non-LLM models, virtual models, deferred tools, cache warming, and
transcript-aware prompt/tool changes as shipped additions[^earendil-pi-1-0-post].
Pi Durable is explicitly a separate **experimental** package, not a durability
mode hidden inside the coding CLI[^earendil-pi-durable-post][^earendil-pi-durable-readme].
The coding-agent package wires codemode and MCP as dependencies
[^earendil-pi-coding-agent-package]. Durable sessions belong to the separate
`@earendil-works/pi-durable` package[^earendil-pi-agent-changelog].

Pi is a minimal, extensible harness with interactive, print/JSON, RPC, and SDK
surfaces[^earendil-pi-readme-stack]. See [pi-mono](./pi-mono.md) for provider
session headers and session-tree mechanics.

**Study**

1. **Codemode and MCP are capability composition, not a new authority layer.**
   The coding-agent codemode tool accepts model-written JavaScript, allows
   nested calls through the existing tool pipeline, and keeps nested results out
   of the model context; the source explicitly says validation, tool hooks, and
   permission checks still apply to those nested calls
   [^earendil-pi-codemode-tool]. The standalone codemode runtime starts one
   worker per script, uses a QuickJS/WASM execution, and can terminate a runaway
   script without poisoning the next run[^earendil-pi-codemode-host]
   [^earendil-pi-codemode-worker]. The advertised script surface has no Node,
   filesystem, network, or timer capability, but injected tools remain the
   authority.

   MCP servers can be exposed as `codemode`, `deferred`, `direct`, or `hidden`.
   The built-in extension connects indirect servers in the background, keeps
   codemode tools out of ordinary model declarations, and routes every MCP call
   through Pi's normal hooks and permission pipeline
   [^earendil-pi-mcp-extension]. The configuration accepts stdio commands,
   arguments, environment references, working directories, HTTP endpoints, and
   provider-backed auth[^earendil-pi-mcp-config]. This is a useful distinction:
   QuickJS limits model-authored code, while the host configuration and injected
   tool implementations still decide what files, processes, network, and
   credentials are reachable. Pi's own README says it has no built-in permission
   system and runs with the launching user's permissions; stronger boundaries
   require containerization or sandboxing[^earendil-pi-readme-permissions].

   **llame application — high confidence for tool-search/code-mode shape, low
   confidence for direct security transfer ([#338](https://github.com/leon0399/llame/issues/338),
   [#778](https://github.com/leon0399/llame/issues/778)).** A llame executor
   could offer one bounded script tool that batches or filters already-admitted
   tool calls, while the Chat/Run owner retains allowlist admission, per-call
   permission evaluation, tenant scoping, and receipts outside the script. The
   nested-call trace is a good candidate for a compact Run observation, but
   codemode must never be allowed to approve itself or turn MCP descriptions into
   authorization.

2. **Non-LLM models and virtual models are typed, routed adjuncts.** `pi-ai`
   gives classifiers their own `ClassifierContext` (JSON state plus typed choice,
   score, or boolean questions), answer probabilities/confidence, usage, and an
   error/abort stop reason[^earendil-pi-classifier-types]. Codemode's `models`
   namespace can reach classifiers and image models, so the non-chat model can
   be used inside a script without pretending it is a normal conversation model
   [^earendil-pi-codemode-tool].

   Virtual models are catalog entries with API id `pi-virtual`; a router receives
   the selected thinking level, reason (`user`, continuation, retry, or direct),
   previous physical response, failed response, optional JSON state, and the
   complete transcript, then returns one physical model and thinking level
   [^earendil-pi-virtual-model]. The session routes only that request, writes a
   `pi.virtual-model-state` custom entry when router state changes, and leaves
   the virtual selection in agent state while assistant messages identify the
   physical model that answered[^earendil-pi-virtual-route]. A virtual model
   therefore does not stream directly; a failed route ends as an error rather
   than silently falling back to an unrelated model.

   **llame application — moderate confidence for advisory routing ([#833](https://github.com/leon0399/llame/issues/833),
   [#972](https://github.com/leon0399/llame/issues/972)).** A classifier or
   router could choose a bounded effort/model tier from explicit Run state and
   record the decision, model identity, and outcome as Run evidence. Keep
   calibration, budget limits, cancellation, and terminal Run state in llame;
   classifier probabilities and router state are observations, not permission
   decisions. Virtual routing also changes cache identity and provider semantics,
   so a cache policy should not assume the router repeats the same physical model.

3. **Deferred tools and transcript-aware changes reduce prompt cost without
   hiding execution.** `tool_search` ranks undisclosed `codemode`/`deferred`
   tools with BM25, activates matches, and makes them available on the next model
   call; activation is recorded in the transcript and survives tree navigation,
   resume, and fork[^earendil-pi-tool-search]. At the lower agent layer, the
   executable tool set and model-visible declarations are separate: differences
   become transcript system messages with `toolsAdded`/`toolsRemoved`. The
   transcript helpers replay those deltas, and providers without native
   mid-conversation support collapse them into one leading system message
   [^earendil-pi-transcript]. Anthropic's native path keeps the initial tool list
   fixed and emits later tools by value in `tool_addition` blocks, with a stable
   deferred placeholder so the cached prefix survives tool changes
   [^earendil-pi-anthropic].

   This is transcript-aware prompt state, not merely a mutable in-memory tool
   array. It gives a resumed branch a model-visible history of what was offered,
   while the host still resolves the implementation and permission at execution
   time.

   **llame application — high confidence for bounded discovery, moderate for
   provider transport ([#338](https://github.com/leon0399/llame/issues/338),
   [#821](https://github.com/leon0399/llame/issues/821),
   [#972](https://github.com/leon0399/llame/issues/972)).** Keep a small stable
   `search_tools` surface, rank only tools already admitted to the Chat/Run, and
   persist the loaded declaration or declaration hash in the Run projection.
   Treat search relevance as context selection, never authorization. A later
   llame prompt/instruction change should have an explicit context-item or
   declaration event rather than silently mutating a cached prefix; current
   llame SPEC describes that installation-local Run/event boundary and does not
   make Pi's provider-specific transport behavior a shipped llame contract
   [^llame-spec-boundaries].

4. **Cache warming is an economic, bounded replay loop.** Pi models carry
   per-model configured prompt-cache lifetimes. The warmer refuses unknown or
   disabled lifetimes, refuses Anthropic replay when a changed thinking budget
   could alter the cache key, and refreshes near expiry rather than claiming
   that every provider has the same cache semantics[^earendil-pi-cache-warmer-policy].
   Its run is capped by one-hour streaming and thirty-minute idle horizons; it
   sends a one-token refresh only when expected savings clear a $0.05 threshold
   [^earendil-pi-cache-warmer-policy][^earendil-pi-cache-warmer-run]. The SDK starts warming only for the selected
   request model and only while the transcript remains an extension of the
   original prefix; virtual or extension-rerouted requests are intentionally not
   warmed as if they were guaranteed to repeat[^earendil-pi-cache-sdk].

   **llame application — moderate confidence for [#972](https://github.com/leon0399/llame/issues/972).**
   Reuse the decision shape (`ttl`, prompt size, warm cost, miss cost, expected
   savings, action) as an advisory cache controller and persist the successful
   refresh usage as a cost receipt. Measure real provider behavior per model and
   retention tier; do not turn Pi's expected-savings threshold into a llame
   default or treat a warm request as proof that a future Run will reuse a cache.

5. **Pi Durable separates durable state from the Pi 1.0 coding CLI.** The package
   README labels its API experimental, while its concepts define conversations,
   immutable entries, typed documents, tasks, submissions, and a registry of
   named extensions[^earendil-pi-durable-readme]. The Durable post describes the
   intended deployment shape as storage plus task machinery, with memory, SQLite,
   and JSONL backends and an execution-environment interface that can be local or
   remote[^earendil-pi-durable-post]. The package metadata confirms a separate
   `@earendil-works/pi-durable` package in the same monorepo, currently on the
   1.0.4 package line[^earendil-pi-durable-package].

   The durability claims that are visible in the source are narrower and more
   useful than the announcement headline:

   - **Committed visibility.** `SessionImpl` serializes one mutation line and
     publishes only after storage settlement/adoption; listeners run later
     [^earendil-pi-durable-session]. SQLite applies table/document writes and
     sequence metadata inside one database transaction
     [^earendil-pi-durable-sqlite]. JSONL appends sidecars, optionally flushes
     them, appends the main commit marker, and only then applies the prepared
     in-memory state[^earendil-pi-durable-jsonl].
   - **Reopen recovery.** On open, the scheduler loads live tasks and changes
     surviving `running` records to `pending` without dispatching during the
     recovery commit; `resume()` then enables scheduling
     [^earendil-pi-durable-scheduler]. This is recovery of persisted task state,
     not proof that an external provider call was completed exactly once.
   - **Replay policy at the tool boundary.** A tool's validated arguments and
     `safe`/`unsafe` replay policy are committed before execution. Recovery reruns
     only when both the stored and current tool policy say `safe`; otherwise the
     model receives an interrupted result that may have partially run
     [^earendil-pi-durable-tool]. A safe declaration is an application assertion,
     not an idempotency proof or automatic compensation.
   - **Exactly-once admission and steering.** A repeated `requestId` returns the
     existing submission; busy input is queued or rejected, and idle input is
     placed and starts a run[^earendil-pi-durable-submissions]. The inbox chooses
     steering messages at the post-tools boundary and follow-ups at the final
     boundary, with configurable one-at-a-time/all modes
     [^earendil-pi-durable-inbox]. This gives an explicit steering lifecycle
     rather than appending arbitrary user text from a second client.
   - **Checkpointed generation and transcript recovery.** Generation preparation
     renders prompt sections and tool declarations, commits `pi.system` entries,
     then checkpoints the request; later phases request, retry, poll deferred
     handles, and wait on durable tool tasks[^earendil-pi-durable-generation].
     Context derivation replays the active head range, applies edits, orders tool
     results after their calls, and filters failed/aborted assistant messages
     before the next provider request[^earendil-pi-durable-context].
   - **Execution placement remains host policy.** The harness builds an
     execution environment from the current conversation `cwd` for each use and
     passes it to tools; source does not make that environment a sandbox or
     supply tenant authorization[^earendil-pi-durable-harness].

   **llame application — moderate confidence for [#765](https://github.com/leon0399/llame/issues/765),
   [#782](https://github.com/leon0399/llame/issues/782),
   [#758](https://github.com/leon0399/llame/issues/758), and
   [#42](https://github.com/leon0399/llame/issues/42).** Durable submissions,
   task ownership, fork-visible history, and committed views are useful prior art
   for steering an active Run, child-agent work, channels, and reconnecting
   clients. Adapt the mechanics under llame's Chat/Run, owner, Workspace, and
   receipt contracts: a Pi Durable conversation is not a llame Chat, and its
   `owner`/execution environment fields are not an authorization boundary. The
   Durable post's remote-environment story is an adapter seam, not shipped remote
   execution or sandbox isolation in llame.

**Caution**

- **Pi 1.0 trust boundary.** Codemode's QuickJS worker limits direct script
  capabilities, but injected tools, MCP stdio processes, and the launching user
  remain privileged according to host configuration. Pi's README explicitly
  recommends containerization for stronger boundaries[^earendil-pi-readme-permissions].
  Do not present codemode as a substitute for llame's permission gate or a future
  Sandbox.
- **Durable replay is conditional.** A crash can occur after an external effect
  and before its task checkpoint. `replay: "safe"` may repeat it; `unsafe` avoids
  repeating it but reports an uncertain/interrupted outcome. Exactly-once
  `requestId` admission deduplicates submissions, not arbitrary network, shell,
  payment, or MCP side effects. Use idempotency keys, compensations, or explicit
  human recovery at the application boundary.
- **Durable is experimental and single-process-owned at the storage seam.** The
  announcement's multi-client view and steering story still require an
  application transport, authentication, and ownership policy. SQLite/JSONL
  durability does not establish multi-tenant isolation, remote placement, or
  provider-side exactly-once completion.
- **Provider behavior differs.** Some providers preserve system/tool deltas in
  place; others collapse them. Cache lifetimes and replayability are model and
  transport properties, and virtual routing can change both. Reproduce llame
  decisions against the provider adapter in use instead of copying Pi defaults.

No adoption is implied. Pi 1.0 is a stable coding-agent reference; Pi Durable is
an experimental prior-art study with a distinct lifecycle and storage boundary.

[^earendil-pi-1-0-post]: [Pi 1.0 announcement](https://earendil.com/posts/pi-1-0/)

[^earendil-pi-durable-post]: [Pi Durable announcement and design tour](https://earendil.com/posts/pi-durable/)

[^earendil-pi-readme-stack]: [Pi product surface and package map](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/README.md#L13-L21)

[^earendil-pi-readme-permissions]: [Pi permission and containerization boundary](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/README.md#L88-L96)

[^earendil-pi-license]: [Pi MIT license](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/LICENSE#L1-L15)

[^earendil-pi-agent-changelog]: [Pi 1.0 agent package boundary](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/agent/CHANGELOG.md#L13-L18)

[^earendil-pi-coding-agent-package]: [Coding agent dependencies on codemode and MCP](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/package.json#L49-L55)

[^earendil-pi-durable-package]: [Pi Durable package metadata](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/package.json#L1-L5)

[^earendil-pi-codemode-tool]: [Codemode nested calls and transcript store](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/extensions/codemode/tool.ts#L1-L21)

[^earendil-pi-codemode-host]: [Codemode worker lifecycle](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/codemode/src/runtime/host.ts#L120-L166)

[^earendil-pi-codemode-worker]: [Codemode QuickJS worker boundary](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/codemode/src/runtime/worker.ts#L1-L11)

[^earendil-pi-mcp-extension]: [MCP exposure and tool pipeline](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/extensions/mcp/index.ts#L1-L25)

[^earendil-pi-mcp-config]: [MCP exposure modes and server configuration](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/core/mcp-servers.ts#L43-L87)

[^earendil-pi-classifier-types]: [Structured non-chat classifier model contract](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/ai/src/types.ts#L635-L690)

[^earendil-pi-virtual-model]: [Virtual model routing contract](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/core/virtual-models.ts#L52-L101)

[^earendil-pi-virtual-route]: [Per-request virtual routing and persisted router state](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/core/agent-session.ts#L804-L830)

[^earendil-pi-tool-search]: [BM25 deferred tool loading](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/extensions/tool-search/tool.ts#L197-L213)

[^earendil-pi-cache-warmer-policy]: [Cache warming safety policy](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/core/cache-warmer.ts#L15-L58)

[^earendil-pi-cache-warmer-run]: [Cache warmer request lifecycle](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/core/cache-warmer.ts#L157-L225)

[^earendil-pi-cache-sdk]: [Cache warming integration and current-prefix check](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/coding-agent/src/core/sdk.ts#L349-L412)

[^earendil-pi-transcript]: [Transcript replay and provider fallback](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/ai/src/utils/transcript.ts#L57-L121)

[^earendil-pi-anthropic]: [Anthropic native mid-conversation tool additions](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/ai/src/api/anthropic-messages.ts#L1136-L1221)

[^earendil-pi-durable-readme]: [Pi Durable experimental status](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/README.md#L1-L5)

[^earendil-pi-durable-session]: [Session mutation line and committed publication](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/session/session.ts#L53-L58)

[^earendil-pi-durable-jsonl]: [JSONL sidecar and commit marker ordering](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/storage/jsonl/storage.ts#L277-L305)

[^earendil-pi-durable-sqlite]: [SQLite atomic storage transaction](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/storage/sqlite/storage.ts#L162-L185)

[^earendil-pi-durable-scheduler]: [Durable task reopen and resume](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/scheduler.ts#L230-L262)

[^earendil-pi-durable-tool]: [Durable tool intent and replay policy](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/tool.ts#L35-L111)

[^earendil-pi-durable-submissions]: [Exactly-once submission admission and busy queue](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/submissions.ts#L141-L206)

[^earendil-pi-durable-inbox]: [Steering and follow-up boundary placement](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/inbox.ts#L58-L106)

[^earendil-pi-durable-generation]: [Durable generation checkpoints and deferred polling](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/generation.ts#L111-L231)

[^earendil-pi-durable-context]: [Durable transcript derivation and interrupted tool results](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/context.ts#L53-L82)

[^earendil-pi-durable-harness]: [Per-conversation execution environment and scheduler](https://github.com/earendil-works/pi/blob/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable/src/harness/harness.ts#L224-L240)

[^llame-spec-boundaries]: [llame approvals and installation-local Run lifecycle](../../../SPEC.md#L75-L108)
