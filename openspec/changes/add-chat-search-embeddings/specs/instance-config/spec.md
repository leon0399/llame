## ADDED Requirements

### Requirement: Embedding model catalog configuration

The config file SHALL support an optional top-level `embeddingModels` array declaring the embedding models an instance may use. Each entry SHALL include a required opaque `id` (the stable internal key that stored vectors reference), a required `provider` referencing a defined `providers[].id`, a required server-only `providerModelId`, and a required positive-integer `dimensions`. Each entry MAY include a distance metric, a model revision, a positive-integer `batchSize` bounding how many documents are sent per provider request, and optional asymmetric `documentPrefix` / `queryPrefix` strings. Embedding models SHALL reuse the existing `providers[]` connections rather than introducing a parallel credential or endpoint concept, so the same interpolation, keyless-provider, and secret-redaction rules apply unchanged.

The config file SHALL additionally support a per-corpus intended-embedding-model setting naming an `embeddingModels[].id`. Selection SHALL be expressed per corpus rather than as one instance-wide flag, so corpora embedding at different rates cannot strand one another; a corpus with no setting has no intended model and produces no embedding work.

Embedding selection is **operator** configuration, not tenant configuration: background indexing is instance-scoped and is not performed per request or per user, so no per-user embedding credential exists.

A duplicate `id`, an entry whose `provider` does not reference a defined provider, a non-positive `dimensions`, or a corpus activation naming an undeclared embedding model id SHALL fail startup naming the offending entry and the dangling reference, applying no partial catalog.

#### Scenario: Embedding model references a defined provider

- **WHEN** an `embeddingModels[]` entry's `provider` names a provider defined in `providers[]`
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
