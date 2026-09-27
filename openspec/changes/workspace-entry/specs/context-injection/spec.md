## MODIFIED Requirements

### Requirement: Residency determines whether a change re-renders the prompt or appends an item

Every context contribution SHALL be classified by **residency**:

- **prefix-resident** — re-supplied in full on every request as part of the system prompt. Updating it means re-rendering the prompt. It is cheap to read on every turn and expensive to change, because a change invalidates the cached prefix for the whole conversation.
- **rail-resident** — appended once as a context item and never re-sent. Updating it means appending another item. It is cheap to add and paid for in every later turn until compaction.
- **rail-only** — a small complete statement of current state whose re-statement after each compaction is cheaper than a prefix baseline. It MAY be kept only on the rail: a `snapshot` is emitted when the state changes and re-emitted after compaction, rather than adding it to the system prompt. The Workspace producer uses this class.

A new context surface SHALL be classified by this procedure:

1. A contribution that is an **account of something that happened** SHALL be rail-resident.
2. A contribution that is a **complete statement of current state** which changes **less often than compaction** SHALL be prefix-resident.
3. A complete statement of current state which changes **more often than compaction** SHALL be a frozen prefix-resident baseline plus rail-resident deltas, re-baked at compaction, unless it qualifies as rail-only under step 4. A frequently-changing complete statement SHALL NOT be placed in the prefix, because that forfeits prefix caching for the whole conversation on every change.
4. A small complete statement of current state whose re-statement after each compaction is cheaper than a prefix baseline MAY be rail-only, emitted as a `snapshot` on change and re-emitted after compaction.

Residency SHALL be recorded for every contribution in the per-run record required below, so that a later audit reads one list regardless of where a contribution lived.

#### Scenario: A new surface reports an event

- **WHEN** a new context surface reports that something occurred
- **THEN** it is rail-resident
- **AND** it is not added to the system prompt

#### Scenario: A new surface states rarely-changing state

- **WHEN** a new context surface states current state that changes less often than the chat is compacted
- **THEN** it is prefix-resident
- **AND** a change to it re-renders the prompt rather than appending an item

#### Scenario: A new surface states frequently-changing state

- **WHEN** a new context surface states current state that changes more often than the chat is compacted
- **THEN** it is a frozen prefix baseline with rail-resident deltas
- **AND** the baseline is re-resolved at compaction rather than on every change

#### Scenario: A new surface states compact current state

- **WHEN** a new context surface states a small complete statement of current state whose re-statement after each compaction is cheaper than a prefix baseline
- **THEN** it MAY be rail-only, with a `snapshot` emitted when the state changes
- **AND** the snapshot is re-emitted after compaction rather than changing the system prompt

### Requirement: The skill catalog is a frozen prefix baseline stored on the chat

The proactively eligible skill catalog for a Chat SHALL be computed from that Chat's effective skill sources, as defined by `agent-skills`, and SHALL be classified as a frozen prefix-resident baseline with rail-resident deltas. The baseline SHALL be the `skills` prompt projection defined by `model-system-prompts`: admitted entries in code-point name order, each with name and description, plus the count of proactively eligible entries omitted. Admission SHALL retain whole entries while the admitted count stays within 256 and the cumulative UTF-8 length of name and description stays within 16 KiB, so that template-owned per-entry markup cannot multiply the bound; omission SHALL be disclosed through that count whenever the baseline admits at least one entry, and the proactively eligible set SHALL remain inspectable through `read("skill://")` regardless.

The baseline and the names of the entries the Chat was last told SHALL be persisted on the Chat row under owner isolation, following the recency-digest precedent, together with the compaction identity under which the baseline was resolved. Accepted-turn preparation SHALL reuse the stored baseline only when a baseline is persisted and its recorded identity equals the Chat's latest compaction identity — a Chat that has never been compacted records both as absent and keeps reusing its first baseline — and SHALL otherwise resolve the current catalog from that Chat's effective skill sources and start a new baseline and told state in the same accepted-turn transaction as the user message and Run. No baseline SHALL be written for a Chat whose effective skill source set is empty. Package edits, model switches, and other prompt contributions SHALL NOT refresh the baseline. A transition compaction inside an already-bound Run SHALL leave that Run's bound prompt unchanged; the next accepted turn starts the refreshed baseline. Caller-supplied owner identifiers SHALL NOT authorize baseline or told-state reads or mutations.

The baseline SHALL enter the prompt only through the template projection. A template that does not reference `skills` SHALL render no catalog, and no server-rendered block SHALL be appended outside the template. Operator-authored descriptions SHALL be neutralized before composing the prompt or any item and SHALL replay from persisted text without another sanitization pass.

#### Scenario: Catalog is frozen within an epoch

- **WHEN** a package description changes or the model is switched between two user turns with no compaction between them
- **THEN** the next Run's prompt renders the stored baseline byte-for-byte
- **AND** the effective-context snapshot is reused rather than re-minted for that reason

#### Scenario: Compaction starts a new baseline

- **WHEN** a Chat is compacted after catalog notices have accumulated
- **THEN** the next accepted turn resolves the current catalog as its new baseline and told state
- **AND** old deltas are not applied again against that new baseline

#### Scenario: Transition compaction occurs inside a Run

- **WHEN** context fitting triggers compaction after a Run has bound its prompt
- **THEN** that Run keeps its bound skill baseline and the next user turn starts the refreshed baseline

#### Scenario: Operator template omits the namespace

- **WHEN** a model's template never references `skills`
- **THEN** its prompt carries no catalog and boot succeeds
- **AND** explicit `$skill` activation on that model still loads instructions through the rail

#### Scenario: Workspace sources contribute to a bound Chat's baseline

- **WHEN** a new baseline is resolved for a Chat bound to a Workspace containing a proactively eligible skill
- **THEN** that skill is included in the Chat's baseline subject to the ordinary admission bounds
- **AND** a Chat without that Workspace binding continues to resolve its baseline from its own effective sources

#### Scenario: Another owner targets catalog state

- **WHEN** owner A attempts to read or mutate owner B's Chat baseline or told state
- **THEN** datastore enforcement refuses access using the authenticated identity
- **AND** supplying owner B's identifier does not authorize the operation

### Requirement: Catalog notices announce added and removed skills on the next user turn

At each accepted user turn that continues a compaction epoch and whose bound model's template references the `skills` namespace, the current proactively eligible catalog from that Chat's effective skill sources, bounded as for the baseline, SHALL be compared with the Chat's told state by name only; descriptions SHALL NOT participate in the comparison and an addition SHALL render the entry's current description. A turn bound to a model whose template does not reference `skills` SHALL emit no catalog notice and SHALL leave the told state unchanged. When entries were added or removed, one `skill-catalog` item with form `notice` SHALL be persisted listing added entries with name and description and removed entries by name, telling the model to read an added skill before applying it and not to apply a removed skill's earlier instructions, and carrying a precedence statement whenever a description is present. An eligibility flip or a promotion from the omitted portion SHALL render as an add or a remove. A changed description or changed instruction content of an entry that stays advertised SHALL NOT produce a notice in this change. Notices SHALL carry only bounded metadata, never instruction bodies. The told state SHALL be updated in the same accepted-turn transaction; a retried accepted message SHALL reuse its persisted state and a rollback SHALL expose none of those writes.

When a delta would exceed the baseline bound, one `skill-catalog` item with form `snapshot` SHALL instead state that the catalog was refreshed and earlier updates are superseded, listing the bounded current set with its omitted count; the told state SHALL then equal that snapshot. No notice SHALL be injected between model requests inside an existing Run; a removed package fails its next read under current availability and its removal is announced on the next user turn.

#### Scenario: Catalog changes between user messages

- **WHEN** one skill is added and another removed after a user turn in the same epoch
- **THEN** the next user turn carries one notice naming the addition with its description and the removal by name
- **AND** the immutable effective-context receipt retains the frozen baseline while the executed-context record captures the notice

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

#### Scenario: Workspace source changes affect only that Chat's delta

- **WHEN** a Chat enters a Workspace containing a skill that was absent from its effective sources, or detaches from a Workspace whose skill was previously effective, within the same compaction epoch
- **THEN** the next accepted turn compares the current effective catalog and announces the resulting addition or removal for that Chat
- **AND** another Chat without that Workspace binding compares only its own effective sources

#### Scenario: Told-state transaction is interrupted

- **WHEN** the accepted-turn transaction fails before commit after preparing a catalog notice
- **THEN** neither the message, Run linkage, notice, nor updated told state is visible
- **AND** retry produces one consistent accepted turn without repeated or skipped catalog changes

### Requirement: Co-occurring items have a total author-time order

When more than one item is injected on the same turn, the authoring/request-preparation path SHALL persist them in a fixed producer precedence order, ahead of the triggering user text within the same message:

1. `effective-context-change`
2. `tool-availability`
3. `workspace`
4. `skill-catalog`
5. `skill-activation`
6. `recency-digest`
7. `temporal`

When one producer contributes more than one item, those items SHALL be stored in emission order. A producer added later SHALL extend this authoring list in the rail specification.

Replay SHALL preserve the stored part order. It SHALL NOT re-sort historical items through the current precedence list or merge adjacent text parts. The compaction checkpoint is carried by replacement history of its own and follows that capability's placement rule rather than this attached-item list.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, availability change, and chat-list change accompany one user message
- **THEN** their final text blocks are persisted in fixed author-time order
- **AND** every later replay preserves the stored order and part boundaries

#### Scenario: Workspace and skill catalog items share a turn

- **WHEN** a Workspace state change and an effective skill catalog change accompany one user message
- **THEN** the `workspace` item precedes the `skill-catalog` item and both precede the user text
- **AND** replay preserves those stored positions

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

## ADDED Requirements

### Requirement: Workspace binding changes are rail-resident context items

Before resolving effective skill sources, explicit `$skill` activation, Workspace MCP clients or catalog, or the `workspace` producer's items, attempt preparation SHALL finish the Workspace binding re-check and any detach. A detaching attempt SHALL contribute no Workspace skill activation, `skill://` resolution, or Workspace tools and SHALL still narrate the detach. Skill-catalog baseline content already frozen at acceptance in the accepted-turn transaction before worker preparation MAY still list Workspace skills for that attempt; the next accepted turn's skill-catalog notice SHALL remove them.

At each accepted user turn, accepted-turn preparation SHALL compare the Chat's current Workspace
root, or its absence, with the root last narrated to the Chat, or the absence of any narration. For
that comparison, the stored `workspace_told` SHALL be treated as null whenever its
`workspace_told_from` differs from the Chat's latest compaction identity; when those identities
match, the stored told root is used. When the current and comparison roots differ, the `workspace`
producer SHALL emit a rail-resident item with form `snapshot`: it SHALL name the canonical root
and state that the Workspace selects a working root but does not confine host authority, or, when a
previously narrated root is no longer bound, it SHALL state that no Workspace is entered. A detach
reason persisted during attempt preparation SHALL be consumed from the Chat's persisted state, not
inferred from the current unbound state, by emitting a separate rail-resident item with form
`notice` in the same turn. The notice SHALL name that reason, and the persisted reason SHALL be
cleared only when the Run that narrates it completes. The producer SHALL stage the narrated root,
or its absence, and the latest compaction identity as `workspace_told` and `workspace_told_from`;
the same accepted-turn transaction SHALL write both values, and the compaction path SHALL NOT
write Chat state. A Chat that has never been bound and has no narrated root SHALL receive no notice.
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

- **WHEN** a compaction becomes active for a Chat that is still bound and its stored
  `workspace_told_from` names an earlier compaction or is null
- **THEN** the next accepted turn treats the told state as null for comparison and emits a
  snapshot re-establishing the current root
- **AND** the snapshot remains rail-resident rather than changing the system prompt

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
