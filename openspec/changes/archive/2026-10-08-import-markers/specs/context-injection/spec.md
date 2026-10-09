## MODIFIED Requirements

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

When worker preparation adds attempt-owned items beside already persisted message facts, the final request SHALL apply this same producer order while preserving each producer's internal order and all user-authored content. Successful publication SHALL store that final ordering atomically; a failed attempt SHALL publish no staged rail items, while its own assistant output persists as the record of that turn.

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

### Requirement: Explicit activations are rail items carrying current instructions

Each explicit `$skill` selection SHALL produce one `skill-activation` item with form `notice` in the triggering user message before the first model request. A successful item SHALL state which mention selected the skill, the absolute skill directory and instructions file, the instruction to resolve package-relative references and scripts against that directory while keeping task-relative inputs and choosing `cwd` explicitly, a precedence statement, and the current `SKILL.md` instruction body with its frontmatter removed, taken from the raw read with its ordinary truncation indicator, followed by file blocks for package files imported by markers in that body in depth-first order. A failed selection SHALL produce a bounded item naming the mention and one closed reason from `not_found`, `unavailable`, `permission_denied`, and `read_failed`, without operator diagnostics in model text. Selections beyond the count, output, or work budget SHALL be accounted for by one bounded omission item listing their names.

Activation items SHALL use the existing canonical envelope, provenance, owner visibility, separate executed-context recording, stored-text replay, and author-time ordering. A completed explicit activation SHALL NOT be reloaded on recovery. Partial recovery SHALL preserve completed mention results and fill only unfinished selections in original order. Operator-supplied reserved delimiters SHALL be neutralized before composing and persisting activation text.

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
`notice` in the same turn. The notice SHALL name that reason, and the persisted reason SHALL be
cleared only when the Run that narrates it completes. The producer SHALL stage the narrated root,
or its absence, and the latest checkpoint message as `workspace_told` and `workspace_told_from`;
the same accepted-turn transaction that commits the successful turn SHALL write
both values, and the only other writer SHALL be a checkpoint's publication
transaction, which advances `workspace_told_from` to name its own row and resets
the told root, so the state is not left suppressed by a narration the checkpoint
superseded. The `workspace` producer re-derives its snapshot after that
transaction commits and before the model step the checkpoint precedes, so the
re-established state takes effect for that very request rather than on a later
turn. That snapshot is staged like any other: the successful turn the checkpoint
preceded records the re-narrated root and the checkpoint's identity in its own
accepted-turn transaction, so the next turn finds the root already told within
the epoch, and a failed attempt records neither value, leaving its retry to
re-derive the same snapshot.
Workspace state SHALL NOT be placed in the system prompt. Each successful Run that sends a
Workspace snapshot or notice SHALL include each exact item text, producer, form, and rail residency
in its owner-scoped Run context-item record under the existing recording rules.

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
- **AND** the successful turn records that root against the checkpoint's identity, so the next turn emits no second snapshot for the same root

#### Scenario: A never-bound Chat receives no Workspace notice

- **WHEN** a Chat that has never been bound to a Workspace accepts a turn, including the first turn after a compaction
- **THEN** no `workspace` snapshot or notice is emitted

#### Scenario: Run context record includes the Workspace notice

- **WHEN** a successful Run sends a Workspace snapshot or detach notice in its final request
- **THEN** the Run's owner-scoped context-item record contains each exact text with producer `workspace`, its form, and rail residency
- **AND** the record remains subject to the ordinary owner-isolation rules

#### Scenario: Detach reason waits for a completed narration

- **WHEN** attempt preparation persists a detach reason and that attempt fails before the Run narrating it completes
- **THEN** a retry consumes the reason from persisted Chat state and emits it as a separate `workspace` notice
- **AND** the reason remains persisted until the narration Run completes, while the Chat remains unbound

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
