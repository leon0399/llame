## ADDED Requirements

### Requirement: Configured credentials form one protected set

At startup the API process MUST derive one set of configured credentials. The
set MUST stay in process memory. llame MUST NOT serialize it to an API, an
event, a log, or model context. llame MUST NOT send it to a Machine or a
remote host. The set MUST NOT narrow "Resolved secret values are never
exposed". A name is credential-shaped when it contains, without regard to
case, `authorization`, `cookie`, `credential`, `token`, `key`, `secret`,
`passw`, or `signature`.

#### Scenario: The set is never serialized

- **WHEN** a provider `key` resolves to `sk-canary-set` and an owner requests the model catalog or any other configuration-derived response
- **THEN** no response contains `sk-canary-set`

### Requirement: Only inferred credentials need 8 characters

Every member MUST be nonblank. Only the database password, `PGPASSWORD`, and a
URL userinfo username MUST also need 8 characters to be a member. Every other
member counts at any nonblank length.

#### Scenario: A short database password is not a member

- **WHEN** `POSTGRES_URL` is `postgres://app:app@db:5432/llame`
- **THEN** the set contains the connection string and not `app`
- **AND** a bash result that prints `apps/api/src` is unchanged

#### Scenario: Only the database password and a URL username need 8 characters

- **WHEN** a provider header is `X-Api-Key: {env:GW_KEY}` and `GW_KEY` holds `k-6chr`. A stdio MCP server's `env` value is `{env:MCP_TOKEN}` and `MCP_TOKEN` holds `t0ken`. A provider `baseUrl` is `https://svc:abc123@gw.internal/v1`. The Codex auth document that a provider `key` selects holds a `refresh_token` of `rt-123`
- **THEN** the set contains `k-6chr`, `t0ken`, `abc123`, and `rt-123`
- **AND** it does not contain `svc`

### Requirement: Credential fields and their sources are members

The set MUST contain each provider `key` and `openai-codex` `accountId`. It
MUST contain each web search engine `key` and the `github` web adapter
`token`. This rule applies however llame wrote each value. The set MUST also
contain values from the environment that the configuration loader reads.
Those values are the `POSTGRES_URL` connection string, its password in
percent-encoded and decoded form, and `PGPASSWORD` when it is set.

#### Scenario: Credential fields are members

- **WHEN** a provider declares `key: "{env:OPENAI_KEY}"` and a `brave` engine declares a literal `key`. A `yandex` engine declares `key: "{env:YANDEX_KEY}"` and the `github` adapter declares `token: "{env:GH_TOKEN}"`
- **THEN** the set contains each of those resolved values
- **AND** it does not contain the `yandex` engine's `folderId`

#### Scenario: A short credential field is a member

- **WHEN** a provider declares the literal `key: "secret7"`
- **THEN** the set contains `secret7`

#### Scenario: The database password is a member

- **WHEN** `POSTGRES_URL` is `postgres://app:pw-canary-1065@db:5432/llame`
- **THEN** the set contains the whole connection string and `pw-canary-1065`

### Requirement: A selected JSON document contributes its credential leaves

Each `{path:…|json:…}` substitution can be a member. For that substitution,
the set MUST also contain each string leaf of the selected document under a
credential-shaped name. An element of an array under such a name MUST also be
a member. The loader MUST read those leaves in the same file read that selects
the value.

#### Scenario: A Codex auth document contributes its tokens

- **WHEN** an `openai-codex` provider's `key` is `{path:/run/secrets/codex-auth.json|json:/tokens/access_token}`. That file also holds `tokens.refresh_token`, `tokens.id_token`, and a `last_refresh` timestamp
- **THEN** the set contains the access token, the refresh token, and the id token
- **AND** it does not contain the timestamp

### Requirement: Substitutions in credential-bearing values are members

The set MUST contain each resolved `{env:…}` or `{path:…}` substitution inside
a provider entry's or remote MCP server's `headers`. It MUST also contain each
such substitution in a stdio MCP server's `command`, `args`, or `env` values.
It MUST contain each literal header value whose header name is
credential-shaped. It MUST NOT contain the literal text around a substitution
or a `:-` fallback written in the file.

#### Scenario: Header and stdio substitutions are members

- **WHEN** a provider header is `"Authorization": "Bearer {path:/run/secrets/gw}"`. A stdio MCP server's `args` contain `--token={env:MCP_TOKEN}`
- **THEN** the set contains the resolved file contents and the resolved `MCP_TOKEN`
- **AND** it does not contain `Bearer`, a header name, or `--token=`

#### Scenario: Only credential-shaped literal headers are members

- **WHEN** a remote MCP server declares a literal `X-Api-Key: abcdefgh-canary` and a literal `X-Region: eu-west-1`
- **THEN** the set contains `abcdefgh-canary` and not `eu-west-1`

### Requirement: Credentials in configured URLs are members

For a provider `baseUrl` and a remote MCP `url`, the set MUST contain each
substitution inside the userinfo password or query. It MUST contain each
query value under a credential-shaped name, in a literal or a substituted URL.
It MUST contain the userinfo password at any nonblank length and the username
from 8 characters. It MUST contain each value as written, percent-decoded, and
without ASCII tab, LF, or CR, as URL parsing sends it.
It MUST NOT contain the whole URL or any other part of it.

#### Scenario: A URL substitution is a member

- **WHEN** a remote MCP `url` is `https://mcp.example/mcp?apiKey={env:MCP_KEY}`
- **THEN** the set contains the resolved `MCP_KEY`
- **AND** it does not contain `https://mcp.example/mcp?apiKey=`

#### Scenario: A credential written into a URL is a member

- **WHEN** a remote MCP `url` is the literal `https://mcp.example/mcp?apiKey=sk-canary-1065&region=eu-west-1`. A provider `baseUrl` is `{env:GATEWAY_URL}` and `GATEWAY_URL` resolves to `https://gateway.example/v1?signature=gw-canary-1065`
- **THEN** the set contains `sk-canary-1065` and `gw-canary-1065`
- **AND** it contains neither URL nor `eu-west-1`

#### Scenario: An endpoint is not a member

- **WHEN** a provider `baseUrl` is `{env:OPENAI_BASE_URL:-http://localhost:11434/v1}` and `OPENAI_BASE_URL` is set to `https://gateway.example/v1` or unset
- **THEN** neither URL is in the set

#### Scenario: A URL credential counts in every spelling that llame sends

- **WHEN** a remote MCP `url` holds the query `apiKey=canary%2F1065` and a provider `baseUrl` holds the query `token=canary` followed by a line feed and `secret`
- **THEN** the set contains `canary%2F1065` and `canary/1065`
- **AND** it contains the token with the line feed and `canarysecret`

### Requirement: Other settings are not members

The set MUST NOT contain the resolved `{session:…}` value or the keyless
placeholder that llame sends for a keyless provider. The set MUST NOT contain
any configuration value that the membership requirements do not name. This
rule applies whether or not llame interpolated that value.

#### Scenario: Other interpolations are not members

- **WHEN** `knowledge.root` is `{env:KB_ROOT}`, a numeric configuration value is `{env:POOL_SIZE}`, and the `searxng` `baseUrl` is `{env:SEARXNG_URL}`
- **THEN** none of those resolved values is in the set

#### Scenario: A keyless provider contributes nothing

- **WHEN** a provider's `key` is omitted or resolves blank
- **THEN** no value from that provider's `key` is in the set. The keyless placeholder that llame sends on the wire is also not a member
