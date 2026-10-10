## ADDED Requirements

### Requirement: Configured credentials form one protected set

At startup the API process SHALL derive one set of configured credentials,
held only in process memory and never serialized to an API, an event, a log,
or model context. The set is the redaction source other capabilities name; it
SHALL NOT narrow "Resolved secret values are never exposed", which still
governs llame's own logs and errors. An empty value SHALL NOT be a member.

#### Scenario: The set is never serialized

- **WHEN** a provider `key` resolves to `sk-canary-set` and an owner requests the model catalog or any other configuration-derived response
- **THEN** no response contains `sk-canary-set`

### Requirement: Credential fields and their sources are members

The set SHALL contain the resolved value of each provider `key` and
`openai-codex` `accountId`, each `brave`, `exa`, `perplexity`, and `exa-mcp`
engine `key`, the `github` web adapter `token`, and each remote MCP header
value, written literally or interpolated; every non-empty string leaf of a
JSON document a `{path:…|json:…}` token of one of those fields selects from;
and the `POSTGRES_URL` connection string the process connects with, and its
password.

#### Scenario: Credential fields are members

- **WHEN** a provider declares `key: "{env:OPENAI_KEY}"`, a `brave` engine declares a literal `key`, the `github` adapter declares `token: "{env:GH_TOKEN}"`, and a remote MCP server declares a literal `X-Api-Key` header
- **THEN** the set contains each of those resolved values

#### Scenario: A selected JSON document contributes its other secrets

- **WHEN** an `openai-codex` provider's `key` is `{path:/run/secrets/codex-auth.json|json:/tokens/access_token}` and that file also holds `tokens.refresh_token` and `tokens.id_token`
- **THEN** the set contains the access token, the refresh token, and the id token

#### Scenario: The database password is a member

- **WHEN** `POSTGRES_URL` is `postgres://app:pw-canary@db:5432/llame`
- **THEN** the set contains the whole connection string and `pw-canary`

### Requirement: Substitutions in credential-bearing values are members

The set SHALL contain each resolved `{env:…}` or `{path:…}` substitution
inside a provider entry's `headers` or `baseUrl`, a remote MCP server's `url`,
and a stdio MCP server's `env` values, and SHALL NOT contain the literal text
around those substitutions.

#### Scenario: A header and a URL substitution are members

- **WHEN** a provider header is `"Bearer {path:/run/secrets/gw}"` and a remote MCP `url` is `https://mcp.example/mcp?apiKey={env:MCP_KEY}`
- **THEN** the set contains the resolved file contents and the resolved `MCP_KEY`
- **AND** it does not contain `Bearer`, a header name, or `https://mcp.example/mcp?apiKey=`

### Requirement: Other settings are not members

The set SHALL NOT contain a `{session:…}` rendering, the keyless placeholder
llame sends for a keyless provider, a substitution in a stdio MCP server's
`command` or `args`, or the value of any setting not named by the membership
requirements, whether or not it was interpolated.

#### Scenario: Other interpolations are not members

- **WHEN** `knowledge.root` is `{env:KB_ROOT}`, a numeric setting is `{env:POOL_SIZE}`, and a stdio MCP server's `args` contain `{env:HOME}`
- **THEN** none of those resolved values is in the set

#### Scenario: A keyless provider contributes nothing

- **WHEN** a provider's `key` is omitted or resolves blank
- **THEN** no value from that provider's `key` is in the set, including the keyless placeholder llame sends on the wire
