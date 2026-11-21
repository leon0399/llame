## MODIFIED Requirements

### Requirement: Workspace binding changes are rail-resident context items

Attempt preparation MUST finish the Workspace binding re-check and any detach first. It MUST then resolve effective skill sources, explicit `$skill` activation, prompt imports, Workspace MCP clients or catalog, `workspace` items, and the accepted-turn `instructions` load. A detaching attempt MUST contribute no Workspace skill activation, no `skill://` resolution, no prompt imports, no Workspace tools, and no accepted-turn `instructions` item. It MUST stage no prompt-import instruction triggers, and it MUST still narrate the detach.

When an earlier attempt of the Run stored accepted-turn items and dispatched, a detaching retry MUST keep those items unchanged and in place. It MUST store its detach narration after them, ahead of the user text, in its own dispatch transaction. That narration is the detach notice and the snapshot of the unbound state. When no `prompt-imports` item from an earlier attempt of the Run is persisted, prompt-import markers MUST stay prose for that attempt. A `prompt-imports` item from an earlier attempt of the Run MUST stay on the user message. It MUST replay unchanged as stored text, without a new read or a removal.

Every other accepted-turn item that an earlier attempt persisted, an accepted-turn `instructions` item included, MUST also stay and replay unchanged. A retry that does not detach MUST rebuild prompt-import triggers from its persisted resolved paths. Skill-catalog baseline content that the accepted-turn transaction froze before worker preparation can still list Workspace skills for that attempt. The skill-catalog notice of the next accepted turn MUST remove them.

At each accepted user turn, accepted-turn preparation MUST compare two states. The first is the current Machine and the current Workspace root or its absence. The second is the Machine and root last narrated to the Chat. The stored told state MUST count as absent when `workspace_told_from` names a checkpoint message other than the latest checkpoint row of the Chat. When those identities match, the stored told state is used. When the current state and the told state differ, the `workspace` producer MUST emit a rail-resident item with form `snapshot`:

- In a bound Chat, the snapshot MUST name the canonical root and its Machine. It MUST state that tools resolve bare and relative paths and `file:` locators there. It MUST state that the Workspace does not confine the authority of that Machine user.
- In an unbound Chat, the snapshot MUST state that no Workspace is entered. It MUST name the current Machine and state that tools resolve bare and relative paths and `file:` locators on it.

The snapshot MUST NOT name the worker that runs the Run.

A detach reason that attempt preparation persisted MUST come from the persisted state of the Chat, not from the current unbound state. The producer MUST emit it as a separate rail-resident item with form `notice` in the same turn. The notice MUST name that reason. The transaction that persists the narrating notice MUST clear the persisted reason, whatever the outcome of the Run.

The producer MUST compute the narrated Machine and root, and the latest checkpoint message, as the told state and `workspace_told_from`. The transaction that dispatches the first model request of an attempt MUST write both, whatever the outcome of the Run. The only other writer MUST be the publication transaction of a checkpoint. It advances `workspace_told_from` to its own row and resets the told state, so a narration that the checkpoint replaced does not suppress the next one. The `workspace` producer derives its snapshot again after that transaction commits and before the model step that the checkpoint precedes.

The state thus takes effect for that request and not on a later turn. That snapshot persists as any other does. The transaction that dispatches the request after the checkpoint stores it. That transaction records the narrated state and the identity of the checkpoint, whatever the outcome of the Run. The next turn thus finds the state already told within the epoch. The system prompt MUST NOT contain Workspace state or the current Machine.

#### Scenario: Changed binding is narrated on the rail

- **WHEN** an accepted turn observes a current Machine or a Workspace binding different from the last state narrated to the Chat
- **THEN** a rail-resident `workspace` snapshot names the canonical root and its Machine when the turn has a bound root
- **AND** with no bound root, the snapshot states that no Workspace is entered and names the current Machine
- **AND** if preparation detached the binding, a separate rail-resident `workspace` notice consumes the persisted detach reason
- **AND** the system prompt does not contain the Workspace state

#### Scenario: Unchanged binding is not repeated

- **WHEN** an accepted turn observes the same current Machine and Workspace state already narrated in the active context epoch
- **THEN** the producer emits no duplicate state-change snapshot
- **AND** the narrated state stays the comparison state

#### Scenario: A failed Run's Workspace snapshot is not repeated

- **WHEN** the dispatched request of a Run carried a `workspace` snapshot for root R on Machine `devl` and the Run then failed
- **THEN** the snapshot stays on the triggering user message, and that dispatch transaction recorded `devl` and R as the told state against the latest checkpoint
- **AND** the next accepted turn, with the binding still R in the same epoch, emits no `workspace` snapshot

#### Scenario: A detaching retry after a dispatched attempt narrates the detach once

- **WHEN** an earlier attempt of a Run stored a `workspace` snapshot for root R and an `instructions` item, dispatched, and failed
- **AND** the preparation of the retry detaches the binding
- **THEN** the retry keeps both stored items unchanged and in place
- **AND** it stores its detach notice and the snapshot of the unbound state after them in its own dispatch transaction
- **AND** that transaction records the unbound state as told and clears the detach reason, so the next turn emits neither item again

#### Scenario: Compaction re-establishes Workspace state

- **WHEN** a checkpoint becomes active for a Chat and its stored `workspace_told_from` names an earlier checkpoint message or is null
- **THEN** the first request after the checkpoint counts the told state as absent
- **AND** that request carries a snapshot of the current Machine and Workspace state
- **AND** the snapshot stays rail-resident and does not change the system prompt
- **AND** the transaction that dispatches that request records that state against the identity of the checkpoint, whatever the outcome of the Run
- **AND** the next turn emits no second snapshot for the same state

#### Scenario: A never-bound Chat receives no Workspace notice

- **WHEN** a Chat that was never bound to a Workspace accepts its first turn, or its first turn after a compaction
- **THEN** no `workspace` notice is emitted
- **AND** one `workspace` snapshot states that no Workspace is entered and names the current Machine

#### Scenario: Detach reason clears with its persisted narration

- **WHEN** attempt preparation persists a detach reason, and the attempt whose request carries the narrating notice fails afterward
- **THEN** the notice stays on the user message, and the transaction that stored it cleared the reason
- **AND** the next turn emits no second notice, and the Chat stays unbound

#### Scenario: Detach reason waits for a completed narration

- **WHEN** attempt preparation persists a detach reason, and that attempt fails before the request that carries the narrating notice dispatches
- **THEN** a retry consumes the reason from the persisted state of the Chat and emits it as a separate `workspace` notice
- **AND** the reason stays persisted until a dispatch transaction stores the narrating notice, and the Chat stays unbound

#### Scenario: Run context record includes the Workspace notice

- **WHEN** a Run sends a Workspace snapshot or detach notice in a model request
- **THEN** the triggering user message holds each exact text as a context-item part with producer `workspace` and its form
- **AND** the part stays subject to the ordinary owner-isolation rules

#### Scenario: Detach is ordered before Workspace contributions

- **WHEN** attempt preparation detaches a binding before the accepted turn resolves Workspace sources or tools
- **THEN** the turn contributes no Workspace skill activation, no `skill://` resolution, and no MCP tools
- **AND** skill-catalog baseline content that acceptance froze can still list Workspace skills, and the skill-catalog notice of the next accepted turn removes them
- **AND** it always emits the separate detach `notice` and the snapshot of the unbound state

#### Scenario: Detaching attempt without a persisted item leaves markers as prose

- **WHEN** attempt preparation detaches a Workspace binding before prompt imports run, and the user text contains an import marker
- **AND** no `prompt-imports` item from an earlier attempt of the Run is persisted
- **THEN** no prompt import is produced for that attempt and no prompt-import instruction trigger is staged
- **AND** the marker stays prose for that attempt

#### Scenario: A persisted prompt-imports item replays on a detaching retry

- **WHEN** an earlier attempt persisted a `prompt-imports` item and a retry detaches before prompt imports run
- **THEN** the item stays on the user message and replays unchanged as stored text, without a new read or a removal
- **AND** no new prompt imports occur and no prompt-import instruction triggers are staged

#### Scenario: A persisted instructions item replays on a detaching retry

- **WHEN** an earlier attempt persisted an accepted-turn `instructions` item and a retry detaches before the accepted-turn `instructions` load
- **THEN** the item stays on the user message and replays unchanged as stored text, without a new read or a removal
- **AND** the retry loads no new accepted-turn `instructions` item

#### Scenario: A changed default Machine is narrated in an unbound Chat

- **WHEN** an unbound Chat was told the current Machine `devl`, and the operator changes `machines.default` to `gpu` before the next accepted turn
- **THEN** that turn carries a `workspace` snapshot that states that no Workspace is entered and names `gpu`

#### Scenario: The snapshot does not name the worker

- **WHEN** the current Machine is `devl` and the worker that runs the attempt hosts `gpu`
- **THEN** the `workspace` snapshot names `devl` and does not name `gpu`
