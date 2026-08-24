## MODIFIED Requirements

### Requirement: Code-owned Knowledge tools use the existing immutable read-only loop

The code-owned tool inventory SHALL include `knowledge_search` and `knowledge_read` in addition to `search_conversations`. Each SHALL declare `read_only`, require its own exact entry in `tools.allowed`, and participate in the same declaration admission, immutable Run tool snapshot, execution rebinding, timeout, abort, settlement, persistence, replay, compaction, result neutralization, truncation, and browser-rendering contracts as every other code-owned tool. The Run tool snapshot SHALL bind operation eligibility and declarations, not a Knowledge resource inventory.

The operator allowlist controls only whether these fixed operations are eligible. It SHALL NOT choose an owner, configured root, child directory, path root, or execution location. A permitted Knowledge tool MAY accept a stable Knowledge Space selector as defined by its code-owned schema, but current authority for that selector MUST come from the trusted Run owner at execution time. Model input SHALL NOT supply or expand ownership or local filesystem authority.

For each newly accepted Run, the code-owned candidate resolver SHALL use the static declaration, safety classification, exact allowlist entry, and configured Knowledge root to determine Knowledge tool availability. It SHALL NOT query or snapshot the owner's Knowledge Space inventory. With a configured root, an owner with zero current resources SHALL still receive the callable tool declarations; invocation SHALL return `knowledge_space_not_configured`. Without a configured root, each otherwise-eligible Knowledge tool SHALL retain the closed `knowledge_space_unavailable` manifest state. The API request path SHALL NOT probe the filesystem.

Worker execution SHALL receive the private filesystem resolver through trusted dependency injection or tool context and current owner identity through trusted Run context. It SHALL resolve current owner resources under RLS for every invocation and SHALL NOT serialize local binding data into declarations or accept it from model input.

Knowledge results SHALL retain the global execution envelope `status: "success" | "error"`; this change SHALL NOT add a generic `partial` status. A successful `knowledge_search` MAY additionally declare `complete: false` with bounded warnings. While its full payload is present, that structured result remains usable. Whenever a later model-replay projection clears that payload—including ordinary bounded next-turn projection and compaction into the observation ledger—the payload-cleared observation SHALL carry outcome `incomplete`, not `success`; later replay SHALL preserve that outcome. Other successful tool results SHALL continue to project and compact as `success`. General partial-result semantics outside Knowledge are not defined by this requirement.

New Knowledge results SHALL persist and render the current passage/range attribution defined by `knowledge-tools` without requiring a content hash. Historical persisted Knowledge results MAY retain their earlier hash-bearing shape. Execution, persistence, replay, compaction, and browser rendering SHALL preserve either bounded observation as authored and SHALL NOT normalize historical results into the new shape or synthesize removed fields. Existing persisted calls without new optional range or cursor arguments SHALL remain valid observations.

The canonical closed Knowledge reason vocabulary and model-safe label mapping SHALL retain `knowledge_space_not_configured` and `knowledge_space_unavailable`. Because zero inventory no longer changes tool availability, `knowledge_space_not_configured` SHALL be emitted only as a tool-call result, not as an immutable manifest state. `knowledge_space_unavailable` and its existing recovery mapping SHALL continue to govern missing process configuration without admitting arbitrary reason text.

#### Scenario: Knowledge tool is not allowlisted

- **WHEN** a Knowledge tool is registered but its exact ID is absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly accepted Run

#### Scenario: Allowlisted Knowledge tool is snapshotted

- **WHEN** an exact Knowledge tool ID is allowlisted for a newly accepted Run with a configured Knowledge root
- **THEN** its exact declaration is included in that Run's immutable tool snapshot regardless of current owner inventory
- **AND** execution requires the matching code-owned read-only executor

#### Scenario: Eligible Knowledge tool starts unavailable

- **WHEN** a Knowledge tool is allowlisted but the authoring API has no configured Knowledge root
- **THEN** the Run manifest records `knowledge_space_unavailable`
- **AND** the tool is not advertised as callable for that Run

#### Scenario: Knowledge availability recovery uses the closed mapping

- **WHEN** a later accepted Run changes `knowledge_space_unavailable` to available within the disclosure epoch
- **THEN** its `Now available` transition uses `knowledge_space_restored`
- **AND** no root, host path, or arbitrary reason text is rendered

#### Scenario: Knowledge observation persists through reload and replay

- **WHEN** an allowlisted Knowledge tool completes with passage/range attribution and no content hash
- **THEN** its call and structured result persist and render after browser reload
- **AND** later model replay receives the complete matched pair, a payload-cleared matched pair with honest `success`, `incomplete`, or error outcome, or a bounded omission marker according to the existing pair and turn/ledger budgets

#### Scenario: Historical Knowledge observation is not rewritten

- **WHEN** a persisted Knowledge observation uses the earlier hash-bearing result shape
- **THEN** reload and replay preserve the bounded observation as authored
- **AND** no migration or projection invents new range fields or removes its historical fields

#### Scenario: Tool permission cannot alter filesystem authority

- **WHEN** an operator allowlists either Knowledge tool
- **THEN** the permission makes only that fixed operation eligible
- **AND** any supplied space selector still resolves solely through current trusted owner authority

#### Scenario: Zero inventory remains model-visible

- **WHEN** a Run owner has no current Knowledge Spaces but the Knowledge tools are otherwise eligible
- **THEN** the tools are advertised as callable
- **AND** invocation returns the closed `knowledge_space_not_configured` result

#### Scenario: Incomplete Knowledge search stays incomplete after payload clearing

- **WHEN** `knowledge_search` returns `status: "success"` with `complete: false` and its payload is later cleared by any model-replay projection
- **THEN** the payload-cleared observation and subsequent replay carry outcome `incomplete`
- **AND** the call is not upgraded to complete success
