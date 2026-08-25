## ADDED Requirements

### Requirement: Digest rail items persist their author-time projection

Every recency-digest append and supersession marker SHALL be neutralized, framed, and rendered before the message carrying it commits. The message SHALL persist the complete final model-facing text block alongside its producer, form, Run linkage, and semantic payload.

Later replay SHALL use the stored text block verbatim and in stored part order. It SHALL NOT regenerate titles, excerpts, precedence framing, supersession prose, or envelope text from the semantic payload, and a later sanitizer or renderer change SHALL affect only newly authored digest items.

Existing digest parts that carry no complete text SHALL follow the
`context-injection` capability's inert-part rule and SHALL NOT be backfilled
from other chats or the told-set.

#### Scenario: A renderer changes after an append was written

- **WHEN** an existing chat containing a persisted digest append is replayed after its producer wording changes
- **THEN** the append's complete stored text and position remain unchanged
- **AND** newly authored appends may use the new wording

#### Scenario: A source chat changes after an append was written

- **WHEN** the title or opening excerpt of a chat named by an existing append later changes or is deleted
- **THEN** the persisted append remains unchanged
- **AND** replay does not re-read the source chat to reconstruct it

#### Scenario: A data-only digest part is replayed

- **WHEN** an existing digest part carries semantic payload but no complete text
- **THEN** it contributes no model-visible block
- **AND** no source-chat content is re-read to backfill it
