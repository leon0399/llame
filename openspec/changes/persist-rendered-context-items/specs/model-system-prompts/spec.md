## MODIFIED Requirements

### Requirement: Model switches use canonical semantic context metadata

The API SHALL persist a server-authored context-item part on the triggering user message when the selected model differs from the most recent prior run. Its producer SHALL be `effective-context-change` and its form SHALL be `notice`.

The producer SHALL carry a **closed cause vocabulary**, of which `model` is the member covering a model change. A cause SHALL be a **single value per item**: when more than one cause occurs on the same turn, each SHALL be a separate item. The item SHALL NOT enumerate dimensions whose detail is owned by another producer — notably a tool-availability change, which the `tool-calling` capability owns.

The part SHALL retain the cause, prior public model id, target public model id, and target Run id as non-rendering metadata for transition compaction, the owner-facing model boundary, and provenance. It SHALL also persist the complete canonical model-facing text block authored from that metadata. Client-supplied context-item parts MUST be rejected or discarded.

The persisted text SHALL state that the active model changed before this user message, name the current model while omitting the prior model from model-facing prose, direct the assistant to follow the current system instructions and continue the existing conversation, and direct it not to restart, reintroduce itself, or mention the model change unless the user asks. Later request assembly SHALL replay that stored text verbatim immediately before the triggering user text; it SHALL NOT reconstruct it from the model ids.

A model change SHALL be announced because the conversation contains turns produced under the previous model, which is the condition the `context-injection` capability requires for announcing a change to prefix-resident content.

#### Scenario: Switch metadata is assembled for the model

- **WHEN** a model-switch turn is accepted
- **THEN** the server persists both its structured switch metadata and its complete canonical model-facing text block
- **AND** later request assembly replays that block immediately before the turn's visible text without adding a second top-level system prompt

#### Scenario: Failed prior run selected another model

- **WHEN** the most recent prior run selected model `A` but failed and the next turn selects model `B`
- **THEN** the next user message records an `A` to `B` switch
- **AND** the event is based on durable selection rather than inferred answer completion

#### Scenario: Client attempts to forge switch metadata

- **WHEN** a client submits a user message containing a context-item part
- **THEN** the server does not persist or trust that client-authored part
- **AND** only server-derived run state can create effective-context-change metadata and text

#### Scenario: Model and tool availability change together

- **WHEN** a turn changes both the selected model and tool availability
- **THEN** the effective-context-change item names only the model cause
- **AND** the availability change is reported by the `tool-calling` capability's own item rather than enumerated here

## ADDED Requirements

### Requirement: Compaction checkpoints persist their complete replay projection

Every new compaction SHALL persist both the raw non-empty summary and the complete final model-facing checkpoint text that wraps it in the `context-injection` capability's canonical `compaction`/`checkpoint` envelope. The raw summary SHALL remain the authority for lineage, owner UI, and input to later compaction; the persisted checkpoint text SHALL be the sole authority for replay.

The summary and complete checkpoint text SHALL commit atomically. Later requests SHALL replay the stored checkpoint text verbatim ahead of retained recent history and SHALL NOT re-wrap, re-sanitize, or otherwise regenerate it through the current checkpoint renderer.

A pre-cutover compaction with no persisted checkpoint text SHALL retain the legacy rendering path until a later compaction supersedes it. It SHALL NOT be backfilled, and it SHALL NOT be omitted, because omission would remove the only model-facing representation of the history it superseded.

#### Scenario: A checkpoint is replayed after its renderer changes

- **WHEN** a later release changes checkpoint framing or sanitization and replays a compaction created after the cutover
- **THEN** the request uses the checkpoint's persisted complete text unchanged
- **AND** the raw summary remains available separately for UI and later compaction

#### Scenario: A new compaction supersedes a legacy checkpoint

- **WHEN** a chat whose active legacy compaction lacks persisted checkpoint text is compacted again
- **THEN** the legacy checkpoint is rendered only as input to the new summarization
- **AND** the new active compaction persists its own complete checkpoint text for all later replay

#### Scenario: A legacy checkpoint remains active

- **WHEN** a pre-cutover compaction remains the active checkpoint after deployment
- **THEN** later requests continue to produce its checkpoint through the legacy renderer
- **AND** its summarized history is not silently discarded or backfilled
