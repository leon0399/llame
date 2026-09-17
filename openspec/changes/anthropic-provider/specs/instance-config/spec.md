## MODIFIED Requirements

### Requirement: Provider list configuration

The config file SHALL support a top-level `providers` array of duplicable provider entries, discriminated by `type`. `id` SHALL be a non-empty operator-chosen identifier, unique within the array. `type` SHALL select the client implementation and SHALL be constrained by the schema to the set of executable provider types (`"openai"` for native OpenAI; `"openai-compatible"` for OpenAI-compatible endpoints; `"openai-codex"` for the Codex subscription backend; `"anthropic"` for Anthropic's own Messages API; `"anthropic-compatible"` for the Messages wire format at an operator-supplied base URL). The `openai` variant SHALL accept `{ id, type, key?, baseUrl? }`; its `key` and `baseUrl` SHALL be strings supporting `{env:…}`/`{path:…}` interpolation. An `openai` `key` that resolves to empty SHALL mark the provider **keyless** (no credential), preserving the empty-resolution-means-unset semantics. Duplicate ids, or a `type` outside the schema enum, SHALL fail startup naming the offending entry.

Resolved `key` values SHALL never be written to logs, errors, or diagnostics; a load-time error on a provider field SHALL identify the entry by `id` and the field name, never the resolved value.

The `anthropic` variant SHALL accept `{ id, type, key?, baseUrl? }`: `key` supplies the API credential, and the optional `baseUrl` targets Anthropic behind a proxy. The `anthropic-compatible` variant SHALL require `{ id, type, key?, baseUrl }`, because the destination is operator-supplied and no default exists. Both variants' `key` and `baseUrl` SHALL be strings supporting `{env:…}`/`{path:…}` interpolation, and an anthropic `key` that resolves to empty SHALL mark the provider **keyless**, preserving the empty-resolution-means-unset semantics. A `baseUrl` whose host or shape does not correspond to the vendor implied by the entry's `type` SHALL be accepted unchanged: no load-time error, warning, migration, or reinterpretation applies.

The `openai-codex` variant SHALL require `{ id, type, key, accountId }`, with nonblank resolved strings for `key` and `accountId`, supporting existing interpolation. It SHALL reject `baseUrl` and arbitrary headers. Resolved `accountId` values SHALL receive the same non-disclosure protections as credentials. Embedding model entries SHALL NOT reference an `openai-codex`, `anthropic`, or `anthropic-compatible` provider.

#### Scenario: Duplicable providers of the same type coexist

- **WHEN** the file defines two providers of the same `type` with distinct ids (e.g. two OpenAI-compatible endpoints on different `baseUrl`s)
- **THEN** both are loaded as distinct providers keyed by `id`
- **AND** startup succeeds

#### Scenario: Unsupported provider type fails at boot

- **WHEN** a provider entry sets `type` to a value outside the schema enum (e.g. `"gemini"`)
- **THEN** startup fails naming the entry and the invalid `type`

#### Scenario: Anthropic provider variants load by shape

- **WHEN** the file defines a `type: "anthropic"` provider with an optional `baseUrl` and a `type: "anthropic-compatible"` provider with a required `baseUrl`
- **THEN** both are loaded as distinct providers keyed by `id`
- **AND** startup succeeds without probing either endpoint

#### Scenario: A compatible provider requires a base URL

- **WHEN** an `anthropic-compatible` entry omits `baseUrl`
- **THEN** startup fails naming the entry and the missing field

#### Scenario: A mismatched base URL is accepted unchanged at boot

- **WHEN** an entry's `baseUrl` does not identify the vendor implied by its `type`
- **THEN** startup succeeds and emits no warning about the mismatch
- **AND** the entry is used exactly as authored rather than migrated or re-pointed

#### Scenario: Keyless provider

- **WHEN** an `openai` provider's `key` is `"{env:OLLAMA_API_KEY:-}"` and `OLLAMA_API_KEY` is unset
- **THEN** the provider is loaded as keyless
- **AND** startup succeeds

#### Scenario: Provider key is never exposed

- **WHEN** a provider `key` resolves to a credential
- **THEN** the resolved value appears in no log line, error, or diagnostic output
- **AND** any error about that entry names it by `id` and field, not by value

#### Scenario: Codex credentials resolve at startup

- **WHEN** a Codex provider has valid nonblank access token and account ID references
- **THEN** each API and worker process loads them once at startup
- **AND** its provider is available through the configured model catalog without a network authentication probe

#### Scenario: Missing or invalid Codex configuration

- **WHEN** a Codex credential file is missing, JSON is invalid, its pointer is absent or not a string, either resolved credential is blank, or a forbidden endpoint/header field is supplied
- **THEN** startup fails with a field-identifying diagnostic without resolved values or file contents

#### Scenario: Subscription provider cannot back embeddings

- **WHEN** an embedding model entry references an `openai-codex`, `anthropic`, or `anthropic-compatible` provider
- **THEN** startup fails identifying the unsupported provider binding
