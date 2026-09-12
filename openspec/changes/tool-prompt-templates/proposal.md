## Why

llame-owned tool descriptions are embedded TypeScript strings, so operators
cannot customize them like system prompts or adapt their guidance to available
tools. Render file-based descriptions and system prompts together in the worker,
using the current execution attempt's owner context and admitted tool catalog.

## What Changes

- D1: Package complete Markdown descriptions for llame-owned tools and reuse the
  existing Handlebars renderer, safe variable projection, and validation.
- D2: Select each file through `models[].toolPromptFiles[toolId]` ->
  `tools.promptFiles[toolId]` -> packaged default. Workers load and compile files
  at boot; overrides replace the entire description.
- D3: Each execution attempt resolves its current owner variables and worker
  catalog, then renders both prompt surfaces together. `tools.<id>` is true for
  an admitted tool and false for an absent id, including an unknown tool.
  Invocation permissions remain separate. This iteration adds no other feature
  checks.
- D4: Keep tool declarations, schemas, descriptions, and executor bindings in
  worker memory. Replace combined context snapshots with system-prompt-only
  receipts per attempt and a minimal committed-turn record of tool ids and
  available/unavailable states.
- D5: Compare each attempt against the previous successfully committed turn's
  availability. Publish its reminder and advance that baseline only with a
  successful turn. Failed attempts contribute no model context or baseline;
  retries resolve fresh and compare against the same preceding committed turn.
- D6: Gate existing cross-tool advice, including Bash's preference for edit and
  conversation search's suggestion to call `conversation_read`.
- **BREAKING**: Effective tool context is no longer fixed at enqueue or reused
  from the database on retry. Tool catalog/availability-hash fields disappear
  from receipts. API/worker storage and context consumers require a coordinated
  cutover; existing native effect-recovery fences remain mandatory.

MCP descriptions, parameter schemas, and tool-result contracts retain their own
authors. There is no new grep executor, prompt editor, file watcher, or raw
configuration exposure.

## Capabilities

### New Capabilities

- `tool-prompt-templates`: Complete description files, shared variables,
  absent-safe tool predicates, and worker-boot/per-attempt lifecycle.

### Modified Capabilities

- `instance-config`: Instance-wide and per-model tool file maps and worker-owned
  prompt loading.
- `model-system-prompts`: Runtime context per attempt, system-only receipts,
  pending receipt state, and compaction without historical database catalogs.
- `tool-calling`: Attempt-local trusted tool bindings, minimal availability
  baselines, and previous-turn reminders that exclude failed attempts.
- `context-injection`: Attempt-local contributions become model history only
  when their turn commits successfully.
- `mcp-tools`: Worker-local admission and in-memory declaration matching in
  place of persisted declaration rebinding.
- `durable-runs`: Attempt identity/fencing and atomic publication of the
  successful assistant turn and availability baseline.
- `personalization`: Shared safe variables and owner settings resolved per
  attempt without changing tool admission or execution authority.
- `chat-recency-digest`: Successful-attempt publication, disclosure tracking
  across both prompt surfaces, and system-only receipt limitations.
- `temporal-anchor`: Stable anchor rendering without combined snapshot reuse.
- `knowledge-tools`: Trusted worker-owned resolution instead of API binding.
- `chat-search`: Current worker catalog gates without inherited declarations.
- `tool-call-permissions`: Attempt membership remains separate from the
  process-frozen invocation policy.

## Impact

API acceptance keeps the user message, selected public model/effort, and Run
identity. The worker takes responsibility for effective prompt/catalog resolution.
The database retains system prompt receipts and minimal availability comparison
state, plus normal messages and operational effect records; it stores no
executable tool catalogs or rendered tool descriptions.

Affected code includes API configuration/prompts, chat acceptance/context
building, Run claim/execution/finalization, MCP binding, compaction, the receipt
API/client/UI, and database migrations. UI changes are limited to system-only
attempt receipts and an honest not-yet-resolved state. No new template dependency
is required.

This design addresses the worker-binding questions in
[#319](https://github.com/leon0399/llame/issues/319). It is a local draft; tracking
and publication remain separate delivery steps. The pending `tool-search` and
`system-provided-skills` proposals require reconciliation with this lifecycle
before their implementations are combined.
