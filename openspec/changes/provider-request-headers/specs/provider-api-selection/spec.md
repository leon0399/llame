## MODIFIED Requirements

### Requirement: Every provider request identifies llame

Every language-model request llame makes on behalf of any provider entry SHALL carry a `User-Agent` whose value names llame and llame's version, taken from the API package's own version and read at startup under the instance configuration contract. The value SHALL be carried on the request itself, on streaming and structured requests alike, so that the SDK's own token follows llame's rather than replacing it. The value SHALL NOT be the adapter's or SDK's identifier alone: a provider that inspects the header SHALL see llame's product token first, not a bare HTTP library or SDK name. llame's own value SHALL NOT claim another product's client identity, and a model entry's `providerOptions` SHALL NOT override it; only a `User-Agent` value in the provider entry's operator header map (`provider-request-headers`) SHALL replace it, for that entry's requests. The identity is a product token, never a credential: it carries no key, account, owner, Chat, or tenant value, and it SHALL NOT be derived from any of them. Tokens the SDK or an adapter appends after llame's are out of llame's control and do not violate this requirement. Embedding requests are exempt.

#### Scenario: A request from any provider type carries the identity

- **WHEN** a language-model request is made through an entry of any executable provider type whose header map does not name `User-Agent`
- **THEN** the request carries the llame identity header
- **AND** the same llame token leads the value whichever type, wire, or endpoint served the request

#### Scenario: The identity names llame and its version

- **WHEN** a request's `User-Agent` value is inspected on an entry whose header map does not name `User-Agent`
- **THEN** it begins with llame's product token and the API package's version
- **AND** it is never the adapter's or SDK's identifier alone

### Requirement: Language-model requests carry the Chat identity

Both model-client input contracts — the streaming input and the structured-generation input — SHALL carry a required, transport-neutral Chat identity: the Chat's identifier and the lane the request belongs to, where the lane is `main` or `title`. The field SHALL be required, so every call site supplies it and the type checker enumerates every construction site rather than allowing a default. Call sites SHALL supply facts only, never a rendered header value or a transport name: each client renders the identity in the form its own provider requires and through the request-time variable of its entry's header map (`provider-request-headers`), and sends nothing derived from it when neither applies. The main turn and every compaction path SHALL send the `main` lane, because compaction reuses the conversation's own prefix; title generation SHALL send the `title` lane. The value SHALL be stable across retries, worker restarts, compaction, and model switches within the same Chat. The identity is not a credential: it is the Chat's own identifier, which llame already records, and it SHALL NOT reach model context or persisted message parts and SHALL add nothing to owner-visible output.

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
