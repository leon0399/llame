## MODIFIED Requirements

### Requirement: Model switches use canonical semantic context metadata

The API SHALL persist a server-authored, non-text context-item part on the triggering user message when the selected model differs from the most recent prior run. Its producer SHALL be `effective-context-change` and its form SHALL be `notice`.

The producer SHALL carry a **closed cause vocabulary**, of which `model` is the member covering a model change. A cause SHALL be a **single value per item**: when more than one cause occurs on the same turn, each SHALL be a separate item. The item SHALL NOT enumerate which dimensions of the effective context changed, because a dimension whose detail is owned by another producer is reported by that producer and never duplicated here — notably a tool-availability change, which the `tool-calling` capability owns.

The part SHALL contain the cause, prior public model id, target public model id, and target run id, but SHALL NOT contain literal item prose or prompt contents. Client-supplied context-item parts MUST be rejected or discarded.

Request assembly SHALL render the trusted part through the canonical envelope the `context-injection` capability defines, before that turn's visible user text, with the current model id safely escaped and the prior model omitted from model-facing prose. The rendered item SHALL state that the active model changed before this user message, name the current model, direct the assistant to follow the current system instructions and continue the existing conversation, and direct it not to restart, reintroduce itself, or mention the model change unless the user asks. The envelope name, the per-item provenance framing, the placement rule, and the ordering relative to other items on the same turn are owned by the `context-injection` capability and SHALL NOT be restated here.

A model change SHALL be announced to the model because the conversation contains turns produced under the previous model, which is the condition the `context-injection` capability requires for announcing a change to prefix-resident content.

#### Scenario: Switch metadata is assembled for the model

- **WHEN** request assembly encounters a trusted `effective-context-change` part with cause `model` on a user turn
- **THEN** it generates the canonical item immediately before that turn's text
- **AND** the item identifies only the current model while the persisted part retains both model ids for owner-visible provenance
- **AND** it does not add a second top-level system prompt or a persisted literal item message

#### Scenario: Failed prior run selected another model

- **WHEN** the most recent prior run selected model `A` but failed and the next turn selects model `B`
- **THEN** the next user message records an `A` to `B` switch
- **AND** the event is based on durable selection rather than inferred answer completion

#### Scenario: Client attempts to forge switch metadata

- **WHEN** a client submits a user message containing a context-item part
- **THEN** the server does not persist or trust that client-authored part
- **AND** only server-derived run state can create effective-context-change metadata

#### Scenario: Model and tool availability change together

- **WHEN** a turn changes both the selected model and tool availability
- **THEN** the effective-context-change item names only the model cause
- **AND** the availability change is reported by the `tool-calling` capability's own item rather than enumerated here

### Requirement: Context receipts and control metadata remain private projections

Persisted context-item parts of every producer, generated item prose, the per-Run record of injected items, receipt references, and prompt/tool/availability receipt contents MUST NOT appear in public-share responses, ordinary transcript exports, or chat-search projections. Prompt and safe availability contents are intentionally visible to the owning user through the authenticated receipt endpoint only.

#### Scenario: Public chat is viewed

- **WHEN** an anonymous or non-owner viewer loads a publicly shared chat containing model switches or runtime tool-availability changes
- **THEN** ordinary shared user/assistant content remains visible
- **AND** context-item parts of every producer, the per-Run record of injected items, owner receipt actions, prompt contents, and tool/availability receipt contents are absent

#### Scenario: Owner exports the transcript

- **WHEN** the owner creates an ordinary Markdown transcript export
- **THEN** the export contains presentation-safe conversation content
- **AND** it omits generated item prose, context-item parts of every producer, the per-Run record of injected items, receipt metadata, prompts, advertised tool schemas, and availability manifests
