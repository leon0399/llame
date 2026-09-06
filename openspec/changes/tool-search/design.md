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
- llame speaks OpenAI-compatible endpoints only (`@ai-sdk/openai`, no Anthropic provider). The
  native OpenAI provider (`provider.id === 'openai'`, `model-client-factory.ts:38`) is routed to
  the Responses API, every other endpoint to Chat Completions (`openai-model-client.ts:240-244`).
  The installed `@ai-sdk/openai@3.0.97` already ships `openai.tools.toolSearch({ execution,
description, parameters })` and the `deferLoading` provider option on Responses, and converts a
  client-executed search result into a `tool_search_output` item with the loaded definitions
  (`dist/index.mjs:3540-3553`). Anthropic's `tool_search_tool_*` types need an Anthropic
  provider llame does not have.
- OpenAI's tool-search guide (read 2026-09-06): for a deferred function "the model still sees
  the function name and description, so in practice tool search is mostly deferring the
  parameter schema"; loaded tools persist through history ("you do not need to load the same
  tool again across turns", "Tools that were not listed as part of this array will not be
  available"); "Only `gpt-5.4` and later models support `tool_search`". Support is therefore a
  model property, not a provider property.
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
- Provider-neutral by default: the `harness` strategy works against any OpenAI-compatible
  endpoint with function calling; native strategies are per-model opt-ins over one executor.

**Non-Goals:**

- Ranking quality beyond exact ids and simple keyword matching; no BM25, no embeddings.
- Deferring code-owned tools, per-server tier configuration, or a per-model kill switch.
- OpenAI server-executed search and OpenAI tool namespaces (D11 explains both).
- Filling the remaining budget with a subset of MCP tools (see D4).
- Any change to `tools.allowed` semantics or to the availability manifest version.

## Decisions

### D1. One search executor, per-model transport strategy

The budget, tiers, bound declarations, loaded-means-delivered recording, promotion, allowlist,
and receipt are strategy-independent; only how discoverable tools travel and who runs the search
differ. `models[].toolSearch` selects the strategy, default `harness`:

- `harness`: `tool_search` is an ordinary function tool executed by llame; discoverable
  declarations are omitted from the request; the per-step tool set is `prepareStep →
{ activeTools }`, composed with the existing step cap in the model client: cap reached → `[]`,
  otherwise `declared ∪ loaded(steps) ∪ { tool_search }`. Works on every OpenAI-compatible
  endpoint.
- `openai`: the Responses `tool_search` tool type in client-executed mode (D11). Only valid on
  the native OpenAI provider; boot fails otherwise. The same llame executor answers the search.
- An Anthropic hosted strategy (`tool_search_tool_bm25`/`regex`, `defer_loading`,
  server-expanded `tool_reference`) is a named extension point, not shipped: it needs an
  Anthropic provider type first, and its ranking is Anthropic's, so the receipt would record the
  strategy label rather than a llame ranking.

Two implementations ship, so the seam is justified. The reason to go native is model
familiarity, not tokens: under both strategies deferred schemas cost the model nothing and the
inventory costs about the same; a model trained on its provider's native `tool_search` uses it
more reliably than a look-alike function tool. Rejected: a code-mode `execute` tool (a new
execution class, out of scope under §13.5).

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

Why no tokenizer: the estimate feeds a trip-wire at 10% of the window, which tolerates a ±30%
error, and no local tokenizer can be exact about tool definitions anyway, because each provider
renders them through its own template (OpenAI compacts JSON Schema into a TypeScript-like
namespace, Anthropic prepends a tool-use preamble, open models follow their chat template) before
tokenizing. Measured with `o200k_base` on canonical JSON of three representative declarations
(`search_conversations`, a GitHub MCP tool, a Playwright MCP tool): 4.2 to 4.7 chars per token,
4.46 overall, so `chars / 4` overestimates slightly, which errs toward deferring early, the cheap
direction. A 300-id enum measured ~4.2k tokens. The only exact figure is the provider's reported
`usage.inputTokens` after the step, which compaction already prefers over its estimate; if a
second consumer needs sub-10% accuracy, the primitive to add is calibration from reported usage,
not a tokenizer dependency with per-model vocabularies that an OpenAI-compatible endpoint cannot
supply.

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
persisted part on every turn. The enum is the provider-native disclosure of those callable tools,
so the existing reminder rule that callable tools are never listed in prose stays true. Rejected:
the tool description (1024-char provider limit); a
per-turn server-authored context item (hundreds of ids re-persisted into history each turn); a
system-prompt section (moves the inventory into `promptHash` and requires a projection change).
Worst case at the 1,000-tool guard: ~64k characters of ids, still one order of magnitude below
the schemas it replaces.

### D6. Loaded means delivered; promotion reads the previous Run

A tool is loaded only when its full declaration was delivered in a `tool_search` result. The
executor sizes the result itself, dropping whole declarations that would not fit the tool result
cap and listing them as `notLoaded`, so the recorded structured result is never truncated and is
the single record of the loaded set. Within a Run, `prepareStep` derives the loaded set from the
prior steps' delivered `tool_search` results; a queue retry restarts the loop from step one, so the
derivation is deterministic. The worker also writes the loaded ids onto the Run row as each
`tool_search` call completes, so a Run that fails or is cancelled afterward still carries them.

Across Runs, acceptance already loads `previousRun` and `previousSnapshot` (`turn-context.ts`) to
diff availability; promotion reuses them: declared tier = default partition ∪ previous snapshot's
declared tier ∪ previous Run's recorded loaded ids, each filtered to ids still bound for the new
Run. Folding the previous declared tier in gives transitive coverage of the epoch without scanning
message parts. A new compaction checkpoint starts a new disclosure epoch (the same signal the
availability reminder uses) and resets to D4. Under the `openai` strategy the provider carries the
loaded set itself through the replayed `tool_search_output` items, so promotion does not change
the wire (a promoted tool stays `defer_loading: true`, which also preserves the provider cache);
the recorded loaded ids still feed the receipt, and compaction resets both strategies the same
way because the replayed items disappear with the compacted prefix. Needed because inactive tools are refused (see
Context): without promotion the model would see itself calling a tool in history and be refused
when it calls it again.

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
the cap still wins in `prepareStep`. Because it is a manifest entry, a catalog crossing the
threshold between turns yields an `Added tools: tool_search` or `Removed tools: tool_search`
availability reminder; that is deliberate, since the model's callable surface did change. The
allowlist half of the reserved-id rule is already implied by "unknown allowlist id fails boot";
the registry refusal is the new behavior.

### D9. Refusal text is the SDK's; the prompt carries the guidance

llame cannot author the refusal text the model reads: `experimental_repairToolCall` returns
`null`, so the AI SDK synthesizes the tool error itself, and on `ai@6.0.256` that text is
`Model tried to call unavailable tool '<id>'. Available tools: <declared ids>.` Since `tool_search`
is always in the declared set, the model is told where to go without llame adding text. llame's
recorded `not_available` refusal is unchanged. The packaged prompt's Tools section gains one
sentence about loading discoverable tools with `tool_search`. Rejected: rewriting an unloaded call
into `tool_search { select: [id] }` inside `repairToolCall`, which would persist a call the model
never authored and still costs the same extra step.

### D11. The `openai` strategy: client execution, deferred schemas, no enum

Discoverable declarations are sent with `providerOptions.openai.deferLoading: true` instead of
omitted, and the bound `tool_search` declaration is `openai.tools.toolSearch({ execution:
'client', parameters })` with the same `select`/`query`/`limit` shape minus the enum, since the
model already sees every deferred function's name and description natively. llame's executor
answers the `tool_search_call` and the SDK returns the loaded declarations as
`tool_search_output`; from then on OpenAI declares them from history, so no `activeTools`
bookkeeping is needed and `prepareStep` only enforces the cap. Loaded means delivered holds
because the `tools` array of that output is exactly the record. Rejected: server execution
(OpenAI's ranking and inventory, which the receipt cannot describe; revisit as an opt-in if its
quality proves better) and OpenAI namespaces (one per MCP server would hide member names behind
a server description llame does not have; the only candidate source is the server's own
`initialize` text, which is untrusted and needs its own spec).

### D10. Surfaces stay generic

`tool_search` calls are ordinary durable tool parts rendered by the existing tool part UI. The
receipt marks each bound declaration as declared or discoverable, labels the strategy, and
shows the `tool_search` declaration like any other. No new UI component.

## Risks / Trade-offs

- [Weak tool-use models never call `tool_search`] → the refusal message names the tool, and the
  per-model override lets an operator raise the threshold for that model.
- [Enum of many ids is itself large] → bounded by the 1,000-tool guard; an order of magnitude
  below the schemas replaced; recorded in the receipt so the cost is visible.
- [Crude token estimate misjudges the budget] → the estimate errs the same way compaction's does;
  the override exists for a model where 10% is wrong.
- [Loaded schemas inflate a `tool_search` result] → `limit ≤ 20` and the executor drops whole
  declarations to fit the cap, so the result is never truncated and loaded means delivered.
- [A Run expires before its loaded ids are recorded] → the ids are written per `tool_search`
  completion, not at finish; anything lost costs the model one search, never a wrong tier.
- [Provider caches] → the declared set changes only when a load happens, so the stable prefix
  changes at most once per load; under `openai` the loaded set lives in history and the
  deferred set is stable across turns.
- [`openai` strategy on an unsupported model] → the strategy is a per-model declaration, and the
  provider's rejection of `tool_search` surfaces as the existing recorded run error rather than
  a silent fallback; operators declare it only on `gpt-5.4`-and-later models.
- [Replayed history must keep `tool_search_output` items in place] → llame already preserves
  `messages.parts` and stored order; the SDK rebuilds the item from the persisted tool-result
  part, and a compaction prefix removes it together with the loads it carried.

## Migration Plan

Additive: two nullable snapshot fields (discoverable ids, strategy), one nullable Run field for
loaded ids, two optional config keys. Existing snapshots have no
`discoverableToolIds` and keep their hashes. Rollback is removing the code; bound snapshots with
a non-empty list still execute because every listed tool is bound.

## Open Questions

None that change the specs or the stack.
