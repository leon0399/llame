## ADDED Requirements

### Requirement: Bound tools beyond the declaration budget are discoverable through tool search

Every new Run SHALL resolve a per-model declaration budget in tokens: the model's
`toolSearchThresholdTokens` when configured, otherwise one tenth of its `contextWindowTokens`
rounded down. The system SHALL estimate the size of every eligible admitted declaration for the
turn with the same deterministic provider-independent estimator used for compaction. When the
estimate does not exceed the budget, every eligible declaration SHALL be declared to the model on
every step exactly as before this capability, no `tool_search` tool SHALL exist for that Run, and
the Run's bound declarations, hashes, and receipt SHALL be identical to those produced without
this capability.

When the estimate exceeds the budget, the Run SHALL still bind every eligible admitted
declaration. Each bound tool SHALL belong to exactly one tier for that Run: **declared**, sent as
a native tool declaration on the first step, or **discoverable**, bound but not declared until
loaded. Code-owned tools SHALL be declared. MCP tools SHALL be discoverable unless promoted by a
prior load in the same disclosure epoch. When at least one tool is discoverable, the Run SHALL
additionally bind and declare the reserved harness tool `tool_search`, whose input accepts an
exact-id `select` list constrained to the discoverable ids, a keyword `query`, and a result
`limit` with a default of 5 and a maximum of 20. The discoverable inventory SHALL be disclosed
to the model only through that declaration's input schema, which counts as the provider-native
disclosure of those callable tools; no per-turn prose inventory SHALL be persisted.

A `tool_search` call SHALL resolve exact `select` ids and rank keyword matches over each
discoverable tool's id and its admitted description deterministically, returning the loaded
declarations as a structured success result together with any ids that matched nothing. A tool
SHALL count as loaded only when its full declaration was delivered in that result: the executor
SHALL drop whole declarations that would not fit the result size cap and report them as not
loaded, so the recorded result is never truncated and is the single record of what was loaded.
From the next step of the same Run onward, every loaded tool SHALL be declared natively in
addition to the declared tier. A call to a discoverable tool that has not been loaded in the Run
SHALL be refused with the existing recorded, non-fatal `not_available` error; the text the model
receives for that refusal SHALL name the tools declared on that step, which include `tool_search`.
A step whose only tool call is `tool_search` SHALL count toward `maxStepsPerRun`, and the step cap
SHALL take precedence over loading.

Every Run SHALL record the ids it loaded, in load order, as each `tool_search` call completes,
so a Run that later fails or is cancelled still carries them. At acceptance of a later Run in the
same disclosure epoch, promotion candidates SHALL be the previous accepted Run's recorded loaded
ids, most recent first, followed by the previous snapshot's promoted ids (its declared MCP ids,
present only when that snapshot had discoverable tools). Candidates still bound for the new Run
SHALL be promoted into the declared tier in that order only while the declared tier plus the
inventory still fits the budget; the remainder SHALL stay discoverable. Loads recorded on Runs
before the active compaction checkpoint SHALL NOT be promoted. A search result that survives in
the kept tail of a compaction is history only: callability SHALL be decided by the loaded set,
never by history. A tool that is not bound for the Run SHALL be neither discoverable, loadable,
nor callable, regardless of history.

The inventory disclosed to the model SHALL be counted against the budget. When the declared
tier plus the inventory would exceed the budget, MCP tools SHALL be cut in descending id order
until it fits, and each cut id SHALL be bound as `unavailable` with the closed reason
`declaration_budget_exceeded`, disclosed through the availability manifest, the availability
reminder, and the receipt; no bound tool SHALL be silently omitted.

For availability disclosure, a discoverable tool SHALL count as callable: it is bound,
allowlisted, and reachable through the inventory, so it belongs in `Added tools` and never in an
unavailable group by virtue of its tier. Wherever the availability manifest or its reminder
speaks of declarations advertised to the model, a discoverable declaration SHALL count as
advertised through the inventory.

`tool_search` SHALL be a reserved id: registration under that id SHALL fail, an allowlist entry
naming it SHALL fail boot, and it SHALL be synthesized only when deferral engages. It SHALL be
classified `read_only`, SHALL require no tenant datastore access, SHALL NOT appear in the
availability manifest (its binding is visible through the receipt's declarations, and a threshold
crossing SHALL produce no availability reminder), and SHALL be executed on the same exact
declaration-hash match as every other bound tool, resolved to a harness-owned executor built
from the snapshot at the same seam that binds every other declaration. Under every strategy the
harness SHALL refuse a call to a discoverable tool outside the Run's loaded set before any
executor runs. Queue retry SHALL reproduce the same tiers and the same loaded set from the bound
snapshot and the replayed steps alone.

#### Scenario: Catalog within budget changes nothing

- **WHEN** the estimated size of every eligible declaration does not exceed the model's budget
- **THEN** every eligible declaration is declared on every step
- **AND** no `tool_search` declaration is bound
- **AND** the tool hash, content hash, and availability hash equal those of the same turn without this capability

#### Scenario: Catalog beyond budget defers MCP tools

- **WHEN** the estimated size exceeds the budget and the turn is eligible for code-owned and MCP tools
- **THEN** every eligible declaration is bound and executable on exact hash match
- **AND** the first step declares only the code-owned tools and `tool_search`
- **AND** the `tool_search` input schema enumerates exactly the discoverable ids

#### Scenario: Exact select loads and declares tools

- **WHEN** the model calls `tool_search` with `select` naming two discoverable ids
- **THEN** the result contains those two declarations
- **AND** the next step declares both tools natively alongside the declared tier
- **AND** a following call to either tool executes normally

#### Scenario: Keyword query ranks deterministically

- **WHEN** the model calls `tool_search` with a `query` and a `limit`
- **THEN** at most `limit` declarations are returned in a deterministic order for that catalog and query
- **AND** every returned tool is loaded for the rest of the Run

#### Scenario: Unloaded discoverable tool is refused

- **WHEN** the model calls a discoverable tool it has not loaded in the Run
- **THEN** the harness refuses the call with the recorded, non-fatal `not_available` error before any executor runs, under every strategy
- **AND** under `harness` the text the model receives names the declared tools, including `tool_search`
- **AND** the Run continues

#### Scenario: Loaded means delivered

- **WHEN** a `tool_search` result would exceed the tool result size cap
- **THEN** whole declarations are dropped from the result and reported as not loaded
- **AND** only the delivered declarations are declared on the next step
- **AND** the recorded result is not truncated

#### Scenario: Loaded tools carry into the next Run of the epoch

- **WHEN** the previous accepted Run in the same disclosure epoch loaded a tool through `tool_search` and that tool is still bound
- **THEN** the new Run declares it on the first step without a new search
- **AND** the new Run's snapshot records it outside the discoverable list
- **AND** a previous Run that failed after loading still contributes its recorded loaded ids
- **AND** a previous Run whose catalog fit the budget contributes no promotion

#### Scenario: Promotion is bounded by the budget

- **WHEN** the previous Run's loaded ids and promoted ids together would push the declared tier plus the inventory over the budget
- **THEN** the most recently loaded ids are promoted first until the budget is met
- **AND** the remainder are discoverable again

#### Scenario: Inventory alone exceeds the budget

- **WHEN** the code-owned tools plus the discoverable inventory would exceed the budget
- **THEN** MCP tools are cut in descending id order until it fits
- **AND** each cut id is bound as `unavailable` with reason `declaration_budget_exceeded` in the manifest, the reminder, and the receipt

#### Scenario: Threshold crossing emits no availability reminder

- **WHEN** a chat's catalog crosses the budget between two Runs with no change in eligible ids
- **THEN** no availability reminder is emitted
- **AND** `tool_search` appears in neither Run's availability manifest

#### Scenario: Compaction resets the tiers

- **WHEN** a compaction checkpoint becomes active after tools were loaded
- **THEN** the first Run of the new epoch uses the default partition
- **AND** previously loaded MCP tools are discoverable again
- **AND** a search result kept verbatim in the compaction tail does not make its tools callable

#### Scenario: Search cannot surface an unbound tool

- **WHEN** a tool is refused by admission, matches no allowlist rule, or is unavailable for a closed reason
- **THEN** it is absent from the `tool_search` enumeration and from every search result
- **AND** selecting it by id returns it under the not-found list without loading anything

#### Scenario: Tool search counts toward the step cap

- **WHEN** the model has used `maxStepsPerRun - 1` tool steps and then calls `tool_search`
- **THEN** the cap is reached
- **AND** the following step declares no tools and the loaded declarations are not sent

#### Scenario: Reserved id cannot be registered or allowlisted

- **WHEN** a code-owned tool attempts to register as `tool_search` or `tools.allowed` names `tool_search`
- **THEN** registration fails, or boot fails naming `tools.allowed`

#### Scenario: Queue retry reproduces the loaded set

- **WHEN** a Run that loaded tools is retried by the queue
- **THEN** every attempt starts from the bound tiers and re-derives the loaded set from its own replayed steps
- **AND** no attempt declares a tool the snapshot does not bind

### Requirement: The tool-search transport is a per-model strategy that preserves every invariant

Each Run SHALL bind exactly one tool-search strategy from the model's configuration, defaulting
to `harness`. Under every strategy the declaration budget, tier partition, bound declaration
set, allowlist and admission gates, loaded-means-delivered recording, step-cap precedence, and
receipt SHALL behave identically, and the same deterministic ranking SHALL answer every search
that llame executes. Strategies SHALL differ only in how discoverable declarations travel to the
provider and in which wire shape carries the search call and its loaded declarations.

Under `harness`, discoverable declarations SHALL be omitted from provider requests until loaded
and `tool_search` SHALL be an ordinary function tool whose input schema enumerates the
discoverable ids. Under `openai`, discoverable declarations SHALL be sent marked as deferred so
the provider withholds their schemas, `tool_search` SHALL be the provider's client-executed
tool-search tool answered by llame with the same input shape without the enumeration, loaded
declarations SHALL enter the model through the provider's tool-search output, and the recorded
loaded set SHALL equal that output's tools. Cross-Run promotion SHALL work identically under
both strategies: a promoted tool SHALL be sent as an ordinary declaration on the new Run rather
than relying on the provider replaying an earlier search. Persisted search observations SHALL
replay in a shape the provider accepts, and that replay SHALL NOT be what makes a tool callable.
A strategy that the model's provider cannot carry SHALL be rejected at startup, never silently
replaced.

#### Scenario: Same catalog binds the same tiers under both strategies

- **WHEN** the same eligible catalog exceeds the budget for a `harness` model and for an `openai` model
- **THEN** both Runs bind the same declaration set, the same discoverable-id list, and the same availability manifest
- **AND** only the `tool_search` declaration and the strategy label differ

#### Scenario: OpenAI strategy promotes across Runs like harness

- **WHEN** a Run with the `openai` strategy loads a tool and a later Run in the same epoch is accepted
- **THEN** the new Run declares that tool natively without the deferred marker
- **AND** the replayed history of the earlier search is accepted by the provider and grants no callability on its own

#### Scenario: Strategy on the wrong provider fails startup

- **WHEN** a model on any provider other than the entry with id `openai` declares the `openai` strategy
- **THEN** startup fails naming the model id and `toolSearch`
