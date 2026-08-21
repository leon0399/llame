## MODIFIED Requirements

### Requirement: Co-occurring items have a total order

When more than one item is injected on the same turn, they SHALL render in a **fixed producer precedence order**, ahead of the triggering user text within the same message:

1. `effective-context-change`
2. `tool-availability`
3. `recency-digest`
4. `temporal`

This list governs items **attached to a turn**. A producer whose item is carried by a message of its own — the compaction checkpoint is the only one today — is ordered by its placement rule instead, and SHALL NOT be read as absent from the vocabulary merely because it is absent from this list. A checkpoint necessarily leads the history it supersedes, which is a stronger constraint than any precedence order could express.

A producer added later SHALL be appended to this list, and the list SHALL be extended in the rail's own specification rather than negotiated between producers.

When one producer contributes **more than one item** on the same turn, those items SHALL render in the order that producer emitted them, ahead of the next producer's items. Emission order is load-bearing within a producer: a supersession and a subsequent delta from the same producer are only interpretable in the order they occurred, since a delta rendered before the supersession that precedes it reads as already superseded. Producers SHALL NOT order themselves relative to each other, and an item SHALL NOT be merged into, or suppressed by, another item. Identical inputs SHALL therefore produce identical model-visible output.

#### Scenario: Several producers fire on one turn

- **WHEN** a model change, an availability change, and a chat-list change all occur before one user message
- **THEN** their items render in the fixed producer precedence order, each in its own envelope
- **AND** none is merged, reordered relative to the specification, or suppressed

#### Scenario: One producer contributes two items on one turn

- **WHEN** a producer emits a supersession and a later delta before the same user message
- **THEN** both render under that producer's slot in the order they were emitted
- **AND** the delta does not precede the supersession it follows

#### Scenario: A temporal item accompanies other items on one turn

- **WHEN** a turn carries both an availability change and the temporal item
- **THEN** the temporal item renders last among the attached items, immediately ahead of the user's visible text
- **AND** it renders in its own envelope like any other item
