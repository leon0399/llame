# Spec Delta

## MODIFIED Requirements

### Requirement: Every chat carries a temporal anchor

The system SHALL resolve, for every chat, an anchor instant marking when that chat's current context began. The anchor SHALL be the time of the chat's most recent checkpoint, or the chat's creation time when it has never been compacted.

The anchor SHALL be **derived from state the system already records** rather than stored as an independent value. Storing it separately would create a second source of truth that can drift from the compaction it is supposed to describe, and would require a migration to introduce a value that is already implied by existing state.

#### Scenario: Chat has never been compacted

- **WHEN** a run is prepared for a chat with no checkpoint
- **THEN** the anchor is that chat's creation time

#### Scenario: Chat has been compacted

- **WHEN** a run is prepared for a chat that has published a checkpoint
- **THEN** the anchor is the time of its most recent checkpoint
- **AND** earlier checkpoints do not affect the value

### Requirement: The anchor is refreshed only at compaction

The anchor SHALL be re-resolved **only when the chat publishes a checkpoint**. The refresh takes effect in the same transaction as that checkpoint and therefore applies to the request the checkpoint precedes, and it survives a failure of that attempt. A model switch SHALL NOT re-resolve it.

The rationale SHALL be documented: compaction is a context boundary at which the conversation is rewritten anyway, whereas a model switch changes only which provider reads an otherwise unchanged conversation. Moving the anchor at a switch would change what the assistant believes about time as a side effect of an unrelated action. This is deliberately the same lifecycle the recency digest already follows, so the two frozen per-chat values cannot disagree about when the conversation's context began.

#### Scenario: Owner switches model mid-conversation

- **WHEN** an owner switches the chat to a different model and sends another message
- **THEN** the anchor is unchanged from the previous run
- **AND** the prompt text may differ only because the new model's template differs

#### Scenario: Chat is compacted

- **WHEN** a chat publishes a checkpoint and the request it precedes is prepared
- **THEN** the anchor is that checkpoint's time rather than the chat's creation time
