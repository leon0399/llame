## MODIFIED Requirements

### Requirement: Provider list configuration

The config file SHALL support a top-level `providers` array of duplicable provider entries, discriminated by `type`. `id` SHALL be a non-empty operator-chosen identifier, unique within the array. `type` SHALL select the client implementation and SHALL be constrained by the schema to the set of executable provider types (`"openai"` for native OpenAI and OpenAI-compatible endpoints; `"openai-codex"` for the Codex subscription backend). The `openai` variant SHALL accept `{ id, type, key?, baseUrl? }`; its `key` and `baseUrl` SHALL be strings supporting `{env:…}`/`{path:…}` interpolation. An `openai` `key` that resolves to empty SHALL mark the provider **keyless** (no credential), preserving the empty-resolution-means-unset semantics. Duplicate ids, or a `type` outside the schema enum, SHALL fail startup naming the offending entry.

Resolved `key` values SHALL never be written to logs, errors, or diagnostics; a load-time error on a provider field SHALL identify the entry by `id` and the field name, never the resolved value.

The `openai-codex` variant SHALL require `{ id, type, key, accountId }`, with nonblank resolved strings for `key` and `accountId`, supporting existing interpolation. It SHALL reject `baseUrl` and arbitrary headers. Resolved `accountId` values SHALL receive the same non-disclosure protections as credentials. Embedding model entries SHALL NOT reference an `openai-codex` provider.

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

### Requirement: Embedding model catalog configuration

The config file SHALL support an optional top-level `embeddingModels` array declaring the embedding models an instance may use. Each entry SHALL include a required opaque `id` (the stable internal key that stored vectors reference), a required `provider` referencing a defined `providers[].id` whose type supports embeddings (`openai`), a required server-only `providerModelId`, and a required positive-integer `dimensions`. Each entry MAY include a distance metric, a model revision, a positive-integer `batchSize` bounding how many documents are sent per provider request, and optional asymmetric `documentPrefix` / `queryPrefix` strings. Embedding models SHALL reuse the existing `providers[]` connections rather than introducing a parallel credential or endpoint concept, so the same interpolation, keyless-provider, and secret-redaction rules apply unchanged.

The config file SHALL additionally support a per-corpus intended-embedding-model setting naming an `embeddingModels[].id`. Selection SHALL be expressed per corpus rather than as one instance-wide flag, so corpora embedding at different rates cannot strand one another; a corpus with no setting has no intended model and produces no embedding work.

Embedding selection is **operator** configuration, not tenant configuration: background indexing is instance-scoped and is not performed per request or per user, so no per-user embedding credential exists.

A duplicate `id`, an entry whose `provider` does not reference a defined provider with embedding support, a non-positive `dimensions`, or a corpus activation naming an undeclared embedding model id SHALL fail startup naming the offending entry and the dangling reference, applying no partial catalog.

#### Scenario: Embedding model references a defined provider

- **WHEN** an `embeddingModels[]` entry's `provider` names an `openai` provider defined in `providers[]`
- **THEN** the embedding model is loaded against that provider connection
- **AND** startup succeeds

#### Scenario: Embedding model references an undefined provider

- **WHEN** an `embeddingModels[]` entry's `provider` matches no `providers[].id`
- **THEN** startup fails naming the embedding model id and the unknown provider reference
- **AND** no partial catalog is applied

#### Scenario: A self-hosted embedding backend needs no new configuration concept

- **WHEN** an operator declares a keyless local provider in `providers[]` and an `embeddingModels[]` entry referencing it
- **THEN** the embedding model is loaded against that local endpoint
- **AND** no embedding-specific credential, endpoint, or interpolation rule is introduced

#### Scenario: Dimensions are required and validated

- **WHEN** an entry omits `dimensions` or sets it non-positive
- **THEN** startup fails naming the offending embedding model id

#### Scenario: Corpus activation must reference the catalog

- **WHEN** a corpus is configured to be served by an embedding model id that matches no `embeddingModels[].id`
- **THEN** startup fails naming the dangling reference
- **AND** the instance does not begin serving requests

#### Scenario: Omitting the section is valid and degrades to lexical

- **WHEN** the config file declares no `embeddingModels`
- **THEN** startup succeeds, no embedding work is scheduled, and search behavior is unchanged

#### Scenario: Embedding provider credentials are never exposed

- **WHEN** an embedding model's provider `key` resolves to a credential and a load-time or runtime error concerns that entry
- **THEN** the error names the embedding model id and the field, and the resolved value appears in no log line, error, or diagnostic output

#### Scenario: Subscription inference provider is not an embedding backend

- **WHEN** an embedding model references an `openai-codex` provider
- **THEN** startup fails identifying the unsupported embedding binding
- **AND** no partial catalog is applied
