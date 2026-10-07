## MODIFIED Requirements

### Requirement: Requests identify llame as the client

The client SHALL send llame's product `User-Agent` as `provider-api-selection`
requires of every provider, and SHALL additionally send the gateway's client
header naming llame. It SHALL NOT send the gateway's request-identifier or
project headers unless the entry's operator header map adds them, and llame's
own values SHALL NOT claim another product's client identity. An operator
header map value replaces either identity header for that entry's requests.
Neither default value is a credential and neither carries owner, Chat, tenant,
or credential data.

#### Scenario: Both identity headers are sent

- **WHEN** a language-model request is made through an `opencode-go` provider whose header map names neither identity header
- **THEN** it carries llame's `User-Agent` and the gateway client header naming llame
- **AND** the gateway can attribute the request to llame

#### Scenario: No other gateway header is invented

- **WHEN** the request headers llame sends to the gateway for an entry that declares no `headers` map are inspected
- **THEN** no request-identifier, project, or `x-session-affinity` header is present
- **AND** the only Chat-derived headers are the gateway session header and the default `X-Session-Id`
- **AND** no header value names a different product

### Requirement: Every request for a Chat carries its session identity

The client SHALL send the Chat's identity as the gateway's session header on
every language-model request it makes, including requests that are not the
conversation's main turn: the Chat's own identifier, sent verbatim, for the
main turn and for compaction, and the Chat's identifier under a `title:` prefix
for title generation. The value SHALL be the same for every request that
belongs to the same lane of the same Chat, and SHALL remain stable across
retries, worker restarts, compaction, and model switches within that Chat.
Because the identity is required on the model-client input contract, no
fallback value exists and no request can be made without it. The identity SHALL
NOT be treated as a secret; it is the Chat's own identifier, which llame already
records, and it SHALL NOT reach model context or persisted message parts and
SHALL add nothing to owner-visible output.
An operator header map value for the session header replaces this value for
that entry's requests (`provider-request-headers`).

#### Scenario: The main turn carries the Chat identity

- **WHEN** a run streams its main turn through an `opencode-go` provider whose header map does not override the session header
- **THEN** the request carries the Chat's identifier in the session header
- **AND** the gateway accepts the request without a missing-session rejection

#### Scenario: Compaction carries the conversation's own identity

- **WHEN** a source-model compaction request is made for a Chat on the same provider whose header map does not override the session header
- **THEN** it carries the same session value as that Chat's main turn
- **AND** the summarization request can reuse the conversation's prefix identity

#### Scenario: Title generation carries the title lane

- **WHEN** the title service generates a title through an `opencode-go` provider whose header map does not override the session header
- **THEN** the request carries the Chat's identifier under the `title:` prefix
- **AND** a title failure leaves the completed answer unaffected under the existing title contract

#### Scenario: The identity survives a retry, a restart, and a compaction

- **WHEN** the same Chat's turn is retried, executed by a restarted worker, or preceded by a compaction through an entry whose header map does not override the session header
- **THEN** each request carries the same session value for that lane
- **AND** no request mints a new identity for an existing Chat
