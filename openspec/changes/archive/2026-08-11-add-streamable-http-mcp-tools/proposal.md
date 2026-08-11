## Why

llame's durable tool loop can execute only code-owned tools, so an operator cannot add a remote read-only capability such as current web search without changing the application. #215 adds one generic external-tool path while keeping unavailable servers isolated, credentials out of durable surfaces, and the model explicitly informed when an expected tool is unavailable or changes between turns.

## What Changes

- Add instance-managed remote MCP servers through a top-level, `.mcp.json`-compatible `mcpServers` named object (`type`, `url`, optional static interpolated `headers`), restricted to session-capable Streamable HTTP revisions `2025-03-26` through `2025-11-25` supported by the pinned client, with eager process-resident clients, jittered background discovery/reconnect, nonblocking turn snapshots, and one independent lifecycle per server.
- Discover the complete paginated tool catalog, namespace tool ids as `mcp__<server>__<tool>`, neutralize externally authored declaration prose, validate each input schema before admission, and withdraw a server's tools whenever its connection or fresh catalog becomes unusable.
- Extend the existing fail-closed `tools.allowed` gate so code-owned ids remain boot-validated while syntactically valid MCP ids can remain configured through an outage; only explicitly allowlisted tools execute, and MCP annotations never grant classification or authority.
- Make runtime availability source-neutral for code-owned tools such as `search_conversations`, MCP tools, and later tool sources. Each immutable effective-context snapshot records the exact eligible, advertised, and safely unavailable tool state bound to the Run.
- Persist trusted semantic availability metadata on the triggering user turn and render a canonical `<runtime-tool-availability>` reminder immediately before its text. Each model-facing availability disclosure epoch—a fresh conversation or the first turn after compaction—uses initial semantics: emit an `Unavailable tools` baseline only when degraded because provider-native declarations reintroduce every callable tool on each request. Later turns emit only Added/Removed/Unavailable/Became unavailable/Now available deltas. `Added tools` always means callable now; a newly eligible but already unavailable id is reported under `Unavailable tools`. Unchanged state otherwise emits nothing. Models are told not to simulate unavailable tools or invent their results.
- Preserve answer-only and unrelated native-tool chats during an MCP outage. A disconnect after enqueue settles an affected call as a structured non-fatal unavailable result; it does not substitute another tool or fail an otherwise executable Run.
- Keep configured headers, MCP session ids, raw remote errors, tool arguments/results containing secret values, and transport diagnostics out of logs, run events, persisted errors, receipts, and test output.
- Cover discovery, pagination, admission, call/result mapping, disconnect, reconnect, withdrawal, and close with a deterministic local Streamable HTTP fixture; cover browser invocation plus refresh/history replay and an environment-gated real web-search evaluation.

## Capabilities

### New Capabilities

- `mcp-tools`: Instance-managed Streamable HTTP MCP configuration, client lifecycle, discovery, admission, execution, reconnect, failure isolation, redaction, and acceptance behavior.

### Modified Capabilities

- `instance-config`: Add a closed, portable named-object MCP server configuration with interpolated secret headers and split `tools.allowed` boot validation between code-owned and namespaced dynamic ids.
- `tool-calling`: Generalize the catalog beyond code-owned tools, define source-neutral runtime availability manifests/reminders, preserve allowlist and read-only gates, and degrade withdrawn executors as structured tool outcomes.
- `model-system-prompts`: Extend immutable effective-context snapshots with safe runtime tool availability state and reuse trusted semantic user-message metadata to render availability reminders before the triggering text without adding another top-level system prompt.

## Impact

- `apps/api/src/instance-config/` and `llame.config.json` schema: remote server entries, header interpolation, id validation, and dynamic allowlist semantics.
- `apps/api/src/tools/`: combined code-owned/MCP catalog snapshot, declaration sanitization, availability diffing, result mapping, and persistence-path redaction.
- `apps/api/src/chats/` and `apps/api/src/runs/`: atomic availability metadata authoring, effective-context hashing/storage/receipts, reminder assembly, dynamic executor binding, and disconnect/reconnect behavior.
- `apps/api/src/db/schema` and generated migrations: immutable availability manifests bound to model-context snapshots.
- `e2e/`, API fixtures, and evaluation scripts: deterministic MCP lifecycle coverage, browser replay coverage, and credential-gated real-search evidence.
- Runtime dependency: the AI SDK v6-compatible `@ai-sdk/mcp` line, pinned explicitly rather than following its AI SDK v7 `latest` line.
- `README.md`, `SPEC.md`, `ROADMAP.md`, and `CHANGELOG.md`: remote MCP becomes shipped behavior and #215 leaves the forward roadmap.
- No stdio, deprecated HTTP+SSE fallback, MCP `2026-07-28`, OAuth, user-scoped server configuration, management UI, readiness endpoint, MCP resources/prompts, or write/send/delete tools. Modern sessionless protocol negotiation and lazy account-scoped MCP lifecycles are separate follow-ups.
