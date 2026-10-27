## MODIFIED Requirements

### Requirement: Existing message ids conflict

In the current product, a chat send MUST use a user message id only once in a Chat. A chat send
with a message id that exists MUST get a conflict, also when its content or its model id matches
an earlier request. This rule does not apply to a follow-up request from `turn-actions`, because
that request names a user message that exists.

#### Scenario: Duplicate message id is rejected

- **WHEN** a caller posts a chat message whose id already exists in that Chat
- **THEN** the API returns 409 and creates no new Run

#### Scenario: A follow-up request names a message that exists

- **WHEN** the owner sends a follow-up request for the latest user message of a Chat
- **THEN** the message id does not cause a conflict
- **AND** the `turn-actions` rules decide the answer
