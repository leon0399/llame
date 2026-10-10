## ADDED Requirements

### Requirement: Configured credentials form one protected set

At startup the instance configuration SHALL derive one set of configured
credentials, held only in process memory and never serialized to an API, an
event, a log, or model context. Its members SHALL be the resolved values of
the credential-typed fields, written literally or interpolated, and the
resolved `{env:…}` and `{path:…}` substitutions inside the credential-bearing
maps.

#### Scenario: Credential-typed fields are members

- **WHEN** a provider declares `key: "{env:OPENAI_KEY}"`, an `openai-codex` provider declares an `accountId`, a web-search engine declares a literal `key`, and the `github` web adapter declares `token: "{env:GH_TOKEN}"`
- **THEN** the set contains each of those resolved values

#### Scenario: Substitutions in credential-bearing maps are members

- **WHEN** a provider header is `"Bearer {path:/run/secrets/gw}"`, a remote MCP server header resolves an `{env:…}` token, and a stdio MCP server's `command`, `args`, or `env` resolves an `{env:…}` or `{path:…}` token
- **THEN** the set contains each resolved substitution
- **AND** it does not contain the literal `Bearer` prefix or any header name

### Requirement: Non-credential settings are not protected

The configured credential set SHALL NOT contain the literal text of a
credential-bearing map, a `{session:…}` rendering, the keyless placeholder
llame sends for a keyless provider, an empty value, or the value of any other
setting, whether or not it was interpolated.

#### Scenario: Other interpolations are not members

- **WHEN** `knowledge.root` is `{env:KB_ROOT}` and a numeric setting is `{env:POOL_SIZE}`
- **THEN** neither resolved value is in the set

#### Scenario: A keyless provider contributes nothing

- **WHEN** a provider's `key` is omitted or resolves blank
- **THEN** no value from that provider's `key` is in the set, including the keyless placeholder llame sends on the wire
