# provider-request-headers

## Purpose

Let an operator decide, per provider entry, which extra HTTP headers every
language-model request carries, with per-type defaults that correlate a Chat's
requests for gateways such as LiteLLM.

## Requirements

### Requirement: Provider entries accept an operator header map

Every `providers[]` entry SHALL accept an optional `headers` object whose keys
are header names and whose values are a string or `null`. A value of another
type, or two keys equal under ASCII case-folding, SHALL fail startup naming the
configuration path. A key that the runtime's `Headers` rejects as a header name
SHALL fail startup naming the configuration path. No header name is reserved. The
map is server-only and SHALL NOT be returned by the models endpoint.

#### Scenario: A header map on any provider type loads

- **WHEN** an entry of any executable provider type declares `headers` with a string value and a `null` value
- **THEN** startup succeeds and the entry is loaded with its resolved header map

#### Scenario: Case-variant keys collide

- **WHEN** one entry's `headers` declares both `X-Tag` and `x-tag`
- **THEN** startup fails naming the colliding header paths without printing either value

#### Scenario: An invalid header name fails startup

- **WHEN** an entry declares `"headers": { "bad name": "x" }`
- **THEN** startup fails naming the header path

#### Scenario: The map never reaches a client of the API

- **WHEN** the models endpoint lists a model whose provider entry declares `headers`
- **THEN** the response contains no header name or value from that map

### Requirement: Provider types supply default headers under the operator map

Each provider type MUST have a default header map. The map `{ "X-Session-Id": "{session:id}" }` is the default for `openai-responses`, `openai-completions`, `anthropic-messages`, and `opencode-go`. The default map is empty for `openai-codex`, `system-one`, and `cohere-rerank`. The effective map MUST be the default map with the operator map laid over it key by key. Names compare without ASCII letter case. A string value replaces the default value. A `null` value removes a default entry.

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

### Requirement: Operator header values take precedence over the client's own

An operator string value SHALL replace any header llame's client sets under the same name, compared under ASCII case-folding, including `User-Agent`, credentials, and the session and identity headers other capabilities require; those requirements describe the default. `null` and an empty render SHALL withdraw only the operator or default value, never a client-set header. A header the adapter composes after per-call headers is outside this precedence.

#### Scenario: The Messages adapter merges a lowercase anthropic-beta

- **WHEN** an `anthropic-messages` entry declares `"headers": { "anthropic-beta": "x" }`
- **THEN** its requests carry `x` merged with the adapter's own betas
- **AND** on a streaming request, a differently cased `Anthropic-Beta` is replaced by the adapter's own value

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

#### Scenario: An empty render does not strip a client-owned header

- **WHEN** an `opencode-go` entry declares `"headers": { "x-opencode-session": "{env:S:-}" }` and `S` is unset
- **THEN** its requests carry the gateway session header llame renders

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

### Requirement: The session variable renders the Chat identity per lane

`{session:id}` SHALL render the request's Chat identity as the `opencode-go` session header does for the `main` and `title` lanes: the Chat's identifier, verbatim, on the `main` lane (the main turn and compaction), and under a `title:` prefix on the `title` lane. It SHALL render under a `search:` prefix on the `search` lane used by the hosted-search sub-requests of `web-search` model-hosted engines. It is not a secret.

#### Scenario: Main turn and compaction share the value

- **WHEN** a run's main turn and a compaction request for the same Chat are made through an entry that sends `X-Session-Id`
- **THEN** both carry the Chat's identifier as the header value

#### Scenario: Title generation carries the title lane

- **WHEN** the title service makes a structured-generation request through an entry that sends `X-Session-Id`
- **THEN** the serialized request carries `title:` followed by the Chat's identifier

#### Scenario: A hosted web search carries the search lane

- **WHEN** a model-hosted web search engine makes its sub-request for a Run in Chat `c1` through an entry that sends `X-Session-Id`
- **THEN** the serialized request carries `search:c1` as the header value

### Requirement: Every language-model request carries the rendered headers

Every language-model request a provider client makes SHALL carry the entry's effective header map rendered for that request, on streaming and structured-generation requests alike, including compaction and title generation. llame SHALL NOT place rendered headers in model context, persisted message parts, or owner-visible output. Embedding requests are exempt.

#### Scenario: A configured custom header reaches the provider

- **WHEN** an `openai-completions` entry declares `"headers": { "x-litellm-tags": "llame" }`
- **THEN** its streaming and structured requests both carry `x-litellm-tags: llame`

### Requirement: Interpolated header values get the provider key's non-disclosure

A header value that `{env:…}` or `{path:…}` resolves MUST get the protection
of a provider `key`. llame MUST NOT write it to a log, a diagnostic, or a
startup error. A resolved value with CR, LF, or NUL MUST fail startup and name
the path, because the header validation error quotes the value. If a provider
echoes a resolved header value that is a member, llame MUST redact it
(`provider-api-selection`, "Provider failures never carry a configured
credential").

#### Scenario: A startup error does not print a secret value

- **WHEN** a header value's `{path:…}` token fails to resolve at startup
- **THEN** the error names the configuration path and file location, not any resolved value

#### Scenario: A control character fails startup without disclosure

- **WHEN** a header value's `{env:…}` token resolves to text with a line feed
- **THEN** startup fails, names the header path, and does not print the resolved value

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
