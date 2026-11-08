## MODIFIED Requirements

### Requirement: Co-occurring items have a total author-time order

The system can inject more than one item on the same turn. The path that authors items and
prepares the request MUST then persist them in a fixed producer precedence order. They go before the triggering
user text in the same message:

1. `effective-context-change`
2. `regenerate`
3. `tool-availability`
4. `workspace`
5. `instructions`
6. `skill-catalog`
7. `skill-activation`
8. `prompt-imports`
9. `recency-digest`
10. `temporal`
11. `interrupted`

When one producer contributes more than one item, the system MUST store those items in emission
order. A producer added later MUST extend this author-time list in the rail specification. The
`interrupted` producer of `run-steering` attaches its item to a delivered message, before the
owner text.

In-Run items MUST be in the order of the model step that triggered them. In a step, they MUST be in
this same producer precedence. The system never sorts them again against the attached items of the
triggering user message.

Replay MUST keep the stored part order. It MUST NOT sort historical items again through the current
precedence list, and it MUST NOT merge adjacent text parts. A `checkpoint` row of its own carries
the compaction checkpoint, and it follows the placement rule of that capability, not this list of
attached items.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, an availability change, and a chat-list change come with one user message
- **THEN** their final text blocks persist in the fixed author-time order
- **AND** each later replay keeps the stored order and part boundaries

#### Scenario: One producer contributes two items on one turn

- **WHEN** one producer emits two items before the same user message
- **THEN** both persist in the emission order of the producer
- **AND** the system does not merge or suppress either item

#### Scenario: A temporal item accompanies other items on one turn

- **WHEN** a temporal item comes with another context item
- **THEN** the author path persists the temporal item last among the attached items
- **AND** replay keeps that stored position

#### Scenario: The precedence list changes later

- **WHEN** a later release adds a producer or changes the author-time precedence
- **THEN** new items follow the new author-time order
- **AND** the current messages keep their original stored order

When worker preparation adds attempt-owned items next to message facts that already persisted, the
final request MUST apply this same producer order. It MUST keep the internal order of each producer
and all user-authored content. The transaction that dispatches the first model request MUST store
that final order atomically on the triggering user message. It puts each item at its producer rank,
around the `prompt-imports` and `skill-activation` facts persisted before dispatch. A retry of the
same Run MUST keep the order that the dispatch transaction of an earlier attempt stored, unchanged
and in place. It MUST store each item that it newly yields after the last stored
context item and before the user text. Its own new items follow producer order. This applies also when the
producer of that item ranks before a stored item. A retry of a Run whose earlier attempts never
dispatched MUST instead store each item at its producer rank, as a first attempt does. When an earlier
Run of the triggering user message dispatched, a follow-up Run from `turn-actions` MUST follow the
rule of a retry after a dispatch.

#### Scenario: Workspace and skill catalog items share a turn

- **WHEN** a Workspace state change and an effective skill catalog change come with one user message
- **THEN** the `workspace` item comes before the `skill-catalog` item, and both come before the user text
- **AND** replay keeps those stored positions

#### Scenario: Workspace snapshot and root instructions share a turn

- **WHEN** an accepted turn sets up the Workspace snapshot again and stages the root instruction chain
- **THEN** the `workspace` item comes before the `instructions` item, and both come before any `skill-catalog` item

#### Scenario: Skill activation and prompt imports share a turn

- **WHEN** an explicit skill activation and prompt imports come with one user message
- **THEN** each `skill-activation` item comes before the `prompt-imports` item, and both come before the user text
- **AND** replay keeps those stored positions

#### Scenario: A retry's new item follows the stored items

- **WHEN** an earlier attempt of a Run stored `instructions` and `skill-catalog` items in its dispatch transaction
- **AND** a retry of the Run detaches the Workspace bind
- **THEN** the retry stores its `workspace` detach narration after the stored items and before the user text, although `workspace` ranks before `instructions`
- **AND** the stored items keep their positions, and replay keeps the order that results

#### Scenario: A retry of a Run that never dispatched orders items by producer rank

- **WHEN** an earlier attempt of a Run persisted a `prompt-imports` item and failed before its dispatch transaction committed
- **AND** a retry yields `workspace`, `instructions`, and `temporal` items
- **THEN** the dispatch transaction of the retry stores the `workspace` and `instructions` items before the `prompt-imports` item
- **AND** it stores the `temporal` item after it, as a first attempt does
- **AND** all of them come before the user text

#### Scenario: A Regenerate notice follows the stored items

- **WHEN** the first Run of a turn stored a `temporal` item and dispatched, and a Regenerate of that turn yields a `regenerate` notice
- **THEN** the Regenerate dispatch stores the notice after the `temporal` item and before the user text

#### Scenario: An interrupted item comes before the owner text

- **WHEN** a Run delivers an interrupt as a user message
- **THEN** the `interrupted` item is the last attached item of that message, before the owner text
