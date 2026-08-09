# model-system-prompts

## Purpose

Per-model effective system prompts as operator config-as-code, executed with run-level integrity: every configured model resolves exactly one complete prompt at boot (the packaged project default, or a whole-file `systemPromptFile` override, both Handlebars templates over an allowlisted context projection with fail-loud boot validation, rendering `{{model.id}}`/`{{model.name}}` and supporting `if`/`unless` conditionals); every new run binds an immutable owner-scoped effective-context snapshot (prompt + advertised tool contract) at enqueue; model switches replace the top-level prompt while preserving portable user/assistant history (with source-model transition compaction when the target window cannot fit it); switches are persisted as trusted server-authored `data-model-context` parts rendered into a canonical reminder; and owners — only owners — can inspect the exact effective context through an on-demand receipt that never exposes host paths, provider internals, or credentials.

## Requirements

### Requirement: Each model resolves one complete effective system prompt

The system SHALL provide a versioned project-default system prompt and SHALL allow each configured model to replace it with one independently resolved complete prompt. A model without an override SHALL use the project default.

Both prompt-file kinds SHALL be **Handlebars templates** over an explicit context projection. The renderable context SHALL expose exactly `model.id` for the public llame model id and `model.name` for the configured public name, plus the requesting owner's **per-user paths** `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name`, and `user.email`; operators MAY use the built-in `if` and `unless` conditionals, and MAY emit a literal expression by escaping it in the engine's own notation. Validation SHALL permit only an allowlisted set of node kinds — literal content, value expressions, block expressions, and comments — rejecting everything else by default, including partials in any form (plain, with a fallback block, or defined through a decorator). Referencing a context path outside the allowlist — evaluated on parsed segments and depth, so a bracketed path that merely displays as an allowlisted one is rejected — emitting unescaped output, invoking any helper other than `if`/`unless` (including one passed as a hash argument to an allowed block), giving a conditional other than exactly one parameter, or declaring block parameters SHALL fail startup naming the model id and the offending construct without printing prompt contents. Referencing `model.name` when the selected model has no configured name SHALL **not** fail startup: the value renders empty, so that a conditional over a possibly-absent value is expressible. Fail-loud is preserved where it catches mistakes: an unknown path is still rejected at boot.

Validation SHALL occur at boot against the template; rendering SHALL be lenient, so an allowlisted path with no value at request time renders empty rather than failing a run. **Model paths SHALL be resolved at boot, while per-user paths SHALL be validated at boot and resolved per run**, because no owner is in scope at startup; boot therefore renders each template with BOTH an absent and a populated per-user context and fails if either is empty. A single no-owner probe is unsound: `unless` is permitted over the per-user gates, so a template whose only content sits behind an inverse user gate renders non-empty with no owner and empty for exactly the owners who personalized. Rendered model and account-identity values SHALL be escaped by replacing exactly `&`, `<`, and `>`, leaving all other punctuation verbatim; rendered owner-authored values SHALL instead be neutralized by the two tag rules defined in the instance-config capability — a value can never close a tag it did not open within that same value, and can never emit a reserved delimiter name as a tag at all, with unmatched or malformed closers escaped fail-closed and everything else passing verbatim. Both SHALL be applied when the context is built rather than by mutating the engine's global escaping. A value that is absent or empty after trimming SHALL be omitted from the context, since an already-safe wrapper is always truthy and would otherwise make conditionals over it evaluate true. **Omission SHALL apply at every level of the per-user projection**: an individual field with no value is absent, `user.personalization` is absent when personalization is disabled or every authored field is empty, and `user` itself is absent when nothing beneath it would render — so that `{{#if user}}` gates an entire section including its operator-authored framing prose. Whitespace-control syntax is permitted. Resolution SHALL remain single-pass and non-recursive before hashing and snapshotting: rendered output, including substituted owner text, MUST NOT be re-parsed or re-evaluated as a template. Prompt resolution MUST NOT use prompt fragments, inheritance, arbitrary config traversal, or another model's prompt — the prohibition on fragments and inheritance is what requires partials to be rejected. Per-user substitution is a projection into one already-complete template and MUST NOT compose two prompt files.

#### Scenario: Model has no prompt override

- **WHEN** a run selects a configured model whose entry omits `systemPromptFile`
- **THEN** the run's effective system prompt is the project-default prompt
- **AND** the receipt identifies its source as the project default

#### Scenario: Two models use materially different prompts

- **WHEN** two configured models reference different valid prompt files
- **THEN** a run for each model receives that model's complete rendered contents as its top-level system prompt
- **AND** neither prompt is inherited or composed from the other

#### Scenario: Default prompt renders model id and name

- **WHEN** the project-default prompt references `model.id` and `model.name` and a configured model supplies both values
- **THEN** that model's effective prompt contains the public id and configured name
- **AND** its immutable snapshot contains the rendered text rather than the expressions

#### Scenario: Prompt references an absent model name

- **WHEN** a selected default or override prompt references `model.name` and that model omits `name`
- **THEN** startup succeeds and the expression renders empty
- **AND** a conditional over `model.name` in the same template evaluates false rather than failing

#### Scenario: Literal expression is emitted

- **WHEN** a prompt escapes an expression in the engine's literal notation
- **THEN** its effective prompt contains that expression as literal text
- **AND** the emitted literal is not recursively interpolated

#### Scenario: Prompt uses a conditional

- **WHEN** a prompt wraps a label and its value in an `if` conditional over an allowlisted path
- **THEN** the wrapped region renders only when that path has a value
- **AND** the surrounding prompt structure is otherwise unchanged

#### Scenario: Prompt contains a disallowed construct

- **WHEN** a prompt references an unknown context path, emits unescaped output, references a partial, or invokes another helper
- **THEN** startup fails naming the model id and the offending construct
- **AND** no raw config, environment, or server-only field is exposed

#### Scenario: Configured override is broken

- **WHEN** a model declares `systemPromptFile` but the file cannot resolve to a valid non-empty prompt
- **THEN** instance startup fails
- **AND** the system does not silently substitute the project default

#### Scenario: Rendered output is not re-evaluated

- **WHEN** a rendered value itself contains template-looking text
- **THEN** that text appears literally in the effective prompt
- **AND** no second parse or render pass occurs

#### Scenario: Per-user paths survive boot unresolved

- **WHEN** a prompt file references per-user context paths at startup
- **THEN** startup succeeds and each is accepted as allowlisted
- **AND** no owner data is resolved at boot, because these resolve per run

#### Scenario: Prompt references no per-user path

- **WHEN** a configured model's prompt references no per-user context path
- **THEN** startup succeeds and runs for that model execute with no per-user content
- **AND** the model forgoes personalization rather than failing startup or a run

#### Scenario: Owner value absent at render time

- **WHEN** an allowlisted per-user path has no value for the requesting owner
- **THEN** the path is absent from the render context, a conditional over it is false, and a bare reference renders empty
- **AND** the run executes normally

#### Scenario: An entire section is gated on the owner having any per-user context

- **WHEN** an operator wraps a block including its framing prose in a conditional over `user`, and the owner has authored nothing and shares no account identity
- **THEN** the whole block including its framing prose is omitted
- **AND** the resulting prompt remains valid and non-empty

#### Scenario: Template renders non-empty without an owner

- **WHEN** a configured template's content would be empty once every per-user path is absent
- **THEN** startup fails as empty against the boot render, which uses the model context alone
- **AND** no prompt that could render empty for an unpersonalized owner reaches a run

### Requirement: Every new run binds an immutable effective-context snapshot

Before a new run is enqueued, the system SHALL bind it to an immutable owner-scoped snapshot containing the selected model's effective system prompt **with the requesting owner's per-user context already substituted**, prompt source kind, and exact model-facing tool ids, descriptions, and input schemas. Substitution SHALL precede computation of the prompt and content hashes, so the snapshot is addressed by what was actually sent. The user message, run, and snapshot binding SHALL commit atomically in the chat owner's tenant transaction. The per-user read MAY occur in a separate short tenant-scoped transaction preceding that one, so the binding transaction is not held open across it; a personalization edit committed between the read and the write MAY apply only to the next run. Queued execution and retry SHALL use the bound snapshot rather than rereading prompt files, re-reading personalization, or resolving newer tool declarations. Snapshots MAY be content-addressed and reused only within the same owner; because per-user context participates in the bound content, a change to an owner's personalization SHALL produce a distinct snapshot for that owner rather than mutating an existing one.

#### Scenario: Personalization changes after enqueue

- **WHEN** an owner edits their personalization after a run is enqueued but before the worker executes it
- **THEN** that run executes with the personalization bound at enqueue
- **AND** the edited content applies only to subsequently enqueued runs

#### Scenario: Two owners share one model

- **WHEN** two owners with different personalization run the same configured model
- **THEN** each run binds its own owner's rendered values
- **AND** neither owner's authored text appears in the other's prompt or snapshot

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

### Requirement: A model switch replaces the top-level prompt and preserves portable history

For a turn whose selected model differs from the most recent prior run in the chat, the request SHALL use the target run's complete effective prompt as the sole top-level system prompt. It SHALL retain portable prior user/assistant history, omit prior top-level system prompts, include a trusted model-switch reminder immediately before the triggering user text, and use the target run's tool declarations. Portable history SHALL use the canonical replay projection of visible user/assistant text, typed server-generated conversation checkpoints, and the replayed tool observations required by the `tool-calling` capability. It MUST NOT replay persisted reasoning or provider-native thinking/signature/cache metadata from earlier runs. An unavailable target model SHALL fail transparently; the system MUST NOT execute another model as fallback.

Tool observations are no longer display-only. They are replayed in the conventional tool-call/tool-result representation, carried across a model or provider switch in the target provider's expected form, with every replayed call accompanied by its result. What remains excluded on a switch is the **originating model's provider-native metadata** — thinking blocks, signatures, cache markers — none of which is portable to a different provider.

#### Scenario: User sends the next turn with a different model

- **WHEN** the previous run selected model `A` and the user sends the next message with model `B`
- **THEN** model `B` receives model `B`'s effective top-level system prompt and tool declarations
- **AND** portable earlier conversation turns remain in history
- **AND** model `A`'s system prompt is not replayed

#### Scenario: Earlier turn contains reasoning and tool activity

- **WHEN** an earlier assistant turn persisted reasoning, provider-native metadata, or settled tool activity/results alongside visible answer text
- **AND** a later turn uses the same model or switches providers or models
- **THEN** the later model receives the visible answer text through the canonical replay projection
- **AND** it receives the earlier tool observations in the target provider's expected representation, each call accompanied by its result
- **AND** it does not receive the persisted reasoning or the originating model's provider-native metadata

#### Scenario: Target context window cannot fit portable history

- **WHEN** a turn switches from model `A` to smaller-context model `B` and the complete request for `B` would exceed its configured context window or reserved output budget
- **AND** model `A` plus its most recent immutable context snapshot remain executable
- **THEN** the worker performs transition compaction with model `A` over history through the last assistant turn before invoking model `B`
- **AND** the triggering user message remains outside the summarized prefix
- **AND** model `B` receives its own prompt and tools, the resulting portable checkpoint, retained recent history, and the switch reminder plus triggering user text

#### Scenario: No capable source model is available

- **WHEN** the target request does not fit and the prior model or its immutable execution context is unavailable or transition compaction fails
- **THEN** the run fails before the target provider call with `context_incompatible`
- **AND** history is not silently truncated and no fallback model is selected

#### Scenario: Over-window public-chat fork has no source execution context

- **WHEN** the owner of a public-chat fork sends a turn whose portable fork history does not fit the selected model
- **AND** no source-model snapshot owned by the fork owner can compact that history in one request
- **THEN** the run fails with `context_incompatible`
- **AND** the system does not access the source owner's snapshots, prompt receipts, credentials, or non-public metadata

#### Scenario: Target model is unavailable

- **WHEN** a model-switch turn selects a model that cannot execute
- **THEN** the run fails with the selected model's error
- **AND** no fallback model is invoked

#### Scenario: Same model continues

- **WHEN** the selected model is the same as the most recent prior run
- **THEN** no model-switch reminder or model-switch UI boundary is created

#### Scenario: First turn in a chat

- **WHEN** a chat has no prior run
- **THEN** the selected model receives its effective prompt normally
- **AND** no model-switch reminder is created

### Requirement: Model switches use canonical semantic context metadata

The API SHALL persist a server-authored, non-text `data-model-context` part on the triggering user message when the selected model differs from the most recent prior run. The part SHALL contain the switch kind, prior public model id, target public model id, and target run id, but SHALL NOT contain literal reminder prose or prompt contents. Client-supplied model-context parts MUST be rejected or discarded. Request assembly SHALL render the trusted part as the following reminder, with the current model id safely escaped and the prior model omitted from model-facing prose:

```xml
<system-reminder>
The active model changed before this user message.
You are now running as model "{currentModelId}".
Follow the current system instructions and continue the existing conversation.
Do not restart, reintroduce yourself, or mention the model change unless the user asks.
</system-reminder>
```

#### Scenario: Switch metadata is assembled for the model

- **WHEN** request assembly encounters a trusted model-switch part on a user turn
- **THEN** it generates the canonical reminder immediately before that turn's text
- **AND** the reminder identifies only the current model while the persisted part retains both model ids for owner-visible provenance
- **AND** it does not add a second top-level system prompt or a persisted literal reminder message

#### Scenario: Failed prior run selected another model

- **WHEN** the most recent prior run selected model `A` but failed and the next turn selects model `B`
- **THEN** the next user message records an `A` to `B` switch
- **AND** the event is based on durable selection rather than inferred answer completion

#### Scenario: Client attempts to forge switch metadata

- **WHEN** a client submits a user message containing a `data-model-context` part
- **THEN** the server does not persist or trust that client-authored part
- **AND** only server-derived run state can create model-switch metadata

### Requirement: Compaction preserves the completed run's effective prompt and emits historical data

When a completed chat run triggers full-current compaction, the summarization inference SHALL use that run's selected model client, exact bound effective top-level system prompt, byte-equivalent provider-facing tool declarations reconstructed without executor functions, compactable conversation prefix, and a final synthetic user summarization instruction. It SHALL set `toolChoice: "none"`, MUST NOT execute tools, and SHALL accept text only; a returned tool call SHALL make compaction fail safely without invoking an executor. The instruction SHALL request the stable sections `Objective`, `Constraints and Preferences`, `Decisions and Rationale`, `Established Facts`, `Current State`, `Open Questions and Next Steps`, and `Critical References`.

Because the replayed prompt may contain the owner's rendered per-user context, **every summarization instruction SHALL direct the model not to carry content out of the delimited personalization block into the summary**, stating that this content is re-supplied on every request and must not be frozen into a checkpoint. This exclusion SHALL be expressed by naming the block's delimiter rather than by asking the model to distinguish where a preference originated, and SHALL apply to the full-current and transition instructions alike. The bound system prompt itself SHALL NOT be altered for compaction: the instruction is the request's final user message and therefore outside the cached prefix, whereas editing the replayed prompt would break provider prefix caching for the entire absorbed conversation.

The application SHALL wrap the non-empty result deterministically in a typed synthetic user-role `conversation-checkpoint` that identifies the content as server-generated historical context, not a new user request or higher-priority instruction. The next run SHALL assemble its own current snapshotted top-level prompt and tools, then the checkpoint, retained recent portable history, and the new user turn in that order. Title generation SHALL continue to use its dedicated task-specific system prompt rather than the chat model's effective prompt, and therefore never carries per-user context.

#### Scenario: Compaction runs for an owner with personalization

- **WHEN** a run whose bound prompt contains rendered personalization triggers compaction
- **THEN** the summarization instruction directs the model not to carry content out of the personalization block
- **AND** the resulting checkpoint is not required to contain the owner's standing personalization, because the next run re-renders it from current stored values

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

#### Scenario: Transition compaction precedes a smaller-context target

- **WHEN** a model switch requires source-model transition compaction
- **THEN** the source model receives only history through the last assistant turn plus the dedicated `up_to` handoff instruction
- **AND** that instruction does not propose a next action that could conflict with the unseen triggering user turn
- **AND** the generated checkpoint is inserted before retained history and the triggering user turn in the target model's request

#### Scenario: Partial rewind is requested

- **WHEN** future functionality needs to summarize only a prefix or suffix around a retained historical boundary
- **THEN** it is not implemented by reusing either the full-current or narrow transition-compaction instruction from this capability
- **AND** it requires a separately specified summary contract

### Requirement: Owners can inspect the exact effective context without seeing host paths

The owner SHALL be able to retrieve an immutable context receipt for each new run. The receipt SHALL contain the public model id, prompt source label, complete effective system prompt contents **including any rendered per-user context exactly as sent to the provider**, advertised tool ids/descriptions/input schemas, content hash, and snapshot timestamp. It MUST NOT contain the administrator's prompt-file path, server-only provider model id, provider credentials, executor implementation, or trusted authorization context. Non-owners SHALL receive a not-found response.

#### Scenario: Owner inspects a run carrying personalization

- **WHEN** the chat owner opens the receipt for a run whose prompt rendered their personalization
- **THEN** the rendered personalization is visible in the disclosed prompt contents
- **AND** the owner can determine exactly what personalization the model received for that run

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

### Requirement: Model context is surfaced as progressive disclosure

The owner transcript SHALL render a compact model-switch boundary immediately before the triggering user message. Its collapsed state SHALL identify the public prior and target models; public model ids that exceed the available width SHALL use a single-line ellipsis, and a tooltip SHALL expose only the full id values that are actually truncated. Its expanded state SHALL explain that the effective prompt/tool contract changed and provide access to the target run's receipt. Every new assistant turn SHALL also provide an owner-only effective-context action near its model/usage metadata. Receipt contents SHALL load on demand rather than being embedded in every history response.

#### Scenario: Owner views a switched turn

- **WHEN** the owner loads a chat containing a persisted model-switch part
- **THEN** a compact boundary appears immediately before the triggering user message
- **AND** expanding it gives access to the immutable target-run receipt

#### Scenario: Owner inspects a turn without a switch

- **WHEN** the owner views an assistant turn that continued with the same model
- **THEN** no switch boundary is shown
- **AND** the turn's effective-context action still opens its receipt

#### Scenario: A public model id exceeds the boundary width

- **WHEN** either public model id cannot fit in the collapsed model-switch boundary
- **THEN** that displayed id is truncated with an ellipsis instead of wrapping or breaking
- **AND** focusing or hovering the existing disclosure control shows the complete value for each truncated id
- **AND** complete values for ids that were not truncated are not redundantly added to the tooltip

### Requirement: Context receipts and control metadata remain private projections

Model-context parts, generated reminder prose, receipt references, and prompt/tool receipt contents MUST NOT appear in public-share responses, ordinary transcript exports, or chat-search projections. Prompt contents are intentionally visible to the owning user through the authenticated receipt endpoint only.

#### Scenario: Public chat is viewed

- **WHEN** an anonymous or non-owner viewer loads a publicly shared chat containing model switches
- **THEN** ordinary shared user/assistant content remains visible
- **AND** model-switch parts, owner receipt actions, prompt contents, and tool receipt contents are absent

#### Scenario: Owner exports the transcript

- **WHEN** the owner creates an ordinary Markdown transcript export
- **THEN** the export contains presentation-safe conversation content
- **AND** it omits generated reminders, model-context parts, receipt metadata, prompts, and advertised tool schemas
