## Purpose

Supply the current Project's identity and owner-authored guidance to a Chat without a Workspace dependency or a new source of tool authority.

## ADDED Requirements

### Requirement: Project context binds at execution preparation

Before the first model dispatch, a Run MUST resolve its Chat's current Project under the owner's identity. It MUST resolve no Project from message admission state. A failure before dispatch MUST freeze nothing. After dispatch, all attempts and segments of that Run MUST keep the selected Project context. A later Run MUST resolve current state again.

#### Scenario: A queued Run sees a move before execution

- **WHEN** a message enters the queue under Project A and the owner moves its Chat to B before execution preparation
- **THEN** the Run selects B's current identity, description, and instructions

#### Scenario: Preparation fails before dispatch

- **WHEN** preparation selects A but fails before dispatch and the owner then moves the Chat to B
- **THEN** the next attempt selects B

#### Scenario: An edit does not change a dispatched Run

- **WHEN** the owner edits instructions or moves the Chat after its Run dispatches
- **THEN** subsequent steps, segments, and recovery of that Run keep its selected context
- **AND** the next Run resolves the latest Project state

#### Scenario: A follow-up Run selects current context

- **WHEN** the owner starts Continue or Regenerate after a Project change
- **THEN** that new Run resolves the current Project context
- **AND** it preserves earlier stored items and appends the required supersession

### Requirement: Automatic Project context is independent of read eligibility

The system MUST supply automatic context for the selected Project even when native `read` is absent or denies Project locators. A Project resolution failure MUST fail Run preparation before model dispatch. The system MUST NOT continue with an assumed empty Project after a datastore error.

#### Scenario: Instructions apply without file tools

- **WHEN** the operator offers no `read` tool and a Chat belongs to a Project with instructions
- **THEN** the first model request carries that Project's context

#### Scenario: Read rejection does not suppress automatic context

- **WHEN** `read` policy rejects `projects://` locators
- **THEN** automatic context still supplies the current Project
- **AND** explicit Project reads follow that rejection

#### Scenario: Project resolution fails

- **WHEN** the worker cannot resolve the Chat's Project because its datastore read fails
- **THEN** preparation fails before any model request
- **AND** no context snapshot claims that the Chat has no Project

### Requirement: The project snapshot carries identity and additive guidance

The `project` producer MUST emit rail-only `snapshot` items. A bound item MUST contain the Project ID, name, description, literal instructions, and `projects://<id>`. It MUST label metadata as data and instructions as owner guidance additive with personalization. It MUST NOT derive repository inventories or checkout paths from registrations. It MUST distinguish Project affiliation from a Workspace binding.

#### Scenario: A Project needs no Workspace

- **WHEN** a Chat belongs to a Project but has no Workspace
- **THEN** its Project snapshot supplies the selected guidance
- **AND** it claims no Workspace binding

#### Scenario: Instructions are absent

- **WHEN** the selected Project has no instructions or description
- **THEN** its snapshot states those absences without sample text

#### Scenario: Project instructions cannot grant tools

- **WHEN** Project instructions request a tool or action that operator policy does not admit
- **THEN** the executable tool set and permission decisions remain unchanged

### Requirement: Project reminder state comes from reconstructed context

The producer MUST compare its selected rendering with its own latest item in reconstructed context of the active compaction epoch. It MUST use stored item text or payload for comparison. It MUST NOT use producer-specific told-state columns. A prior item from an in-Run position MUST count when it remains in reconstructed context.

#### Scenario: Unchanged Project context emits no duplicate

- **WHEN** the selected rendering equals the latest Project snapshot in the active epoch
- **THEN** preparation emits no duplicate Project snapshot

#### Scenario: An in-Run snapshot counts as told

- **WHEN** a surviving in-Run Project snapshot already supplies the selected context
- **THEN** the next preparation compares against that item
- **AND** it emits no duplicate snapshot

#### Scenario: A fork uses its own context

- **WHEN** an owner fork copies Project snapshots but inherits no Project affiliation
- **THEN** its first Run derives told state from copied items
- **AND** it supersedes inherited guidance with the absence of Project affiliation

### Requirement: Project snapshots explicitly supersede old guidance

A changed snapshot MUST retire earlier Project guidance without a history rewrite. Cleared instructions MUST lose their authority. A null Run selection with durable Project history MUST receive an absence snapshot under the epoch comparison rule. A null selection without Project history MUST receive no absence reminder.

#### Scenario: A Chat moves between Projects

- **WHEN** a new Run selects B after earlier context supplied A
- **THEN** its snapshot names B and states that all earlier Project guidance no longer applies

#### Scenario: Instructions are cleared

- **WHEN** a new Run selects a Project whose owner cleared previously supplied instructions
- **THEN** its snapshot explicitly retires those instructions

#### Scenario: Project deletion unfiles the Chat

- **WHEN** the owner deletes a Project whose context the Chat already received
- **THEN** a later Run states that no Project applies and retires the old guidance
- **AND** earlier private history remains unchanged

#### Scenario: A never-filed Chat gets no reminder

- **WHEN** a Chat has no Project and its durable history contains no Project context
- **THEN** the producer emits nothing

### Requirement: Compaction re-establishes the applicable Project context

The compaction instruction MUST exclude Project snapshots from its summary. After a checkpoint, the producer MUST re-establish applicable context for the first subsequent model request. A dispatched Run MUST retain its selection despite live edits, moves, unfiling, or deletion. A later Run MUST use its new selection and explicitly retire old guidance that can remain in history.

#### Scenario: Mid-Run compaction preserves the selected instructions

- **WHEN** a dispatched Run compacts after the owner changes Project instructions
- **THEN** its first request after compaction receives the Run's selected instructions
- **AND** no new instructions enter that Run through re-baseline

#### Scenario: Recovery follows a published checkpoint

- **WHEN** a worker dies after a checkpoint commits but before the next model dispatch
- **THEN** recovery re-establishes the same Run selection
- **AND** a later successful dispatch records the exact supplied snapshot

#### Scenario: The next Run sees a new epoch

- **WHEN** a new Run starts after compaction and selects a Project
- **THEN** its first model request carries a fresh Project snapshot

### Requirement: Project snapshots preserve private provenance

The producer MUST use the rail's neutralization, bounded-authority framing, persisted-text replay, and owner-only visibility. Project context MUST stay outside the system-only prompt receipt. A Project edit or deletion MUST NOT rewrite earlier context. Public shares, shared forks, ordinary exports, and search projections MUST NOT expose the snapshots or their private recovery data.

#### Scenario: Authored delimiters cannot forge another item

- **WHEN** a Project name, description, or instruction contains reserved reminder delimiters
- **THEN** neutralization keeps it inside the single Project item

#### Scenario: The owner inspects applied instructions

- **WHEN** the owner inspects a Run's supplied context
- **THEN** its persisted Project item shows the exact text sent
- **AND** its system-only prompt receipt does not claim to contain Project context

#### Scenario: A public viewer cannot read Project guidance

- **WHEN** a viewer opens a public share or creates a shared fork
- **THEN** no Project snapshot or private recovery data appears

#### Scenario: An instruction edit preserves history

- **WHEN** the owner replaces or clears Project instructions
- **THEN** earlier private context still records the text actually sent
- **AND** the system makes no claim of provider-side erasure

### Requirement: First dispatch durably records the selected context

First dispatch MUST atomically record the complete Project selection, even when no new snapshot emits. That record MUST survive checkpoints and reply replacement. It MUST NOT serve as reminder told state. A dispatch failure MUST publish neither the selection nor its new snapshot. Invalid recovery data MUST fail preparation before a model request.

#### Scenario: An unchanged selection survives recovery

- **WHEN** a Run emits no snapshot because the active epoch already contains identical context
- **AND** the worker later recovers that Run after compaction
- **THEN** recovery uses its original recorded selection without a live Project lookup

#### Scenario: A dispatch transaction rolls back

- **WHEN** the dispatch transaction fails after it stages Project selection and a snapshot
- **THEN** neither record commits and no model request starts

#### Scenario: Recovery data is invalid

- **WHEN** an existing dispatch record proves that the Run dispatched and its selected Project data is invalid or absent
- **THEN** preparation fails without a model request or a current-row substitute

### Requirement: Absence after compaction retires earlier Project guidance

After compaction, a Run with a null selection and durable Project history MUST receive an absence snapshot. It MUST retire earlier guidance even when the active epoch has no Project item. A null selection with no Project history MUST receive no absence reminder solely because a checkpoint exists.

#### Scenario: A summary can retain former instructions

- **WHEN** a checkpoint absorbs Project A's context and a later Run selects no Project
- **THEN** its first request receives an absence snapshot that retires earlier Project guidance

#### Scenario: Compaction does not invent affiliation

- **WHEN** a never-filed Chat publishes a checkpoint
- **THEN** the next Run emits no Project absence reminder

#### Scenario: Mid-Run unfiling does not clear the selection

- **WHEN** a Run selects A and dispatches before the owner unfiles its Chat or deletes A
- **AND** that same Run then compacts
- **THEN** the next request re-establishes A's selected context without an absence snapshot

### Requirement: Selection events remain private control metadata

The `run.project_bound` event MUST remain owner-only control metadata. Owner SSE consumers MUST accept it without assistant text, reasoning, or tool chunks. Public projections, shared forks, ordinary exports, search, and system-only prompt receipts MUST omit its payload. The event MUST NOT add model-visible content outside the normal `project` snapshot.

#### Scenario: A selection event produces no assistant output

- **WHEN** an owner SSE consumer receives a Run stream with a committed `run.project_bound` event
- **THEN** the consumer continues without an assistant text, reasoning, or tool chunk from that event
- **AND** the Project snapshot remains the only model-visible contribution of that selection

#### Scenario: Selection payload stays outside public projections and receipts

- **WHEN** a Run has a committed selection event and the owner reads its system-only prompt receipt
- **THEN** that receipt contains no selection-event payload
- **AND** public projections, shared forks, exports, and search contain none of that payload
