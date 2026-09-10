## MODIFIED Requirements

### Requirement: Provider list configuration

The config file SHALL support a top-level `providers` array of duplicable provider entries, discriminated by `type`. `id` SHALL be a non-empty operator-chosen identifier, unique within the array. `type` SHALL select the client implementation and SHALL be constrained by the schema to the set of executable provider types (`"openai"` for native OpenAI and OpenAI-compatible endpoints; `"openai-codex"` for the Codex subscription backend). The `openai` variant SHALL accept `{ id, type, key?, baseUrl? }`; its `key` and `baseUrl` SHALL be strings supporting `{env:…}`/`{path:…}` interpolation. An `openai` `key` that resolves to empty SHALL mark the provider **keyless** (no credential), preserving the empty-resolution-means-unset semantics. Duplicate ids, or a `type` outside the schema enum, SHALL fail startup naming the offending entry.

Resolved `key` values SHALL never be written to logs, errors, or diagnostics; a load-time error on a provider field SHALL identify the entry by `id` and the field name, never the resolved value.

#### Scenario: Duplicable providers of the same type coexist

- **WHEN** the file defines two `type: "openai"` providers with distinct ids (e.g. a hosted OpenAI and a local Ollama on a different `baseUrl`)
- **THEN** both are loaded as distinct providers keyed by `id`
- **AND** startup succeeds

#### Scenario: Unsupported provider type fails at boot

- **WHEN** a provider entry sets `type` to a value outside the schema enum (e.g. `"anthropic"` before the adapter exists)
- **THEN** startup fails naming the entry and the invalid `type`

#### Scenario: Keyless provider

- **WHEN** an `openai` provider's `key` is `"{env:OLLAMA_API_KEY:-}"` and `OLLAMA_API_KEY` is unset
- **THEN** the provider is loaded as keyless
- **AND** startup succeeds

#### Scenario: Provider key is never exposed

- **WHEN** a provider `key` resolves to a credential
- **THEN** the resolved value appears in no log line, error, or diagnostic output
- **AND** any error about that entry names it by `id` and field, not by value

The `openai-codex` variant SHALL require `{ id, type, key, accountId }`, with nonblank resolved strings for `key` and `accountId`, supporting existing interpolation. It SHALL reject `baseUrl` and arbitrary headers. Resolved `accountId` values SHALL receive the same non-disclosure protections as credentials. Embedding model entries SHALL NOT reference an `openai-codex` provider.

#### Scenario: Codex credentials resolve at startup

- **WHEN** a Codex provider has valid nonblank access token and account ID references
- **THEN** each API and worker process loads them once at startup
- **AND** its provider is available through the configured model catalog without a network authentication probe

#### Scenario: Missing or invalid Codex configuration

- **WHEN** a Codex credential file is missing, JSON is invalid, its pointer is absent or not a string, either resolved credential is blank, or a forbidden endpoint/header field is supplied
- **THEN** startup fails with a field-identifying diagnostic without resolved values or file contents

#### Scenario: Subscription provider cannot back embeddings

- **WHEN** an embedding model entry references a Codex provider
- **THEN** startup fails identifying the unsupported provider binding
