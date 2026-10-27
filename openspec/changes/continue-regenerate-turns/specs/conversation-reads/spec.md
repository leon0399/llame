## MODIFIED Requirements

### Requirement: Conversation reads derive authority only from trusted Run identity

`conversation_read` MUST be a strict read-only operation. It accepts `chatId`, a positive
safe-integer `messageSeq`, an optional zero-based safe-integer `offset`, and an optional
safe-integer `limit` from 1 through 2,000. When `offset` is absent, it MUST be zero. When `limit`
is absent, the read MUST go to the current end of that message, in the server bounds. Input
validation MUST reject each of these values before data access: unknown properties, malformed
IDs, and a non-positive or unsafe sequence. It MUST also reject a negative or unsafe offset, and a
limit outside that range.

Owner identity MUST come only from the authenticated Run context. Each call MUST resolve the Chat,
the message sequence, evidence eligibility, and the adjacent eligible sequences under the current
owner RLS and explicit owner predicates. Some well-formed sources MUST get the same closed
`conversation_source_not_found` observation. These are a source that is absent, deleted,
retryable, or revised, a public or shared source without its owner, and a source of another
owner. An empty trusted identity MUST fail closed. A source
locator MUST NOT expand authority.

The reader MUST return only immutable evidence-eligible messages. A retryable assistant row is a
reply whose usage status is not `completed`. Until #611 replaces the in-place change of a reply, a
retryable assistant row MUST NOT be an addressable evidence source.
A revised assistant row is a `completed` reply that a Regenerate from `turn-actions` replaced. A
revised row MUST NOT be an addressable evidence source again. User messages stay eligible.
Assistant messages that are `completed` or legacy-immutable, and that are not revised, stay
eligible.

#### Scenario: Direct owner message read succeeds

- **WHEN** the trusted Run owner gives a valid owned Chat and an eligible message sequence
- **THEN** the reader returns the visible text of that message from the requested line offset
- **AND** the reader accepts no owner identity or message UUID from model input

#### Scenario: Another owner's sequence fails closed

- **WHEN** an owner gives a well-formed Chat and sequence pair that resolves only under another owner or under a public share
- **THEN** the reader returns `conversation_source_not_found`
- **AND** the observation reveals no foreign title, role, timestamp, sequence, content, or existence

#### Scenario: Retryable assistant source is unavailable

- **WHEN** a selector identifies an assistant row whose usage status is not `completed`
- **THEN** the reader returns `conversation_source_not_found`
- **AND** it does not show changeable bytes as canonical history

#### Scenario: A revised assistant source stays unavailable

- **WHEN** a selector identifies a `completed` reply that a Regenerate replaced, and the Regenerate Run has completed
- **THEN** the reader returns `conversation_source_not_found`
- **AND** the adjacent eligible sequences skip that row

#### Scenario: Malformed input never reaches source resolution

- **WHEN** the input has a malformed identity, an unsafe sequence or offset, an invalid limit, or unknown properties
- **THEN** strict tool validation rejects it before any source query
- **AND** the failure is not a `conversation_source_not_found` observation
