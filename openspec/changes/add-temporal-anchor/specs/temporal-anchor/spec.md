## Purpose

Gives the model an honest sense of when the conversation is happening: an absolute, timezone-explicit instant resolved when a chat's current context begins and refreshed only at compaction, so that relative expressions and dated context become interpretable without a per-request clock destroying prefix caching for the whole conversation.

## ADDED Requirements

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

A resolved zone that is **absent or degenerate** SHALL fall back to UTC. A misconfigured or unset environment can resolve to no zone at all, or to a placeholder identifier that names no real zone; either would otherwise render a meaningless or literally undefined timezone label into every user's prompt. The fallback SHALL be UTC rather than a startup failure, because the timezone comes from the process environment rather than from llame's own operator config, and UTC is a correct and honest reading. The condition SHALL be logged so a misconfiguration is discoverable rather than silent.

#### Scenario: Instance timezone is misconfigured or unset

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

- **WHEN** a run is prepared after the chat has been compacted
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
- **THEN** the entry's date and the anchor are expressed on the same absolute, timezone-explicit basis, so the interval between them is determinable
- **AND** the digest's own compilation date is still rendered, unchanged
