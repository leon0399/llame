## ADDED Requirements

### Requirement: Every user message carries the time its turn was received

Alongside the frozen anchor, the system SHALL attach to **every user message** a temporal row stating when that turn was received, so the conversation the model reads is a dated timeline rather than an undated sequence.

The row SHALL be attached unconditionally, to every user turn, and SHALL NOT be gated on elapsed time, on drift from the anchor, or on any other condition. A gate would make a row's absence load-bearing — indistinguishable from the feature being absent — and would break the uniformity that lets the model read intervals between turns by comparison.

The row SHALL be attached to the user message itself, ahead of that message's visible text. Assistant messages SHALL NOT carry one: an assistant turn's timing is bounded by the user turns around it, and stamping it would double the cost to state something already derivable.

The row SHALL NOT be placed in the system prompt. A per-turn value ahead of the cached prefix forfeits prefix caching for the whole conversation, which is the constraint that produced the frozen anchor.

#### Scenario: A turn is persisted

- **WHEN** a user message is accepted
- **THEN** it carries exactly one temporal row
- **AND** the row precedes that message's visible text

#### Scenario: Two messages are sent seconds apart

- **WHEN** a user sends a second message immediately after the first
- **THEN** both carry their own row
- **AND** neither is suppressed for being close to the other

#### Scenario: The model reads an interval

- **WHEN** a conversation contains turns separated by a long gap
- **THEN** every turn on both sides of the gap carries a row
- **AND** the interval is derivable by comparing them

### Requirement: The row is immutable once written and identical on every replay

The row SHALL be **persisted with the turn it belongs to**, and its stored form SHALL carry the semantics needed to render it — the instant and the timezone it is to be rendered in — so that rendering consults neither the clock nor the process environment.

A rendered row SHALL therefore be **byte-identical across every request that replays that turn**, for the life of the turn. This is the property that makes the surface free: no message's serialized form changes between requests, so provider-side prefix caching is unaffected, and history reconstruction reproduces the conversation without a special case.

A later change to the instance's timezone SHALL NOT retroactively re-render an existing row. The row records how that turn was stated at the time, which remains true.

#### Scenario: A conversation is replayed

- **WHEN** a request is assembled for a chat whose turns each carry a row
- **THEN** every row renders exactly as it did when the turn was new
- **AND** no row's text depends on when the replay happened

#### Scenario: The instance timezone changes

- **WHEN** the instance is reconfigured to a different timezone and an existing chat continues
- **THEN** existing rows render unchanged
- **AND** only turns received after the change carry the new timezone

#### Scenario: A chat is forked

- **WHEN** a chat is forked, copying its turns
- **THEN** the copied turns carry their original rows
- **AND** the rows state when the original turns were received

### Requirement: The row states receipt, and only the anchor and the newest row approximate the present

The row SHALL be phrased as **when that turn was received by the system**. It SHALL NOT be phrased as the current time, for two independent reasons: a row that survives replay would be asserting a present instant that has passed, and a row whose wording changed once it stopped being the newest turn would forfeit the byte-identity that this surface depends on.

The instant SHALL be the one at which the turn was accepted. Under a queue delay, a retry, or a long tool loop the model may read the row measurably later than that; the row remains true, because it states receipt rather than the present.

The row SHALL be rendered entirely from values the system itself authored. It therefore SHALL NOT be required to carry a precedence statement, and SHALL remain a single line so the per-item framing it sits under stays worth reading.

#### Scenario: Anchor and rows render together

- **WHEN** a request carries the frozen anchor and the conversation's rows
- **THEN** the anchor states when the conversation's context was established and states that it is not the current time
- **AND** each row states when its turn was received
- **AND** neither claims to state the present instant

#### Scenario: A run executes long after it was enqueued

- **WHEN** a run executes after a queue delay or a retry
- **THEN** its turn's row states when the turn was accepted
- **AND** the row is not re-stated or corrected to the time of execution

### Requirement: Temporal readings share one format, and the system's own readings share one timezone

The row SHALL use the same rendered shape as the anchor: absolute, carrying a numeric UTC offset, and accompanied by the IANA identifier of the zone it is expressed in. Offset and identifier SHALL be produced from a single formatting operation over one instant, so the two cannot disagree.

The row and the anchor SHALL be expressed in the **instance's own local timezone**, resolved once where the turn is accepted and carried with the row thereafter. Rendering SHALL NOT re-resolve it, so a process that renders a conversation cannot disagree with the process that accepted it.

A further temporal reading — a reading of the same instant in a user's stored timezone — SHALL be an additional labeled line of the same row, rendered from the same stored instant. A second temporal block SHALL NOT be introduced.

#### Scenario: The instance runs in a non-UTC timezone

- **WHEN** a turn is accepted on an instance whose local timezone is not UTC
- **THEN** its row is expressed in that timezone with that zone's numeric offset for that instant and that zone's IANA identifier
- **AND** it matches the shape the anchor renders

#### Scenario: A further reading is added later

- **WHEN** a further temporal reading is introduced
- **THEN** it renders as another labeled line of the same row, from the same stored instant
- **AND** no second temporal block appears in the conversation

### Requirement: Rows are superseded with the turns they annotate

A row SHALL be treated as part of the turn it is attached to. When a compaction checkpoint supersedes a turn, that turn's row SHALL be superseded with it and SHALL NOT be re-stated.

No exclusion instruction SHALL be added to compaction on the row's behalf. The row is per-turn historical fact rather than standing context re-supplied on every request, so the reason the personalization, digest, and anchor exclusions exist does not apply: a summary that records the span a conversation covered is recording something true and durable.

#### Scenario: A chat is compacted

- **WHEN** a checkpoint supersedes a chat's earlier turns
- **THEN** the rows on those turns are superseded with them
- **AND** the rows on turns after the checkpoint are unaffected

#### Scenario: The summarizing model reads the rows

- **WHEN** a summarizing request is assembled from turns carrying rows
- **THEN** the rows are present as ordinary conversation content
- **AND** the compaction instruction carries no clause about them

### Requirement: Only the system may author a temporal row

A temporal row SHALL be authored exclusively from server-derived state, in the same transaction that persists the turn. A client-supplied part shaped like a temporal row SHALL be discarded rather than persisted or rendered, consistent with the rail's treatment of every other item.

A temporal row SHALL NOT be exposed through a public share, a fork read by a non-owner, an ordinary transcript export, or a search projection, consistent with the existing egress allowlist for those surfaces.

#### Scenario: A client submits a temporal row

- **WHEN** a client posts a message containing a part shaped like a temporal item
- **THEN** the part is discarded
- **AND** the persisted turn carries only the server-authored row

#### Scenario: A conversation is read publicly

- **WHEN** a shared chat is read by an unauthenticated visitor
- **THEN** no temporal row appears in the response
- **AND** the instance's timezone is not disclosed by that surface
