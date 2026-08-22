## ADDED Requirements

### Requirement: Code-owned Knowledge tools use the existing immutable read-only loop

The code-owned tool inventory SHALL include `knowledge_search` and `knowledge_read` in addition to `search_conversations`. Each SHALL declare `read_only`, require its own exact entry in `tools.allowed`, and participate in the same declaration admission, immutable Run snapshot, execution rebinding, timeout, abort, settlement, persistence, replay, compaction, result neutralization, truncation, and browser-rendering contracts as every other code-owned tool.

The operator allowlist controls only whether these declarations are eligible. It SHALL NOT choose an owner, Knowledge Space, source, ref, repository path, or execution location. Those values MUST come from the trusted repository capability and Run context after the exact declaration has been bound.

For each newly accepted Run, the authoring API SHALL resolve the trusted owner's Knowledge linkage under RLS before binding the immutable availability manifest. An otherwise-eligible Knowledge tool SHALL be unavailable with the closed server-authored reason `knowledge_space_not_configured` when the owner has no linkage, or `knowledge_source_unavailable` when the linked logical source key is absent from that API process's configuration. A declared logical key SHALL be sufficient for accept-time availability; the API request path SHALL NOT probe the repository filesystem. All turn-authoring API processes SHALL declare the same logical source-key set, while only `runs` workers require accessible repository mounts.

The canonical closed tool-unavailable reason vocabulary and model-safe label mapping SHALL add `knowledge_space_not_configured` and `knowledge_source_unavailable`. The closed recovery vocabulary SHALL add `knowledge_space_configured` and `knowledge_source_restored`; unavailable-to-available transition derivation SHALL map the two unavailable reasons to those recovery reasons respectively. Manifest parsing, persisted DTO validation, availability comparison, and reminder rendering SHALL accept these additions without admitting arbitrary reason text.

#### Scenario: Knowledge tool is not allowlisted

- **WHEN** a Knowledge tool is registered but its exact ID is absent from `tools.allowed`
- **THEN** it is neither advertised nor executable for a newly accepted Run

#### Scenario: Allowlisted Knowledge tool is snapshotted

- **WHEN** an exact Knowledge tool ID is allowlisted for a newly accepted Run
- **THEN** its exact declaration is included in that Run's immutable tool snapshot
- **AND** execution requires the matching code-owned read-only executor

#### Scenario: Eligible Knowledge tool starts unavailable

- **WHEN** a Knowledge tool is allowlisted but the accepted Run owner has no linkage or the authoring API lacks the linked logical source key
- **THEN** the Run manifest records the applicable closed unavailable reason
- **AND** the tool is not advertised as callable for that Run

#### Scenario: Knowledge availability recovery uses the closed mapping

- **WHEN** a later accepted Run changes `knowledge_space_not_configured` to available or changes `knowledge_source_unavailable` to available within the disclosure epoch
- **THEN** its `Now available` transition uses `knowledge_space_configured` or `knowledge_source_restored`, respectively
- **AND** no source key, host path, or arbitrary reason text is rendered

#### Scenario: Knowledge observation persists through reload and replay

- **WHEN** an allowlisted Knowledge tool completes
- **THEN** its call and structured result persist and render after browser reload
- **AND** later model replay receives the complete matched pair, a payload-cleared matched pair, or a bounded omission marker according to the existing 8,000-unit pair and 32,000-unit turn/ledger budgets

#### Scenario: Tool permission cannot alter repository authority

- **WHEN** an operator allowlists either Knowledge tool
- **THEN** the permission makes only that fixed operation eligible
- **AND** it grants no model or caller authority to select a source, owner, ref, path root, or credential
