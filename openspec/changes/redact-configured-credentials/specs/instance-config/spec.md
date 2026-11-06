## ADDED Requirements

### Requirement: Configured credentials form one protected set

At startup the API process MUST derive one set of configured credentials. The
set MUST stay in process memory and MUST NOT change after startup. llame MUST
NOT serialize it to an API, an event, a log, or model context, or send it to a
Machine or a remote host. llame sends values without the whitespace at their
two ends. If that trimmed form of a member passes the gate, the trimmed form
MUST also be a member.

#### Scenario: The set is never serialized

- **WHEN** a provider `key` resolves to `sk-canary-7Qx2Lm9Vb4Rt8Wn3` and an owner requests the model catalog or any other configuration-derived response
- **THEN** no response contains `sk-canary-7Qx2Lm9Vb4Rt8Wn3`

#### Scenario: A padded credential also counts trimmed

- **WHEN** a provider `key` resolves to `  sk-canary-7Qx2Lm9Vb4Rt8Wn3  `
- **THEN** the set contains the padded value and `sk-canary-7Qx2Lm9Vb4Rt8Wn3`

#### Scenario: The set never reaches a Machine or a remote host

- **WHEN** a run whose set holds `sk-canary-7Qx2Lm9Vb4Rt8Wn3` sends an `ssh://` command and a Machine command that do not contain it
- **THEN** neither request to the remote host nor request to the Machine contains `sk-canary-7Qx2Lm9Vb4Rt8Wn3`

### Requirement: Only high-entropy values are members

A member MUST have at least 16 characters and an estimated entropy of at
least 64 bits. The estimate is the length times the Shannon entropy per
character of the value's own characters. A value below either bound MUST NOT
be a member, so llame does not redact it from a command result or an upstream
failure. llame MUST NOT detect a credential by its format. llame still never
writes a resolved secret value to its own logs, errors, or diagnostics.

#### Scenario: A short or simple value is not a member

- **WHEN** `POSTGRES_URL` is `postgres://app:app@db:5432/llame` and a provider declares the literal `key` `app`
- **THEN** the set contains neither `app` nor `postgres`
- **AND** a bash result that prints `apps/api/src` is unchanged

#### Scenario: A long repetitive value is not a member

- **WHEN** a provider declares the literal `key` `aaaaaaaaaaaaaaaaaaaa`
- **THEN** the set does not contain it

#### Scenario: A 32-character hexadecimal key is a member

- **WHEN** a provider declares the literal `key` `9f2c7b1e4d8a6350c9e2b7f4a1d8635e`
- **THEN** the set contains that key

#### Scenario: A long passphrase is a member

- **WHEN** a provider declares the literal `key` `correct horse battery staple`
- **THEN** the set contains that key

#### Scenario: A format alone does not make a member

- **WHEN** a provider declares the literal `key` `sk-1065-short`
- **THEN** the set does not contain it, although the value begins with `sk-`

### Requirement: Credential fields are members

The set MUST contain each provider `key` that passes the gate. This rule
covers every provider type. A keyless provider MUST contribute no value. The
set MUST contain each web search engine `key` and the `github` web adapter
`token` that passes the gate.

#### Scenario: Credential fields are members

- **WHEN** a provider declares `key: "{env:OPENAI_KEY}"` and `OPENAI_KEY` holds `sk-canary-7Qx2Lm9Vb4Rt8Wn3`. A `brave` engine declares the literal key `brave-7Qx2Lm9Vb4Rt8Wn3`. A `yandex` engine declares `key: "{env:YANDEX_KEY}"` and `YANDEX_KEY` holds `yandex-7Qx2Lm9Vb4Rt8Wn3`. The `github` adapter declares `token: "{env:GH_TOKEN}"` and `GH_TOKEN` holds `ghp_9rT2xK7pLm4Vb8Qn1Wc6Zd3Fh5Js0YaE`
- **THEN** the set contains each of those four resolved values

### Requirement: A selected JSON document contributes its credential leaves

A `{path:…|json:…}` substitution in a member position selects a document. Each
credential-shaped string leaf of that document that passes the gate MUST be a
member, whether or not the selected value passes. A name is credential-shaped
when it contains, without regard to case, `authorization`, `cookie`,
`credential`, `token`, `key`, `secret`, `passw`, or `signature`. Array
elements under such a name count as leaves. The loader MUST read the leaves in
the same file read that selects the value.

#### Scenario: A Codex auth document contributes its tokens

- **WHEN** an `openai-codex` provider's `key` is `{path:/run/secrets/codex-auth.json|json:/tokens/access_token}` and the access token is `at-7Qx2Lm9Vb4Rt8Wn3`. That file also holds `tokens.refresh_token` `rt-7Qx2Lm9Vb4Rt8Wn3`, `tokens.id_token` `id-7Qx2Lm9Vb4Rt8Wn3`, and a `last_refresh` timestamp
- **THEN** the set contains the access token, the refresh token, and the id token
- **AND** it does not contain the timestamp

#### Scenario: An array under a credential name contributes its elements

- **WHEN** the selected document holds `tokens.api_keys` as the array `["ak-7Qx2Lm9Vb4Rt8Wn3", "bk-7Qx2Lm9Vb4Rt8Wn3"]`
- **THEN** the set contains both elements

### Requirement: Environment credentials are members

The set MUST contain the `POSTGRES_URL` password, as written and
percent-decoded, and `PGPASSWORD`, each when it passes the gate. The loader
MUST read them from the process environment that it was given. The set MUST
NOT contain the whole `POSTGRES_URL`.

#### Scenario: The database password and PGPASSWORD are members

- **WHEN** `POSTGRES_URL` is `postgres://app:pw%407Qx2Lm9Vb4Rt8Wn3@db:5432/llame` and `PGPASSWORD` is `pgp-7Qx2Lm9Vb4Rt8Wn3`
- **THEN** the set contains `pw%407Qx2Lm9Vb4Rt8Wn3`, `pw@7Qx2Lm9Vb4Rt8Wn3`, and `pgp-7Qx2Lm9Vb4Rt8Wn3`
- **AND** it does not contain the whole `POSTGRES_URL`

### Requirement: Header and stdio env substitutions are members

Each resolved `{env:…}` or `{path:…}` substitution in a provider or remote MCP
server's `headers` MUST be a member when it passes the gate. The same rule
applies to each stdio MCP server `env` value. The set MUST NOT contain literal
text around a substitution or `:-` fallback text.

#### Scenario: Header and stdio env substitutions are members

- **WHEN** a provider header is `"Authorization": "Bearer {path:/run/secrets/gw}"` and the file holds `gw-7Qx2Lm9Vb4Rt8Wn3`. A remote MCP header is `{env:MCP_GW_KEY}` and `MCP_GW_KEY` holds `mcp-gw-7Qx2Lm9Vb4Rt8Wn3`. A stdio MCP server's `env` value is `{env:MCP_TOKEN}` and `MCP_TOKEN` holds `mcp-7Qx2Lm9Vb4Rt8Wn3`
- **THEN** the set contains `gw-7Qx2Lm9Vb4Rt8Wn3`, `mcp-gw-7Qx2Lm9Vb4Rt8Wn3`, and `mcp-7Qx2Lm9Vb4Rt8Wn3`
- **AND** it does not contain `Bearer`, a header name, a variable name, or text around a substitution

#### Scenario: A fallback text is not a member

- **WHEN** a provider header is `X-Api-Key: {env:GW_KEY:-fb-7Qx2Lm9Vb4Rt8Wn3}` and `GW_KEY` is unset
- **THEN** the set does not contain `fb-7Qx2Lm9Vb4Rt8Wn3` or `X-Api-Key`

### Requirement: Other settings are not members

The set MUST NOT contain a provider `baseUrl`, a remote MCP `url`, or any part
of either. It MUST NOT contain a substitution in a stdio `command` or `args`,
or a literal header value. It MUST NOT contain the `openai-codex` `accountId`,
the `yandex` `folderId`, or a resolved `{session:…}` value. It MUST NOT
contain the keyless placeholder. It MUST NOT contain any configuration value
that the membership requirements do not name.

#### Scenario: URLs and their parts are not members

- **WHEN** a remote MCP `url` is the literal `https://mcp.example/mcp?apiKey=sk-canary-7Qx2Lm9Vb4Rt8Wn3&region=eu-west-1`. A provider `baseUrl` is `{env:GATEWAY_URL}` and `GATEWAY_URL` holds `https://gateway.example/v1?signature=gw-7Qx2Lm9Vb4Rt8Wn3`
- **THEN** the set contains no part of either URL

#### Scenario: A stdio command and args are not members

- **WHEN** a stdio MCP server's `command` is `{env:MCP_BIN}` and an `args` value is `{env:MCP_TOKEN}`, and those variables hold `mcp-bin-7Qx2Lm9Vb4Rt8Wn3` and `mcp-token-7Qx2Lm9Vb4Rt8Wn3`
- **THEN** the set contains neither value

#### Scenario: A literal header value is not a member

- **WHEN** a remote MCP server declares a literal `X-Api-Key` header whose value is `hdr-7Qx2Lm9Vb4Rt8Wn3`, and a literal `X-Region` header whose value is `eu-west-1`
- **THEN** the set contains neither value

#### Scenario: The account ID, session value, and folder ID are not members

- **WHEN** an `openai-codex` provider declares `accountId: acct-7Qx2Lm9Vb4Rt8Wn3`, a header holds `{session:id}` with the value `sess-7Qx2Lm9Vb4Rt8Wn3`, and a `yandex` engine declares `folderId: folder-7Qx2Lm9Vb4Rt8Wn3`
- **THEN** the set contains none of those values

#### Scenario: Other interpolations are not members

- **WHEN** `knowledge.root` is `{env:KB_ROOT}`, a numeric configuration value is `{env:POOL_SIZE}`, and the `searxng` `baseUrl` is `{env:SEARXNG_URL}`
- **THEN** none of those resolved values is in the set

#### Scenario: A keyless provider contributes nothing

- **WHEN** a provider's `key` is omitted or resolves blank
- **THEN** no value from that provider's `key` is in the set. The keyless placeholder that llame sends on the wire is also not a member
