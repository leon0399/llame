## MODIFIED Requirements

### Requirement: Server-authored context is injected as discrete items on one rail

Every server-authored contribution to a chat's model-visible conversation that is not part of the system prompt SHALL be injected as a **context item** on one rail. An item SHALL be rendered inside a single canonical `<system-reminder>` envelope, and SHALL NOT introduce a top-level delimiter name of its own.

A compaction checkpoint SHALL remain a rail context item with producer `compaction`, form `checkpoint`, and rail residency for envelope semantics. It SHALL NOT be a storage exception: its durable representation SHALL be an ordinary persisted `data-context` part on a `checkpoint` row, and replay SHALL convert that row to one user-role text message exactly as it converts every other persisted rail part. `model-system-prompts` SHALL own the row's coverage boundary and replay-selection contract.

The wire role SHALL remain `user`. A provider-level role for injected context SHALL NOT be invented, and items SHALL NOT be emitted as additional conversation messages of their own where a message already exists to carry them: items attached to a turn SHALL be carried inside that turn's triggering user message.

An item authored **between the model steps of one Run** — an in-Run item — has no user message to carry it. It SHALL be stored as a `data-context` part on that Run's assistant message, immediately after the last tool part of the step whose results triggered it, and SHALL be supplied to the model as a user-role text message placed after that step's last tool result on the step that follows the trigger and on every later step of the same Run at the same position. Within a Run, that placement SHALL be computed from the step's live model messages by removing any earlier copy of the item and inserting it after the tool-result message that carries the matching tool call, so that the result is identical whether or not the model client retains an earlier step's message override. It SHALL use the same envelope, framing, and vocabulary as an attached item. An in-Run item SHALL be persisted on that assistant message in the transaction that dispatches the model request first carrying it, whatever the Run's outcome, and every terminal outcome SHALL keep it after the last tool part of its triggering step.

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
- **AND** the item stays on the assistant message whatever the Run's outcome, and only a retry whose own request dispatches replaces that attempt's reply, removing the item together with that attempt's output in the retry's dispatch transaction

#### Scenario: A compaction checkpoint replaces history

- **WHEN** compaction publishes a checkpoint row for a superseded prefix
- **THEN** the row carries one persisted `data-context` part whose text is the
  complete final checkpoint envelope
- **AND** the envelope and stored part retain producer `compaction` and form
  `checkpoint`, and replay uses that stored text without metadata
  reconstruction

#### Scenario: A failed Run keeps the items it sent

- **WHEN** a Run's worker dies after its first model request carried accepted-turn items, including an instruction bundle
- **THEN** those items remain on the triggering user message after the Run settles as failed
- **AND** the next turn's request carries each stored item once and loads none of them again

#### Scenario: A retry keeps its stored accepted-turn items

- **WHEN** a retry of a Run starts after an earlier attempt dispatched a request carrying accepted-turn items
- **THEN** those items stay on the triggering user message unchanged and in place, and the retry's request carries each of them once
- **AND** the retry derives each accepted-turn producer again, treating the stored items and the told, seen, and baseline state their dispatch advanced as already told, so it authors no second `temporal` or model-switch item for the same turn and loads no stored instruction file again
- **AND** it stores only the items that comparison newly yields, after the last stored context item in producer order among its own new items, in its own dispatch transaction
- **AND** its preparation reads history only through the triggering user message, and the earlier attempt's assistant output and in-Run items are replaced only when the transaction that dispatches the retry's request resets the reply to `running`

#### Scenario: A retry that fails before dispatching changes nothing

- **WHEN** a retry of a Run fails before its own dispatch transaction commits, after an earlier attempt of the Run dispatched
- **THEN** the earlier attempt's assistant message, its output, its in-Run items, and the accepted-turn items it stored remain untouched
- **AND** the retry stores no item and advances no told or baseline state

Every persisted-literal rail item a model request carries SHALL be persisted in conversation history in the transaction that dispatches that request, whatever the Run's outcome: items triggered by the accepted user turn on the triggering user message before its first model request, items triggered by an assistant tool call on the Run's assistant message after the last tool part of the triggering step. The request SHALL carry exactly the stored text of those items, and an attempt whose dispatch transaction does not commit SHALL dispatch nothing. A retry of the same Run SHALL keep every item an earlier attempt's dispatch transaction stored on the triggering user message, unchanged and in place. It SHALL derive each accepted-turn producer again, treating those stored items and the told, seen, and baseline state their dispatch advanced as already told, and SHALL store only the items that comparison newly yields, after the last stored context item, in producer order among its own new items, and ahead of the user text, in its own dispatch transaction. This keep-and-append rule SHALL apply only to items an earlier attempt's dispatch transaction stored: a retry of a Run none of whose earlier attempts dispatched SHALL store every item it yields at its producer rank around the `prompt-imports` and `skill-activation` facts persisted before dispatch, as a first attempt does. A retry SHALL create or reset the Run's assistant message to `running` inside its own dispatch transaction, not before it reads history; its preparation SHALL read history only through the triggering user message, so its own assistant message never enters its request, and that reset SHALL remove a dead attempt's in-Run items together with that attempt's output. A retry that fails before its own dispatch SHALL leave the earlier attempt's assistant message, output, and items untouched. A failed, cancelled, expired, or superseded attempt's persisted items and its own persisted output remain part of the record as the user saw it and enter later model context like any other committed turn. Legitimate accepted-message facts remain persisted-literal; accepting a user message is not publishing a failed attempt's context. Committed parts retain the exact prepared text and existing envelope/order. A compaction checkpoint row and the epoch state published with it are not dispatch-transaction contributions: they commit in their own transaction before the model step they precede, and a later failure of that attempt SHALL NOT retract them.

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

When worker preparation adds attempt-owned items beside already persisted message facts, the final request SHALL apply this same producer order while preserving each producer's internal order and all user-authored content. The transaction that dispatches the first model request SHALL store that final ordering atomically on the triggering user message, placing each item at its producer rank around the `prompt-imports` and `skill-activation` facts persisted before dispatch. A retry of the same Run SHALL keep the ordering an earlier attempt's dispatch transaction stored unchanged and in place, and SHALL store each item it newly yields after the last stored context item, in producer order among its own new items and ahead of the user text, even when that item's producer ranks ahead of a stored item. A retry of a Run none of whose earlier attempts dispatched SHALL instead store every item at its producer rank, as a first attempt does.

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

#### Scenario: A retry's new item follows the stored items

- **WHEN** an earlier attempt of a Run stored `instructions` and `skill-catalog` items in its dispatch transaction, and a retry of the Run detaches the Workspace binding
- **THEN** the retry stores its `workspace` detach narration after the stored items and ahead of the user text, although `workspace` ranks ahead of `instructions`
- **AND** the stored items keep their positions and replay preserves the resulting order

#### Scenario: A retry of a Run that never dispatched orders items by producer rank

- **WHEN** an earlier attempt of a Run persisted a `prompt-imports` item and failed before its dispatch transaction committed, and a retry yields `workspace`, `instructions`, and `temporal` items
- **THEN** the retry's dispatch transaction stores the `workspace` and `instructions` items ahead of the `prompt-imports` item and the `temporal` item after it, as a first attempt does
- **AND** all of them precede the user text

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

### Requirement: A prefix change is announced only when history was conditioned on the old value

A change to prefix-resident content SHALL be **silent to the model by default**: the model reads the re-rendered prompt, so its content needs no announcement.

An announcement SHALL be injected as a rail item when the changed content is **assertional** — a fact the model may previously have denied, lacked, or answered around — because the conversation then contains turns that contradict the new prefix and the contradiction would otherwise be unexplained. An announcement SHALL NOT be injected when the changed content is **behavioral** — tone, format, working style, or comparable guidance — because the only history conditioned on it is the model's own prior output, which is not authoritative.

An announcement SHALL state that earlier turns predate the changed content and that they are not to be treated as contradicting it.

Disclosure to the **owner** SHALL be unconditional and independent of this rule: every change to the effective context SHALL be recorded for the owner whether or not it is announced to the model.

**This requirement is not yet satisfied for every prefix contribution, and the gap SHALL be stated rather than implied.** Only the model cause of an effective-context change is detected today; a personalization edit or an operator prompt reload changes prefix-resident content without producing an announcement, so an owner who supplies a fact the assistant previously said it lacked still leaves the conversation carrying an unexplained contradiction. Detecting the remaining causes requires the binder to record why it minted a new snapshot, which no shipped path does, and is owned separately. Likewise, the owner-disclosure clause is satisfied today only for changes that produce a rail item: a behavioral change renders nothing, and the owner reads a Run's injected context from the rail items persisted in conversation history, so history currently carries no entry for one. Both gaps are deferred rather than descoped — the rule stands as the contract the deferred work is written against, and a reader of this capability SHALL NOT infer that the assertional-announce branch is implemented.

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

Frozen per-chat digest and temporal baselines retain their owning lifecycles. This requirement SHALL not freeze owner-variable resolution, runtime tool catalogs, or descriptions across attempts. A Run SHALL count as **dispatched** when its stored availability record (`turn_tool_availability`) is not null, which the transaction dispatching its first model request writes even when the record is empty, or when its status is `completed`. Availability comparisons use the minimal id/state record of the most recent prior dispatched Run, whatever its outcome, within the current epoch; an attempt that dispatches no model request never establishes such a comparison baseline, and the epoch state a checkpoint publishes with itself survives the failure of the attempt it preceded. A new rail epoch SHALL begin when the active checkpoint's absorbed-through sequence is at or above the sequence of the most recent prior dispatched Run's triggering user message. That boundary SHALL NOT be decided by comparing checkpoint creation times, and SHALL NOT be read off the sequence of an assistant row, because a retried assistant row keeps its sequence below a checkpoint published between its attempts.

#### Scenario: A failed dispatched Run anchors the epoch boundary

- **WHEN** the most recent prior dispatched Run failed after dispatching, and the active checkpoint's absorbed-through sequence is at or above that Run's triggering user message
- **THEN** the next accepted turn begins a new rail epoch
- **AND** a Run accepted in between whose attempts dispatched no model request does not replace the failed Run as the most recent prior dispatched Run

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

An attempt-generated item intended for later conversation history SHALL be persisted as a persisted-literal part in the transaction that dispatches the model request first carrying it, and that request SHALL use its exact stored text. A failure of the attempt SHALL NOT discard it; only a retry's replacement of the attempt's non-completed assistant message, in the transaction that dispatches the retry's own request, removes that attempt's in-Run items, together with its output. A compaction checkpoint row is not a dispatch-transaction contribution: it is published with the epoch state it re-bakes before the step it precedes, and that state survives the attempt's failure. This persistence does not add a new wire-format item kind or permit a bind-time-only producer to persist into message history. Content copied from outside the chat SHALL remain non-erasable through deletion of its source once it has been written into a persisted message part; that limitation SHALL remain documented.

#### Scenario: A source of injected content is deleted

- **WHEN** a reminder copied content from another chat that is later deleted
- **THEN** the persisted reminder part remains unchanged
- **AND** the deletion limitation is not hidden

### Requirement: Worker-attempt cutover preserves existing conversation state

The dispatch-time persistence rule and the retention of failed-attempt output and rail items SHALL
apply to attempts executed after the coordinated runtime cutover. Cutover SHALL
preserve existing messages and reminders, digest baseline/told-set state, and
the epoch identity a live checkpoint publishes under, without rebuilding,
clearing, or adding
retrospective replay filters. Existing state SHALL retain its ordinary
compaction, digest, and owner-access rules. These prospective rules SHALL NOT
claim to remove failed pre-cutover Run contributions from existing history or
aggregates, and SHALL NOT backfill rail items that a pre-cutover failed attempt did
not publish. The separate system-receipt and tool-catalog storage migration
remains required and SHALL NOT authorize rewriting conversation state.

#### Scenario: An existing Chat crosses the worker-attempt cutover

- **WHEN** an existing Chat has stored reminders, an active checkpoint, and digest disclosure state
- **THEN** cutover preserves their contents and existing replay eligibility without reconstruction
- **AND** later compaction and digest updates follow their ordinary lifecycle

#### Scenario: A post-cutover attempt fails in an existing Chat

- **WHEN** a newly prepared attempt fails after cutover
- **THEN** its persisted partial output and every rail item its requests carried remain part of the record, and the digest and comparison state advanced in its dispatch transaction stay advanced
- **AND** pre-existing conversation state is not retrospectively filtered or reset

#### Scenario: A pre-cutover failed Run is not backfilled

- **WHEN** an existing Chat contains a Run that failed before cutover without publishing its rail items
- **THEN** cutover adds none of those items to its messages
- **AND** later turns derive their seen and told state from the history as stored

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

### Requirement: Catalog notices announce added and removed skills on the next user turn

At each accepted user turn that continues a compaction epoch and whose bound model's template references the `skills` namespace, the current proactively eligible catalog from that Chat's effective skill sources, bounded as for the baseline, SHALL be compared with the Chat's told state by name only; descriptions SHALL NOT participate in the comparison and an addition SHALL render the entry's current description. A turn bound to a model whose template does not reference `skills` SHALL emit no catalog notice and SHALL leave the told state unchanged. When entries were added or removed, one `skill-catalog` item with form `notice` SHALL be persisted listing added entries with name and description and removed entries by name, telling the model to read an added skill before applying it and not to apply a removed skill's earlier instructions, and carrying a precedence statement whenever a description is present. An eligibility flip or a promotion from the omitted portion SHALL render as an add or a remove. A changed description or changed instruction content of an entry that stays advertised SHALL NOT produce a notice in this change. Notices SHALL carry only bounded metadata, never instruction bodies. The told state SHALL be updated in the dispatch transaction that persists the notice, whatever the Run's outcome, and a dispatch transaction that does not commit SHALL expose none of those writes. The freeze of the first-epoch catalog baseline SHALL stay with the winning turn, because that baseline lives only in the system prompt. A retry of the Run SHALL follow the retry rule of the requirement that server-authored context is injected as discrete items on one rail: it treats a notice an earlier attempt's dispatch transaction stored, and the told state that transaction advanced, as already told.

When a delta would exceed the baseline bound, one `skill-catalog` item with form `snapshot` SHALL instead state that the catalog was refreshed and earlier updates are superseded, listing the bounded current set with its omitted count; the told state SHALL then equal that snapshot. No notice SHALL be injected between model requests inside an existing Run; a removed package fails its next read under current availability and its removal is announced on the next user turn.

#### Scenario: Catalog changes between user messages

- **WHEN** one skill is added and another removed after a user turn in the same epoch
- **THEN** the next user turn carries one notice naming the addition with its description and the removal by name
- **AND** the immutable effective-context receipt retains the frozen baseline while the notice is persisted on the user message

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
- **THEN** neither the notice nor the updated told state is visible, and no model request dispatches
- **AND** a retry produces one consistent notice without repeated or skipped catalog changes

#### Scenario: A failed Run's catalog notice is not repeated

- **WHEN** a Run's dispatched request carried a `skill-catalog` notice announcing an added skill and the Run then failed
- **THEN** the notice stays on the triggering user message and that dispatch transaction advanced the told state
- **AND** the next accepted turn in the same epoch, with the catalog unchanged, emits no catalog notice

#### Scenario: Workspace source changes affect only that Chat's delta

- **WHEN** a Chat enters a Workspace containing a skill that was absent from its effective sources, or detaches from a Workspace whose skill was previously effective, within the same compaction epoch
- **THEN** the next accepted turn compares the current effective catalog and announces the resulting addition or removal for that Chat
- **AND** another Chat without that Workspace binding compares only its own effective sources

### Requirement: Skill activations remain separate from immutable enqueue receipts

The enqueue-bound effective-context receipt SHALL retain its immutable prompt/tool snapshot and SHALL NOT be extended with post-claim activation results. Skill catalog notices and activations SHALL instead be persisted as rail items on the triggering user message, alongside all existing producers, under the owner-visibility rules that govern that message.

#### Scenario: Owner inspects before and after activation

- **WHEN** the owner reads the enqueue receipt before execution and again after skill activation
- **THEN** its snapshot content and hashes are unchanged
- **AND** the activation items are persisted on the triggering user message rather than in the receipt

#### Scenario: Activation succeeds but request preparation fails

- **WHEN** activation results have been persisted but window fitting fails before provider dispatch
- **THEN** those observations remain in the owner message
- **AND** the immutable enqueue receipt is not changed

### Requirement: Workspace binding changes are rail-resident context items

Before resolving effective skill sources, explicit `$skill` activation, prompt imports, Workspace MCP clients or catalog, the `workspace` producer's items, or the accepted-turn `instructions` load, attempt preparation SHALL finish the Workspace binding re-check and any detach. A detaching attempt SHALL contribute no Workspace skill activation, `skill://` resolution, prompt imports, Workspace tools, or accepted-turn `instructions` item, SHALL stage no prompt-import instruction triggers, and SHALL still narrate the detach. When an earlier attempt of the Run stored accepted-turn items and dispatched, a detaching retry SHALL keep those items unchanged and in place and SHALL store its detach narration (the detach notice and, when `workspace_told` names a root, the snapshot stating that no Workspace is entered) after them, ahead of the user text, in its own dispatch transaction. When no `prompt-imports` item from an earlier attempt of the Run is persisted, prompt-import markers SHALL remain prose for that attempt. A `prompt-imports` item persisted by an earlier attempt of the Run SHALL remain on the user message and replay unchanged as stored text, without being re-read or removed; every other accepted-turn item persisted by an earlier attempt of the Run, including an accepted-turn `instructions` item, SHALL likewise remain and replay unchanged. A non-detaching retry SHALL rebuild prompt-import triggers from its persisted resolved paths. Skill-catalog baseline content already frozen at acceptance in the accepted-turn transaction before worker preparation MAY still list Workspace skills for that attempt; the next accepted turn's skill-catalog notice SHALL remove them.

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
`notice` in the same turn. The notice SHALL name that reason, and the persisted reason SHALL be
cleared in the transaction that persists the narrating notice, whatever the Run's outcome. The producer SHALL compute the narrated root,
or its absence, and the latest checkpoint message as `workspace_told` and `workspace_told_from`;
the transaction that dispatches an attempt's first model request SHALL write
both values, whatever the Run's outcome, and the only other writer SHALL be a checkpoint's publication
transaction, which advances `workspace_told_from` to name its own row and resets
the told root, so the state is not left suppressed by a narration the checkpoint
superseded. The `workspace` producer re-derives its snapshot after that
transaction commits and before the model step the checkpoint precedes, so the
re-established state takes effect for that very request rather than on a later
turn. That snapshot is persisted like any other: the transaction that dispatches the
request the checkpoint precedes stores it and records the re-narrated root and
the checkpoint's identity, whatever the Run's outcome, so the next turn finds
the root already told within the epoch.
Workspace state SHALL NOT be placed in the system prompt.

#### Scenario: Changed binding is narrated on the rail

- **WHEN** an accepted turn observes a Workspace binding different from the last state narrated to the Chat
- **THEN** a rail-resident `workspace` snapshot names the canonical root and states that host authority is not confined when the turn has a bound root, or states that no Workspace is entered only when a previously narrated root has been detached
- **AND** if preparation detached the binding, a separate rail-resident `workspace` notice consumes the persisted detach reason in every case; when `workspace_told` named no root, no snapshot is emitted, and the Workspace state is not added to the system prompt

#### Scenario: Unchanged binding is not repeated

- **WHEN** an accepted turn observes the same Workspace state already narrated in the active context epoch
- **THEN** the producer emits no duplicate state-change snapshot
- **AND** the already-narrated state remains the comparison state

#### Scenario: A failed Run's Workspace snapshot is not repeated

- **WHEN** a Run's dispatched request carried a `workspace` snapshot for root R and the Run then failed
- **THEN** the snapshot stays on the triggering user message and that dispatch transaction recorded R as the told root against the latest checkpoint
- **AND** the next accepted turn, with the binding still R in the same epoch, emits no `workspace` snapshot

#### Scenario: A detaching retry after a dispatched attempt narrates the detach once

- **WHEN** an earlier attempt of a Run stored a `workspace` snapshot for root R and an `instructions` item, dispatched, and failed, and the retry's preparation detaches the binding
- **THEN** the retry keeps both stored items unchanged and in place and stores its detach notice and the snapshot stating that no Workspace is entered after them, in its own dispatch transaction
- **AND** that transaction records the absence as told and clears the detach reason, so the next turn emits neither item again

#### Scenario: Compaction re-establishes Workspace state

- **WHEN** a checkpoint becomes active for a Chat that is still bound and its stored
  `workspace_told_from` names an earlier checkpoint message or is null
- **THEN** the first request the checkpoint precedes treats the told state as null
  for comparison and carries a snapshot re-establishing the current root
- **AND** the snapshot remains rail-resident rather than changing the system prompt
- **AND** the transaction that dispatches that request records that root against the checkpoint's identity, whatever the Run's outcome, so the next turn emits no second snapshot for the same root

#### Scenario: A never-bound Chat receives no Workspace notice

- **WHEN** a Chat that has never been bound to a Workspace accepts a turn, including the first turn after a compaction
- **THEN** no `workspace` snapshot or notice is emitted

#### Scenario: Detach reason clears with its persisted narration

- **WHEN** attempt preparation persists a detach reason and the attempt whose request carries the narrating notice fails afterward
- **THEN** the notice stays on the user message and the reason is cleared in the transaction that stored it
- **AND** the next turn emits no second notice, while the Chat remains unbound

#### Scenario: Detach reason waits for a completed narration

- **WHEN** attempt preparation persists a detach reason and that attempt fails before the request carrying the narrating notice dispatches
- **THEN** a retry consumes the reason from persisted Chat state and emits it as a separate `workspace` notice
- **AND** the reason remains persisted until a dispatch transaction stores the narrating notice, while the Chat remains unbound

#### Scenario: Run context record includes the Workspace notice

- **WHEN** a Run sends a Workspace snapshot or detach notice in a model request
- **THEN** the triggering user message holds each exact text as a context-item part with producer `workspace` and its form
- **AND** the part remains subject to the ordinary owner-isolation rules

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

#### Scenario: A persisted instructions item replays on a detaching retry

- **WHEN** an earlier attempt persisted an accepted-turn `instructions` item and a retry detaches before the accepted-turn `instructions` load
- **THEN** the item remains on the user message and replays unchanged as stored text, without being re-read or removed
- **AND** the retry loads no new accepted-turn `instructions` item

## REMOVED Requirements

### Requirement: Successful Runs record the winning attempt's injected items

**Reason**: The per-Run item record duplicated the rail parts already persisted in conversation history, re-copied every rail item on each Run, and had no client reader. Every rail item a request carries is now persisted in messages when that request dispatches, so history is the record of what the model saw.

**Migration**: Read a Run's injected context from the persisted `data-context` parts of its triggering user message and its assistant message in effective history. An assistant message whose usage status is still `running` is omitted from owner-facing reads until it is finalized, so a Run's in-Run items become readable there when its reply is finalized; the live stream renders them meanwhile. The Run-level item record and its owner endpoint are removed without replacement; the non-erasure limitation for content copied from outside the chat now applies to persisted message parts.
