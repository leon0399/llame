## MODIFIED Requirements

### Requirement: Provider list configuration

The config file SHALL support a top-level `providers` array of duplicable provider entries, discriminated by `type`. `id` SHALL be a non-empty operator-chosen identifier, unique within the array. `type` SHALL select the client implementation and the wire API it speaks, and SHALL be constrained by the schema to the set of executable provider types (`"openai-responses"` for the Responses wire through `@ai-sdk/openai`; `"openai-completions"` for the Chat Completions wire through `@ai-sdk/openai-compatible`; `"anthropic-messages"` for the Messages wire through `@ai-sdk/anthropic`; `"openai-codex"` for the Codex subscription backend; `"opencode-go"` for the OpenCode Go subscription gateway, which executes the Chat Completions wire at an endpoint fixed in llame's code). The `openai-responses` variant SHALL accept `{ id, type, key?, baseUrl? }`, with `baseUrl` defaulting to the OpenAI API; the `openai-completions` variant SHALL accept `{ id, type, key?, baseUrl }`, with `baseUrl` required; the `anthropic-messages` variant SHALL accept `{ id, type, key?, baseUrl? }`, with `baseUrl` defaulting to the Anthropic API; the `opencode-go` variant SHALL accept `{ id, type, key }` and no other field, with `key` a string supporting `{env:…}`/`{path:…}` interpolation that SHALL resolve nonblank. For all three wire types, `key` and `baseUrl` SHALL be strings supporting `{env:…}`/`{path:…}` interpolation, and a `key` that resolves to empty SHALL mark the provider **keyless** (no credential), preserving the empty-resolution-means-unset semantics. Duplicate ids, or a `type` outside the schema enum (including the retired `"openai"` and a bare `"anthropic"`), SHALL fail startup naming the offending entry.

Resolved `key` values SHALL never be written to logs, errors, or diagnostics; a load-time error on a provider field SHALL identify the entry by `id` and the field name, never the resolved value.

The `openai-codex` variant SHALL require `{ id, type, key, accountId }`, with nonblank resolved strings for `key` and `accountId`, supporting existing interpolation. It SHALL reject `baseUrl` and arbitrary headers. Resolved `accountId` values SHALL receive the same non-disclosure protections as credentials. Embedding model entries SHALL NOT reference an `openai-codex`, `anthropic-messages`, or `opencode-go` provider.

#### Scenario: Duplicable providers of the same type coexist

- **WHEN** the file defines two providers of the same `type` with distinct ids (e.g. two `openai-completions` endpoints on different `baseUrl`s, or two `openai-responses` providers with different keys)
- **THEN** both are loaded as distinct providers keyed by `id`
- **AND** startup succeeds

#### Scenario: Unsupported provider type fails at boot

- **WHEN** a provider entry sets `type` to a value outside the schema enum (e.g. the retired `"openai"`, or a bare `"anthropic"`)
- **THEN** startup fails naming the entry and the invalid `type`

#### Scenario: OpenAI-completions provider loads by shape

- **WHEN** the file defines a `type: "openai-completions"` provider with a `baseUrl` and a `key` that resolves to empty
- **THEN** it is loaded as a keyless provider targeting that base URL
- **AND** startup succeeds without contacting the endpoint

#### Scenario: OpenAI-completions provider requires a base URL

- **WHEN** the file defines a `type: "openai-completions"` provider whose `baseUrl` is omitted or resolves to empty
- **THEN** startup fails naming the entry and the `baseUrl` field

#### Scenario: Anthropic provider loads by shape

- **WHEN** the file defines a `type: "anthropic-messages"` provider without a `baseUrl` and another with a `baseUrl` naming a non-Anthropic host and a `key` that resolves to empty
- **THEN** both are loaded as distinct providers keyed by `id`, the first targeting the Anthropic API and the second loaded keyless against its base URL exactly as authored
- **AND** startup succeeds without contacting either endpoint

#### Scenario: OpenCode Go provider loads by shape

- **WHEN** the file defines a `type: "opencode-go"` provider whose `key` resolves nonblank
- **THEN** it is loaded as a provider keyed by `id` with its resolved key, and no endpoint field of its own
- **AND** startup succeeds without contacting the gateway

#### Scenario: OpenCode Go provider rejects a base URL

- **WHEN** the file defines a `type: "opencode-go"` provider that also sets `baseUrl`
- **THEN** startup fails naming the offending configuration path
- **AND** the entry is not loaded with the field ignored, and no endpoint is contacted

#### Scenario: OpenCode Go provider requires a non-empty key

- **WHEN** the file defines a `type: "opencode-go"` provider whose `key` is omitted, or resolves to empty through interpolation
- **THEN** startup fails naming the entry and the `key` field
- **AND** the provider is never loaded as keyless, because the gateway authenticates every request

#### Scenario: Keyless provider

- **WHEN** an `openai-completions` provider's `key` is `"{env:OLLAMA_API_KEY:-}"` and `OLLAMA_API_KEY` is unset
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

- **WHEN** an embedding model entry references a Codex provider
- **THEN** startup fails identifying the unsupported provider binding

#### Scenario: Anthropic provider cannot back embeddings

- **WHEN** an embedding model entry references an `anthropic-messages` provider
- **THEN** startup fails identifying the unsupported provider binding

#### Scenario: OpenCode Go provider cannot back embeddings

- **WHEN** an embedding model entry references an `opencode-go` provider
- **THEN** startup fails identifying the unsupported provider binding
- **AND** no partial catalog is applied
