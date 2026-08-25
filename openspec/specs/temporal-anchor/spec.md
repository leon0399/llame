# temporal-anchor

## Purpose

Gives the model an honest sense of when the conversation is happening: an absolute, timezone-explicit instant resolved when a chat's current context begins and refreshed only at compaction, so that relative expressions and dated context become interpretable without a per-request clock destroying prefix caching for the whole conversation.

## Requirements

### Requirement: Every chat carries a temporal anchor

The system SHALL resolve, for every chat, an anchor instant marking when that chat's current context began. The anchor SHALL be the time of the chat's most recent compaction, or the chat's creation time when it has never been compacted.

The anchor SHALL be **derived from state the system already records** rather than stored as an independent value. Storing it separately would create a second source of truth that can drift from the compaction it is supposed to describe, and would require a migration to introduce a value that is already implied by existing state.

#### Scenario: Chat has never been compacted

- **WHEN** a run is prepared for a chat with no compaction
- **THEN** the anchor is that chat's creation time

#### Scenario: Chat has been compacted

- **WHEN** a run is prepared for a chat that has been compacted at least once
- **THEN** the anchor is the time of its most recent compaction
- **AND** earlier compactions do not affect the value

### Requirement: The anchor is refreshed only at compaction

The anchor SHALL be re-resolved **only when the chat is compacted**. A model switch SHALL NOT re-resolve it.

The rationale SHALL be documented: compaction is a context boundary at which the conversation is rewritten anyway, whereas a model switch changes only which provider reads an otherwise unchanged conversation. Moving the anchor at a switch would change what the assistant believes about time as a side effect of an unrelated action. This is deliberately the same lifecycle the recency digest already follows, so the two frozen per-chat values cannot disagree about when the conversation's context began.

#### Scenario: Owner switches model mid-conversation

- **WHEN** an owner switches the chat to a different model and sends another message
- **THEN** the anchor is unchanged from the previous run
- **AND** the prompt text may differ only because the new model's template differs

#### Scenario: Chat is compacted

- **WHEN** a chat is compacted and a subsequent run is prepared
- **THEN** the anchor is the new compaction's time rather than the chat's creation time

### Requirement: The anchor renders as an absolute, timezone-explicit value

The rendered anchor SHALL be absolute and unambiguous, expressed in the **instance's own local timezone**. It SHALL carry a numeric UTC offset alongside the timestamp, and SHALL separately expose the IANA identifier of the timezone it is expressed in.

The numeric offset is required rather than decorative: an IANA identifier alone obliges the model to carry a timezone database and that date's daylight-saving rules, which is exactly where weaker models fail. An explicit offset reduces any conversion to arithmetic.

The offset and the timezone identifier SHALL be produced from a **single formatting operation over one instant**, so that the two can never disagree with each other. Timezones whose offset is not a whole number of hours SHALL render correctly.

Rendering the anchor discloses the instance's timezone to every user of that instance. This SHALL be treated as a **considered disclosure rather than an oversight**: the signal is coarse, it is required for the rendered time to be interpretable at all, and it is categorically unlike host filesystem paths, provider internals, or credentials, which remain excluded from every model-visible surface and from the owner-facing context receipt.

#### Scenario: Instance runs in a non-UTC timezone

- **WHEN** the anchor renders on an instance whose local timezone is not UTC
- **THEN** the timestamp is expressed in that local timezone, carries that zone's numeric UTC offset for the anchored date, and is accompanied by that zone's IANA identifier

#### Scenario: Instance timezone has a fractional-hour offset

- **WHEN** the anchor renders on an instance whose local timezone offset is not a whole number of hours
- **THEN** the rendered offset states the exact hours and minutes

A resolved zone that is **absent or degenerate** SHALL fall back to UTC. A misconfigured environment (e.g. `TZ` set to a non-existent zone, or set to an empty string) can resolve to no zone at all, or to a placeholder identifier that names no real zone; either would otherwise render a meaningless or literally undefined timezone label into every user's prompt. When `TZ` is unset, Node uses the operating system's configured timezone, which is the native and correct behavior — an unset `TZ` is not a misconfiguration. The fallback SHALL be UTC rather than a startup failure, because the timezone comes from the process environment rather than from llame's own operator config, and UTC is a correct and honest reading. The condition SHALL be logged so a misconfiguration is discoverable rather than silent.

#### Scenario: Instance timezone is misconfigured

- **WHEN** the environment resolves to no timezone, or to a placeholder that names no real zone
- **THEN** the anchor renders in UTC with a zero offset and the identifier `UTC`
- **AND** no placeholder or undefined value reaches the rendered prompt
- **AND** the condition is logged

#### Scenario: Instance runs in UTC

- **WHEN** the anchor renders on an instance whose local timezone is UTC
- **THEN** the timestamp carries a zero offset and is accompanied by its IANA identifier

### Requirement: Rendered phrasing does not assert the present instant

The anchor is frozen by construction, so the packaged default prompt SHALL phrase it as **when the conversation's context was last established**, and SHALL NOT phrase it as the current time.

The phrasing SHALL additionally hold true under **both** of the anchor's bases. Because the anchor becomes the compaction time once a chat has been compacted, wording such as "this conversation began on ..." SHALL NOT be used: it is accurate only for a chat that has never been compacted and asserts a start date the conversation never had for every chat that has. One basis-neutral phrasing SHALL cover both, rather than the system exposing which basis produced the value.

Phrasing a frozen value as the present instant would make a day-old chat assert a wrong time with full confidence, which is worse than carrying no clock at all. Framing the value as an established reference point is what keeps sub-day precision truthful indefinitely, because a statement about when a context was established remains true however much later it is read.

#### Scenario: Long-running chat renders the anchor

- **WHEN** the packaged default prompt renders for a chat whose anchor is materially older than the current time
- **THEN** the rendered text describes when the conversation's context was established rather than claiming to state the current time
- **AND** the text remains true despite the elapsed interval

#### Scenario: Compacted chat renders the anchor

- **WHEN** the packaged default prompt renders for a chat that has been compacted, so the anchor is a compaction time rather than the creation time
- **THEN** the rendered text does not claim the conversation began at that time
- **AND** the wording is identical to what a never-compacted chat renders

### Requirement: The anchor contributes no per-turn variation

Rendering the anchor SHALL be deterministic for a given chat between compactions: across runs whose other effective-context inputs are unchanged, the resulting system prompt SHALL be byte-identical, so the effective-context snapshot is reused rather than re-minted and provider-side prefix caching is unaffected.

A per-request clock SHALL NOT be introduced ahead of the cached prefix under any circumstances, since that would forfeit caching for the entire conversation.

#### Scenario: Consecutive runs in one chat

- **WHEN** two runs are prepared for the same chat with no compaction between them and no other effective-context input changed
- **THEN** the rendered anchor is byte-identical in both
- **AND** the effective-context snapshot is reused rather than re-minted

#### Scenario: Run after a compaction

- **WHEN** a run is prepared after the chat has been compacted and the compaction time differs from the previous anchor source at minute precision
- **THEN** the rendered anchor differs from the previous run's
- **AND** a new effective-context snapshot is minted, as any changed prompt input requires

### Requirement: The anchor is always available to prompt rendering

The anchor SHALL be supplied to prompt rendering **unconditionally**, never as an optional input, because an anchor instant and a timezone are always computable for any chat.

A prompt that references no temporal path SHALL be unaffected, and its startup SHALL NOT fail: the anchor being available does not place it in a prompt that does not ask for it.

#### Scenario: Rendering is requested for any chat

- **WHEN** a system prompt is rendered for any chat, whether or not it has been compacted
- **THEN** an anchor is available to the template
- **AND** there is no case in which rendering proceeds without one

#### Scenario: Operator prompt omits the temporal paths

- **WHEN** an operator's prompt references no temporal path
- **THEN** startup succeeds and the rendered prompt contains no temporal content

### Requirement: The anchor is not frozen into a compaction checkpoint

The anchor is standing context re-supplied on every request, so the compaction instruction SHALL direct the summarizing model not to carry it into the checkpoint, consistent with the existing treatment of the owner's standing personalization and chat-history blocks.

The instruction SHALL be narrow enough to leave **in-conversation** temporal facts intact: a date, deadline, or interval established by the user or the assistant within the conversation SHALL still be preserved, since those are exactly the established facts a checkpoint exists to carry forward.

This exclusion SHALL be documented as resting on instruction and model compliance rather than structural enforcement, consistent with the existing standing-context exclusion.

#### Scenario: Checkpoint omits the anchor

- **WHEN** a chat is compacted and the summarizing model receives a rendered prompt containing the anchor
- **THEN** it is instructed not to carry the anchor into the checkpoint
- **AND** the checkpoint does not embed a second, stale context timestamp that would conflict with the refreshed anchor

#### Scenario: A date established in conversation survives compaction

- **WHEN** the conversation itself established a date, deadline, or interval
- **THEN** that fact is preserved in the checkpoint
- **AND** the anchor exclusion does not remove it

### Requirement: Dated context is interpretable relative to the anchor

Dated content already carried in the prompt — notably the recency digest's per-entry activity dates and its compilation date — SHALL be placeable against the anchor. The anchor SHALL NOT duplicate or replace the digest's own compilation date, which records a different instant: when the list was compiled, not when the conversation began.

#### Scenario: Digest entry is placed against the anchor

- **WHEN** a prompt renders both the anchor and a digest entry carrying a last-activity date
- **THEN** the anchor provides the timezone-explicit reference point against which the entry's date-only value can be interpreted, even though the entry itself is a UTC calendar date without an offset
- **AND** the digest's own compilation date is still rendered, unchanged

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

The temporal row SHALL be **persisted with the turn it belongs to as its complete final model-facing text block**. The accepted instant and timezone SHALL be validated and formatted before that block is persisted; later replay SHALL consult neither the clock, the process environment, the stored semantic payload, nor the current formatter.

The stored row SHALL be byte-identical across every application-level request that replays that turn, for the life of the turn. A later renderer, timezone-database, formatting, or instance-timezone change SHALL affect only rows authored after that change and SHALL NOT retroactively alter an existing row.

#### Scenario: A conversation is replayed after a formatter change

- **WHEN** a later release changes temporal formatting or reminder wording and replays an existing chat
- **THEN** every existing row uses its persisted complete text unchanged
- **AND** only newly accepted turns use the new rendering

#### Scenario: A conversation is replayed

- **WHEN** a request is assembled for a chat whose turns each carry a persisted
  row
- **THEN** every row replays exactly as it was authored
- **AND** no row's text depends on when or by which release the replay happens

#### Scenario: The instance timezone changes

- **WHEN** the instance is reconfigured to a different timezone and an existing chat continues
- **THEN** existing rows replay unchanged
- **AND** only turns received after the change carry the new timezone

#### Scenario: A chat is forked

- **WHEN** an owner forks a chat and its private turns are copied
- **THEN** the copied turns carry their original persisted rows
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

At authoring time, the row SHALL use the same rendered shape as the anchor: absolute, carrying a numeric UTC offset, and accompanied by the IANA identifier of the zone it is expressed in. Offset and identifier SHALL be produced from a single formatting operation over one accepted instant, so the two cannot disagree.

The row and the anchor SHALL be expressed in the **instance's own local timezone** resolved where the turn is accepted. The complete row text SHALL then be persisted. Replay SHALL NOT re-resolve the timezone or reformat the instant, so a later process cannot disagree with the process that accepted the turn.

A future temporal reading of the same instant in a user's stored timezone SHALL be an additional labeled line authored within the same persisted row. A second temporal block SHALL NOT be introduced, and the new line SHALL apply only to rows authored after that capability exists unless an explicit data transition says otherwise.

#### Scenario: The instance runs in a non-UTC timezone

- **WHEN** a turn is accepted on an instance whose local timezone is not UTC
- **THEN** its persisted row is expressed in that timezone with that zone's numeric offset for that instant and that zone's IANA identifier
- **AND** later replay uses the persisted row without another timezone calculation

#### Scenario: A further reading is added later

- **WHEN** a later release introduces a further temporal reading
- **THEN** newly authored rows render it as another labeled line of the same persisted block
- **AND** existing rows remain unchanged and no second temporal block appears

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
