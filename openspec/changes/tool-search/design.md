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
declaration when deferral engages. The snapshot gains two nullable fields: `discoverableToolIds`
(sorted bound ids not declared on the first step) and `toolSearchStrategy`, both `NULL` when no
tool is discoverable and both included in `contentHash` and in the stored-content equality check
only when present, so every pre-existing snapshot keeps its hash and a pre-change row never
collides with a post-change one (reviewer C-F5). `toolHash` keeps covering the exact bound
declaration set, now including `tool_search`. The availability manifest is untouched and
`tool_search` does not enter it: exposure is receipt-only state, the manifest keeps describing
eligibility and availability, and a threshold crossing therefore never produces an `Added tools`
or `Removed tools` reminder (reviewers A-F4, C-F4). Rejected: a manifest v2 with an `exposure`
field per entry, which forces a parser fork and migration for a field the reminder logic must
ignore anyway; listing `tool_search` in the manifest, which the existing diff would report as an
availability transition.

### D3. Per-model threshold, constant ratio, existing estimator

`budget = models[].toolSearchThresholdTokens ?? floor(contextWindowTokens × 0.1)`. The budget
governs only the deferrable part of the catalog: code-owned tools are always declared and never
counted, so the cut below always terminates and a tiny override cannot make a Run unsatisfiable
(Codex PR finding). The MCP estimate is the ~4 chars/token estimator over the canonical JSON of
every eligible MCP declaration, computed once at accept from already-canonical declarations.
Deferral engages only when `mcpEstimate > budget` (strict; #338's sketch wrote `>=`, the
difference is one token). A per-model positive-integer override mirrors
`compactionThresholdTokens`; a threshold below every inventory entry cuts every MCP tool into
`declaration_budget_exceeded` and binds no `tool_search`, which is the honest outcome rather
than a special eval mode.
The inventory is counted against the same budget with one strategy-neutral estimate, ids plus
admitted descriptions, which is the surface the `openai` strategy keeps visible and a
conservative over-count for the `harness` enum; charging the two strategies differently would
make them partition the same catalog differently (Codex PR finding). When promoted MCP
declarations plus the inventory would exceed the budget, MCP tools are cut from the discoverable
set in descending id order until it fits and the cut ids are bound as `unavailable` with the
closed reason `declaration_budget_exceeded`, so they appear in the manifest, the reminder, and
the receipt rather than vanishing (reviewer C-F7; a 1,000-id enum is ~16k tokens, above a 128k
model's budget). No instance-level knob, per the `instance-config`
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
unless D6 promotes it, except ids cut by D3's inventory rule, which are terminal for the Run:
bound `unavailable`, absent from the inventory, search results, loading, and promotion
candidates (CodeRabbit finding). Filling the leftover budget with "the first N MCP tools" would
make the partition depend on id order and shift as servers reconnect; a stable, explainable
rule is worth more than a few thousand tokens. Revisit only with a measured case.

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

### D6. Loaded means delivered; promotion is bounded and reads the previous Run

A tool is loaded only when its full declaration was delivered in a `tool_search` result. The
executor sizes the result itself, dropping whole declarations that would not fit the tool result
cap and listing them as `notLoaded`, so the recorded structured result is never truncated and is
the single record of the loaded set. The worker persists each completed `tool_search` call as
an occurrence record `{ step, position, ids }` keyed by `(step, position)` with an atomic,
idempotent upsert on the Run row, and the ordered loaded set is derived from those records;
parallel calls in one step settle in scheduler order, so completion order does not change the
derived order (Codex and CodeRabbit findings). A queue retry re-executes the loop from the
first step and the model may search differently, so an attempt clears the Run's records before
its first step; a stale record from a dead attempt would otherwise make a tool the current
attempt never received callable under `openai` (Codex finding). A Run that fails or is
cancelled afterward still carries what its last attempt recorded.

llame's executor wrapper is the authority on the loaded set under every strategy: a call to a
discoverable tool that is not in the Run's loaded set is refused with the recorded
`not_available` error before any executor runs (reviewer A-F3). Under `harness` the SDK also
refuses it earlier through `activeTools`; under `openai` the deferred tool must stay in the
request, so the wrapper is the only gate.

Across Runs, acceptance already loads `previousRun` and `previousSnapshot` (`turn-context.ts`).
The promotion candidates are the previous Run's recorded loaded ids (most recent first) followed
by the previous snapshot's promoted ids (its declared MCP ids, present only when that
snapshot's partition was engaged: a non-empty discoverable list or at least one
`declaration_budget_exceeded` cut, so a Run that simply fit the budget promotes nothing per
reviewer A-F2, while a promotion that cut the whole remaining inventory still carries forward
per a Codex finding). Candidates are admitted in that order while the declared tier still fits
the
budget; the rest stay discoverable (reviewer C-F3: promotion is bounded by the same budget that
triggered deferral, so a long epoch cannot re-declare the whole catalog). Loads recorded on Runs
before the active compaction checkpoint are never promoted. Compaction keeps the last messages
verbatim, so a search result can survive in the kept tail as history; that is fine because the
wrapper, not history, decides callability: the model is refused once and searches again
(reviewer A-F1).

### D7. Search is exact ids plus token match, top-N

`select` resolves exact ids (enum-validated). `query` matches case-insensitive tokens against the
id split on `_`/`-` and the neutralized description, ranking exact id > id token > description
token, ties by id. `limit` default 5, maximum 20. The result is
`{ status: 'success', tools: [{ id, description, inputSchema }], notFound: [...], notLoaded: [...] }`.
Loaded
declarations are the same neutralized, admitted declarations that were bound; no new trust
boundary. Rejected: BM25 (Codex's choice; a dependency for ≤1,000 short documents), embeddings
(latency and a provider call inside the loop for no measured gain).

### D8. `tool_search` is a reserved harness id

The registry refuses `tool_search` like it refuses `mcp__*`; it is never a `tools.allowed` entry
and boot fails if listed. It is synthesized only when deferral engages, classified `read_only`,
needs no tenant database access, is absent from the availability manifest (D2), and is shown in
the receipt through the bound declarations. A step that only calls `tool_search` counts toward
`maxStepsPerRun`;
the cap still wins in `prepareStep`. The worker resolves it to a synthetic executor
built from the snapshot at the same seam that binds every other declaration, validated by the
same declaration hash (reviewer C-F6: `resolveBoundExecutableTools` throws for an id with no
executor, so the seam must know the reserved id). The allowlist half of the reserved-id rule is
already implied by "unknown allowlist id fails boot"; the registry refusal is the new behavior.

### D9. Refusal text is the SDK's; the `tool_search` description carries the guidance

llame cannot author the refusal text the model reads: `experimental_repairToolCall` returns
`null`, so the AI SDK synthesizes the tool error itself, and on `ai@6.0.256` that text is
`Model tried to call unavailable tool '<id>'. Available tools: <declared ids>.` Since `tool_search`
is always in the declared set, the model is told where to go without llame adding text. llame's
recorded `not_available` refusal is unchanged. The guidance about loading discoverable tools
lives in the bound `tool_search` declaration's description, which exists only when deferral is
active; the packaged prompt is untouched, so a within-budget Run keeps its `promptHash` and
`contentHash` (Codex PR finding). Rejected: rewriting an unloaded call
into `tool_search { select: [id] }` inside `repairToolCall`, which would persist a call the model
never authored and still costs the same extra step.

### D11. The `openai` strategy: client execution, deferred schemas, no enum, llame-owned promotion

Discoverable declarations are sent with `providerOptions.openai.deferLoading: true` instead of
omitted, and the bound `tool_search` declaration is `openai.tools.toolSearch({ execution:
'client', parameters })` with the same `select`/`query`/`limit` shape minus the enum, since the
model already sees every deferred function's name and description natively. An adapter owns the
wire mapping (reviewer C-F1): the SDK hands `execute` `{ arguments, call_id }`, so the adapter
unwraps `arguments` into the shared executor's input and maps each delivered declaration to
`{ type: 'function', name, description, parameters, defer_loading: true }` in the returned
`tools` array, which the SDK emits as `tool_search_output` with the echoed `call_id`; `notFound`
and `notLoaded` cannot cross that output schema, so under this strategy they are recorded in the
durable tool observation and the model sees an empty or partial load, a relaxation the spec
states explicitly (Codex PR finding). Within a
Run the provider declares the loaded tools from that output; the wrapper in D6 still gates calls.

Across Runs, llame does not rely on provider history: promoted tools (D6) are sent as ordinary
declarations without `defer_loading`, exactly as under `harness`, so both strategies share one
promotion and compaction story. This is forced by replay: llame replays every persisted tool
result as text (`tool-observation-part.ts:233-252`), so a prior Run's search never becomes a
`tool_search_output` item (reviewer C-F2). What the replayed pair `tool_search_call` plus a text
function output does to the Responses API is unverified; task 3.0 settles it against the real
API before any other native work, with two candidates: persist the structured output for
`tool_search` observations so the SDK emits `tool_search_output` (then a promoted tool must not
also be redeclared, or the API is checked to tolerate it), or replay prior searches as plain
function calls under the reserved id. Codex also claimed the serializer requires a `namespace`
on deferred function calls; the installed code spreads it only when present
(`dist/index.mjs:3361-3367`), so that claim is rejected.

Rejected: server execution (OpenAI's ranking and inventory, which the receipt cannot describe;
revisit as an opt-in if its quality proves better) and OpenAI namespaces (one per MCP server
would hide member names behind a server description llame does not have; the only candidate
source is the server's own `initialize` text, which is untrusted and needs its own spec).
Namespaces are the lever if the visible inventory, not the schemas, becomes the budget problem
under this strategy; D3's `declaration_budget_exceeded` cut is the bound until then.

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
- [Provider caches] → the declared set changes only when a load or a promotion happens, under
  both strategies.
- [Inventory alone exceeds the budget] → deterministic `declaration_budget_exceeded` cut,
  disclosed through the manifest and reminder, never a silent omission.
- [`openai` strategy on an unsupported model] → the strategy is a per-model declaration, and the
  provider's rejection of `tool_search` surfaces as the existing recorded run error rather than
  a silent fallback; operators declare it only on `gpt-5.4`-and-later models.
- [Replayed prior searches under `openai` may be rejected by the Responses API] → task 3.0 spike
  gates the native layer; cross-Run loads never depend on that replay.

## Migration Plan

Additive: two nullable snapshot fields (discoverable ids, strategy), one nullable Run field for
loaded ids, one new closed unavailable reason, two optional config keys. Existing snapshots have
neither field and keep their hashes. Forward rollout (Codex PR finding): a Run bound by a new
API with a `tool_search` declaration or a `declaration_budget_exceeded` entry is executable only
by a worker that knows both, so a mixed-version window fails such Runs closed before any
provider request. The default co-located deployment has no window; a dedicated-worker
deployment deploys workers before the API, and the loop layer's PR body states that order.
Rollback is not free (reviewer C-F8): a queued or retried
Run bound with a `tool_search` declaration needs the synthetic executor, so removing the feature
means keeping that executor until every such Run is terminal, or accepting that those Runs fail
closed before the provider request.

## Open Questions

None that change the specs or the stack.
