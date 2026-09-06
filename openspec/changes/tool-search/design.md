## Context

See `proposal.md` for motivation. Constraints that shape the design:

- Every Run binds an immutable effective-context snapshot: exact declarations (`toolHash`),
  prompt plus declarations (`contentHash`), and an availability manifest (`availabilityHash`).
  Workers execute only an exact declaration-hash match from that snapshot; the owner receipt shows
  exactly what was bound (`model-system-prompts`).
- The tool loop already varies the per-step tool set: `openai-model-client.ts` returns
  `{ activeTools: [] }` from the AI SDK `prepareStep` once `maxStepsPerRun` tool steps ran.
  Verified on the installed `ai@6.0.256`: a step's `parseToolCall` receives the
  `activeTools`-filtered set, so a call to an inactive tool is a `NoSuchToolError` that reaches
  `experimental_repairToolCall` and llame's `onUnavailableToolCall` refusal. Inactive means
  refused, not silently executed.
- llame speaks OpenAI-compatible endpoints only (`@ai-sdk/openai`, no Anthropic provider), so the
  hosted `tool_search_tool_*` (Anthropic) and Responses `tool_search` (OpenAI) tool types are not
  usable; a client-executed function tool is the only portable shape.
- Chat Completions rejects a function description longer than 1024 characters (moderate
  confidence, provider error `string too long`), so an inventory of hundreds of ids cannot live in
  a description.
- Compaction already estimates tokens at ~4 chars/token (`compaction.ts` `estimateContextTokens`)
  and resolves its trigger per model as `compactionThresholdTokens ?? contextWindowTokens × ratio`;
  `instance-config` forbids an instance-level context-window knob.

### Reference survey (read 2026-09-06 from the local checkouts in `CLAUDE.local.md`)

| harness                                                             | exists  | trigger                                                                                 | inventory shown                                                       | search                                                                    | after a hit                                                                                                | persistence                                                    |
| ------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Claude Code (`src/utils/toolSearch.ts`, `src/tools/ToolSearchTool`) | yes     | default always; `auto` mode fires when deferred definitions ≥ 10% of the context window | bare names; a hints A/B "showed no benefit" (`prompt.ts:110-117`)     | `select:A,B` exact, else weighted name/description keyword scoring, top 5 | server-expanded `tool_reference` blocks AND re-added to the next request's `tools`                         | session-sticky, survives compaction, evicted on MCP disconnect |
| Codex (`codex-rs/core/src/tools/handlers/tool_search*.rs`)          | yes     | model capability flag; MCP tools always deferred                                        | no names; only a source list in the tool description                  | BM25 over name + description + schema property names, limit 8             | full specs inside a `tool_search_output` history item, not re-injected into `tools` (`search_tool.rs:554`) | history-carried                                                |
| oh-my-pi (`tools/xdev.ts`)                                          | yes     | always for `discoverable` tools (MCP default)                                           | `xd://<name> — summary` catalog in the system prompt, 48k-char budget | exact name only                                                           | schema returned as `read` output; calls dispatched through `write xd://`                                   | none needed                                                    |
| openclaw (`src/agents/tool-search*.ts`)                             | yes     | mode `code`/`directory`/…                                                               | bounded directory                                                     | lexical, batch queries                                                    | `tool_describe` returns schema; `tool_call` dispatches indirectly                                          | none needed                                                    |
| goose                                                               | partial | always                                                                                  | active extensions only                                                | none (dump list)                                                          | `manage_extensions` enables a whole server; tools re-listed next request                                   | until disabled                                                 |
| gemini-cli, deepseek-harness, hermes, open-webui                    | no      | static allow/deny or user-picked toolsets                                               | —                                                                     | —                                                                         | —                                                                                                          | —                                                              |
| AI SDK                                                              | seam    | `prepareStep → { activeTools }` (`filter-active-tools.ts`)                              | —                                                                     | —                                                                         | —                                                                                                          | —                                                              |

Two facts carry over: names alone are enough of an inventory (Claude Code's A/B), and everybody
that declares a real search tool re-declares the loaded schema on following steps except Codex,
which relies on the Responses API keeping the loaded spec in history.

## Goals / Non-Goals

**Goals:**

- Zero behavioral and zero hash change for any instance whose catalog fits the budget.
- Bind-everything, send-a-subset: the receipt and worker execution contract are unchanged in
  kind; a discoverable tool is as bound, allowlisted, and read-only as a declared one.
- Deterministic under queue retry and reproducible from the snapshot alone.
- Provider-neutral: works against any OpenAI-compatible endpoint with function calling.

**Non-Goals:**

- Ranking quality beyond exact ids and simple keyword matching; no BM25, no embeddings.
- Deferring code-owned tools, per-server tier configuration, or a per-model kill switch.
- Filling the remaining budget with a subset of MCP tools (see D4).
- Any change to `tools.allowed` semantics or to the availability manifest version.

## Decisions

### D1. Client-executed function tool on the existing `prepareStep` seam

`tool_search` is an ordinary function tool executed by the harness. The per-step tool set is
`prepareStep → { activeTools }`, composed with the existing step cap in the model client: cap
reached → `[]`; otherwise `declared ∪ loaded(steps) ∪ { tool_search }`. Alternatives: the hosted
Anthropic/OpenAI tool-search tools (not reachable from llame's provider surface, and OpenAI's is
Responses-only); a code-mode `execute` tool (a new execution class, out of scope under §13.5).

### D2. Bind everything at accept; the snapshot records the partition

Every eligible admitted declaration is bound exactly as today, plus the synthesized `tool_search`
declaration when deferral engages. The snapshot gains one sorted list, `discoverableToolIds`
(bound ids not declared on the first step). `toolHash` keeps covering the exact bound declaration
set (now including `tool_search`, whose schema enum lists the discoverable ids). `contentHash`
covers `{ systemPrompt, toolDeclarations, discoverableToolIds }` with the key omitted when the
list is empty, so every pre-existing snapshot hash is preserved and content-address reuse stays
valid. The availability manifest is untouched: `available` keeps meaning bound-and-callable
(after loading, for a discoverable tool), the reminder diff ignores exposure, and no manifest v2
is introduced. Alternative rejected: a manifest v2 with an `exposure` field per entry forces a
parser fork and migration for a field the reminder logic must ignore anyway.

### D3. Per-model threshold, constant ratio, existing estimator

`budget = models[].toolSearchThresholdTokens ?? floor(contextWindowTokens × 0.1)`. The catalog
estimate is the ~4 chars/token estimator over the canonical JSON of every eligible declaration,
computed once at accept from already-canonical declarations. Deferral engages only when
`estimate > budget`. A per-model integer override mirrors `compactionThresholdTokens` exactly;
`0` means always defer (useful for evals). No instance-level knob, per the `instance-config`
rule against instance-level context-window settings. Rejected: an instance-level percentage
(contradicts that rule), a flat tool-count cap (#338 explains why the two limits must not be
conflated).

### D4. Tier rule: code-owned declared, MCP discoverable, no budget filling

When deferral engages, every code-owned tool is declared and every MCP tool is discoverable
unless D6 promotes it. Filling the leftover budget with "the first N MCP tools" would make the
partition depend on id order and shift as servers reconnect; a stable, explainable rule is worth
more than a few thousand tokens. Revisit only with a measured case.

### D5. Inventory lives in the `tool_search` input schema

`tool_search` input: `{ select?: string[], query?: string, limit?: integer }` where `select.items`
carries a JSON Schema `enum` of the discoverable ids. That gives the model the names (all any
surveyed harness needed), validates a `select` for free, keeps the inventory inside the bound
declaration contract (`toolHash`, receipt), and sends it as a stable request prefix rather than a
persisted part on every turn. Rejected: the tool description (1024-char provider limit); a
per-turn server-authored context item (hundreds of ids re-persisted into history each turn); a
system-prompt section (moves the inventory into `promptHash` and requires a projection change).
Worst case at the 1,000-tool guard: ~64k characters of ids, still one order of magnitude below
the schemas it replaces.

### D6. Loaded set: derived within a Run, promoted across Runs in the same epoch

Within a Run the loaded set is derived in `prepareStep` from the prior steps' `tool_search` calls
using the executor's own record of resolved ids (never the possibly truncated result text). A
queue retry restarts the loop from step one, so the derivation is deterministic. Across Runs, at
accept time, every id that a successful `tool_search` result loaded in the model-visible history
since the active compaction checkpoint is placed in the declared tier when it is still bound; the
snapshot records the outcome, so the receipt is exact. A new compaction checkpoint starts a new
disclosure epoch and resets the tier to D4, matching the existing epoch semantics for availability
reminders. Needed because inactive tools are refused (see Context): without promotion the model
would see itself calling a tool in history and be refused when it calls it again.

### D7. Search is exact ids plus token match, top-N

`select` resolves exact ids (enum-validated). `query` matches case-insensitive tokens against the
id split on `_`/`-` and the neutralized description, ranking exact id > id token > description
token, ties by id. `limit` default 5, maximum 20. The result is
`{ status: 'success', tools: [{ id, description, inputSchema }], notFound: [...] }`. Loaded
declarations are the same neutralized, admitted declarations that were bound; no new trust
boundary. Rejected: BM25 (Codex's choice; a dependency for ≤1,000 short documents), embeddings
(latency and a provider call inside the loop for no measured gain).

### D8. `tool_search` is a reserved harness id

The registry refuses `tool_search` like it refuses `mcp__*`; it is never a `tools.allowed` entry
and boot fails if listed. It is synthesized only when deferral engages, classified `read_only`,
needs no tenant database access, appears in the manifest as `available` with its declaration hash,
and is shown in the receipt. A step that only calls `tool_search` counts toward `maxStepsPerRun`;
the cap still wins in `prepareStep`.

### D9. Refusal names the way out

When the model calls a discoverable tool it has not loaded, the existing `not_available` refusal
is recorded and its message adds "load it with `tool_search` first" so the model can recover in
one step. The packaged prompt's Tools section gains one sentence about discoverable tools.

### D10. Surfaces stay generic

`tool_search` calls are ordinary durable tool parts rendered by the existing tool part UI. The
receipt marks each bound declaration as declared or discoverable and shows the `tool_search`
declaration like any other. No new UI component.

## Risks / Trade-offs

- [Weak tool-use models never call `tool_search`] → the refusal message names the tool, and the
  per-model override lets an operator raise the threshold for that model.
- [Enum of many ids is itself large] → bounded by the 1,000-tool guard; an order of magnitude
  below the schemas replaced; recorded in the receipt so the cost is visible.
- [Crude token estimate misjudges the budget] → the estimate errs the same way compaction's does;
  the override exists for a model where 10% is wrong.
- [Loaded schemas inflate a `tool_search` result] → `limit ≤ 20` and the existing result
  truncation; activation uses the executor's id record, not the truncated text.
- [Cross-Run promotion reads history at accept] → same window the reminder logic already reads;
  bounded by the epoch; falls back to D4 when nothing was loaded.
- [Provider caches] → the declared set changes only when a load happens, so the stable prefix
  changes at most once per load.

## Migration Plan

Additive: one nullable snapshot field, one optional config key. Existing snapshots have no
`discoverableToolIds` and keep their hashes. Rollback is removing the code; bound snapshots with
a non-empty list still execute because every listed tool is bound.

## Open Questions

None that change the specs or the stack.
