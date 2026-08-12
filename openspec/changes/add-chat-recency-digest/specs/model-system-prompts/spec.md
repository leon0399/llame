## MODIFIED Requirements

### Requirement: Each model resolves one complete effective system prompt

The system SHALL provide a versioned project-default system prompt and SHALL allow each configured model to replace it with one independently resolved complete prompt. A model without an override SHALL use the project default.

Both prompt-file kinds SHALL be **Handlebars templates** over an explicit context projection. The renderable context SHALL expose exactly `model.id` for the public llame model id and `model.name` for the configured public name, plus the requesting owner's **per-user paths** `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name`, and `user.email`, plus the requesting chat's **recency-digest collections** `chats.pinned` and `chats.recent`. Operators MAY use the built-in `if` and `unless` conditionals, MAY use the built-in `each` block over an allowlisted collection, and MAY emit a literal expression by escaping it in the engine's own notation. Validation SHALL permit only an allowlisted set of node kinds — literal content, value expressions, block expressions, and comments — rejecting everything else by default, including partials in any form (plain, with a fallback block, or defined through a decorator). Referencing a context path outside the allowlist — evaluated on parsed segments and depth, so a bracketed path that merely displays as an allowlisted one is rejected — emitting unescaped output, invoking any helper other than `if`/`unless`/`each` (including one passed as a hash argument to an allowed block), giving a conditional or an iteration other than exactly one parameter, or declaring block parameters SHALL fail startup naming the model id and the offending construct without printing prompt contents. Referencing `model.name` when the selected model has no configured name SHALL **not** fail startup: the value renders empty, so that a conditional over a possibly-absent value is expressible. Fail-loud is preserved where it catches mistakes: an unknown path is still rejected at boot.

**Iteration SHALL be bounded rather than general.** `each` SHALL accept only an allowlisted collection path as its single parameter; it SHALL NOT iterate a scalar, a gate-only path, or any path not explicitly declared as a collection. Inside an `each` body, only that collection's **declared per-item fields** SHALL be referenceable, and each collection SHALL declare its item fields explicitly rather than exposing whatever the projected item happens to carry. Iteration SHALL NOT be nestable within another iteration, index or key variables SHALL NOT be exposed, and the collection itself SHALL remain gate-only in value position, so emitting it renders no stringified structure. The digest collections SHALL each declare exactly the item fields `title`, `date`, `messageCount`, and `excerpt`.

The digest collections SHALL be projected at the **top level as `chats`**, deliberately not beneath `user`. Nesting them under `user` would make `user` present for an owner who has chats but has authored no personalization and shares no account identity, which would render an operator's personalization block — framing prose included — around no content, contradicting the gate behavior the personalization capability requires.

Validation SHALL occur at boot against the template; rendering SHALL be lenient, so an allowlisted path with no value at request time renders empty rather than failing a run. **Model paths SHALL be resolved at boot, while per-user and per-chat paths SHALL be validated at boot and resolved per run**, because no owner and no chat are in scope at startup; boot therefore renders each template with BOTH an absent and a populated per-user context and fails if either is empty. A single no-owner probe is unsound: `unless` is permitted over the per-user gates, so a template whose only content sits behind an inverse user gate renders non-empty with no owner and empty for exactly the owners who personalized. The digest gates admit the same inversion, and because `user` and `chats` are **independent** gates the probe SHALL cover their **cross product** — every combination of absent and populated for both — rather than varying them together. Varying them in lockstep is unsound for the same reason a single probe is: a template whose content sits in `{{#if user}}` and `{{#unless chats}}` renders non-empty when both are absent and when both are populated, while rendering empty for exactly the owners who have chats but authored no personalization. Rendered model and account-identity values SHALL be escaped by replacing exactly `&`, `<`, and `>`, leaving all other punctuation verbatim; rendered owner-authored values and rendered digest item values SHALL instead be neutralized by the two tag rules defined in the instance-config capability — a value can never close a tag it did not open within that same value, and can never emit a reserved delimiter name as a tag at all, with unmatched or malformed closers escaped fail-closed and everything else passing verbatim. Both SHALL be applied when the context is built rather than by mutating the engine's global escaping. A value that is absent or empty after trimming SHALL be omitted from the context, since an already-safe wrapper is always truthy and would otherwise make conditionals over it evaluate true. **Omission SHALL apply at every level of the per-user projection**: an individual field with no value is absent, `user.personalization` is absent when personalization is disabled or every authored field is empty, and `user` itself is absent when nothing beneath it would render — so that `{{#if user}}` gates an entire section including its operator-authored framing prose. **The same omission discipline SHALL apply to the digest projection**: an empty collection is absent rather than an empty array, and `chats` itself is absent when neither collection would render, so that `{{#if chats}}` gates the whole digest section including its framing prose. Whitespace-control syntax is permitted. Resolution SHALL remain single-pass and non-recursive before hashing and snapshotting: rendered output, including substituted owner text and substituted digest entries, MUST NOT be re-parsed or re-evaluated as a template. Prompt resolution MUST NOT use prompt fragments, inheritance, arbitrary config traversal, or another model's prompt — the prohibition on fragments and inheritance is what requires partials to be rejected. Per-user and per-chat substitution is a projection into one already-complete template and MUST NOT compose two prompt files.

A run's rendered prompt MAY therefore derive from **stored per-chat state** as well as per-run owner state. That state SHALL be resolved and substituted before the snapshot's hashes are computed, exactly as per-user values are, so the snapshot remains addressed by what was actually sent.

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

#### Scenario: Prompt iterates an allowlisted collection

- **WHEN** a prompt wraps entry markup in an `each` block over `chats.recent` and references that collection's declared item fields inside it
- **THEN** the block renders once per entry with those fields substituted
- **AND** startup succeeds

#### Scenario: Iteration references an undeclared item field

- **WHEN** a prompt references a field inside an `each` body that the collection does not declare
- **THEN** startup fails naming the model id and the offending construct
- **AND** no chat data is exposed through the unknown field

#### Scenario: Iteration is attempted over a non-collection

- **WHEN** a prompt applies `each` to a scalar path, a gate-only path, or an unknown path
- **THEN** startup fails naming the model id and the offending construct
- **AND** the template is rejected before any run uses it

#### Scenario: Iteration uses a forbidden escape construct

- **WHEN** a prompt nests one `each` inside another, references `@index` or `@key` inside an iteration body, declares block parameters on an `each`, or passes a hash argument to one
- **THEN** startup fails in each case naming the model id and the offending construct
- **AND** no such template reaches a run, since these are the deny-by-default validator's escape paths rather than stylistic preferences

#### Scenario: A collection is emitted as a value

- **WHEN** a prompt references `chats.recent` in value position rather than as an iteration subject
- **THEN** startup fails naming the offending construct
- **AND** no stringified structure can reach a rendered prompt

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

#### Scenario: Digest paths survive boot unresolved

- **WHEN** a prompt file references the digest collections at startup
- **THEN** startup succeeds and each is accepted as allowlisted
- **AND** no chat data is resolved at boot, because these resolve per run

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

#### Scenario: An entire digest section is gated on there being any listed chat

- **WHEN** an operator wraps the digest block including its framing prose in a conditional over `chats`, and the owner's digest is withheld or empty
- **THEN** the whole block including its framing prose is omitted
- **AND** the resulting prompt remains valid and non-empty

#### Scenario: Digest presence does not make the personalization gate true

- **WHEN** an owner with a rendered digest has authored no personalization and shares no account identity
- **THEN** a conditional over `user` evaluates false
- **AND** the operator's personalization block including its framing prose is omitted

#### Scenario: Template renders non-empty without an owner

- **WHEN** a configured template's content would be empty once every per-user path is absent
- **THEN** startup fails as empty against the boot render, which uses the model context alone
- **AND** no prompt that could render empty for an unpersonalized owner reaches a run

#### Scenario: Template is empty only for one gate combination

- **WHEN** a template's entire content sits inside `{{#if user}}` and `{{#unless chats}}`, so it renders non-empty when both gates are absent and when both are populated
- **THEN** startup fails, because the cross-product probe covers the combination where the owner has chats but no per-user context
- **AND** no prompt that would render empty for that population of owners reaches a run

### Requirement: Compaction preserves the completed run's effective prompt and emits historical data

When a completed chat run triggers full-current compaction, the summarization inference SHALL use that run's selected model client, exact bound effective top-level system prompt, byte-equivalent provider-facing tool declarations reconstructed without executor functions, compactable conversation prefix, and a final synthetic user summarization instruction. It SHALL set `toolChoice: "none"`, MUST NOT execute tools, and SHALL accept text only; a returned tool call SHALL make compaction fail safely without invoking an executor. The instruction SHALL request the stable sections `Objective`, `Constraints and Preferences`, `Decisions and Rationale`, `Established Facts`, `Current State`, `Open Questions and Next Steps`, and `Critical References`.

Because the replayed prompt may contain the owner's rendered per-user context **and the chat's rendered recency digest**, **every summarization instruction SHALL direct the model not to carry content out of either delimited block into the summary**, stating that this content is re-supplied on every request and must not be frozen into a checkpoint. This exclusion SHALL be expressed by naming each block's delimiter rather than by asking the model to distinguish where a preference or a chat reference originated, and SHALL apply to the full-current and transition instructions alike. The digest's exclusion SHALL be documented as load-bearing rather than tidy: without it, another chat's title and opening excerpt can be summarized into a persisted checkpoint that is replayed as history indefinitely, which neither deleting that chat nor disabling the setting can reach. The bound system prompt itself SHALL NOT be altered for compaction: the instruction is the request's final user message and therefore outside the cached prefix, whereas editing the replayed prompt would break provider prefix caching for the entire absorbed conversation.

The application SHALL wrap the non-empty result deterministically in a typed synthetic user-role `conversation-checkpoint` that identifies the content as server-generated historical context, not a new user request or higher-priority instruction. The next run SHALL assemble its own current snapshotted top-level prompt and tools, then the checkpoint, retained recent portable history, and the new user turn in that order. Title generation SHALL continue to use its dedicated task-specific system prompt rather than the chat model's effective prompt, and therefore never carries per-user context or digest content.

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
