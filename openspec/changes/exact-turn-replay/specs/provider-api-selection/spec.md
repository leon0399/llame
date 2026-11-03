## ADDED Requirements

### Requirement: The Responses wire stores no response and carries encrypted reasoning

Each `openai-responses` request MUST send `store: false` and MUST ask for the
encrypted content of reasoning items. Both settings are client invariants under
the precedence rule, so the `providerOptions` of an operator cannot change them.
A replayed reasoning part MUST go back with its encrypted content, not as a
reference to a stored item.

#### Scenario: A Responses request stores nothing

- **WHEN** a Run executes on an `openai-responses` model entry
- **THEN** each request carries `store: false` and asks for `reasoning.encrypted_content`

#### Scenario: An operator cannot turn storage on

- **WHEN** the `providerOptions` of an `openai-responses` model entry set `store: true`
- **THEN** the request carries `store: false`
- **AND** the operator value is not sent

#### Scenario: Earlier reasoning replays as encrypted content

- **WHEN** a later turn on the same model replays a reasoning part that carries encrypted content
- **THEN** the request carries a reasoning item with that encrypted content
- **AND** the request carries no `item_reference`

#### Scenario: A part with only an item id is omitted

- **WHEN** a reasoning part persisted before this change carries an item id and no encrypted content
- **THEN** the request does not carry that part
- **AND** the request succeeds
