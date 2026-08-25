# model-system-prompts

## Purpose

Per-model effective system prompts as operator config-as-code, executed with run-level integrity: every configured model resolves exactly one complete prompt at boot (the packaged project default, or a whole-file `systemPromptFile` override, both Handlebars templates over an allowlisted context projection with fail-loud boot validation, rendering `{{model.id}}`/`{{model.name}}` and supporting `if`/`unless` conditionals); every new run binds an immutable owner-scoped effective-context snapshot (prompt + advertised tool contract + source-neutral availability manifest) and any trusted availability reminder metadata at enqueue; model switches replace the top-level prompt while preserving portable user/assistant history (with source-model transition compaction when the target window cannot fit it); model and runtime-availability changes are persisted as trusted server-authored semantic parts rendered into canonical reminders; and owners — only owners — can inspect the exact effective context through an on-demand receipt that never exposes host paths, provider internals, or credentials.

## Requirements

### Requirement: Each model resolves one complete effective system prompt

The system SHALL provide a versioned project-default system prompt and SHALL allow each configured model to replace it with one independently resolved complete prompt. A model without an override SHALL use the project default.

Both prompt-file kinds SHALL be **Handlebars templates** over an explicit context projection. The renderable context SHALL expose exactly `model.id` for the public llame model id and `model.name` for the configured public name, plus the requesting owner's **per-user paths** `user.personalization.preferredName`, `user.personalization.about`, `user.personalization.responsePreferences`, `user.name`, and `user.email`, plus the requesting chat's **recency-digest collections** `chats.pinned` and `chats.recent`, and the digest's **scalar metadata** `chats.pinnedShown`, `chats.pinnedTotal`, `chats.recentShown`, `chats.recentTotal`, and `chats.compiledOn`, plus the **unconditional temporal-anchor paths** `context.systemTime` and `context.systemTimezone`. Operators MAY use the built-in `if` and `unless` conditionals, MAY use the built-in `each` block over an allowlisted collection, and MAY emit a literal expression by escaping it in the engine's own notation. Validation SHALL permit only an allowlisted set of node kinds — literal content, value expressions, block expressions, and comments — rejecting everything else by default, including partials in any form (plain, with a fallback block, or defined through a decorator). Referencing a context path outside the allowlist — evaluated on parsed segments and depth, so a bracketed path that merely displays as an allowlisted one is rejected — emitting unescaped output, invoking any helper other than `if`/`unless`/`each` (including one passed as a hash argument to an allowed block), giving a conditional or an iteration other than exactly one parameter, or declaring block parameters SHALL fail startup naming the model id and the offending construct without printing prompt contents. Referencing `model.name` when the selected model has no configured name SHALL **not** fail startup: the value renders empty, so that a conditional over a possibly-absent value is expressible. Fail-loud is preserved where it catches mistakes: an unknown path is still rejected at boot.

**Iteration SHALL be bounded rather than general.** `each` SHALL accept only an allowlisted collection path as its single parameter; it SHALL NOT iterate a scalar, a gate-only path, or any path not explicitly declared as a collection. Inside an `each` body, only that collection's **declared per-item fields** SHALL be referenceable, and each collection SHALL declare its item fields explicitly rather than exposing whatever the projected item happens to carry. Iteration SHALL NOT be nestable within another iteration, index or key variables SHALL NOT be exposed, and the collection itself SHALL remain gate-only in value position, so emitting it renders no stringified structure. The digest collections SHALL each declare exactly the item fields `title`, `date`, `messageCount`, and `excerpt`.

The digest's **scalar metadata paths are separate from the collections and are not iterable**: `chats.pinnedShown`, `chats.pinnedTotal`, `chats.recentShown`, `chats.recentTotal`, and `chats.compiledOn`. They exist because the digest capability requires the rendered block to state shown/total ratios and the date the list was compiled, and a template that can only iterate item fields has no way to produce either. They SHALL be escaped as model-class values rather than passed through the tag sanitizer, being server-computed numbers and a date rather than owner-authored text.

The digest collections SHALL be projected at the **top level as `chats`**, deliberately not beneath `user`. Nesting them under `user` would make `user` present for an owner who has chats but has authored no personalization and shares no account identity, which would render an operator's personalization block — framing prose included — around no content, contradicting the gate behavior the personalization capability requires.

**The temporal-anchor namespace `context` SHALL be unconditional**, and is the first projected namespace that is. Unlike `user` and `chats`, which are legitimately absent for some owners and some chats, `context.systemTime` and `context.systemTimezone` SHALL always be present in the projection, because an anchor instant and a timezone are always computable. `context` SHALL therefore NOT be a gate-only subject: a bare `{{#if context}}` SHALL fail startup as an unsupported construct, so that an operator is told the guard is unnecessary rather than silently compiling a branch that is always taken. A conditional over either scalar remains expressible, exactly as for any allowlisted value path, and is simply always true. The omission rule for absent-or-empty values SHALL NOT apply to these two paths, and they SHALL be escaped as model-class values rather than passed through the tag sanitizer, being server-computed rather than owner-authored.

Validation SHALL occur at boot against the template; rendering SHALL be lenient, so an allowlisted path with no value at request time renders empty rather than failing a run. **Model paths SHALL be resolved at boot, while per-user and per-chat paths SHALL be validated at boot and resolved per run**, because no owner and no chat are in scope at startup; boot therefore renders each template with BOTH an absent and a populated per-user context and fails if either is empty. A single no-owner probe is unsound: `unless` is permitted over the per-user gates, so a template whose only content sits behind an inverse user gate renders non-empty with no owner and empty for exactly the owners who personalized. The digest gates admit the same inversion, and because `user` and `chats` are **independent** gates the probe SHALL cover their **cross product** — every combination of absent and populated for both — rather than varying them together. Varying them in lockstep is unsound for the same reason a single probe is: a template whose content sits in `{{#if user}}` and `{{#unless chats}}` renders non-empty when both are absent and when both are populated, while rendering empty for exactly the owners who have chats but authored no personalization. **The temporal anchor SHALL add no dimension to this probe, precisely because it cannot be absent**: every probe combination SHALL supply a representative anchor, and no probe SHALL exercise its absence, since no run can produce it. Rendered model and account-identity values SHALL be escaped by replacing exactly `&`, `<`, and `>`, leaving all other punctuation verbatim; rendered owner-authored values and rendered digest item values SHALL instead be neutralized by the two tag rules defined in the instance-config capability — a value can never close a tag it did not open within that same value, and can never emit a reserved delimiter name as a tag at all, with unmatched or malformed closers escaped fail-closed and everything else passing verbatim. Both SHALL be applied when the context is built rather than by mutating the engine's global escaping. A value that is absent or empty after trimming SHALL be omitted from the context, since an already-safe wrapper is always truthy and would otherwise make conditionals over it evaluate true. **Omission SHALL apply at every level of the per-user projection**: an individual field with no value is absent, `user.personalization` is absent when personalization is disabled or every authored field is empty, and `user` itself is absent when nothing beneath it would render — so that `{{#if user}}` gates an entire section including its operator-authored framing prose. **The same omission discipline SHALL apply to the digest projection**: an empty collection is absent rather than an empty array, and `chats` itself is absent when neither collection would render, so that `{{#if chats}}` gates the whole digest section including its framing prose. Whitespace-control syntax is permitted. Resolution SHALL remain single-pass and non-recursive before hashing and snapshotting: rendered output, including substituted owner text and substituted digest entries, MUST NOT be re-parsed or re-evaluated as a template. Prompt resolution MUST NOT use prompt fragments, inheritance, arbitrary config traversal, or another model's prompt — the prohibition on fragments and inheritance is what requires partials to be rejected. Per-user and per-chat substitution is a projection into one already-complete template and MUST NOT compose two prompt files.

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

#### Scenario: A prompt renders the digest's scalar metadata

- **WHEN** a prompt references `chats.pinnedShown`, `chats.pinnedTotal`, `chats.recentShown`, `chats.recentTotal`, or `chats.compiledOn` outside any iteration
- **THEN** each renders its server-computed value
- **AND** applying `each` to one of them fails boot, since they are scalars rather than declared collections

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

#### Scenario: Prompt renders the temporal anchor

- **WHEN** a prompt references `context.systemTime` and `context.systemTimezone` outside any iteration
- **THEN** startup succeeds and both are accepted as allowlisted scalar paths
- **AND** each run renders an absolute timestamp carrying a numeric UTC offset, together with the IANA identifier of the timezone it is expressed in

#### Scenario: Temporal namespace is guarded as though it were optional

- **WHEN** a prompt wraps content in `{{#if context}}`
- **THEN** startup fails naming the model id and the offending construct, without printing prompt contents
- **AND** the operator is not left with an always-true branch implying the anchor can be absent

#### Scenario: Prompt references no temporal path

- **WHEN** a prompt references neither `context.systemTime` nor `context.systemTimezone`
- **THEN** startup succeeds
- **AND** the rendered prompt is byte-identical to what the same template rendered before the anchor existed

#### Scenario: Every boot probe carries an anchor

- **WHEN** boot validates a template across the cross product of the `user` and `chats` gates
- **THEN** every probe combination supplies a representative anchor value
- **AND** no probe exercises an absent anchor, because no run can produce one

### Requirement: Every new run binds an immutable effective-context snapshot

Before a new run is enqueued, the system SHALL bind it to an immutable owner-scoped snapshot containing the selected model's effective system prompt **with the requesting owner's per-user context already substituted**, prompt source kind, exact model-facing tool ids/descriptions/input schemas, and a canonical source-neutral tool-availability manifest for that turn. Substitution and tool admission SHALL precede computation of the hashes. The existing content hash SHALL continue to cover the rendered prompt plus advertised declarations, the tool hash SHALL continue to cover only the exact advertised declaration contract, and a separate availability hash SHALL cover the canonical availability manifest. The snapshot's exact effective-context identity and reuse key SHALL include both content and availability hashes, so availability-only changes bind a distinct snapshot without retroactively changing the meaning of historical content hashes.

The user message, semantic runtime reminder metadata, Run, and snapshot binding SHALL commit atomically in the chat owner's tenant transaction. The per-user read and in-memory projection of the latest atomically published process-local catalog MAY occur before that transaction, but turn binding SHALL perform no MCP network I/O and SHALL not hold the transaction open across either operation; a personalization or remote-catalog change published after resolution MAY apply only to the next Run. Queued execution and retry SHALL use the bound snapshot and persisted reminder metadata rather than rereading prompt files, re-reading personalization, refreshing remote catalogs, or rebinding newer tool availability. Snapshots MAY be content-addressed and reused only within the same owner and only when prompt, advertised declarations, source kind, and availability manifest are canonically identical.

#### Scenario: Personalization changes after enqueue

- **WHEN** an owner edits their personalization after a run is enqueued but before the worker executes it
- **THEN** that run executes with the personalization bound at enqueue
- **AND** the edited content applies only to subsequently enqueued runs

#### Scenario: Tool availability changes after enqueue

- **WHEN** a dynamic tool disconnects or reconnects after a Run is enqueued
- **THEN** that Run retains its bound declarations, availability manifest, and reminder metadata
- **AND** the changed availability is compared and disclosed on the next accepted turn

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
- **THEN** every attempt uses the same effective prompt, advertised tool contract, availability manifest, and semantic reminders
- **AND** the context receipt remains unchanged

#### Scenario: Tool contract is incompatible at execution

- **WHEN** a snapshotted code-owned tool no longer has a compatible trusted executor at execution time
- **THEN** the Run fails before making a provider request
- **AND** the system does not silently advertise or execute a different tool contract
- **AND** a dynamic source failure instead retains the snapshotted declaration with an unavailable executor under the `tool-calling` capability

#### Scenario: Dynamic tool contract is unavailable at execution

- **WHEN** a snapshotted dynamic tool no longer has its matching trusted executor at execution time
- **THEN** its snapshotted declaration remains unchanged and its executor settles a requested call as unavailable
- **AND** unrelated tools and answer generation remain usable

#### Scenario: Cross-tenant snapshot reference is attempted

- **WHEN** one tenant attempts to read or bind another tenant's effective-context snapshot
- **THEN** datastore constraints and FORCE RLS deny the operation
- **AND** no prompt, tool, or availability content is disclosed

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

### Requirement: Model switches use canonical persisted context text and metadata

The API SHALL persist a server-authored context part on the triggering user
message when the selected model differs from the most recent prior Run. Its
producer SHALL be `effective-context-change`, its form SHALL be `notice`, and
its `data.v` SHALL remain `1`.

The producer SHALL carry a closed cause vocabulary, of which `model` covers a
model change. A cause SHALL be a single value per item; simultaneous causes
owned by different producers SHALL remain separate items. It SHALL retain the
cause, prior public model id, target public model id, and target Run id as
non-rendering metadata for transition compaction, the owner-facing boundary,
and provenance. It SHALL NOT duplicate dimensions owned by another producer,
notably tool availability. It SHALL also persist the complete canonical
model-facing reminder beneath `data.text`. Client-supplied context parts MUST be
rejected or discarded.

The persisted text SHALL state that the active model changed before this user
message, name the current model while omitting the prior model from model-facing
prose, direct the assistant to follow current system instructions and continue
the existing conversation, and direct it not to restart, reintroduce itself, or
mention the model change unless the user asks.

Later request assembly SHALL use `data.text` at its stored author-time position
associated with the triggering user text, following the `context-injection`
producer order. It SHALL NOT reconstruct the reminder from model ids.
Transition compaction and owner UI MAY use validated metadata, but a
metadata/text disagreement SHALL NOT rewrite model replay.

#### Scenario: Switch metadata is assembled for the model

- **WHEN** a model-switch turn is accepted
- **THEN** the server persists structured metadata and complete reminder text
- **AND** later request assembly uses that text without adding another top-level
  system prompt

#### Scenario: Failed prior run selected another model

- **WHEN** the most recent prior Run selected model `A` but failed and the next
  turn selects model `B`
- **THEN** the next user message records an `A` to `B` switch
- **AND** the event is based on durable selection rather than answer completion

#### Scenario: Metadata and text disagree

- **WHEN** a switch part's metadata and persisted text disagree
- **THEN** the model receives the persisted text unchanged
- **AND** transition/UI behavior validates metadata independently

#### Scenario: Client attempts to forge switch metadata

- **WHEN** a client submits a context-item part
- **THEN** the server does not persist or trust that part
- **AND** only server-derived Run state can create the switch item

#### Scenario: Model and tool availability change together

- **WHEN** a turn changes both the selected model and tool availability
- **THEN** the switch item names only the model cause
- **AND** the tool availability producer emits its own persisted reminder

### Requirement: Compaction preserves the completed Run's effective prompt and materializes replacement history

When a completed chat Run triggers full-current compaction, the summarization
inference SHALL use that Run's selected model client, exact bound effective
top-level system prompt, byte-equivalent provider-facing tool declarations
reconstructed without executor functions, compactable conversation prefix, and
a final synthetic user summarization instruction. It SHALL set
`toolChoice: "none"`, MUST NOT execute tools, and SHALL accept text only.

The instruction SHALL request the stable sections `Objective`, `Constraints and
Preferences`, `Decisions and Rationale`, `Established Facts`, `Current State`,
`Open Questions and Next Steps`, and `Critical References`.

Because the replayed prompt may contain owner personalization and a rendered
recency digest, every full-current and transition summarization instruction
SHALL name both standing-context delimiters and direct the model not to carry
their content into the summary. The instruction SHALL also exclude digest
message-rail appends by naming the shared context-item envelope and
`recency-digest` producer. This exclusion remains load-bearing: otherwise
another chat's title/excerpt could become durable checkpoint content that
source deletion or consent withdrawal cannot reach.

The bound top-level prompt SHALL remain unchanged; all exclusions belong only
in the trailing summarization instruction so cached prefix content is not
rewritten. Title generation SHALL continue to use its dedicated task-specific
system prompt rather than the chat model's effective prompt.

Every ordinary or transition compaction SHALL atomically persist:

- the non-empty raw summary used by owner UI and recursive summarization; and
- a non-empty, message-shaped `replacementHistory` that is the complete
  application replay replacement for the superseded prefix.

The first replacement record SHALL be a user-role UI message containing one
text part with the complete final `<system-reminder>` checkpoint. Any retained
compacted tool observations SHALL follow as final assistant UI records under
the `tool-calling` capability. The replacement records and part order SHALL be
the sole replay authority.

The next Run SHALL assemble its current snapshotted top-level prompt/tools,
stored replacement history, retained recent history, and new user turn in that
order. It SHALL NOT re-wrap the raw summary, re-render checkpoint text, or
reconstruct any replacement part. The raw summary remains separate; replay
SHALL NOT parse it out of the checkpoint text.

A later compaction SHALL consume the previous replacement history plus newly
absorbed messages and atomically write a wholly new replacement history. No
legacy checkpoint renderer or compatibility fallback SHALL exist. An active
compaction without valid non-empty replacement history SHALL fail closed rather
than silently discard or regenerate history.

#### Scenario: Completed turn triggers compaction

- **WHEN** a completed Run crosses its compaction threshold
- **THEN** summarization uses the completed Run's bound prompt, model, portable
  tools, compactable history, and trailing instruction
- **AND** the committed row contains raw summary and complete replacement
  history atomically

#### Scenario: Compaction excludes standing and digest rail context

- **WHEN** either compaction mode receives personalization, a prefix digest, or
  digest rail appends
- **THEN** its trailing instruction names the applicable delimiters and producer
  and forbids carrying them into the summary
- **AND** the replayed system prompt and compactable history remain unchanged

#### Scenario: Compaction runs for an owner with personalization

- **WHEN** a bound prompt contains rendered personalization
- **THEN** the trailing instruction excludes that block from the summary
- **AND** the next Run supplies current personalization independently

#### Scenario: Compaction runs for a chat carrying a digest

- **WHEN** a bound prompt contains a rendered recency digest
- **THEN** the trailing instruction excludes that block from the summary
- **AND** the replacement checkpoint need not contain other-chat content

#### Scenario: Compaction leaves the cached prefix untouched

- **WHEN** a summarization request is assembled
- **THEN** the bound prompt and compactable history remain unchanged
- **AND** exclusions appear only in the trailing user instruction

#### Scenario: Both delimited blocks are excluded under either compaction mode

- **WHEN** personalization and recency digest occur under ordinary and
  transition compaction
- **THEN** both instructions exclude both standing-context blocks
- **AND** neither mode rewrites the cached prefix

#### Scenario: Exclusion targets one producer under a shared envelope

- **WHEN** the instruction excludes recency-digest rail appends
- **THEN** it names the shared envelope and the `recency-digest` producer
- **AND** it does not infer producer identity from a private delimiter

#### Scenario: Provider returns a tool call during compaction

- **WHEN** a provider returns a tool call despite `toolChoice: "none"`
- **THEN** no executor is available or invoked
- **AND** the result is rejected rather than persisted as replacement history

#### Scenario: Checkpoint renderer changes later

- **WHEN** a later release changes checkpoint framing or sanitization
- **THEN** an existing compaction replays its stored user text part unchanged
- **AND** the raw summary remains available separately

#### Scenario: Next turn follows a compaction

- **WHEN** the next Run is assembled after successful compaction
- **THEN** current top-level prompt/tools are followed by stored replacement
  history, retained live messages, and the new user turn
- **AND** no replacement record is regenerated, joined, or reordered

#### Scenario: Model changes after compaction

- **WHEN** a model switch follows a stored replacement history
- **THEN** the target receives its current top-level prompt and tools
- **AND** replacement history remains portable historical data before the new
  persisted switch reminder

#### Scenario: Active compaction lacks replacement history

- **WHEN** request assembly encounters an active compaction without valid
  non-empty replacement history
- **THEN** preparation fails closed
- **AND** it does not render a checkpoint from raw summary or treat an old
  ledger as replay authority

#### Scenario: Transition compaction precedes a smaller-context target

- **WHEN** a model switch requires source-model transition compaction
- **THEN** the source model summarizes only the eligible prefix
- **AND** the target request uses the resulting stored replacement history
  before the retained triggering turn

#### Scenario: Partial rewind is requested

- **WHEN** future functionality needs to summarize only a prefix or suffix
  around a retained historical boundary
- **THEN** it does not reuse full-current or transition compaction
- **AND** it requires a separately specified summary contract

### Requirement: Owners can inspect the exact effective context without seeing host paths

The owner SHALL be able to retrieve an immutable context receipt for each new Run. The receipt SHALL contain the public model id, prompt source label, complete effective system prompt contents **including any rendered per-user context exactly as sent to the provider**, advertised tool ids/descriptions/input schemas, availability manifest version, content hash, availability hash, and snapshot timestamp. For observed v1 availability it SHALL also contain the safe eligible/unavailable entries and closed reason labels. For migrated v0 availability it SHALL instead contain only `state: "unobserved"` and SHALL NOT represent historical non-observation as an empty catalog. It MUST NOT contain the administrator's prompt-file path, MCP URL, configured header names or values, session id, raw remote error, server-only provider model id, provider credentials, executor implementation, or trusted authorization context. Non-owners SHALL receive a not-found response.

#### Scenario: Owner inspects a run carrying personalization

- **WHEN** the chat owner opens the receipt for a run whose prompt rendered their personalization
- **THEN** the rendered personalization is visible in the disclosed prompt contents
- **AND** the owner can determine exactly what personalization the model received for that run

#### Scenario: Owner inspects runtime tool availability

- **WHEN** the chat owner opens a receipt for a Run with unavailable eligible tools
- **THEN** the receipt shows safe tool ids and closed availability labels matching the bound manifest
- **AND** it exposes no endpoint, header, session, or raw remote error data

#### Scenario: Owner inspects migrated historical availability

- **WHEN** the owner opens a receipt whose snapshot carries the canonical v0 availability sentinel
- **THEN** the receipt reports manifest version `0` and state `unobserved`
- **AND** it does not report an empty observed tool catalog

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
- **AND** no model, prompt, tool, availability, endpoint, or path metadata is disclosed

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

Persisted context-item parts of every producer, generated item prose, the per-Run record of injected items, receipt references, and prompt/tool/availability receipt contents MUST NOT appear in public-share responses, ordinary transcript exports, or chat-search projections. Prompt and safe availability contents are intentionally visible to the owning user through the authenticated receipt endpoint only.

#### Scenario: Public chat is viewed

- **WHEN** an anonymous or non-owner viewer loads a publicly shared chat containing model switches or runtime tool-availability changes
- **THEN** ordinary shared user/assistant content remains visible
- **AND** context-item parts of every producer, the per-Run record of injected items, owner receipt actions, prompt contents, and tool/availability receipt contents are absent

#### Scenario: Owner exports the transcript

- **WHEN** the owner creates an ordinary Markdown transcript export
- **THEN** the export contains presentation-safe conversation content
- **AND** it omits generated item prose, context-item parts of every producer, the per-Run record of injected items, receipt metadata, prompts, advertised tool schemas, and availability manifests
