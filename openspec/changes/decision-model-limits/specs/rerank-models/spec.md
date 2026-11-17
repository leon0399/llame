## MODIFIED Requirements

### Requirement: The rerank catalog names models by id

The config file MUST accept an optional top-level `rerankModels` array. Each
entry MUST be `{ id, provider, providerModelId, wire? }`. `provider` MUST name a
`providers[].id` whose default or explicit model wire resolves to
`cohere-rerank`. `providerModelId` MUST be a nonblank string, sent verbatim
as the wire `model`. An entry that sets `model` MUST fail startup.
`id`, `provider`, and `providerModelId` MUST accept `{env:…}` and `{path:…}` interpolation.

#### Scenario: A rerank catalog loads

- **WHEN** the file declares a `rerankModels` entry with an `id`, a `cohere-rerank` `provider`, and the `providerModelId` `cohere/rerank-5-fast`
- **THEN** startup succeeds
- **AND** a rank call that names that id sends `cohere/rerank-5-fast` on the wire

#### Scenario: A rerank model has no supported default wire

- **WHEN** a `rerankModels` entry names a provider of `type: "system-one"` without an explicit `wire`
- **THEN** startup fails and names `rerankModels[0].wire` for the first entry

#### Scenario: An account serves a rerank model

- **WHEN** a `rerankModels` entry names an `openrouter` provider without an explicit `wire`
- **THEN** startup resolves its wire to `cohere-rerank`

#### Scenario: A blank rerank model fails startup

- **WHEN** a `rerankModels` entry has a `providerModelId` that is blank or resolves to blank
- **THEN** startup fails and names `rerankModels[0].providerModelId` for the first entry

#### Scenario: The former rerank field name fails startup

- **WHEN** a `rerankModels` entry sets `model` instead of `providerModelId`
- **THEN** startup fails and names the first entry of `rerankModels`

### Requirement: A rerank call reports scores, usage, and cost

The judge result MUST map each judged card key to its `relevance_score`. The
representative model MUST be the first accepted response's served `model` in
request order if it names one, else the entry's `providerModelId`. It MUST be `null` when no response is
accepted.

#### Scenario: Two requests report different served models

- **WHEN** request zero answers as `rerank-v5.0-fast` and request one answers as `rerank-v5.0-pro`
- **THEN** the representative model is `rerank-v5.0-fast`
