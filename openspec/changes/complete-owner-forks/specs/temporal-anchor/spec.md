## MODIFIED Requirements

### Requirement: Every chat carries a temporal anchor

The system SHALL resolve, for every chat, an anchor instant marking when that chat's current context began. The anchor SHALL be the time of the chat's most recent applicable compaction, or its context origin when it has no compaction.

An ordinary new chat's context origin SHALL be its creation time. A non-empty owner fork SHALL inherit the source prefix's context origin, independently of the fork's own creation time. A fork of a fork SHALL retain that inherited origin. An empty whole-chat fork SHALL use its own creation time because it inherits no context. Copied compactions SHALL retain their original timestamps; copying a checkpoint SHALL NOT assert that compaction occurred at fork creation.

The anchor SHALL be derived from the applicable compaction or recorded context origin, not from an independently editable anchor setting. The fork's creation timestamp SHALL continue to record when the new Chat was created.

The inherited origin is an immutable historical input that cannot be derived from a fork's new creation time or its message timestamps. Recording it preserves otherwise unavailable source history; it does not store a second resolved anchor. The resolved anchor remains derived from the applicable compaction when one exists, avoiding an independent value that could drift from that checkpoint. Ordinary chats still derive their origin from their existing creation time.

#### Scenario: Chat has never been compacted

- **WHEN** a run is prepared for an ordinary new chat with no compaction
- **THEN** the anchor is that chat's creation time

#### Scenario: Chat has been compacted

- **WHEN** a run is prepared for a chat that has been compacted at least once
- **THEN** the anchor is the time of its most recent applicable compaction
- **AND** earlier compactions do not affect the value

#### Scenario: Owner forks uncompacted history

- **WHEN** an owner forks a non-empty prefix with no applicable compaction
- **THEN** the fork inherits the prefix's context origin
- **AND** its new creation timestamp does not change the rendered anchor

#### Scenario: Owner forks an empty completed prefix

- **WHEN** a whole-chat fork has no completed turn to inherit
- **THEN** its context origin is the new Chat's own creation time
- **AND** it inherits no temporal anchor from unfinished source history

#### Scenario: Owner forks compacted history

- **WHEN** an owner fork inherits an applicable compaction
- **THEN** its anchor derives from that compaction's preserved timestamp
- **AND** no timestamp is regenerated for the copy

#### Scenario: Owner forks an existing fork

- **WHEN** an uncompacted owner fork is forked again
- **THEN** both forks use the same inherited context origin
- **AND** deleting either source Chat cannot change the surviving fork's anchor

### Requirement: The anchor is refreshed only at compaction

The anchor SHALL be re-resolved **only when the chat is compacted**. A model switch or owner fork SHALL NOT refresh it. Fork creation SHALL inherit the anchor's recorded basis at the selected boundary rather than establish a new time reference.

The rationale SHALL be documented: compaction is a context boundary at which the conversation is rewritten anyway, whereas a model switch changes only which provider reads an otherwise unchanged conversation. Moving the anchor at a switch or fork would change what the assistant believes about time as a side effect of an unrelated action. This is deliberately the same lifecycle the recency digest already follows, so the two frozen per-chat values cannot disagree about when the conversation's context began.

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
