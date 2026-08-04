## MODIFIED Requirements

### Requirement: Each model resolves one complete effective system prompt

The system SHALL provide a versioned project-default system prompt and SHALL allow each configured model to replace it with one independently resolved complete prompt. A model without an override SHALL use the project default.

Both prompt-file kinds SHALL be **Handlebars templates** over an explicit context projection. The renderable context SHALL expose exactly `model.id` for the public llame model id and `model.name` for the configured public name, plus the requesting owner's **per-user paths** `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name`, and `user.email`; operators MAY use the built-in `if` and `unless` conditionals, and MAY emit a literal expression by escaping it in the engine's own notation. Validation SHALL permit only an allowlisted set of node kinds — literal content, value expressions, block expressions, and comments — rejecting everything else by default, including partials in any form (plain, with a fallback block, or defined through a decorator). Referencing a context path outside the allowlist — evaluated on parsed segments and depth, so a bracketed path that merely displays as an allowlisted one is rejected — emitting unescaped output, invoking any helper other than `if`/`unless` (including one passed as a hash argument to an allowed block), giving a conditional other than exactly one parameter, or declaring block parameters SHALL fail startup naming the model id and the offending construct without printing prompt contents. Referencing `model.name` when the selected model has no configured name SHALL **not** fail startup: the value renders empty, so that a conditional over a possibly-absent value is expressible. Fail-loud is preserved where it catches mistakes: an unknown path is still rejected at boot.

Validation SHALL occur at boot against the template; rendering SHALL be lenient, so an allowlisted path with no value at request time renders empty rather than failing a run. **Model paths SHALL be resolved at boot, while per-user paths SHALL be validated at boot and resolved per run**, because no owner is in scope at startup; boot therefore renders each template once with the model context alone, both to preserve the existing non-empty-output guarantee and because an empty per-user context yields the minimum possible output, so a template that is non-empty there is non-empty for every owner. Rendered values SHALL be escaped by replacing exactly `&`, `<`, and `>`, leaving all other punctuation verbatim, and SHALL be escaped when the context is built rather than by mutating the engine's global escaping. A value that is absent or empty after trimming SHALL be omitted from the context, since an already-safe wrapper is always truthy and would otherwise make conditionals over it evaluate true. **Omission SHALL apply at every level of the per-user projection**: an individual field with no value is absent, `user.personalization` is absent when personalization is disabled or every authored field is empty, and `user` itself is absent when nothing beneath it would render — so that `{{#if user}}` gates an entire section including its operator-authored framing prose. Whitespace-control syntax is permitted. Resolution SHALL remain single-pass and non-recursive before hashing and snapshotting: rendered output, including substituted owner text, MUST NOT be re-parsed or re-evaluated as a template. Prompt resolution MUST NOT use prompt fragments, inheritance, arbitrary config traversal, or another model's prompt — the prohibition on fragments and inheritance is what requires partials to be rejected. Per-user substitution is a projection into one already-complete template and MUST NOT compose two prompt files.

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

### Requirement: Owners can inspect the exact effective context without seeing host paths

The owner SHALL be able to retrieve an immutable context receipt for each new run. The receipt SHALL contain the public model id, prompt source label, complete effective system prompt contents **including any rendered per-user context exactly as sent to the provider**, advertised tool ids/descriptions/input schemas, content hash, and snapshot timestamp. It MUST NOT contain the administrator's prompt-file path, server-only provider model id, provider credentials, executor implementation, or trusted authorization context. Non-owners SHALL receive a not-found response.

#### Scenario: Owner inspects a run carrying personalization

- **WHEN** the chat owner opens the receipt for a run whose prompt rendered their personalization
- **THEN** the rendered personalization is visible in the disclosed prompt contents
- **AND** the owner can determine exactly what personalization the model received for that run
