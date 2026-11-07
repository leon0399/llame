# Spec Delta

## MODIFIED Requirements

### Requirement: Provider types supply default headers under the operator map

Each provider type MUST have a default header map. The map `{ "X-Session-Id": "{session:id}" }` is the default for `openai-responses`, `openai-completions`, `anthropic-messages`, and `opencode-go`. The default map is empty for `openai-codex`, `system-one`, and `cohere-rerank`. The effective map MUST be the default map with the operator map laid over it key by key. The system compares names without ASCII letter case. A string value replaces the default value. A `null` value removes a default entry.

#### Scenario: An entry without a map sends the default

- **WHEN** an `openai-completions` entry declares no `headers`
- **THEN** its requests carry `X-Session-Id` rendered from the request's Chat identity

#### Scenario: Null removes a default header

- **WHEN** an `anthropic-messages` entry declares `"headers": { "x-session-id": null }`
- **THEN** its requests carry no `X-Session-Id` header in any letter case

#### Scenario: An operator value replaces a default

- **WHEN** an `openai-responses` entry declares `"headers": { "X-Session-Id": "llame-{session:id}" }`
- **THEN** its requests carry exactly one `X-Session-Id` header with the operator's rendered value

#### Scenario: Codex sends no default header

- **WHEN** an `openai-codex` entry declares no `headers`
- **THEN** its requests carry no `X-Session-Id` and no other header from a default map

#### Scenario: Codex sends the header when the operator adds it

- **WHEN** an `openai-codex` entry declares `"headers": { "X-Session-Id": "{session:id}" }`
- **THEN** its requests carry `X-Session-Id` rendered from the request's Chat identity

#### Scenario: A decision provider sends no default header

- **WHEN** a `system-one` entry declares no `headers`
- **THEN** its requests carry no header from a default map

### Requirement: Header values are templates resolved at startup

A header string MUST resolve `{env:…}` and `{path:…}` once at startup under
the existing interpolation rules.
It MUST render `{session:id}` per request, except for `system-one` and
`cohere-rerank`: there an authored `{session:id}` MUST fail startup and name
the provider id and header.
Any other `{name:…}` token MUST fail startup and name the path.
An empty render MUST send no operator or default value for that header.
The system MUST NOT rescan interpolated output for `{session:id}`.

#### Scenario: Interpolation and the variable combine

- **WHEN** a value is `"{env:DEPLOY}:{session:id}"` on a chat provider and `DEPLOY` is `prod`
- **THEN** a main-lane request for Chat `c1` carries the value `prod:c1`

#### Scenario: Interpolated text is not rescanned

- **WHEN** a value is `"{env:TAG}"` and `TAG` resolves to `{session:id}`
- **THEN** requests carry that literal text

#### Scenario: An unknown variable fails startup

- **WHEN** a value contains `{sesion:id}`
- **THEN** startup fails and names the header path
- **AND** the token is never sent verbatim

#### Scenario: An empty value omits the header

- **WHEN** `TAG` is unset and `"{env:TAG:-}"` defines a header that the client does not set
- **THEN** requests carry no header of that name

### Requirement: A decision provider header cannot name the session

An authored header value of a `system-one` or `cohere-rerank` entry MUST NOT contain
`{session:id}`. Startup MUST fail and name the provider id and header name.

#### Scenario: A decision provider header names the session

- **WHEN** a `system-one` entry declares `"headers": { "X-Tag": "{session:id}" }`
- **THEN** startup fails
- **AND** the message names the provider id and the header `X-Tag`

#### Scenario: A rerank provider header names the session

- **WHEN** a `cohere-rerank` entry declares `"headers": { "X-Tag": "{session:id}" }`
- **THEN** startup fails
- **AND** the message names the provider id and the header `X-Tag`
