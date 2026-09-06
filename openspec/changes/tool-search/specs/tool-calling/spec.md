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
prior load in the same disclosure epoch. The Run SHALL additionally bind and declare the reserved
harness tool `tool_search`, whose input accepts an exact-id `select` list constrained to the
discoverable ids, a keyword `query`, and a result `limit` with a default of 5 and a maximum of 20. The discoverable inventory SHALL be disclosed to the model only through that declaration's
input schema; no per-turn prose inventory SHALL be persisted.

A `tool_search` call SHALL resolve exact `select` ids and rank keyword matches over each
discoverable tool's id and its admitted description deterministically, returning the loaded
declarations as a structured success result together with any ids that matched nothing. From the
next step of the same Run onward, every loaded tool SHALL be declared natively in addition to the
declared tier. A call to a discoverable tool that has not been loaded in the Run SHALL be refused
with the existing recorded, non-fatal `not_available` error, whose message SHALL state that the
tool must be loaded with `tool_search` first. A step whose only tool call is `tool_search` SHALL
count toward `maxStepsPerRun`, and the step cap SHALL take precedence over loading.

At acceptance of a later Run in the same chat, every id that a successful `tool_search` result
loaded in the model-visible history since the active compaction checkpoint SHALL be placed in the
declared tier when it is still bound for the new Run. A newly active compaction checkpoint SHALL
reset the tiers to the default partition. A tool that is not bound for the Run SHALL be neither
discoverable, loadable, nor callable, regardless of history.

`tool_search` SHALL be a reserved id: registration under that id SHALL fail, an allowlist entry
naming it SHALL fail boot, and it SHALL be synthesized only when deferral engages. It SHALL be
classified `read_only`, SHALL require no tenant datastore access, SHALL appear in the availability
manifest as `available` with its declaration hash, and SHALL be executed on the same exact
declaration-hash match as every other bound tool. Queue retry SHALL reproduce the same tiers and
the same loaded set from the bound snapshot and the replayed steps alone.

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

#### Scenario: Unloaded discoverable tool is refused with guidance

- **WHEN** the model calls a discoverable tool it has not loaded in the Run
- **THEN** the call is refused with the recorded, non-fatal `not_available` error
- **AND** the error message tells the model to load it with `tool_search` first
- **AND** the Run continues

#### Scenario: Loaded tools carry into the next Run of the epoch

- **WHEN** a prior Run in the same disclosure epoch loaded a tool through `tool_search` and that tool is still bound
- **THEN** the new Run declares it on the first step without a new search
- **AND** the new Run's snapshot records it outside the discoverable list

#### Scenario: Compaction resets the tiers

- **WHEN** a compaction checkpoint becomes active after tools were loaded
- **THEN** the first Run of the new epoch uses the default partition
- **AND** previously loaded MCP tools are discoverable again

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
