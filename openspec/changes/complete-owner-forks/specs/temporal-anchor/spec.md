## MODIFIED Requirements

### Requirement: Every chat carries a temporal anchor

The system SHALL resolve, for every chat, an anchor instant marking when that chat's current context began. The anchor SHALL be the time of the chat's most recent compaction, or its context origin when it has never been compacted.

An ordinary chat's context origin SHALL be its creation time. A non-empty owner fork SHALL record the source's context origin and use it, so the fork's own creation time does not change the rendered anchor. A fork of a fork SHALL retain that recorded origin. Copied compactions SHALL retain their original timestamps.

The resolved anchor SHALL remain derived from the applicable compaction when one exists, not stored as an independently editable value. The recorded origin preserves a historical input that a fork cannot derive from its own row; it does not store a second resolved anchor.

#### Scenario: Chat has never been compacted

- **WHEN** a run is prepared for an ordinary chat with no compaction
- **THEN** the anchor is that chat's creation time

#### Scenario: Chat has been compacted

- **WHEN** a run is prepared for a chat that has been compacted at least once
- **THEN** the anchor is the time of its most recent compaction
- **AND** earlier compactions do not affect the value

#### Scenario: Owner forks uncompacted history

- **WHEN** an owner forks a non-empty prefix with no copied compaction
- **THEN** the fork's anchor is the source's context origin
- **AND** the fork's creation timestamp does not change the rendered anchor

#### Scenario: Owner forks compacted history

- **WHEN** an owner fork copies a compaction
- **THEN** its anchor derives from that compaction's preserved timestamp
- **AND** no timestamp is regenerated for the copy

#### Scenario: Owner forks an existing fork

- **WHEN** an uncompacted owner fork is forked again
- **THEN** both forks use the same recorded origin
- **AND** deleting either source Chat cannot change the surviving fork's anchor

### Requirement: The anchor is refreshed only at compaction

The anchor SHALL be re-resolved **only when the chat is compacted**. A model switch or owner fork SHALL NOT refresh it.

The rationale SHALL be documented: compaction is a context boundary at which the conversation is rewritten anyway, whereas a model switch changes only which provider reads an otherwise unchanged conversation, and a fork copies that conversation. Moving the anchor at a switch or fork would change what the assistant believes about time as a side effect of an unrelated action and would change the system prompt, invalidating the inherited prefix. This is deliberately the same lifecycle the recency digest already follows, so the two frozen per-chat values cannot disagree about when the conversation's context began.

#### Scenario: Owner switches model mid-conversation

- **WHEN** an owner switches the chat to a different model and sends another message
- **THEN** the anchor is unchanged from the previous run
- **AND** the prompt text may differ only because the new model's template differs

#### Scenario: Chat is compacted

- **WHEN** a chat is compacted and a subsequent run is prepared
- **THEN** the anchor is the new compaction's time rather than the prior context origin or compaction time

#### Scenario: Fork compacts independently

- **WHEN** a fork commits its own new compaction
- **THEN** its subsequent Runs use the new local compaction time
- **AND** the source Chat's anchor remains unchanged
