## MODIFIED Requirements

### Requirement: Server-authored context is injected as discrete items on one rail

Every server-authored contribution outside the system prompt MUST use one context item on one rail. Each item MUST use the canonical `<system-reminder>` envelope. A producer MUST NOT add its own top-level delimiter. Each item MUST occupy its own text block, separate from other items and owner text.

The provider wire role MUST remain `user`. The system MUST NOT invent a provider role. An accepted-turn item MUST attach to its triggering user message when that message can carry it. A producer without a triggering message MUST use its existing producer-owned message.

A compaction checkpoint MUST remain a rail item with producer `compaction` and form `checkpoint`. Its storage MUST be an ordinary `data-context` part on a checkpoint row. Replay MUST convert that part to one user-role message. Model-system-prompts MUST own its coverage and selection boundaries.

A recency-digest snapshot associated with a checkpoint MUST use a separate host-authored user-role message. That message MUST contain only its digest context item. Its payload MUST name the checkpoint. Both rows MUST commit atomically.

Replay MUST place the companion immediately after its checkpoint and before retained owner messages. No companion can enter the summary or start another Run. Duplicate publication MUST create no second companion.

An in-Run item MUST persist on the Run's assistant message immediately after its triggering step's last tool part. Its next and later steps MUST receive it as user-role text after that tool result. Live assembly MUST remove earlier copies and place one item after the matching tool-result message. That placement MUST remain independent of model-client override retention. The item MUST use ordinary envelope, provenance, and vocabulary rules.

The dispatch transaction of the first request with an in-Run item MUST persist it. Every terminal outcome MUST keep it. Only a retry or follow-up dispatch that resets the reply can remove it with that reply. A step-boundary compaction MUST absorb it once. It MUST NOT reappear outside the summary unless its producer defines a re-baseline snapshot.

A job item MUST NOT be an in-Run item. Run steering MUST deliver it through the owner's delivery message. Without an owner message, the host message MUST carry context items only and no text part. A host-started job-notice Run MUST use that same rule.

Ordinary persisted-literal items MUST commit in request dispatch before model I/O, regardless of the later outcome. A dispatch transaction that fails MUST send nothing. Accepted-turn items MUST precede the owner's text. The request MUST use their exact stored text.

A retry MUST keep earlier dispatched accepted-turn items unchanged and in place. It MUST derive each producer again against effective stored context. That comparison MUST count prior committed disclosure, seen state, and baseline items. Persist only newly derived items after the last stored item and before owner text. Order those new items by producer rank. A retry without earlier dispatch MUST use normal first-attempt ranks, relative to accepted prompt imports and skill activations.

Follow-up Runs MUST follow the same keep-and-append rule. They MUST reuse accepted prompt imports and skill activations without another read or activation. Regenerate MUST remove prior model-switch items with cause `model` on its first dispatch. It MUST then append only the model switch its own comparison yields. Retry of that Regenerate MUST keep the newly stored switch.

Retry preparation MUST read ordinary history only through its triggering user message. It MUST also load the effective checkpoint and its associated companion. Its own reply MUST NOT enter that request. Only its dispatch can create or reset the reply to `running`. That reset MUST remove the dead attempt's output and in-Run items. Pre-dispatch failure MUST leave those records unchanged.

Preparation MUST also load an imported digest baseline associated with the effective epoch start, irrespective of its storage sequence. For the latest pre-conversion turn, retry and follow-up preparation MUST load its imported comparison notice. This notice MUST retain its distinct logical boundary. It MUST NOT enter an earlier fork through the baseline association.

Failed, cancelled, expired, or superseded output and items MUST remain historical records until an authorized follow-up resets the reply. Later turns MUST replay them like other committed history. Acceptance of an owner message MUST NOT publish a failed attempt's uncommitted context. Checkpoints, their companions, and epoch state MUST publish before the next model step, outside ordinary dispatch. A later attempt failure MUST NOT retract them.

#### Scenario: Regenerate retains imported epoch context

- **WHEN** an owner regenerates the latest unabsorbed turn after digest conversion
- **THEN** its request retains the imported epoch baseline and comparison notice despite their higher storage sequences
- **AND** disabled sharing neither loses the baseline nor resolves a fresh one

#### Scenario: Two items are injected on one turn

- **WHEN** the system injects two context items before a user's message
- **THEN** each item is in its own `<system-reminder>` envelope in its own text content block
- **AND** the visible text of the user is in a further block of the same message
- **AND** the system creates no additional conversation message

#### Scenario: A turn carries no injected item

- **WHEN** a turn has no context item to inject
- **THEN** the user message carries only the visible text of the user
- **AND** its serialized form is the same as the form of a turn from before this capability

#### Scenario: An item is not attached to a turn

- **WHEN** the producer of an item has no triggering user message to attach to
- **THEN** the message that its producer already owns carries the item
- **AND** the item uses the same envelope, frame, and vocabulary as an attached item

#### Scenario: An in-Run item follows its triggering tool result

- **WHEN** a producer authors an item after a tool result inside a Run
- **THEN** the system stores the item on the assistant message of the Run after that tool part
- **AND** each later model step of that Run receives it as a user-role message directly after that tool result
- **AND** the item stays on the assistant message whatever the outcome of the Run, until a dispatch replaces the reply
- **AND** only the dispatch of a retry of the same Run, or of a follow-up Run from `turn-actions`, replaces the reply
- **AND** that reset removes the item together with the output of that attempt

#### Scenario: A compaction checkpoint replaces history

- **WHEN** compaction publishes a checkpoint row for a superseded prefix
- **THEN** the row carries one persisted `data-context` part whose text is the complete final checkpoint envelope
- **AND** the envelope and the stored part keep producer `compaction` and form `checkpoint`, and replay uses that stored text with no rebuild from metadata

#### Scenario: A failed Run keeps the items it sent

- **WHEN** the worker of a Run dies after the first model request of the Run carried accepted-turn items, with an instruction bundle
- **THEN** those items stay on the triggering user message after the Run settles as failed
- **AND** the request of the next turn carries each stored item once and loads none of them again

#### Scenario: A retry keeps its stored accepted-turn items

- **WHEN** an earlier attempt dispatches accepted-turn items before a retry
- **THEN** the retry keeps their stored text once and compares against their effective disclosure
- **AND** it appends only newly derived items in producer order
- **AND** only retry dispatch resets the prior assistant output and in-Run items

#### Scenario: A retry that fails before dispatching changes nothing

- **WHEN** a retry of a Run fails before its own dispatch transaction commits, after an earlier attempt of the Run dispatched
- **THEN** the assistant message, the output, the in-Run items, and the stored accepted-turn items of the earlier attempt stay unchanged
- **AND** the retry stores no item and advances no told or baseline state

#### Scenario: A follow-up Run keeps the turn's stored items

- **WHEN** the first Run of a turn stored a `temporal` item and failed, and the owner regenerates the turn
- **THEN** the request of the Regenerate Run carries the stored `temporal` item unchanged
- **AND** the triggering user message holds one `temporal` item

#### Scenario: A follow-up Run appends a new availability change

- **WHEN** an operator enables a new tool after the first Run of a turn dispatched, and the owner continues the turn
- **THEN** the Continue Run compares tool availability with the first Run
- **AND** it stores one `tool-availability` item after the last stored context item of the triggering user message

#### Scenario: A Regenerate replaces the model-switch item

- **WHEN** the first Run of a turn stored a model-switch item from model `A` to model `B`
- **AND** the owner regenerates the turn with model `A`, the model of the prior reply
- **THEN** the dispatch transaction of the Regenerate Run removes that item from the triggering user message
- **AND** the Regenerate request carries no model-switch item

#### Scenario: A follow-up Run reuses prompt imports and skill activations

- **WHEN** the triggering user message has an import marker and a `$skill` mention, and its first Run stored a `prompt-imports` item and a `skill-activation` item
- **AND** the owner regenerates the turn
- **THEN** the Regenerate Run reads no import target again and stores no second `prompt-imports` or `skill-activation` item
- **AND** its request carries the stored items once

#### Scenario: A job item between two steps gets a host message

- **WHEN** a job settles between two model steps of a Run, and no owner item awaits delivery
- **THEN** the `job` item is stored on a new host message, and not on the assistant message of the Run
- **AND** the next segment of the Run answers that host message

#### Scenario: A continue message holds only context items

- **WHEN** a Run compacts mid-turn and continues with a host message
- **THEN** that host message holds a `compaction` context item and no text part

#### Scenario: A digest companion survives a failed compacting attempt

- **WHEN** a checkpoint and its companion commit before an attempt fails
- **THEN** both remain effective for retry
- **AND** replay places one companion immediately after the checkpoint

### Requirement: Residency determines whether a change re-renders the prompt or appends an item

Each contribution MUST have a residency class. Prefix-resident content MUST enter the system prompt in full on every request. Rail-resident events MUST enter as persisted items. Rail-only state MUST use snapshots and notices, not system-prompt content.

An event MUST be rail-resident. Rarely changed complete state MUST be prefix-resident unless its owning capability specifies rail-only residency. Frequently changed complete state MUST use a frozen prefix baseline with rail deltas, unless its owning capability specifies rail-only snapshots. Compact state can use rail-only snapshots after each checkpoint.

The Workspace and recency-digest producers MUST be rail-only. The digest MUST use one baseline snapshot per epoch plus bounded notices. Its companion snapshot MUST follow checkpoint publication. Residency MUST NOT create a second system-prompt carrier. Checkpoint re-baseline state MUST affect the request the checkpoint precedes and survive later attempt failure.

#### Scenario: A new surface reports an event

- **WHEN** a new context surface reports that something occurred
- **THEN** it is rail-resident
- **AND** it is not added to the system prompt

#### Scenario: A new surface states rarely-changing state

- **WHEN** a new context surface states current state that changes less often than the chat publishes checkpoints
- **THEN** it is prefix-resident unless its capability specifies rail-only residency
- **AND** a change to it re-renders the prompt rather than appending an item

#### Scenario: A new surface states frequently-changing state

- **WHEN** a new context surface states current state that changes more often than the chat publishes checkpoints
- **THEN** it follows its capability residency, with a frozen prefix baseline or rail-only snapshots and notices
- **AND** the baseline is re-resolved when a checkpoint is published rather than on every change

#### Scenario: A new surface states compact current state

- **WHEN** a new context surface states a small complete statement of current state whose re-statement after each checkpoint is cheaper than a prefix baseline
- **THEN** it can be rail-only, with a `snapshot` emitted when the state changes
- **AND** the snapshot is re-emitted after a checkpoint rather than changing the system prompt

### Requirement: Compaction is the rail's re-baseline boundary

A published checkpoint MUST be the rail re-baseline boundary. A delta producer MUST establish a new epoch instead of comparison across the boundary. Frozen prefix baselines MUST retain their owning lifecycle. Rail-only producers MUST re-establish state outside the summary for the request the checkpoint precedes.

The checkpoint, its companion snapshot, and epoch state MUST commit before that request. A later attempt failure MUST NOT retract them. Retry MUST reuse them. Enabled digest compaction MUST refresh its selection. Disabled digest compaction MUST carry only the frozen baseline without source reads.

The summary instruction MUST exclude standing context and every recency-digest item. This semantic exclusion MUST rely on model compliance, not a claim of structural erasure.

Runtime tool catalogs, descriptions, and owner-variable resolution MUST retain their per-attempt lifecycle. A Run MUST count as dispatched when `turn_tool_availability` is non-null or its status is completed. An empty stored record MUST count. Availability comparison MUST use the most recent prior dispatched Run within the current epoch, regardless of outcome. A non-dispatched attempt MUST establish no baseline. The active checkpoint boundary MUST still determine that epoch.

A new epoch MUST begin when the active absorbed boundary reaches the triggering user sequence of the last prior dispatched Run. The worker MUST NOT compare checkpoint UUID inequality as the epoch test. A baseline from an absorbed source Run MUST NOT survive merely because an unexecuted Run copied another checkpoint id.

The epoch test MUST NOT use checkpoint creation time or the assistant reply sequence. An in-place retry can retain its reply below a newer checkpoint.

#### Scenario: A delta producer crosses a compaction

- **WHEN** a checkpoint is published before a model step
- **THEN** a delta producer establishes a fresh baseline for that very request rather than comparing against pre-checkpoint state
- **AND** no transition is reported across the boundary

#### Scenario: A frozen baseline crosses a compaction

- **WHEN** a chat with a frozen prefix baseline publishes a checkpoint
- **THEN** the baseline is re-resolved in the same transaction, before the model step that follows
- **AND** it is not re-resolved by any other event

#### Scenario: A failed dispatched Run anchors the epoch boundary

- **WHEN** the most recent prior dispatched Run failed after dispatching, and the active checkpoint's absorbed-through sequence is at or above that Run's triggering user message
- **THEN** the next accepted turn begins a new rail epoch
- **AND** a Run accepted in between whose attempts dispatched no model request does not replace the failed Run as the most recent prior dispatched Run

### Requirement: Packaged item templates render from producer-owned values only

A packaged item template MUST receive only its producer payload and view values derived in that module. Those values can include closed-kind booleans, reason labels, and plural forms. Prefix projections MUST NOT enter that context. This includes owner, skill, and web-search projections. The digest producer MUST use only its own entries and comparison data.

`model`, `context`, and `tools` MUST remain reserved producer-value names. The temporal item MUST use its stored instant and zone, not the prefix anchor. Packaged item templates MUST remain separate from replaceable templates. The retired `chats.*` namespace MUST NOT exist as a supplied prefix projection.

#### Scenario: Owner personalization is not renderable in an item

- **WHEN** a packaged item references a per-user profile or identity path absent from its own values
- **THEN** that reference renders empty
- **AND** no prefix profile or identity enters the item

#### Scenario: The prefix digest projection is not renderable in an item

- **WHEN** a packaged item references an absent `chats.*` value
- **THEN** that reference renders empty without a prefix lookup
- **AND** digest content reaches the rail only through its producer payload

#### Scenario: A closed reason code renders its label

- **WHEN** the producer derives a human label for its closed reason code
- **THEN** the item renders that label
- **AND** it does not emit the internal code

### Requirement: Worker-attempt cutover preserves existing conversation state

The coordinated cutover MUST preserve messages, literal reminders, checkpoints, epoch identity, and historical observations. It MUST add no retrospective replay filter or failed-attempt reconstruction. Post-cutover attempts MUST retain dispatched partial output and items under the ordinary lifecycle.

The digest-column retirement MUST use the explicit chat-recency-digest conversion rules. That conversion can omit only unprovable derived fields under Q11. It MUST preserve source parts and receipts and report omissions privately. Removing columns MUST NOT authorize a Chat reset or lost message. Other receipt/catalog migrations MUST confer no permission to rewrite history.

#### Scenario: An existing Chat crosses the worker-attempt cutover

- **WHEN** a Chat has literal reminders, a checkpoint, and digest state
- **THEN** cutover preserves its records and converts proven digest fields under the explicit migration rules
- **AND** it privately reports only unprovable derived omissions
- **AND** later compaction and updates follow the new rail lifecycle

#### Scenario: A post-cutover attempt fails in an existing Chat

- **WHEN** an attempt fails after dispatch under the new runtime
- **THEN** its stored output, items, and committed disclosure remain part of history
- **AND** the failure causes no retrospective reset of earlier state

#### Scenario: A pre-cutover failed Run is not backfilled

- **WHEN** an old failed Run never published its items
- **THEN** cutover invents none of those items
- **AND** later production uses stored effective history
