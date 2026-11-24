## MODIFIED Requirements

### Requirement: An owner starts a follow-up Run on the latest turn

An owner MUST start a follow-up through `POST /api/v1/chats/:chatId/messages/:userMessageId/runs`. That message MUST already have a Run. It MUST be the highest-sequence user turn after exclusion of digest-only host carriers. Ordinary owner messages and job-delivery host messages MUST retain their turn semantics.

The newest Run MUST remain a turn Run of that message. No checkpoint can absorb the target. The Chat MUST remain unarchived. The result MUST use the same AG-UI 1.0 stream as a Chat send. A later digest-only carrier MUST NOT block an otherwise eligible Continue or Regenerate.

#### Scenario: A follow-up request on the latest turn starts a Run

- **WHEN** the owner sends a valid follow-up request for the latest user message of a Chat with no live Run
- **THEN** the API creates a new Run for that message
- **AND** the first event of the stream is `RUN_STARTED` whose `runId` is the new Run id and whose `threadId` is the Chat id

#### Scenario: A follow-up request on an older turn is refused

- **WHEN** the owner sends a follow-up request for a user message that has a newer user message after it
- **THEN** the API answers 409
- **AND** it creates no Run and changes no message

#### Scenario: A follow-up request on an archived Chat is refused

- **WHEN** the owner sends a follow-up request for the latest user message of an archived Chat
- **THEN** the API answers with the error that a chat send to that Chat gets
- **AND** it creates no Run

#### Scenario: A follow-up request for another owner's Chat reveals nothing

- **WHEN** user B sends a follow-up request that names a Chat or a user message of user A
- **THEN** the API answers 404 before it reads any job state
- **AND** it creates no Run, expires no Run, and changes no message of user A

#### Scenario: A follow-up after a compaction Run is refused

- **WHEN** the newest Run of a Chat is a compaction Run, and the owner sends a Regenerate request for the latest user message
- **THEN** the API answers 409 and creates no Run

#### Scenario: A follow-up after a compact at the final answer is refused

- **WHEN** a turn Run compacted at its final answer and completed, and the owner sends a Regenerate request for its user message
- **THEN** the API answers 409 and creates no Run

#### Scenario: A digest companion is not a later turn

- **WHEN** pre-step compaction publishes a companion above an unabsorbed user message and its turn Run then fails
- **THEN** an otherwise eligible Continue or Regenerate remains admitted for that message
- **AND** the digest carrier starts no Run and creates no later-turn conflict

### Requirement: Regenerate replaces the reply of the latest turn

Regenerate MUST require a terminal latest Run of its target message. Any terminal status can qualify. Its first request MUST use history through the triggering message, with the effective checkpoint and digest companion.

Its dispatch MUST replace the old reply, including a completed reply. The old reply MUST remain only in its Run event log. A pre-dispatch failure MUST keep that reply. Replaced replies MUST remain unavailable to search and Chat reads.

#### Scenario: Regenerate replaces a completed answer with another model

- **WHEN** the owner regenerates a `completed` reply of model `A` with model `B`
- **THEN** the first model request of the new Run carries no part of the old reply
- **AND** after the new Run completes, the reply holds only the new answer and records model `B`

#### Scenario: Regenerate a turn with no reply

- **WHEN** the first Run of the latest user message failed at pickup, so the message has no reply, and the owner regenerates it
- **THEN** the API admits the Regenerate Run and its dispatch creates the reply

#### Scenario: A Regenerate that fails before dispatch keeps the old reply

- **WHEN** a Regenerate Run fails during preparation before its first model request
- **THEN** the old reply keeps its parts, its usage, and its eligibility

#### Scenario: A later attempt keeps its own salvaged answer

- **WHEN** the first attempt of a Regenerate Run completes the reply, and the Run stays live and starts a second attempt
- **THEN** the second attempt does not reset the reply, and the Run settles `completed` with that answer

#### Scenario: A replaced completed reply leaves search

- **WHEN** a Regenerate Run replaces a `completed` reply and then completes
- **THEN** `search_conversations` omits that reply and its Chat read returns `not_found`

## ADDED Requirements

### Requirement: Digest-only carriers do not create user turns

A host row with only recency-digest context items MUST remain a transparent carrier. It MUST NOT start a Run, replace the latest user turn, satisfy a later-user-message guard, or alone make compaction eligible. This exclusion MUST NOT change ordinary owner or job-delivery turns. Existing refusals after an idle compaction Run or an absorbed latest turn MUST remain unchanged.

#### Scenario: A real later message still blocks an older follow-up

- **WHEN** a real owner message follows the target turn
- **THEN** follow-up admission still rejects that older target

#### Scenario: Migration carriers do not disable follow-ups

- **WHEN** conversion appends digest-only host rows without a new Run
- **THEN** the same unabsorbed latest turn remains eligible under ordinary follow-up checks
