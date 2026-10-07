## MODIFIED Requirements

### Requirement: Language-model requests carry the Chat identity

Both model-client input contracts — the streaming input and the structured-generation input — SHALL carry a required, transport-neutral Chat identity: the Chat's identifier and the lane the request belongs to, where the lane is `main`, `title`, or `search`. The field SHALL be required, so every call site supplies it and the type checker enumerates every construction site rather than allowing a default. Call sites SHALL supply facts only, never a rendered header value or a transport name: each client renders the identity in the form its own provider requires and through the request-time variable of its entry's header map (`provider-request-headers`), and sends nothing derived from it when neither applies. The main turn and every compaction path SHALL send the `main` lane, because compaction reuses the conversation's own prefix; title generation SHALL send the `title` lane; and the hosted-search sub-request of a `web-search` model-hosted engine SHALL send the `search` lane, because it shares no prefix with the conversation. The value SHALL be stable across retries, worker restarts, compaction, and model switches within the same Chat. The identity is not a credential: it is the Chat's own identifier, which llame already records, and it SHALL NOT reach model context or persisted message parts and SHALL add nothing to owner-visible output.

#### Scenario: The main turn and compaction carry the main lane

- **WHEN** a run's streaming request and a compaction request for the same Chat are made
- **THEN** both carry that Chat's identifier under the `main` lane
- **AND** the value is the same for both, so the compaction request can reuse the conversation's prefix identity

#### Scenario: Title generation carries the title lane

- **WHEN** the title service generates a title for a Chat
- **THEN** its request carries that Chat's identifier under the `title` lane
- **AND** a client that renders the lane distinguishes it from the Chat's main-lane requests

#### Scenario: A client with no consumer sends nothing extra

- **WHEN** a request is made through a client whose provider renders no identity of its own and whose entry's effective header map is empty
- **THEN** the request carries no additional header or body field derived from the identity
- **AND** the request is otherwise unchanged from the same request made before this field existed

#### Scenario: The identity is not a credential

- **WHEN** the identity is supplied to a client and the request is inspected
- **THEN** the identity value appears only in the provider-bound headers the client renders
- **AND** it appears in no model context or persisted part, and adds nothing to owner-visible output

#### Scenario: A hosted web search carries the search lane

- **WHEN** a model-hosted web search engine makes its sub-request during a Run in a Chat
- **THEN** the request carries that Chat's identifier under the `search` lane
- **AND** a client that renders the lane distinguishes it from the Chat's main-lane and title-lane requests
