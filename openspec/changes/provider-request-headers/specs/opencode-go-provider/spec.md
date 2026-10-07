## MODIFIED Requirements

### Requirement: Requests identify llame as the client

The client SHALL send llame's product `User-Agent` as `provider-api-selection`
requires of every provider, and SHALL additionally send the gateway's client
header naming llame. It SHALL NOT send the gateway's request-identifier or
project headers unless the entry's operator header map adds them, and SHALL
NOT claim another product's client identity. Neither
header is a credential and neither carries owner, Chat, tenant, or credential
data.

#### Scenario: Both identity headers are sent

- **WHEN** a language-model request is made through an `opencode-go` provider
- **THEN** it carries llame's `User-Agent` and the gateway client header naming llame
- **AND** the gateway can attribute the request to llame

#### Scenario: No other gateway header is invented

- **WHEN** the request headers llame sends to the gateway for an entry that declares no `headers` map are inspected
- **THEN** no request-identifier, project, or `x-session-affinity` header is present
- **AND** the only Chat-derived headers are the gateway session header and the default `X-Session-Id`
- **AND** no header value names a different product
