## MODIFIED Requirements

### Requirement: Each model resolves one complete effective system prompt

The system SHALL provide a versioned project-default system prompt and SHALL allow each configured model to replace it with one independently resolved complete prompt. A model without an override SHALL use the project default. Both prompt-file kinds SHALL support exactly `${model.id}` for the public llame model id, `${model.name}` for the configured public name, `$${model.name}` for literal `${model.name}` text, and `${personalization}` for the requesting owner's rendered personalization section. Referencing `${model.name}` when the selected model has no configured name, or referencing any other `${...}` expression, SHALL fail startup naming the model id and unsupported or unavailable variable without printing prompt contents. `${model.id}` and `${model.name}` SHALL be rendered at boot; `${personalization}` SHALL be validated as a supported expression at boot and substituted per run at snapshot bind, because no owner is in scope at boot. Rendering SHALL be single-pass and non-recursive before hashing and snapshotting. Prompt resolution MUST NOT use prompt fragments, inheritance, arbitrary config traversal, or another model's prompt; substituting `${personalization}` is a per-owner substitution into one already-complete prompt and MUST NOT compose two prompt files.

#### Scenario: Model has no prompt override

- **WHEN** a run selects a configured model whose entry omits `systemPromptFile`
- **THEN** the run's effective system prompt is the project-default prompt
- **AND** the receipt identifies its source as the project default

#### Scenario: Two models use materially different prompts

- **WHEN** two configured models reference different valid prompt files
- **THEN** a run for each model receives that model's complete file contents as its top-level system prompt
- **AND** neither prompt is inherited or composed from the other

#### Scenario: Default prompt renders model id and name

- **WHEN** the project-default prompt contains `${model.id}` and `${model.name}` and a configured model supplies both values
- **THEN** that model's effective prompt contains the public id and configured name
- **AND** its immutable snapshot contains the rendered text rather than the placeholders

#### Scenario: Prompt requests an absent model name

- **WHEN** a selected default or override prompt contains `${model.name}` and that model omits `name`
- **THEN** startup fails naming the model id and `${model.name}`
- **AND** no partially rendered prompt is applied

#### Scenario: Model name placeholder is escaped

- **WHEN** a prompt contains `$${model.name}`
- **THEN** its effective prompt contains the literal text `${model.name}`
- **AND** that emitted literal is not recursively interpolated

#### Scenario: Prompt contains another expression

- **WHEN** a prompt contains `${model}`, `${model.providerModelId}`, or another unsupported `${...}` expression
- **THEN** startup fails naming the model id and unsupported expression
- **AND** no raw config, environment, or server-only field is exposed

#### Scenario: Configured override is broken

- **WHEN** a model declares `systemPromptFile` but the file cannot resolve to a valid non-empty prompt
- **THEN** instance startup fails
- **AND** the system does not silently substitute the project default

#### Scenario: Personalization placeholder survives boot unresolved

- **WHEN** a prompt file contains `${personalization}` at startup
- **THEN** startup succeeds and the expression is accepted as supported
- **AND** no owner content is resolved at boot, because the placeholder is substituted per run

#### Scenario: Prompt omits the personalization placeholder

- **WHEN** a configured model's prompt file contains no `${personalization}` expression
- **THEN** startup succeeds and runs for that model execute with no personalization content
- **AND** the absence is reported as inactive personalization rather than failing startup or a run

### Requirement: Every new run binds an immutable effective-context snapshot

Before a new run is enqueued, the system SHALL bind it to an immutable owner-scoped snapshot containing the selected model's effective system prompt with the requesting owner's personalization already substituted, prompt source kind, and exact model-facing tool ids, descriptions, and input schemas. The user message, run, and snapshot binding SHALL commit atomically in the chat owner's tenant transaction. Queued execution and retry SHALL use the bound snapshot rather than rereading prompt files, re-reading personalization, or resolving newer tool declarations. Snapshots MAY be content-addressed and reused only within the same owner; because personalization participates in the bound content, a change to an owner's personalization SHALL produce a distinct snapshot for that owner rather than mutating an existing one.

#### Scenario: Prompt file changes after enqueue

- **WHEN** an administrator changes a prompt file after a run is enqueued but before the worker executes it
- **THEN** that run uses the prompt content bound at enqueue
- **AND** a later run uses the newly resolved content only after the instance reloads it

#### Scenario: Run is retried

- **WHEN** execution of a run is retried
- **THEN** every attempt uses the same effective prompt and advertised tool contract
- **AND** the context receipt remains unchanged

#### Scenario: Tool contract is incompatible at execution

- **WHEN** a snapshotted advertised tool no longer has a compatible trusted executor at execution time
- **THEN** the run fails before making a provider request
- **AND** the system does not silently advertise or execute a different tool contract

#### Scenario: Cross-tenant snapshot reference is attempted

- **WHEN** one tenant attempts to read or bind another tenant's effective-context snapshot
- **THEN** datastore constraints and FORCE RLS deny the operation
- **AND** no prompt or tool content is disclosed

#### Scenario: Personalization changes after enqueue

- **WHEN** an owner edits their personalization after a run is enqueued but before the worker executes it
- **THEN** that run executes with the personalization bound at enqueue
- **AND** the edited content applies only to subsequently enqueued runs

### Requirement: Compaction preserves the completed run's effective prompt and emits historical data

When a completed chat run triggers full-current compaction, the summarization inference SHALL use that run's selected model client, exact bound effective top-level system prompt, byte-equivalent provider-facing tool declarations reconstructed without executor functions, compactable conversation prefix, and a final synthetic user summarization instruction. It SHALL set `toolChoice: "none"`, MUST NOT execute tools, and SHALL accept text only; a returned tool call SHALL make compaction fail safely without invoking an executor. The instruction SHALL request the stable sections `Objective`, `Constraints and Preferences`, `Decisions and Rationale`, `Established Facts`, `Current State`, `Open Questions and Next Steps`, and `Critical References`. Because the bound prompt may contain the owner's personalization, the `Constraints and Preferences` section SHALL be scoped to constraints and preferences **stated by the user within the conversation**, so standing personalization is not copied out of the system prompt into a persisted checkpoint that later personalization edits could not reach. The application SHALL wrap the non-empty result deterministically in a typed synthetic user-role `conversation-checkpoint` that identifies the content as server-generated historical context, not a new user request or higher-priority instruction. The next run SHALL assemble its own current snapshotted top-level prompt and tools, then the checkpoint, retained recent portable history, and the new user turn in that order. Title generation SHALL continue to use its dedicated task-specific system prompt rather than the chat model's effective prompt.

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

#### Scenario: Transition compaction precedes a smaller-context target

- **WHEN** a model switch requires source-model transition compaction
- **THEN** the source model receives only history through the last assistant turn plus the dedicated `up_to` handoff instruction
- **AND** that instruction does not propose a next action that could conflict with the unseen triggering user turn
- **AND** the generated checkpoint is inserted before retained history and the triggering user turn in the target model's request

#### Scenario: Partial rewind is requested

- **WHEN** future functionality needs to summarize only a prefix or suffix around a retained historical boundary
- **THEN** it is not implemented by reusing either the full-current or narrow transition-compaction instruction from this capability
- **AND** it requires a separately specified summary contract

#### Scenario: Compaction runs for an owner with personalization

- **WHEN** a run whose bound prompt contains rendered personalization triggers compaction
- **THEN** the summarization instruction scopes `Constraints and Preferences` to preferences stated within the conversation
- **AND** the owner's standing personalization is not required to appear in the persisted checkpoint to preserve behavior, because the next run re-renders it from current stored values

### Requirement: Owners can inspect the exact effective context without seeing host paths

The owner SHALL be able to retrieve an immutable context receipt for each new run. The receipt SHALL contain the public model id, prompt source label, complete effective system prompt contents including any rendered personalization exactly as sent to the provider, advertised tool ids/descriptions/input schemas, content hash, and snapshot timestamp. It MUST NOT contain the administrator's prompt-file path, server-only provider model id, provider credentials, executor implementation, or trusted authorization context. Non-owners SHALL receive a not-found response.

#### Scenario: Owner inspects a model-specific prompt

- **WHEN** the chat owner opens the effective-context receipt for a run using a per-model override
- **THEN** the complete prompt contents and exact advertised tool contract are displayed
- **AND** the source is labeled `Model-specific override`
- **AND** no host path is present

#### Scenario: Owner inspects a default prompt

- **WHEN** the chat owner opens the receipt for a run using the project prompt
- **THEN** the complete project prompt contents are displayed
- **AND** the source is labeled `Project default`

#### Scenario: Another user requests the receipt

- **WHEN** an authenticated user requests a run context receipt they do not own
- **THEN** the API responds as though the receipt does not exist
- **AND** no model, prompt, tool, or path metadata is disclosed

#### Scenario: Owner inspects a run carrying personalization

- **WHEN** the chat owner opens the receipt for a run whose prompt rendered their personalization
- **THEN** the rendered personalization section is visible in the disclosed prompt contents
- **AND** the owner can determine exactly what personalization the model received for that run
