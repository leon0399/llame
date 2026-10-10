## ADDED Requirements

### Requirement: Configured credentials form one protected set

At startup the API process SHALL derive one set of configured credentials,
held only in process memory and never serialized to an API, an event, a log,
or model context. It SHALL NOT narrow "Resolved secret values are never
exposed". A value shorter than 8 characters SHALL NOT be a member. A name is
credential-shaped when it contains, ignoring case, `authorization`, `cookie`,
`token`, `key`, `secret`, or `password`.

#### Scenario: The set is never serialized

- **WHEN** a provider `key` resolves to `sk-canary-set` and an owner requests the model catalog or any other configuration-derived response
- **THEN** no response contains `sk-canary-set`

#### Scenario: A short value is never a member

- **WHEN** `POSTGRES_URL` is `postgres://app:app@db:5432/llame`
- **THEN** the set contains the connection string and not `app`
- **AND** a bash result printing `apps/api/src` is unchanged

### Requirement: Credential fields and their sources are members

The set SHALL contain each provider `key` and `openai-codex` `accountId`, each
`brave`, `exa`, `perplexity`, and `exa-mcp` engine `key`, and the `github`
adapter `token`, written literally or interpolated; the `POSTGRES_URL`
connection string and its password, and `PGPASSWORD` when set; and, for every
`{path:…|json:…}` substitution that is a member, each string leaf of the
selected document whose property name is credential-shaped.

#### Scenario: Credential fields are members

- **WHEN** a provider declares `key: "{env:OPENAI_KEY}"`, a `brave` engine declares a literal `key`, and the `github` adapter declares `token: "{env:GH_TOKEN}"`
- **THEN** the set contains each of those resolved values

#### Scenario: A selected JSON document contributes its other secrets

- **WHEN** an `openai-codex` provider's `key` is `{path:/run/secrets/codex-auth.json|json:/tokens/access_token}` and that file also holds `tokens.refresh_token`, `tokens.id_token`, and a `last_refresh` timestamp
- **THEN** the set contains the access token, the refresh token, and the id token
- **AND** it does not contain the timestamp

#### Scenario: The database password is a member

- **WHEN** `POSTGRES_URL` is `postgres://app:pw-canary-1065@db:5432/llame`
- **THEN** the set contains the whole connection string and `pw-canary-1065`

### Requirement: Substitutions in credential-bearing values are members

The set SHALL contain each resolved `{env:…}` or `{path:…}` substitution
inside a provider entry's `headers` or `baseUrl`, a remote MCP server's `url`
or `headers`, a `searxng` engine's `baseUrl`, and a stdio MCP server's `env`
values; and each literal header value, provider or remote MCP, whose header
name is credential-shaped. It SHALL NOT contain the literal text around a
substitution.

#### Scenario: Header and URL substitutions are members

- **WHEN** a provider header is `"Authorization": "Bearer {path:/run/secrets/gw}"` and a remote MCP `url` is `https://mcp.example/mcp?apiKey={env:MCP_KEY}`
- **THEN** the set contains the resolved file contents and the resolved `MCP_KEY`
- **AND** it does not contain `Bearer`, a header name, or `https://mcp.example/mcp?apiKey=`

#### Scenario: Only credential-shaped literal headers are members

- **WHEN** a remote MCP server declares a literal `X-Api-Key: abcdefgh-canary` and a literal `Accept: application/json`
- **THEN** the set contains `abcdefgh-canary` and not `application/json`

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
