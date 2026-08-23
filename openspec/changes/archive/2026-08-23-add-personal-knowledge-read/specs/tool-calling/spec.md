## ADDED Requirements

### Requirement: Code-owned Knowledge tools use the existing immutable read-only loop

The code-owned tool inventory SHALL include `knowledge_search` and `knowledge_read` in addition to `search_conversations`. Each SHALL declare `read_only`, require its own exact entry in `tools.allowed`, and participate in the same declaration admission, immutable Run snapshot, execution rebinding, timeout, abort, settlement, persistence, replay, compaction, result neutralization, truncation, and browser-rendering contracts as every other code-owned tool.

The operator allowlist controls only whether these declarations are eligible. It SHALL NOT choose an owner, Knowledge Space, configured root, child directory, path root, or execution location. Those values MUST come from the trusted Knowledge capability and Run context after the exact declaration has been bound.

For each newly accepted Run, an owner-aware code-owned candidate resolver SHALL run inside the authoring API's tenant transaction and resolve the trusted owner's Knowledge Space row under RLS before binding the immutable availability manifest. An otherwise-eligible Knowledge tool SHALL be unavailable with the closed server-authored reason `knowledge_space_not_configured` when the owner has no row, or `knowledge_space_unavailable` when `knowledge.root` is absent from that API process. A configured root SHALL be sufficient for accept-time availability; the API request path SHALL NOT probe the filesystem. All turn-authoring API processes SHALL declare the Knowledge root setting when the tools are enabled, while every `runs` consumer SHALL additionally require access to the corresponding owner directories.

The static code-owned registry SHALL continue to own immutable declarations and classifications. Owner-aware candidate state SHALL be composed before snapshotting without mutating that registry. Worker execution SHALL receive the private filesystem resolver through a trusted dependency-injection or tool-context seam; it SHALL NOT serialize local binding data into the declaration or accept it from model input.

The canonical closed tool-unavailable reason vocabulary and model-safe label mapping SHALL add `knowledge_space_not_configured` and `knowledge_space_unavailable`. The closed recovery vocabulary SHALL add `knowledge_space_configured` and `knowledge_space_restored`; unavailable-to-available transition derivation SHALL map the two unavailable reasons to those recovery reasons respectively. Manifest parsing, persisted DTO validation, availability comparison, and reminder rendering SHALL accept these additions without admitting arbitrary reason text.

#### Scenario: Knowledge tool is not allowlisted

- **WHEN** a Knowledge tool is registered but its exact ID is absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly accepted Run

#### Scenario: Allowlisted Knowledge tool is snapshotted

- **WHEN** an exact Knowledge tool ID is allowlisted for a newly accepted Run
- **THEN** its exact declaration is included in that Run's immutable tool snapshot
- **AND** execution requires the matching code-owned read-only executor

#### Scenario: Eligible Knowledge tool starts unavailable

- **WHEN** a Knowledge tool is allowlisted but the accepted Run owner has no Knowledge Space row or the authoring API has no configured Knowledge root
- **THEN** the Run manifest records the applicable closed unavailable reason
- **AND** the tool is not advertised as callable for that Run

#### Scenario: Knowledge availability recovery uses the closed mapping

- **WHEN** a later accepted Run changes `knowledge_space_not_configured` to available or changes `knowledge_space_unavailable` to available within the disclosure epoch
- **THEN** its `Now available` transition uses `knowledge_space_configured` or `knowledge_space_restored`, respectively
- **AND** no root, host path, or arbitrary reason text is rendered

#### Scenario: Knowledge observation persists through reload and replay

- **WHEN** an allowlisted Knowledge tool completes
- **THEN** its call and structured result persist and render after browser reload
- **AND** later model replay receives the complete matched pair, a payload-cleared matched pair, or a bounded omission marker according to the existing pair and turn/ledger budgets

#### Scenario: Tool permission cannot alter filesystem authority

- **WHEN** an operator allowlists either Knowledge tool
- **THEN** the permission makes only that fixed operation eligible
- **AND** it grants no model or caller authority to select a root, owner, Knowledge Space, stable-ID child, or alternate resource
