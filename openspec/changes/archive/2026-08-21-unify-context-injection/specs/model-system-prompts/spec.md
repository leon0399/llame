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

### Requirement: Compaction preserves the completed run's effective prompt and emits historical data

When a completed chat run triggers full-current compaction, the summarization inference SHALL use that run's selected model client, exact bound effective top-level system prompt, byte-equivalent provider-facing tool declarations reconstructed without executor functions, compactable conversation prefix, and a final synthetic user summarization instruction. It SHALL set `toolChoice: "none"`, MUST NOT execute tools, and SHALL accept text only; a returned tool call SHALL make compaction fail safely without invoking an executor. The instruction SHALL request the stable sections `Objective`, `Constraints and Preferences`, `Decisions and Rationale`, `Established Facts`, `Current State`, `Open Questions and Next Steps`, and `Critical References`.

Because the replayed prompt may contain the owner's rendered per-user context **and the chat's rendered recency digest**, **every summarization instruction SHALL direct the model not to carry content out of either delimited block into the summary**, stating that this content is re-supplied on every request and must not be frozen into a checkpoint. This exclusion SHALL be expressed by naming each block's delimiter rather than by asking the model to distinguish where a preference or a chat reference originated, and SHALL apply to the full-current and transition instructions alike.

**The exclusion SHALL also cover the digest's message-rail appends, identified by their producer rather than by a delimiter of their own.** Every rail item shares one envelope under the `context-injection` capability, so a delimiter name no longer selects one producer's content: the instruction SHALL name the envelope together with the producer whose items are excluded, and SHALL NOT rely on a per-producer tag name. Later chat changes are delivered as server-authored reminders prepended to a user message, which places them inside the compactable conversation prefix — not in the replayed system prompt. Naming only the two prompt-side blocks therefore leaves the appends summarizable, and another chat's title and opening excerpt can be copied into the checkpoint, where neither deleting that chat nor withdrawing consent can reach them. That is the same defect the prompt-side exclusion exists to prevent, on the path the digest actually uses between baselines. The digest's exclusion SHALL be documented as load-bearing rather than tidy: without it, another chat's title and opening excerpt can be summarized into a persisted checkpoint that is replayed as history indefinitely, which neither deleting that chat nor disabling the setting can reach. The bound system prompt itself SHALL NOT be altered for compaction: the instruction is the request's final user message and therefore outside the cached prefix, whereas editing the replayed prompt would break provider prefix caching for the entire absorbed conversation.

The application SHALL wrap the non-empty result deterministically in a typed synthetic user-role context item carrying the `checkpoint` form under the `context-injection` capability's shared envelope, identifying the content as server-generated historical context, not a new user request or higher-priority instruction. The retired `conversation-checkpoint` delimiter SHALL NOT be emitted. The next run SHALL assemble its own current snapshotted top-level prompt and tools, then the checkpoint, retained recent portable history, and the new user turn in that order. Title generation SHALL continue to use its dedicated task-specific system prompt rather than the chat model's effective prompt, and therefore never carries per-user context or digest content.

#### Scenario: Compaction runs for an owner with personalization

- **WHEN** a run whose bound prompt contains rendered personalization triggers compaction
- **THEN** the summarization instruction directs the model not to carry content out of the personalization block
- **AND** the resulting checkpoint is not required to contain the owner's standing personalization, because the next run re-renders it from current stored values

#### Scenario: Compaction runs for a chat carrying a digest

- **WHEN** a run whose bound prompt contains a rendered recency digest triggers compaction
- **THEN** the summarization instruction names the digest's delimiter and directs the model not to carry its content into the summary
- **AND** the resulting checkpoint is not required to contain any other chat's title or excerpt

#### Scenario: Compaction leaves the cached prefix untouched

- **WHEN** the summarization request is assembled for a run carrying personalization
- **THEN** the replayed system prompt and history are byte-identical to the turn that just ran
- **AND** the personalization exclusion appears only in the trailing instruction message

#### Scenario: Completed turn triggers compaction

- **WHEN** a completed run using model `A` and effective prompt snapshot `P` crosses its compaction threshold
- **THEN** the separate summarization inference uses model `A`, top-level prompt `P`, byte-equivalent schema-only tool declarations, the compactable history, and the structured final user summarization instruction
- **AND** it sets `toolChoice: "none"` and no tool execution can occur during that inference
- **AND** title generation, if also triggered, uses its dedicated title prompt

#### Scenario: Provider returns a tool call during compaction

- **WHEN** a provider returns a tool call despite `toolChoice: "none"`
- **THEN** no executor is available or invoked
- **AND** the result is rejected rather than persisted as a conversation checkpoint

#### Scenario: Next turn follows a compaction

- **WHEN** the next run is assembled after a successful compaction
- **THEN** its current snapshotted prompt and tools remain top-level
- **AND** the synthetic user-role checkpoint precedes retained recent portable messages and the new user turn
- **AND** the checkpoint is distinguishable from human-authored user messages in canonical metadata

#### Scenario: Model changes after compaction

- **WHEN** a checkpoint exists and the next user turn switches from model `A` to model `B`
- **THEN** model `B` receives its complete snapshotted prompt and tools rather than model `A`'s prompt
- **AND** the portable checkpoint remains historical data
- **AND** the canonical model-switch reminder is generated immediately before the new user text

#### Scenario: Both delimited blocks are excluded under either compaction mode

- **WHEN** a run whose bound prompt carries both rendered personalization and a rendered digest triggers full-current compaction, and again when it triggers transition compaction
- **THEN** each instruction names both delimiters and forbids carrying either block's content into the summary
- **AND** in both modes the exclusion appears only in the trailing instruction, and neither block's content is required to appear in the resulting checkpoint

#### Scenario: Transition compaction precedes a smaller-context target

- **WHEN** a model switch requires source-model transition compaction
- **THEN** the source model receives only history through the last assistant turn plus the dedicated `up_to` handoff instruction
- **AND** that instruction does not propose a next action that could conflict with the unseen triggering user turn
- **AND** the generated checkpoint is inserted before retained history and the triggering user turn in the target model's request

#### Scenario: Partial rewind is requested

- **WHEN** future functionality needs to summarize only a prefix or suffix around a retained historical boundary
- **THEN** it is not implemented by reusing either the full-current or narrow transition-compaction instruction from this capability
- **AND** it requires a separately specified summary contract

#### Scenario: Exclusion targets one producer under a shared envelope

- **WHEN** a summarization instruction is built for a chat whose conversation prefix contains rail items from more than one producer
- **THEN** the instruction excludes the recency-digest producer's items by naming the envelope and that producer
- **AND** it does not rely on a delimiter name unique to that producer
- **AND** another producer's items are not excluded merely by sharing the envelope
