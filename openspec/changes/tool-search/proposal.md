## Why

Every admitted tool declaration is sent to the model on every step of every Run. Today that is a
handful of code-owned tools plus whatever an operator allowlists from MCP, so nothing hurts. It
stops being harmless once an operator wires a real MCP server: `github-mcp-server --toolsets all`
is roughly 100 tools and `@playwright/mcp` roughly 60, each declaration a few hundred tokens, so
two or three such servers put tens of thousands of tokens of schemas in front of a model whose
`contextWindowTokens` may be 128k. Nothing errors; compaction fires sooner and the conversation is
crowded out by a fixed prefix the model mostly never calls
([#338](https://github.com/leon0399/llame/issues/338)).

The approved revision of this change no longer matches the system it targets:

- It bound an immutable accept-time snapshot with `toolHash`, `contentHash`, and a persisted
  availability manifest. Those were removed: the worker composes each attempt's catalog in
  memory and writes a system-only receipt (SPEC §9.7).
- It assumed llame had no Anthropic provider. `anthropic-messages` now ships, and its installed
  adapter already speaks deferred tools, `tool_reference` results, and mid-conversation tool
  changes.
- It refused to pre-declare any MCP tool once the catalog crossed the budget, because every
  candidate ordering it considered (id order, first-N) was arbitrary. The owner's own call history
  is a non-arbitrary ordering: the tools an owner keeps calling are the ones worth declaring.
- OpenAI and Anthropic now both let an application change which tools the model is offered
  without editing the `tools` array, so loading a tool mid-conversation no longer has to cost a
  full prefix re-prefill ([prompt-cache study F10](../../../docs/research/tool-harness/2026-09-26-prompt-cache-boundaries.md)).
  The same mechanisms are what a later per-message selector, such as the Jev classifier the
  [System One study](../../../docs/research/tool-harness/2026-09-23-system-one-jev/report.md)
  assessed, would use to preload tools for one message.

Value is still gated on operators adding large MCP catalogs. This change is not on the v0.7
critical path.

## What Changes

- Separate three tool sets that llame currently treats as one: **admitted** (the operator gate,
  unchanged), **declared** (schemas the model is offered), and **discoverable** (admitted MCP
  tools whose schemas are withheld until loaded). Admitted code-owned tools are always declared
  and never counted against any budget.
- Keep the per-model **declaration budget**: one tenth of the model's usable context (its
  compaction threshold), overridable as `models[].toolSearchThresholdTokens`. When every eligible
  MCP declaration fits, nothing changes: every admitted tool is declared as today.
- When the catalog exceeds the budget, **declare the owner's most-used MCP tools** and make the
  rest discoverable. The ranking counts the owner's own successful calls per MCP tool across
  their chats in a trailing window, is resolved once per chat epoch under owner isolation, frozen
  on the chat like the skill-catalog baseline, and re-resolved at compaction. A tool the owner
  has never called successfully is never pre-declared.
- Add the reserved, read-only, llame-executed `tool_search` tool: exact-id `select` plus a small
  keyword query. It records which tools it loaded; the loaded set for a request is derived from
  the `tool_search` observations present in that request's model context, so it follows
  compaction, queue retry, and model switches without a new Run column.
- Make **how loaded schemas reach the model** a per-model strategy, `models[].toolSearch`:
  `harness` (default, every wire) adds loaded tools to the declared set on later steps; `native`
  keeps the `tools` array constant for the chat epoch and loads through the provider's own
  append-only mechanism: deferred tools plus `tool_reference` results on `anthropic-messages`,
  and deferred functions plus a client-executed `tool_search` on `openai-responses`.
- Keep the discovery limits in `mcp-tools` (1,000 tools, byte bounds, deadline) as wire-level
  resource guards independent of the budget.
- Record, in design, the road to per-message tool selection by a fast classifier: a
  server-authored load delivered through the same native mechanisms (Anthropic `tool_addition`,
  OpenAI `additional_tools` or `allowed_tools`). None of it ships here.

Not in scope: the per-message selector and any Jev integration; provider-executed search
(Anthropic BM25/regex, OpenAI hosted search); OpenAI namespaces; embeddings or BM25 over the
catalog; cache-preserving availability changes for unavailable tools
([#972](https://github.com/leon0399/llame/issues/972)); tools added in the middle of a Run
([#974](https://github.com/leon0399/llame/issues/974)); a user-facing tool picker; tool
declarations in the owner receipt; and any change to authorization. A discoverable tool is
admitted, allowlisted, read-only, and executed under the same attempt-local declaration match as
before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tool-calling`: admitted MCP tools beyond the per-model budget are discoverable through a
  reserved `tool_search` tool; the most-used MCP tools stay declared; the loaded set derives from
  replayed `tool_search` observations; `tool_search` observations project through the executing
  wire's native loading form under the `native` strategy; the transport strategy is per model.
- `context-injection`: the owner's MCP usage rank is a frozen prefix baseline stored on the chat,
  resolved in the accepted-turn transaction and re-resolved at compaction.
- `instance-config`: optional `models[].toolSearchThresholdTokens` and `models[].toolSearch`,
  validated against the model's provider type.
- `mcp-tools`: discovery limits are resource guards independent of the declaration budget.

## Impact

- `apps/api/src/tools`: tier computation beside `composeTurnToolCatalog`, the `tool_search`
  executor, registry and allowlist refusal of the reserved id.
- `apps/api/src/runs`: partition at attempt preparation, loaded-set derivation, per-step declared
  set composed with the existing step cap, the execute-wrapper gate.
- `apps/api/src/chats`: usage-rank resolution in the accepted-turn transaction, fork copy, the
  `tool_search` observation projection.
- `apps/api/src/models`: `anthropic-model-client.ts` and `openai-model-client.ts` native
  delivery using installed adapter options; no SDK upgrade.
- `apps/api/src/db`: two nullable `chats` columns for the rank baseline and its compaction
  identity; one closed unavailable reason `declaration_budget_exceeded`.
- `apps/api/src/instance-config`: two optional model keys and their JSON Schema entries.
- Docs: `docs/mcp-tools.md`, `README.md`, `SPEC.md` §13, `CHANGELOG.md` on ship.
- Closes [#338](https://github.com/leon0399/llame/issues/338).
