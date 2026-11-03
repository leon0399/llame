## ADDED Requirements

### Requirement: The Responses wire stores no response and carries encrypted reasoning

Each `openai-responses` request MUST send `store: false`. A request for a model
entry that declares `reasoning` MUST also ask for the encrypted content of
reasoning items, whatever its model id. For another entry, the adapter decides
from its model id, as today. `store: false` is a client invariant under the
precedence rule, so the `providerOptions` of an operator cannot change it. A replayed reasoning part MUST go back with its
encrypted content, not as a reference to a stored item.

#### Scenario: A reasoning entry stores nothing and asks for encrypted reasoning

- **WHEN** a Run executes on an `openai-responses` model entry that declares `reasoning`
- **THEN** each request carries `store: false` and asks for `reasoning.encrypted_content`

#### Scenario: A reasoning entry under another id asks too

- **WHEN** a model entry declares `reasoning` and names its model `proxy-reasoner`, an id that the adapter does not know
- **THEN** each request asks for `reasoning.encrypted_content`

#### Scenario: A non-reasoning entry keeps the adapter default

- **WHEN** a Run executes on an `openai-responses` model entry `gpt-4.1` that declares no `reasoning`
- **THEN** each request carries `store: false`
- **AND** the adapter asks for no `reasoning.encrypted_content`, as for that id today

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
