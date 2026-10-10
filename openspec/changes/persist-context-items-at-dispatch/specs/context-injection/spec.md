## MODIFIED Requirements

### Requirement: Server-authored context is injected as discrete items on one rail

Every server-authored contribution to a chat's model-visible conversation that is not part of the system prompt SHALL be injected as a **context item** on one rail. An item SHALL be rendered inside a single canonical `<system-reminder>` envelope, and SHALL NOT introduce a top-level delimiter name of its own.

A compaction checkpoint SHALL remain a rail context item with producer `compaction`, form `checkpoint`, and rail residency for envelope and stored-metadata semantics. It SHALL NOT be a storage exception: its durable representation SHALL be an ordinary persisted `data-context` part on a `checkpoint` row, and replay SHALL convert that row to one user-role text message exactly as it converts every other persisted rail part. `model-system-prompts` SHALL own the row's coverage boundary and replay-selection contract.

The wire role SHALL remain `user`. A provider-level role for injected context SHALL NOT be invented, and items SHALL NOT be emitted as additional conversation messages of their own where a message already exists to carry them: items attached to a turn SHALL be carried inside that turn's triggering user message.

An item authored **between the model steps of one Run** — an in-Run item — has no user message to carry it. It SHALL be stored as a `data-context` part on that Run's assistant message, immediately after the last tool part of the step whose results triggered it, and SHALL be supplied to the model as a user-role text message placed after that step's last tool result on the step that follows the trigger and on every later step of the same Run at the same position. Within a Run, that placement SHALL be computed from the step's live model messages by removing any earlier copy of the item and inserting it after the tool-result message that carries the matching tool call, so that the result is identical whether or not the model client retains an earlier step's message override. It SHALL use the same envelope, framing, and vocabulary as an attached item. Before the step request that first carries an in-Run item, the item SHALL be recorded as an ordered `context.item` Run event carrying its attempt id. Settlement SHALL project, at their positions, the `context.item` events of exactly the attempts whose model output it projects, whatever the Run's outcome, including an `outcome_unknown` settlement that projects an earlier attempt's events; an item of a later projected attempt SHALL be dropped only when it names files and every file identity it names, by canonical host path or logical `kb://` locator, is already named by an item of an earlier projected attempt, and SHALL otherwise be kept verbatim. The chat stream and the owner's raw Run event stream (`GET /api/v1/runs/:id/events`) SHALL NOT forward `context.item` events; the owner sees the part when the assistant message settles.

Each item SHALL occupy its **own text content block** within that message rather than being concatenated with another item or with the user's text. The separation between server-authored content and user-authored content SHALL therefore be structural rather than a textual convention that user input can imitate.

#### Scenario: Two items are injected on one turn

- **WHEN** two context items are injected before a user's message
- **THEN** each renders in its own `<system-reminder>` envelope in its own text content block
- **AND** the user's visible text occupies a further block in the same message
- **AND** no additional conversation message is created

#### Scenario: A turn carries no injected item

- **WHEN** a turn has no context item to inject
- **THEN** the user message carries only the user's visible text
- **AND** its serialized form is unchanged from a turn that predates this capability

#### Scenario: An item is not attached to a turn

- **WHEN** an item's producer has no triggering user message to attach to
- **THEN** the item is carried by the message its producer already owns
- **AND** it uses the same envelope, framing, and vocabulary as an attached item

#### Scenario: An in-Run item follows its triggering tool result

- **WHEN** a producer authors an item after a tool result inside a Run
- **THEN** the item is stored on the Run's assistant message after that tool part
- **AND** every later model step of that Run receives it as a user-role message directly after that tool result
- **AND** the item stays on the assistant message at that position when the Run fails, is cancelled, expires, or ends with an unknown outcome

#### Scenario: A compaction checkpoint replaces history

- **WHEN** compaction publishes a checkpoint row for a superseded prefix
- **THEN** the row carries one persisted `data-context` part whose text is the
  complete final checkpoint envelope
- **AND** the envelope and stored part metadata retain producer `compaction` and form
  `checkpoint`, and replay uses that stored text without metadata
  reconstruction

Worker-attempt contributions intended for conversation history SHALL be staged in memory and committed before the model request that first carries them, whatever the Run's outcome: turn-attached items in the triggering message, in-Run items as Run events that the Run's assistant message keeps. An attempt's turn-attached items, together with the seen and told state and the comparison records that account for them, SHALL commit in one **dispatch transaction**, fenced by the attempt identity and committed after request preparation and any pre-step checkpoint and before the attempt's first model request; a superseded attempt SHALL commit nothing, and an attempt that fails before that transaction SHALL commit no staged item. The dispatch transaction SHALL also set the Run's `dispatched_at`; a Run has **dispatched** when `dispatched_at` is set. Each committed turn-attached part SHALL carry its Run id. A later attempt of a dispatched Run SHALL reuse those parts verbatim as its turn-attached items, and no producer SHALL author another turn-attached item, accepted-turn told-state update, or comparison record for that Run, except the **reconciliation items** that `Workspace binding changes are rail-resident context items` and `tool-calling`'s `Attempt availability is disclosed against the preceding dispatched turn` define for Workspace and availability state that changed after the Run dispatched. The retry SHALL commit its reconciliation items, with the told state and comparison record that account for them, in one attempt-fenced write before its first model request. In-Run producers SHALL run normally on the retry's own model steps. A retry of a Run that has not dispatched SHALL re-derive every item; prompt-import and skill-activation parts, which their producers persist earlier and separately, SHALL NOT trigger reuse. The attempt's own persisted output remains part of the record as the user saw it and enters later model context like any other committed turn. Legitimate accepted-message facts remain persisted-literal. Committed parts retain the exact prepared text and existing envelope/order. A compaction checkpoint row and the epoch state published with it are not staged contributions: they commit in their own transaction before the model step they precede, and a later failure of that attempt SHALL NOT retract them.

#### Scenario: A failed Run keeps the items it dispatched

- **WHEN** a Run's first model request carries turn-attached items, a later step carries an in-Run item, and the Run then fails, is cancelled, expires, or ends with an unknown outcome
- **THEN** the turn-attached items remain on its triggering user message and the in-Run item remains on its assistant message at its step position
- **AND** the next turn replays them as stored text exactly as it replays a completed Run's items

#### Scenario: A retried attempt reuses its Run's items

- **WHEN** an attempt commits its dispatch transaction, setting `dispatched_at`, and the Run is then retried in a new attempt whose Workspace binding and tool availability match what the Run dispatched
- **THEN** the retry sends the turn-attached parts that carry its Run id unchanged
- **AND** no producer authors a second turn-attached item, accepted-turn told-state update, or comparison record for that Run
- **AND** a tool result on one of the retry's own steps still triggers in-Run items as usual

#### Scenario: Preparation fails before dispatch

- **WHEN** request preparation fails before the attempt's dispatch transaction commits
- **THEN** no staged item, told state, or comparison record from that attempt is committed and `dispatched_at` stays unset
- **AND** a retry re-derives every item, even though the user message already carries the Run's prompt-import or skill-activation parts

#### Scenario: In-Run items follow the projected output

- **WHEN** attempt A records an `instructions` item naming only `apps/api/AGENTS.md`, and a retry B of the same Run, whose seen set excludes A's in-Run items, independently records an item naming only that file
- **THEN** a settlement that projects both attempts' output, such as an `outcome_unknown` settlement, keeps A's item and drops B's
- **AND** when B's item instead names that file and `apps/api/src/db/AGENTS.md`, the settlement keeps it verbatim beside A's
- **AND** a settlement that projects only B's output keeps only B's in-Run items

#### Scenario: An unknown-outcome settlement keeps the earlier attempt's items

- **WHEN** a Run settles `outcome_unknown` by projecting an earlier attempt's events
- **THEN** that attempt's in-Run items stay on the assistant message at their positions

#### Scenario: In-Run items are not streamed

- **WHEN** an attempt records a `context.item` event while the owner subscribes to the chat stream or `GET /api/v1/runs/:id/events`
- **THEN** neither stream forwards the event
- **AND** the owner sees the part when the assistant message settles

### Requirement: Co-occurring items have a total author-time order

When more than one item is injected on the same turn, the authoring/request-preparation path SHALL persist them in a fixed producer precedence order, ahead of the triggering user text within the same message:

1. `effective-context-change`
2. `tool-availability`
3. `workspace`
4. `instructions`
5. `skill-catalog`
6. `skill-activation`
7. `prompt-imports`
8. `recency-digest`
9. `temporal`

When one producer contributes more than one item, those items SHALL be stored in emission order. A producer added later SHALL extend this authoring list in the rail specification.

In-Run items SHALL be ordered by the model step that triggered them and, within a step, by this same producer precedence; they are never re-sorted against the attached items of the triggering user message.

Replay SHALL preserve the stored part order. It SHALL NOT re-sort historical items through the current precedence list or merge adjacent text parts. The compaction checkpoint is carried by a `checkpoint` row of its own and follows that capability's placement rule rather than this attached-item list.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, availability change, and chat-list change accompany one user message
- **THEN** their final text blocks are persisted in fixed author-time order
- **AND** every later replay preserves the stored order and part boundaries

#### Scenario: One producer contributes two items on one turn

- **WHEN** one producer emits two items before the same user message
- **THEN** both persist in producer emission order
- **AND** neither item is merged or suppressed

#### Scenario: A temporal item accompanies other items on one turn

- **WHEN** a temporal item accompanies another context item
- **THEN** authoring persists the temporal item last among attached items
- **AND** replay retains that stored position

#### Scenario: The precedence list changes later

- **WHEN** a later release adds a producer or changes author-time precedence
- **THEN** new items follow the new authoring order
- **AND** existing messages remain in their original stored order

When worker preparation adds attempt-owned items beside already persisted message facts, the final request SHALL apply this same producer order while preserving each producer's internal order and all user-authored content. The dispatch transaction SHALL store that final ordering atomically before the request that carries it, and the stored ordering SHALL stand whatever the Run's outcome. A retry of a dispatched Run SHALL NOT re-sort its reused items, whose text and order are fixed; the reconciliation items that a dispatched Run's retry adds SHALL be appended immediately after the reused items and ahead of the user text, outside producer order relative to the reused items and in producer order among themselves.

#### Scenario: Workspace and skill catalog items share a turn

- **WHEN** a Workspace state change and an effective skill catalog change accompany one user message
- **THEN** the `workspace` item precedes the `skill-catalog` item and both precede the user text
- **AND** replay preserves those stored positions

#### Scenario: Workspace snapshot and root instructions share a turn

- **WHEN** an accepted turn re-establishes the Workspace snapshot and stages the root instruction chain
- **THEN** the `workspace` item precedes the `instructions` item and both precede any `skill-catalog` item

#### Scenario: Skill activation and prompt imports share a turn

- **WHEN** an explicit skill activation and prompt imports accompany one user message
- **THEN** every `skill-activation` item precedes the `prompt-imports` item and both precede the user text
- **AND** replay preserves those stored positions

#### Scenario: A detaching retry appends outside producer order

- **WHEN** a dispatched Run's user message carries reused `workspace`, `instructions`, and `temporal` items and its retry detaches the Workspace binding
- **THEN** the retry's detach notice and no-Workspace snapshot follow the `temporal` item and precede the user text
- **AND** the reused items keep their stored text and order

#### Scenario: A failed Run keeps its stored order

- **WHEN** a model change, an availability change, and a temporal item accompany a user message whose Run then fails
- **THEN** the three items remain on that message in author-time order
- **AND** a retried attempt of that Run sends them in the same stored order without re-sorting

### Requirement: Residency determines whether a change re-renders the prompt or appends an item

Every context contribution SHALL be classified by **residency**:

- **prefix-resident** — re-supplied in full on every request as part of the system prompt. Updating it means re-rendering the prompt. It is cheap to read on every turn and expensive to change, because a change invalidates the cached prefix for the whole conversation.
- **rail-resident** — appended once as a context item and never re-sent. Updating it means appending another item. It is cheap to add and paid for in every later turn until a checkpoint absorbs it.
- **rail-only** — a small complete statement of current state whose re-statement after each checkpoint is cheaper than a prefix baseline. It MAY be kept only on the rail: a `snapshot` is emitted when the state changes and re-emitted after a checkpoint, rather than adding it to the system prompt. The Workspace producer uses this class.

A new context surface SHALL be classified by this procedure:

1. A contribution that is an **account of something that happened** SHALL be rail-resident.
2. A contribution that is a **complete statement of current state** which changes **less often than a checkpoint** SHALL be prefix-resident.
3. A complete statement of current state which changes **more often than a checkpoint** SHALL be a frozen prefix-resident baseline plus rail-resident deltas, re-baked when a checkpoint is published, unless it qualifies as rail-only under step 4. A frequently-changing complete statement SHALL NOT be placed in the prefix, because that forfeits prefix caching for the whole conversation on every change.
4. A small complete statement of current state whose re-statement after each checkpoint is cheaper than a prefix baseline MAY be rail-only, emitted as a `snapshot` on change and re-emitted after a checkpoint.

A re-bake or re-emission at a checkpoint SHALL take effect for the very request that checkpoint precedes, and SHALL survive a failure of that attempt.

Residency SHALL be readable for every contribution from where it is stored: every persisted context part is rail-resident, and prefix-resident content is carried by the attempt's system-prompt receipt, so that a later audit needs no separate per-Run list.

#### Scenario: A new surface reports an event

- **WHEN** a new context surface reports that something occurred
- **THEN** it is rail-resident
- **AND** it is not added to the system prompt

#### Scenario: A new surface states rarely-changing state

- **WHEN** a new context surface states current state that changes less often than the chat publishes checkpoints
- **THEN** it is prefix-resident
- **AND** a change to it re-renders the prompt rather than appending an item

#### Scenario: A new surface states frequently-changing state

- **WHEN** a new context surface states current state that changes more often than the chat publishes checkpoints
- **THEN** it is a frozen prefix baseline with rail-resident deltas
- **AND** the baseline is re-resolved when a checkpoint is published rather than on every change

#### Scenario: A new surface states compact current state

- **WHEN** a new context surface states a small complete statement of current state whose re-statement after each checkpoint is cheaper than a prefix baseline
- **THEN** it MAY be rail-only, with a `snapshot` emitted when the state changes
- **AND** the snapshot is re-emitted after a checkpoint rather than changing the system prompt

#### Scenario: A failed Run's rail items remain auditable

- **WHEN** an audit reads a Run that failed after its first model request
- **THEN** the context parts on its messages are its rail-resident contributions
- **AND** its system-prompt receipt carries its prefix-resident content

### Requirement: A prefix change is announced only when history was conditioned on the old value

A change to prefix-resident content SHALL be **silent to the model by default**: the model reads the re-rendered prompt, so its content needs no announcement.

An announcement SHALL be injected as a rail item when the changed content is **assertional** — a fact the model may previously have denied, lacked, or answered around — because the conversation then contains turns that contradict the new prefix and the contradiction would otherwise be unexplained. An announcement SHALL NOT be injected when the changed content is **behavioral** — tone, format, working style, or comparable guidance — because the only history conditioned on it is the model's own prior output, which is not authoritative.

An announcement SHALL state that earlier turns predate the changed content and that they are not to be treated as contradicting it.

Disclosure to the **owner** SHALL be unconditional and independent of this rule: every change to the effective context SHALL be recorded for the owner in that Run's persisted rail or system-prompt receipt whether or not it is announced to the model.

**This requirement is not yet satisfied for every prefix contribution, and the gap SHALL be stated rather than implied.** Only the model cause of an effective-context change is detected today; a personalization edit or an operator prompt reload changes prefix-resident content without producing an announcement, so an owner who supplies a fact the assistant previously said it lacked still leaves the conversation carrying an unexplained contradiction. Detecting the remaining causes requires the binder to record why it minted a new snapshot, which no shipped path does, and is owned separately. Likewise, the owner-disclosure clause is satisfied today only for changes that produce a rail item: a behavioral change renders nothing, and the persisted rail holds rendered items only, so it currently carries no entry for one. Both gaps are deferred rather than descoped — the rule stands as the contract the deferred work is written against, and a reader of this capability SHALL NOT infer that the assertional-announce branch is implemented.

#### Scenario: Assertional prefix content changes mid-conversation

- **WHEN** prefix-resident content gains a fact the assistant previously stated it did not have
- **THEN** an item announces that earlier turns predate the information
- **AND** it states that earlier answers are not to be treated as contradicting it

#### Scenario: Behavioral prefix content changes mid-conversation

- **WHEN** prefix-resident content changes only how the assistant should express itself
- **THEN** no item is injected
- **AND** the change is still recorded for the owner

#### Scenario: A routine re-resolution changes the prompt

- **WHEN** the prompt changes only because standing context was re-resolved at compaction
- **THEN** no announcement is injected
- **AND** the change is still recorded for the owner

#### Scenario: A failed Run's announcement stays recorded

- **WHEN** a Run commits an item announcing an effective-context change and then fails
- **THEN** the item stays on that Run's user message for the owner
- **AND** no separate per-Run record is needed to find it

### Requirement: Compaction is the rail's re-baseline boundary

A published compaction checkpoint SHALL be the single boundary at which rail state is re-established. A producer whose items express deltas against a baseline SHALL treat a newly published checkpoint as starting a fresh baseline, rather than comparing across it. A producer whose contribution is a frozen prefix baseline SHALL re-resolve it when a checkpoint is published and at no other time.

The checkpoint and the epoch state published with it commit before the model step they precede, so a producer re-baselines for the very request that follows the checkpoint rather than for a later turn. A failure of that attempt SHALL NOT retract them, and a retry reuses them.

This rule SHALL be stated once for the rail and inherited, rather than derived independently per producer.

Standing context that is re-supplied on every request SHALL be excluded from the summary a compaction writes, so that a checkpoint does not freeze a stale copy of a value the next request supplies fresh. This exclusion SHALL be documented as resting on instruction and model compliance rather than structural enforcement.

#### Scenario: A delta producer crosses a compaction

- **WHEN** a checkpoint is published before a model step
- **THEN** a delta producer establishes a fresh baseline for that very request rather than comparing against pre-checkpoint state
- **AND** no transition is reported across the boundary

#### Scenario: A frozen baseline crosses a compaction

- **WHEN** a chat with a frozen prefix baseline publishes a checkpoint
- **THEN** the baseline is re-resolved in the same transaction, before the model step that follows
- **AND** it is not re-resolved by any other event

Frozen per-chat digest and temporal baselines retain their owning lifecycles. This requirement SHALL not freeze owner-variable resolution, runtime tool catalogs, or descriptions across attempts. Availability comparisons use the minimal id/state record of the most recent prior Run whose `dispatched_at` is set, whatever that Run's outcome, within the current epoch; a Run without `dispatched_at` never establishes such a comparison baseline, and the epoch state a checkpoint publishes with itself survives the failure of the attempt it preceded. A new rail epoch SHALL begin when the active checkpoint's absorbed-through sequence is at or above the sequence of that baseline Run's triggering user message. That boundary SHALL NOT be decided by comparing checkpoint creation times, and SHALL NOT be read off the sequence of an assistant row, because a retried assistant row keeps its sequence below a checkpoint published between its attempts.

#### Scenario: A failed Run's availability record is the next baseline

- **WHEN** a Run commits an availability notice and its id/state record, then fails, and the next turn observes the same availability
- **THEN** the next turn compares against the failed Run's record and emits no availability notice
- **AND** a completed Run before it does not serve as the baseline or decide the epoch boundary

### Requirement: An item is either persisted-literal or bind-time

Every item SHALL be one of two kinds:

- **persisted-literal** — durable storage carries the complete final text used
  for replay; or
- **bind-time** — the item is computed for one request and no durable historical
  text exists.

A persisted-literal item's metadata SHALL NOT be a source from which replay
reconstructs prose, framing, attributes, sanitization, or order. A persisted
context part with missing or empty text is inert stored data, not a third
rendering mode. A bind-time item SHALL NOT be persisted into message history,
because a stored statement about the present request could become false later.

#### Scenario: A persisted-derived item is replayed

- **WHEN** a conversation contains a context part with non-empty final text
- **THEN** replay uses that text directly
- **AND** renderer changes do not alter it

#### Scenario: A data-only item is replayed

- **WHEN** a stored context part lacks non-empty final text
- **THEN** it contributes no model-visible part
- **AND** metadata is not used to derive one

#### Scenario: A bind-time item is replayed

- **WHEN** a request is assembled for a turn that previously had a bind-time
  item
- **THEN** no stale copy of that item appears in history

An attempt-generated item intended for later conversation history SHALL be staged as a pending persisted-literal contribution. Its exact prepared text SHALL be committed before the request that first carries it and used unchanged in that request; a later failure of the Run SHALL NOT discard it. A compaction checkpoint row is not a pending contribution: it is published with the epoch state it re-bakes before the step it precedes, and that state survives the attempt's failure. This staging does not add a new wire-format item kind or permit a bind-time-only producer to persist into message history.

Content copied from outside the chat SHALL remain non-erasable through deletion of its source once it has been written into a persisted reminder; that limitation SHALL remain documented.

#### Scenario: A failed Run's pending item is not discarded

- **WHEN** an attempt commits a pending persisted-literal item, sends it, and the Run then fails
- **THEN** the item's stored text remains in history
- **AND** the next request replays it unchanged

#### Scenario: A source of injected content is deleted

- **WHEN** a reminder copied content from another chat that is later deleted
- **THEN** the persisted reminder remains unchanged
- **AND** the deletion limitation is not hidden

### Requirement: Worker-attempt cutover preserves existing conversation state

The dispatch-time publication rule and the retention of failed-attempt output SHALL
apply to attempts executed after the coordinated runtime cutover. Cutover SHALL
preserve existing messages and reminders, digest baseline/told-set state, and
the epoch identity a live checkpoint publishes under, without rebuilding,
clearing, or adding
retrospective replay filters. Existing state SHALL retain its ordinary
compaction, digest, and owner-access rules. These prospective rules SHALL NOT
claim to remove failed pre-cutover Run contributions from existing history or aggregates, and SHALL NOT reconstruct rail items or told state that a pre-cutover failed Run never published. The separate system-receipt and tool-catalog storage migration
remains required and SHALL NOT authorize rewriting conversation state.

The migration that adds `runs.dispatched_at` SHALL set it, for every pre-cutover Run whose status is
`completed` and whose `completed_attempt_id` is set, to that Run's finish time, and SHALL leave it unset for
every other pre-cutover Run. That set matches the shipped lookup of the most recent successfully
committed Run, so the first post-cutover turn's model-switch, availability, and epoch baseline is the
Run that lookup returns.

#### Scenario: An existing Chat crosses the worker-attempt cutover

- **WHEN** an existing Chat has stored reminders, an active checkpoint, and digest disclosure state
- **THEN** cutover preserves their contents and existing replay eligibility without reconstruction
- **AND** later compaction and digest updates follow their ordinary lifecycle

#### Scenario: A post-cutover attempt fails in an existing Chat

- **WHEN** a newly prepared attempt fails after cutover and after its first model request
- **THEN** its persisted partial output, the rail items it dispatched, its digest updates, and its comparison record remain part of the record, and that record is the next turn's comparison baseline
- **AND** pre-existing conversation state is not retrospectively filtered or reset

#### Scenario: A pre-cutover failed Run stays without its items

- **WHEN** a Run failed before the cutover and its staged rail items were discarded
- **THEN** cutover does not reconstruct those items or advance any told state for them, and leaves that Run's `dispatched_at` unset
- **AND** the next post-cutover turn compares against the state that was committed, taking the most recent pre-cutover completed Run as its baseline

#### Scenario: The first post-cutover turn keeps the pre-cutover baseline

- **WHEN** a Chat's last pre-cutover Run completed on model `A`, its digest baseline was re-baked from the active checkpoint, and that Run already carried the supersession marker
- **THEN** the migration sets that Run's `dispatched_at` to its finish time
- **AND** the first post-cutover turn on model `A` emits no model-switch item and no second digest supersession marker

### Requirement: The skill catalog is a frozen prefix baseline stored on the chat

The proactively eligible skill catalog for a Chat SHALL be computed from that Chat's effective skill sources, as defined by `agent-skills`, and SHALL be classified as a frozen prefix-resident baseline with rail-resident deltas. The baseline SHALL be the `skills` prompt projection defined by `model-system-prompts`: admitted entries in code-point name order, each with name and description, plus the count of proactively eligible entries omitted. Admission SHALL retain whole entries while the admitted count stays within 256 and the cumulative UTF-8 length of name and description stays within 16 KiB, so that template-owned per-entry markup cannot multiply the bound; omission SHALL be disclosed through that count whenever the baseline admits at least one entry, and the proactively eligible set SHALL remain inspectable through `read("skill://")` regardless.

The baseline and the names of the entries the Chat was last told SHALL be persisted on the Chat row under owner isolation, following the recency-digest precedent, together with the identity of the checkpoint message under which the baseline was resolved. Accepted-turn preparation SHALL reuse the stored baseline only when a baseline is persisted and its recorded identity equals the Chat's latest checkpoint message — a Chat that has published no checkpoint records both as absent and keeps reusing its first baseline — and SHALL otherwise resolve the current catalog from that Chat's effective skill sources and start a new baseline and told state in the attempt's dispatch transaction. No baseline SHALL be written for a Chat whose effective skill source set is empty. Package edits, model switches, and other prompt contributions SHALL NOT refresh the baseline. A checkpoint published before a Run's first model request SHALL re-resolve the baseline in the same transaction as that checkpoint, so the request that follows it renders the refreshed baseline. Caller-supplied owner identifiers SHALL NOT authorize baseline or told-state reads or mutations. The epoch that identity comparison serves SHALL be the rail epoch that `Compaction is the rail's re-baseline boundary` defines, which states its boundary once.

The baseline SHALL enter the prompt only through the template projection. A template that does not reference `skills` SHALL render no catalog, and no server-rendered block SHALL be appended outside the template. Operator-authored descriptions SHALL be neutralized before composing the prompt or any item and SHALL replay from persisted text without another sanitization pass.

#### Scenario: Catalog is frozen within an epoch

- **WHEN** a package description changes or the model is switched between two user turns with no compaction between them
- **THEN** the next Run's prompt renders the stored baseline byte-for-byte
- **AND** the effective-context snapshot is reused rather than re-minted for that reason

#### Scenario: Compaction starts a new baseline

- **WHEN** a Chat publishes a checkpoint after catalog notices have accumulated
- **THEN** that checkpoint's publication resolves the current catalog as its new baseline and told state
- **AND** old deltas are not applied again against that new baseline

#### Scenario: A pre-step checkpoint refreshes the baseline inside a Run

- **WHEN** context fitting publishes a checkpoint before a Run's first model request
- **THEN** that Run's request renders the baseline the checkpoint refreshed
- **AND** the next accepted turn reuses that baseline rather than resolving another

#### Scenario: Operator template omits the namespace

- **WHEN** a model's template never references `skills`
- **THEN** its prompt carries no catalog and boot succeeds
- **AND** explicit `$skill` activation on that model still loads instructions through the rail

#### Scenario: Another owner targets catalog state

- **WHEN** owner A attempts to read or mutate owner B's Chat baseline or told state
- **THEN** datastore enforcement refuses access using the authenticated identity
- **AND** supplying owner B's identifier does not authorize the operation

#### Scenario: Workspace sources contribute to a bound Chat's baseline

- **WHEN** a new baseline is resolved for a Chat bound to a Workspace containing a proactively eligible skill
- **THEN** that skill is included in the Chat's baseline subject to the ordinary admission bounds
- **AND** a Chat without that Workspace binding continues to resolve its baseline from its own effective sources

#### Scenario: A failed Run keeps the baseline it froze

- **WHEN** the first Run of a Chat with effective skill sources freezes a baseline and then fails after its first model request
- **THEN** the baseline and told state stay persisted
- **AND** the next accepted turn reuses that baseline rather than resolving another

### Requirement: Explicit activations are rail items carrying current instructions

Each explicit `$skill` selection SHALL produce one `skill-activation` item with form `notice` in the triggering user message before the first model request. A successful item SHALL state which mention selected the skill, the absolute skill directory and instructions file, the instruction to resolve package-relative references and scripts against that directory while keeping task-relative inputs and choosing `cwd` explicitly, a precedence statement, and the current `SKILL.md` instruction body with its frontmatter removed, taken from the raw read with its ordinary truncation indicator, followed by file blocks for package files imported by markers in that body in depth-first order. A failed selection SHALL produce a bounded item naming the mention and one closed reason from `not_found`, `unavailable`, `permission_denied`, and `read_failed`, without operator diagnostics in model text. Selections beyond the count, output, or work budget SHALL be accounted for by one bounded omission item listing their names.

Activation items SHALL use the existing canonical envelope, provenance, owner visibility, stored-text replay, and author-time ordering. A completed explicit activation SHALL NOT be reloaded on recovery. Partial recovery SHALL preserve completed mention results and fill only unfinished selections in original order. Operator-supplied reserved delimiters SHALL be neutralized before composing and persisting activation text.

#### Scenario: Two explicit selections on one message

- **WHEN** the user sends `$research $technical-writing compare these APIs`
- **THEN** two activation items persist in that order ahead of the user text
- **AND** each carries its skill directory, instructions file, and frontmatter-stripped instruction body

#### Scenario: Selection fails after admission is denied

- **WHEN** an explicit selection's read is denied by permission policy
- **THEN** its item names the mention with reason `permission_denied` and no instructions
- **AND** the other selections and the Run proceed

#### Scenario: Skill text contains a forged reminder delimiter

- **WHEN** operator metadata or instructions contain reserved context delimiters
- **THEN** they are neutralized before prompt or context-item composition and cannot create another envelope
- **AND** recovery replays the persisted final text unchanged

#### Scenario: Activation carries package-local imported files

- **WHEN** the user sends `$research` and its current instruction body contains `@references/checklist.md`
- **THEN** the successful `skill-activation` item carries the instruction body followed by a file block for `skill://research/references/checklist.md`
- **AND** nested package-local imports appear after their importer in depth-first order

#### Scenario: Activation text is inspected on the owner message

- **WHEN** the owner inspects a Run whose triggering user message carries a `skill-activation` item
- **THEN** that stored item text is the activation the model received
- **AND** no separate per-Run record of the activation exists

### Requirement: Catalog notices announce added and removed skills on the next user turn

At each accepted user turn that continues a compaction epoch and whose bound model's template references the `skills` namespace, the current proactively eligible catalog from that Chat's effective skill sources, bounded as for the baseline, SHALL be compared with the Chat's told state by name only; descriptions SHALL NOT participate in the comparison and an addition SHALL render the entry's current description. A turn bound to a model whose template does not reference `skills` SHALL emit no catalog notice and SHALL leave the told state unchanged. When entries were added or removed, one `skill-catalog` item with form `notice` SHALL be persisted listing added entries with name and description and removed entries by name, telling the model to read an added skill before applying it and not to apply a removed skill's earlier instructions, and carrying a precedence statement whenever a description is present. An eligibility flip or a promotion from the omitted portion SHALL render as an add or a remove. A changed description or changed instruction content of an entry that stays advertised SHALL NOT produce a notice in this change. Notices SHALL carry only bounded metadata, never instruction bodies. The notice and the told state SHALL be written in the attempt's dispatch transaction; a retried attempt of a dispatched Run SHALL reuse its persisted notice and state, and a rollback SHALL expose none of those writes.

When a delta would exceed the baseline bound, one `skill-catalog` item with form `snapshot` SHALL instead state that the catalog was refreshed and earlier updates are superseded, listing the bounded current set with its omitted count; the told state SHALL then equal that snapshot. No notice SHALL be injected between model requests inside an existing Run; a removed package fails its next read under current availability and its removal is announced on the next user turn.

#### Scenario: Catalog changes between user messages

- **WHEN** one skill is added and another removed after a user turn in the same epoch
- **THEN** the next user turn carries one notice naming the addition with its description and the removal by name
- **AND** the immutable effective-context receipt retains the frozen baseline while the triggering user message carries the notice

#### Scenario: Template opts out of the catalog

- **WHEN** a skill is added while the Chat's bound model uses a template that never references `skills`
- **THEN** no catalog notice is emitted and the told state is unchanged
- **AND** after a switch to a model whose template renders the catalog, the next turn announces the additions since the baseline

#### Scenario: Description changes without membership change

- **WHEN** an advertised skill's description or `SKILL.md` content changes between user turns
- **THEN** no catalog notice is emitted in this change (tracked as [#821](https://github.com/leon0399/llame/issues/821))
- **AND** a later `skill://` read returns the current content

#### Scenario: Active Run sees a deleted skill

- **WHEN** a package disappears while a Run is making tool calls
- **THEN** its next skill read fails under current availability
- **AND** the removal notice waits for the next user turn

#### Scenario: Delta exceeds the bound

- **WHEN** the added and removed entries cannot be rendered within the baseline bound
- **THEN** a supersession snapshot with the bounded current set replaces the delta
- **AND** the told state equals the snapshot's admitted entries

#### Scenario: Told-state transaction is interrupted

- **WHEN** the dispatch transaction fails before commit after preparing a catalog notice
- **THEN** neither the notice nor updated told state is visible, and no model request is sent
- **AND** retry produces one consistent accepted turn without repeated or skipped catalog changes

#### Scenario: Workspace source changes affect only that Chat's delta

- **WHEN** a Chat enters a Workspace containing a skill that was absent from its effective sources, or detaches from a Workspace whose skill was previously effective, within the same compaction epoch
- **THEN** the next accepted turn compares the current effective catalog and announces the resulting addition or removal for that Chat
- **AND** another Chat without that Workspace binding compares only its own effective sources

#### Scenario: A failed Run's catalog notice is not repeated

- **WHEN** a turn's catalog notice announcing an added skill commits and its Run then fails
- **THEN** the told state includes the added skill
- **AND** the next accepted turn emits no notice for that addition

### Requirement: Skill activations remain separate from immutable enqueue receipts

The enqueue-bound effective-context receipt SHALL retain its immutable prompt/tool snapshot and SHALL NOT be extended with post-claim activation results. The context items a Run sent, including skill catalog notices and activations alongside all existing producers, SHALL be inspectable only as the persisted parts of the owner's messages. No separate Run context-item record SHALL be kept, and `GET /api/v1/runs/:id/context-items` SHALL NOT exist. Those parts SHALL remain owner-only and excluded from public shares, exports, and search.

#### Scenario: Owner inspects before and after activation

- **WHEN** the owner reads the enqueue receipt before execution and again after skill activation
- **THEN** its snapshot content and hashes are unchanged
- **AND** the activation items appear on the triggering user message rather than in a separate Run record

#### Scenario: Activation succeeds but request preparation fails

- **WHEN** activation results have been persisted but window fitting fails before provider dispatch
- **THEN** those observations remain in the owner message and no other staged item from that attempt is committed
- **AND** the immutable enqueue receipt is not changed

#### Scenario: The context-items endpoint is gone

- **WHEN** an owner requests `GET /api/v1/runs/:id/context-items` for their own Run
- **THEN** the API responds not found
- **AND** the items that Run sent remain readable on its messages

### Requirement: Workspace binding changes are rail-resident context items

Before resolving effective skill sources, explicit `$skill` activation, prompt imports, Workspace MCP clients or catalog, the `workspace` producer's items, or the accepted-turn `instructions` load, attempt preparation SHALL finish the Workspace binding re-check and any detach. A detaching attempt SHALL contribute no Workspace skill activation, `skill://` resolution, prompt imports, Workspace tools, or accepted-turn `instructions` item, SHALL stage no prompt-import instruction triggers, and SHALL still narrate the detach. When no `prompt-imports` item from an earlier attempt of the Run is persisted, prompt-import markers SHALL remain prose for that attempt. A `prompt-imports` item persisted by an earlier attempt of the Run SHALL remain on the user message and replay unchanged as stored text, without being re-read or removed; a non-detaching retry SHALL rebuild prompt-import triggers from its persisted resolved paths. Skill-catalog baseline content already frozen at acceptance in the accepted-turn transaction before worker preparation MAY still list Workspace skills for that attempt; the next accepted turn's skill-catalog notice SHALL remove them.

At each accepted user turn, accepted-turn preparation SHALL compare the Chat's current Workspace
root, or its absence, with the root last narrated to the Chat, or the absence of any narration. For
that comparison, the stored `workspace_told` SHALL be treated as null whenever its
`workspace_told_from` names a different checkpoint message than the Chat's latest
checkpoint row; when those identities
match, the stored told root is used. When the current and comparison roots differ, the `workspace`
producer SHALL emit a rail-resident item with form `snapshot`: it SHALL name the canonical root
and state that the Workspace selects a working root but does not confine host authority, or, when a
previously narrated root is no longer bound, it SHALL state that no Workspace is entered. A detach
reason persisted during attempt preparation SHALL be consumed from the Chat's persisted state, not
inferred from the current unbound state, by emitting a separate rail-resident item with form
`notice` in the same turn. The notice SHALL name that reason, and the persisted reason SHALL be cleared in the
dispatch transaction that commits that notice. The producer SHALL stage the narrated root,
or its absence, and the latest checkpoint message as `workspace_told` and `workspace_told_from`;
the attempt's dispatch transaction SHALL write both values, and the only other writers SHALL be the
retry reconciliation write below and a checkpoint's publication transaction, which advances `workspace_told_from` to name its own row and resets
the told root, so the state is not left suppressed by a narration the checkpoint
superseded. The `workspace` producer re-derives its snapshot after that
transaction commits and before the model step the checkpoint precedes, so the
re-established state takes effect for that very request rather than on a later
turn. That snapshot is staged like any other: the attempt the checkpoint preceded records
the re-narrated root and the checkpoint's identity in its own dispatch transaction,
so the next turn finds the root already told within the epoch whatever that Run's
outcome, and an attempt that fails before that transaction records neither value,
leaving its retry to re-derive the same snapshot.
Workspace state SHALL NOT be placed in the system prompt. A Workspace snapshot or notice SHALL persist its
exact item text, producer, and form on the triggering user message as a rail-resident part under the
ordinary owner-isolation rules.

A retry of a dispatched Run SHALL reuse its persisted `workspace` items and SHALL then compare the Chat's
current Workspace root, or its absence, with the stored `workspace_told`, which that Run's dispatch
transaction or an earlier retry's reconciliation write set; an earlier attempt's in-Run
`enter_workspace` or `exit_workspace`, or a detach, changes the binding without changing that value.
When `workspace_detach_reason` is set at that retry, whether its own binding re-check detached the
binding or an earlier attempt's detach was never narrated, the retry SHALL append the detach notice.
When the current state differs from `workspace_told`, the retry SHALL append the snapshot for the
current root, or the snapshot stating that no Workspace is entered, and, for a bound root on a
non-detaching attempt, the accepted-turn root `instructions` load that `instruction-files` defines,
which omits files already seen. These reconciliation items go immediately after the reused items and
ahead of the user text, under the exception `Co-occurring items have a total author-time order`
states, and the retry SHALL write `workspace_told` and consume the detach reason in its reconciliation
write before its first model request.

#### Scenario: Changed binding is narrated on the rail

- **WHEN** an accepted turn observes a Workspace binding different from the last state narrated to the Chat
- **THEN** a rail-resident `workspace` snapshot names the canonical root and states that host authority is not confined when the turn has a bound root, or states that no Workspace is entered only when a previously narrated root has been detached
- **AND** if preparation detached the binding, a separate rail-resident `workspace` notice consumes the persisted detach reason in every case; when `workspace_told` named no root, no snapshot is emitted, and the Workspace state is not added to the system prompt

#### Scenario: Unchanged binding is not repeated

- **WHEN** an accepted turn observes the same Workspace state already narrated in the active context epoch
- **THEN** the producer emits no duplicate state-change snapshot
- **AND** the already-narrated state remains the comparison state

#### Scenario: Compaction re-establishes Workspace state

- **WHEN** a checkpoint becomes active for a Chat that is still bound and its stored
  `workspace_told_from` names an earlier checkpoint message or is null
- **THEN** the first request the checkpoint precedes treats the told state as null
  for comparison and carries a snapshot re-establishing the current root
- **AND** the snapshot remains rail-resident rather than changing the system prompt
- **AND** that attempt's dispatch transaction records that root against the checkpoint's identity, so the next turn emits no second snapshot for the same root even when that Run fails

#### Scenario: A never-bound Chat receives no Workspace notice

- **WHEN** a Chat that has never been bound to a Workspace accepts a turn, including the first turn after a compaction
- **THEN** no `workspace` snapshot or notice is emitted

#### Scenario: Run context record includes the Workspace notice

- **WHEN** a Run sends a Workspace snapshot or detach notice in its first request
- **THEN** the Run's record of sent context, its triggering user message, carries each exact text with producer `workspace`, its form, and rail residency
- **AND** those parts remain subject to the ordinary owner-isolation rules

#### Scenario: Detach reason waits for a completed narration

- **WHEN** attempt preparation persists a detach reason and that attempt fails before its dispatch transaction commits
- **THEN** a retry consumes the reason from persisted Chat state and emits it as a separate `workspace` notice
- **AND** the reason remains persisted until a dispatch transaction commits the narrating notice, and is cleared there, while the Chat remains unbound

#### Scenario: A retry of a dispatched Run narrates a new detach

- **WHEN** a dispatched Run narrated a bound root, and its retry's binding re-check detaches that binding
- **THEN** the retry reuses the dispatched `workspace` items and appends the detach notice and the no-Workspace snapshot after them
- **AND** it clears the detach reason and writes the told state in one attempt-fenced write before its first model request

#### Scenario: A retry narrates a detach reason it did not cause

- **WHEN** a dispatched Run is retried while `workspace_detach_reason` is set and the retry's own binding re-check passes because the Chat is already unbound
- **THEN** the retry appends the detach notice naming that reason after the reused items
- **AND** it clears `workspace_detach_reason` in its attempt-fenced write before its first model request

#### Scenario: A retry after an in-Run entry narrates the new root

- **WHEN** a Run dispatches while the Chat is unbound, an attempt's `enter_workspace` binds `/work/app`, and the Run is then retried
- **THEN** the retry reuses the dispatched items and appends a snapshot naming `/work/app` and the root `instructions` load after them
- **AND** it writes `/work/app` as `workspace_told` in its reconciliation write before its first model request, so the next accepted turn emits no second snapshot

#### Scenario: A failed Run's Workspace narration is not repeated

- **WHEN** a turn's Workspace snapshot and detach notice commit in its dispatch transaction and its Run then fails
- **THEN** the next accepted turn finds the root already told and emits no second snapshot
- **AND** it emits no second detach notice for that reason

#### Scenario: Detach is ordered before Workspace contributions

- **WHEN** attempt preparation detaches a binding before the accepted turn resolves Workspace sources or tools
- **THEN** the turn contributes no Workspace skill activation, `skill://` resolution, or MCP tools
- **AND** its skill-catalog baseline content already frozen at acceptance MAY still list Workspace skills, while the next accepted turn's skill-catalog notice removes them
- **AND** it always emits the separate detach `notice`, while the snapshot stating that no Workspace is entered is emitted only when `workspace_told` names a root

#### Scenario: Detaching attempt without a persisted item leaves markers as prose

- **WHEN** attempt preparation detaches a Workspace binding before prompt imports run, the user text contains an import marker, and no `prompt-imports` item from an earlier attempt of the Run is persisted
- **THEN** no prompt import is produced for that attempt and no prompt-import instruction trigger is staged
- **AND** the marker remains prose for that attempt

#### Scenario: A persisted prompt-imports item replays on a detaching retry

- **WHEN** an earlier attempt persisted a `prompt-imports` item and a retry detaches before prompt imports run
- **THEN** the item remains on the user message and replays unchanged as stored text, without being re-read or removed
- **AND** no new prompt imports occur and no prompt-import instruction triggers are staged

## REMOVED Requirements

### Requirement: Successful Runs record the winning attempt's injected items

**Reason**: Every entry duplicated a persisted context part, and the record existed only for successful Runs while the transcript now keeps every item a Run dispatched whatever its outcome. The `runs.context_items` column and `GET /api/v1/runs/:id/context-items` are removed with it.

**Migration**: Read the items a Run sent from the persisted `data-context` parts on its user and assistant messages; clients of the endpoint receive not found. The non-erasure limitation for copied content moves to `An item is either persisted-literal or bind-time`.
