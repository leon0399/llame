## MODIFIED Requirements

### Requirement: Server-authored context is injected as discrete items on one rail

Every server-authored contribution to a chat's model-visible conversation that is not part of the system prompt SHALL be injected as a **context item** on one rail. An item SHALL be rendered inside a single canonical `<system-reminder>` envelope, and SHALL NOT introduce a top-level delimiter name of its own.

A compaction checkpoint SHALL remain a rail context item with producer `compaction`, form `checkpoint`, and rail residency for envelope and stored-metadata semantics. It SHALL NOT be a storage exception: its durable representation SHALL be an ordinary persisted `data-context` part on a `checkpoint` row, and replay SHALL convert that row to one user-role text message exactly as it converts every other persisted rail part. `model-system-prompts` SHALL own the row's coverage boundary and replay-selection contract.

The wire role SHALL remain `user`. A provider-level role for injected context SHALL NOT be invented, and items SHALL NOT be emitted as additional conversation messages of their own where a message already exists to carry them: items attached to a turn SHALL be carried inside that turn's triggering user message.

An item authored **between the model steps of one Run** — an in-Run item — has no user message to carry it. It SHALL be stored as a `data-context` part on that Run's assistant message, immediately after the last tool part of the step whose results triggered it, and SHALL be supplied to the model as a user-role text message placed after that step's last tool result on the step that follows the trigger and on every later step of the same Run at the same position. Within a Run, that placement SHALL be computed from the step's live model messages by removing any earlier copy of the item and inserting it after the tool-result message that carries the matching tool call, so that the result is identical whether or not the model client retains an earlier step's message override. It SHALL use the same envelope, framing, and vocabulary as an attached item. Before the step request that first carries an in-Run item, the item SHALL be recorded as an ordered `context.item` Run event of its attempt, and the Run's assistant message SHALL keep it at that position when the Run settles, whatever its outcome; a superseded attempt's in-Run items SHALL NOT enter the assistant message, like the rest of its output.

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

Worker-attempt contributions intended for conversation history SHALL be staged in memory and committed before the model request that first carries them, whatever the Run's outcome: turn-attached items in the triggering message, in-Run items as Run events that the Run's assistant message keeps. An attempt's turn-attached items, together with the seen and told state and the comparison records that account for them, SHALL commit in one **dispatch transaction**, fenced by the attempt identity and committed after request preparation and any pre-step checkpoint and before the attempt's first model request; a superseded attempt SHALL commit nothing, and an attempt that fails before that transaction SHALL commit no staged item. Each committed turn-attached part SHALL carry its Run id; a later attempt of the same Run SHALL reuse those parts verbatim as its turn-attached items, and no producer SHALL author another item, told-state update, or comparison record for that Run. The attempt's own persisted output remains part of the record as the user saw it and enters later model context like any other committed turn. Legitimate accepted-message facts remain persisted-literal. Committed parts retain the exact prepared text and existing envelope/order. A compaction checkpoint row and the epoch state published with it are not staged contributions: they commit in their own transaction before the model step they precede, and a later failure of that attempt SHALL NOT retract them.

#### Scenario: A failed Run keeps the items it dispatched

- **WHEN** a Run's first model request carries turn-attached items, a later step carries an in-Run item, and the Run then fails, is cancelled, expires, or ends with an unknown outcome
- **THEN** the turn-attached items remain on its triggering user message and the in-Run item remains on its assistant message at its step position
- **AND** the next turn replays them as stored text exactly as it replays a completed Run's items

#### Scenario: A retried attempt reuses its Run's items

- **WHEN** an attempt commits its dispatch transaction and the Run is then retried in a new attempt
- **THEN** the retry sends the turn-attached parts that carry its Run id unchanged
- **AND** no producer authors a second item, told-state update, or comparison record for that Run

#### Scenario: Preparation fails before dispatch

- **WHEN** request preparation fails before the attempt's dispatch transaction commits
- **THEN** no staged item, told state, or comparison record from that attempt is committed

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

When worker preparation adds attempt-owned items beside already persisted message facts, the final request SHALL apply this same producer order while preserving each producer's internal order and all user-authored content. The dispatch transaction SHALL store that final ordering atomically before the request that carries it, and the stored ordering SHALL stand whatever the Run's outcome.

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

#### Scenario: A failed Run keeps its stored order

- **WHEN** a model change, an availability change, and a temporal item accompany a user message whose Run then fails
- **THEN** the three items remain on that message in author-time order
- **AND** a retried attempt of that Run sends them in the same stored order without re-sorting

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

Frozen per-chat digest and temporal baselines retain their owning lifecycles. This requirement SHALL not freeze owner-variable resolution, runtime tool catalogs, or descriptions across attempts. Availability comparisons use the minimal id/state record of the most recent prior Run that committed one within the current epoch, whatever that Run's outcome; a Run none of whose attempts committed a dispatch transaction never establishes such a comparison baseline, and the epoch state a checkpoint publishes with itself survives the failure of the attempt it preceded. A new rail epoch SHALL begin when the active checkpoint's absorbed-through sequence is at or above the sequence of that baseline Run's triggering user message. That boundary SHALL NOT be decided by comparing checkpoint creation times, and SHALL NOT be read off the sequence of an assistant row, because a retried assistant row keeps its sequence below a checkpoint published between its attempts.

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
- **THEN** cutover does not reconstruct those items or advance any told state for them
- **AND** the next post-cutover turn compares against the state that was committed

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

At each accepted user turn that continues a compaction epoch and whose bound model's template references the `skills` namespace, the current proactively eligible catalog from that Chat's effective skill sources, bounded as for the baseline, SHALL be compared with the Chat's told state by name only; descriptions SHALL NOT participate in the comparison and an addition SHALL render the entry's current description. A turn bound to a model whose template does not reference `skills` SHALL emit no catalog notice and SHALL leave the told state unchanged. When entries were added or removed, one `skill-catalog` item with form `notice` SHALL be persisted listing added entries with name and description and removed entries by name, telling the model to read an added skill before applying it and not to apply a removed skill's earlier instructions, and carrying a precedence statement whenever a description is present. An eligibility flip or a promotion from the omitted portion SHALL render as an add or a remove. A changed description or changed instruction content of an entry that stays advertised SHALL NOT produce a notice in this change. Notices SHALL carry only bounded metadata, never instruction bodies. The notice and the told state SHALL be written in the attempt's dispatch transaction; a retried attempt of the Run SHALL reuse its persisted notice and state, and a rollback SHALL expose none of those writes.

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
the attempt's dispatch transaction SHALL write both values, and the only other writer SHALL be a checkpoint's publication
transaction, which advances `workspace_told_from` to name its own row and resets
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
exact item text, producer, form, and rail residency on the triggering user message under the
ordinary owner-isolation rules.

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
