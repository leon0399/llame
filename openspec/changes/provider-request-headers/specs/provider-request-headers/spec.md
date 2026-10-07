## Purpose

Let an operator decide, per provider entry, which extra HTTP headers every
language-model request carries, with per-type defaults that correlate a Chat's
requests for gateways such as LiteLLM.

## ADDED Requirements

### Requirement: Provider entries accept an operator header map

Every `providers[]` entry SHALL accept an optional `headers` object whose keys
are header names and whose values are a string or `null`. A value of another
type, or two keys equal under ASCII case-folding, SHALL fail startup naming the
configuration path. No header name is reserved. The map is server-only and
SHALL NOT be returned by the models endpoint.

#### Scenario: A header map on any provider type loads

- **WHEN** an entry of any executable provider type declares `headers` with a string value and a `null` value
- **THEN** startup succeeds and the entry is loaded with its resolved header map

#### Scenario: Case-variant keys collide

- **WHEN** one entry's `headers` declares both `X-Tag` and `x-tag`
- **THEN** startup fails naming the colliding header paths without printing either value

#### Scenario: The map never reaches a client of the API

- **WHEN** the models endpoint lists a model whose provider entry declares `headers`
- **THEN** the response contains no header name or value from that map

### Requirement: Provider types supply default headers under the operator map

Each provider type SHALL have a default header map: `{ "X-Session-Id": "{session:id}" }` for `openai-responses`, `openai-completions`, `anthropic-messages`, and `opencode-go`, and an empty map for `openai-codex`. The effective map SHALL be the default with the operator's map laid over it key by key, comparing names by ASCII case-folding: a string replaces the default, and `null` removes a default entry.

#### Scenario: An entry without a map sends the default

- **WHEN** an `openai-completions` entry declares no `headers`
- **THEN** its requests carry `X-Session-Id` rendered from the request's Chat identity

#### Scenario: Null removes a default header

- **WHEN** an `anthropic-messages` entry declares `"headers": { "x-session-id": null }`
- **THEN** its requests carry no `X-Session-Id` header under any casing

#### Scenario: An operator value replaces a default

- **WHEN** an `openai-responses` entry declares `"headers": { "X-Session-Id": "llame-{session:id}" }`
- **THEN** its requests carry exactly one `X-Session-Id` header with the operator's rendered value

#### Scenario: Codex sends no default header

- **WHEN** an `openai-codex` entry declares no `headers`
- **THEN** its requests carry no `X-Session-Id` and no other header from a default map

#### Scenario: Codex sends the header when the operator adds it

- **WHEN** an `openai-codex` entry declares `"headers": { "X-Session-Id": "{session:id}" }`
- **THEN** its requests carry `X-Session-Id` rendered from the request's Chat identity

#### Scenario: No default sends an affinity header

- **WHEN** a request is made through an entry of any type whose map does not name `x-session-affinity`
- **THEN** the request carries no `x-session-affinity` header

### Requirement: Operator header values take precedence over the client's own

An operator string value SHALL replace any header the client or adapter would otherwise send under the same name, compared under ASCII case-folding, including `User-Agent` and headers a provider type sets itself. `null` SHALL remove only a default-map entry; it SHALL NOT strip a header the client or adapter sets. Tokens an adapter appends after an operator value are outside llame's control.

#### Scenario: An operator User-Agent replaces llame's

- **WHEN** an `openai-completions` entry declares `"headers": { "User-Agent": "acme-gateway-client/1" }`
- **THEN** its streaming and structured requests carry a `User-Agent` that begins with `acme-gateway-client/1`, not llame's product token

#### Scenario: An operator value replaces a provider type's own header

- **WHEN** an `opencode-go` entry declares `"headers": { "x-opencode-client": "custom" }`
- **THEN** its requests carry `x-opencode-client: custom` and no second value for that header

#### Scenario: Null does not strip a client-owned header

- **WHEN** an `opencode-go` entry declares `"headers": { "x-opencode-session": null }`
- **THEN** startup succeeds
- **AND** its requests still carry the gateway session header llame renders

### Requirement: Header values are templates resolved at startup

A header string value SHALL be parsed once at startup: `{{` is a literal `{`, `{env:…}` and `{path:…}` resolve under the existing interpolation rules, `{session:id}` is a request-time variable, and any other `{name:…}` token SHALL fail startup naming the path. Resolved interpolation output SHALL be treated as literal text. A value that renders empty SHALL omit the header.

#### Scenario: Interpolation and the variable combine

- **WHEN** a value is `"{env:DEPLOY}:{session:id}"` and `DEPLOY` is `prod`
- **THEN** a main-lane request for Chat `c1` carries the value `prod:c1`

#### Scenario: An unknown variable fails startup

- **WHEN** a value contains `{sesion:id}`
- **THEN** startup fails naming the header path
- **AND** the token is never sent verbatim

#### Scenario: An escaped brace is literal

- **WHEN** a value is `"{{session:id}"`
- **THEN** requests carry the literal text `{session:id}`

#### Scenario: Interpolated text is not rescanned

- **WHEN** a value is `"{env:TAG}"` and `TAG` resolves to the text `{session:id}`
- **THEN** requests carry that literal text, not the Chat identity

#### Scenario: An empty value omits the header

- **WHEN** a value is `"{env:TAG:-}"` and `TAG` is unset
- **THEN** requests carry no header of that name

### Requirement: The session variable renders the Chat identity per lane

`{session:id}` SHALL render the request's Chat identity: the Chat's identifier, verbatim, on the `main` lane, and the identifier under a `title:` prefix on the `title` lane, the same rendering the `opencode-go` session header uses. It SHALL be identical for every request of one lane of one Chat across retries, worker restarts, compaction, and model switches, and SHALL differ between Chats. It is not a secret.

#### Scenario: Main turn and compaction share the value

- **WHEN** a run's main turn and a compaction request for the same Chat are made through an entry that sends `X-Session-Id`
- **THEN** both carry the Chat's identifier as the header value

#### Scenario: Title generation carries the title lane

- **WHEN** the title service generates a title through an entry that sends `X-Session-Id`
- **THEN** the request carries `title:` followed by the Chat's identifier

#### Scenario: Two Chats differ and one Chat is stable

- **WHEN** two turns of one Chat and one turn of another Chat are made through the same entry
- **THEN** the first Chat's two requests carry the same value
- **AND** the second Chat's request carries a different value

### Requirement: Every language-model request carries the rendered headers

Every language-model request a provider client makes SHALL carry the entry's effective header map rendered for that request, on streaming and structured-generation requests alike, including compaction and title generation. The rendered headers SHALL NOT reach model context, persisted message parts, or owner-visible output. Embedding requests are exempt.

#### Scenario: An auxiliary request carries the headers

- **WHEN** title generation makes a structured-generation request through an entry with an effective header map
- **THEN** the serialized request carries every header in that map, rendered for the title lane

#### Scenario: A configured custom header reaches the provider

- **WHEN** an `openai-completions` entry declares `"headers": { "x-litellm-tags": "llame" }`
- **THEN** its streaming and structured requests both carry `x-litellm-tags: llame`

### Requirement: Interpolated header values are never disclosed

A header value segment resolved from `{env:…}` or `{path:…}` SHALL be treated as a secret: it SHALL appear in no log, diagnostic, startup error, or run failure message, and a provider failure message that contains it SHALL have it redacted before it reaches the run. A segment written literally in the file is not a secret.

#### Scenario: A startup error does not print a secret value

- **WHEN** a header value's `{path:…}` token fails to resolve at startup
- **THEN** the error names the configuration path and file location, not any resolved value

#### Scenario: An echoed secret is redacted from a failure

- **WHEN** a provider rejects a request with a message that contains a resolved interpolated header value
- **THEN** the run's failure message contains a redaction marker in place of that value
