## Why

Every admitted tool declaration is sent to the model on every step of every Run. Today that is
four code-owned tools plus whatever an operator allowlists from MCP, so nothing hurts. It stops
being harmless the moment an operator wires a real MCP server: `github-mcp-server --toolsets all`
is roughly 100 tools and `@playwright/mcp` roughly 60, each declaration a few hundred tokens, so
two or three such servers put tens of thousands of tokens of schemas in front of a model whose
`contextWindowTokens` may be 128k. Nothing errors; compaction just fires sooner and the
conversation is crowded out by a fixed prefix the model mostly never calls
([#338](https://github.com/leon0399/llame/issues/338)).

Every current harness that solves this does it the same way: bind the whole catalog, declare only
a core set to the model, and let the model load the rest on demand through a search tool
(Claude Code `ToolSearch`, Codex `tool_search`, OpenAI and Anthropic hosted tool-search tools;
survey in `design.md`). llame already runs the tool loop on the AI SDK's per-step `activeTools`
seam for the step cap, so the mechanism is a change to what is _sent_, not to what is _bound_.

Value is gated on operators adding large MCP servers; the current instance never trips the
threshold. This proposal is not on the v0.7 critical path.

## What Changes

- Add a per-Run **declaration budget**: a per-model token threshold (default one tenth of
  `contextWindowTokens`, overridable per model as `models[].toolSearchThresholdTokens`). When the
  estimated size of every eligible declaration fits the budget, nothing changes and every snapshot
  hash is byte-identical to today.
- When the catalog exceeds the budget, the Run still **binds every eligible declaration**, but
  code-owned tools are declared to the model directly while MCP tools become **discoverable**: not
  declared on the first step, listed by id inside a harness-owned `tool_search` tool, and declared
  on later steps once the model loads them.
- Add the reserved, read-only, harness-synthesized `tool_search` tool: exact-id `select` (schema
  enum of the discoverable ids) plus a small keyword search over ids and descriptions. Its result
  returns the loaded declarations, and those tools are declared natively on every following step of
  the Run. Loaded tools stay declared on later Runs in the same disclosure epoch; a compaction
  checkpoint resets the tier to default.
- Make the search **transport a per-model strategy** with one shared executor: `harness` (the
  function tool above, every OpenAI-compatible endpoint) and `openai` (OpenAI's Responses
  `tool_search` in client-executed mode with `defer_loading`, for `gpt-5.4`-and-later models on
  the native OpenAI provider), declared as `models[].toolSearch` and defaulting to `harness`.
  An Anthropic hosted strategy is an explicit later extension that first needs an Anthropic
  provider type.
- Record the tier partition and the strategy in the immutable effective-context snapshot and
  expose them in the owner receipt, so the receipt still shows exactly what the model could reach.
- State explicitly that the fixed discovery limits in `mcp-tools` (1,000 tools, byte bounds,
  deadline) are wire-level resource guards that survive independently of the declaration budget.

Not in scope: OpenAI server-executed search (OpenAI's ranking and disclosure, which the receipt
could not describe), OpenAI tool namespaces, the Anthropic provider itself, embeddings or BM25
over the catalog, a code-mode `execute` tool, per-server deferral configuration, a user-facing
tool picker, and any change to authorization: a discoverable tool is bound, allowlisted,
read-only, and executed on the same exact declaration hash as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tool-calling`: bound declarations beyond the per-model budget are discoverable through a
  reserved `tool_search` tool; loaded tools are declared on later steps and later Runs in the same
  disclosure epoch; `tool_search` steps count toward `maxStepsPerRun`; the reserved id cannot be
  registered or allowlisted; the transport strategy is per model and preserves every invariant.
- `model-system-prompts`: the immutable snapshot binds every eligible declaration plus the tier
  partition and strategy; the content hash covers the partition only when it is non-empty; the
  receipt shows which bound declarations were discoverable and which strategy carried them.
- `instance-config`: optional `models[].toolSearchThresholdTokens`, mirroring
  `compactionThresholdTokens`, and optional `models[].toolSearch` strategy validated against the
  model's provider; no instance-level knob.
- `mcp-tools`: discovery limits are resource guards independent of the declaration budget.

## Impact

- `apps/api/src/tools`: tier computation next to `composeTurnToolCatalog`; the `tool_search`
  executor; registry refusal of the reserved id.
- `apps/api/src/runs`: snapshot fields for the partition and strategy, receipt projection, the
  loaded-set derivation at accept, `prepareStep` composition with the existing step cap in the
  model client.
- `apps/api/src/models`: the `openai` strategy in `openai-model-client.ts` using the installed
  `@ai-sdk/openai` `toolSearch` factory and `deferLoading` provider option; no SDK upgrade.
- `apps/api/src/db`: one nullable field on the effective-context snapshot for the sorted
  discoverable-id list and one on the Run for the ids it loaded; no change to the availability
  manifest version.
- `apps/api/src/instance-config`: the new optional model key and its JSON Schema entry.
- `apps/web`: receipt view marks discoverable declarations; `tool_search` calls render through the
  existing generic tool part.
- Docs: `docs/mcp-tools.md` operator note, `README.md` one line, `CHANGELOG.md` on ship.
- Closes [#338](https://github.com/leon0399/llame/issues/338).
