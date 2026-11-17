## RENAMED Requirements

- FROM: `### Requirement: Decision model catalog entries carry a model`
- TO: `### Requirement: Decision model catalog entries carry a provider model id`

## MODIFIED Requirements

### Requirement: Decision model catalog configuration

The config file MUST accept an optional top-level `decisionModels` array
beside `embeddingModels`. An absent array MUST mean that no decision model
exists. Each entry MUST be `{ id, provider, providerModelId, wire?, limits? }`.
`limits` MUST accept only `perQuestionContextTokens`,
`perRequestContextTokens`, `maxQuestionsPerRequest`, and
`maxConcurrentRequests`. Each limit MUST be a positive integer, or a
whole-value interpolation that resolves to one. When an entry declares both
token limits, the per-question limit MUST NOT exceed the per-request limit. An
invalid limit MUST fail startup and name its array-index path.

#### Scenario: A decision model catalog loads

- **WHEN** the file declares one `decisionModels` entry with an `id`, a `provider` of `type: "system-one"`, and a `providerModelId`
- **THEN** startup succeeds with that entry in the catalog
- **AND** no endpoint receives a request

#### Scenario: An absent catalog is valid

- **WHEN** the file declares no `decisionModels` array
- **THEN** startup succeeds
- **AND** no tool ranks its results

#### Scenario: A catalog entry declares limits

- **WHEN** a `decisionModels` entry sets `limits` to `{ perQuestionContextTokens: 1024, maxQuestionsPerRequest: 16, maxConcurrentRequests: 1 }`
- **THEN** startup succeeds
- **AND** the entry uses the default per-request limit

#### Scenario: A catalog entry declares an invalid limit

- **WHEN** the first `decisionModels` entry sets `limits.perRequestContextTokens` to `-1`, sets `limits.maxConcurrentRequests` to `2.5`, or sets an unknown `limits` field
- **THEN** startup fails and names the `decisionModels[0].limits` path

#### Scenario: A per-question limit exceeds the per-request limit

- **WHEN** the first `decisionModels` entry sets `perQuestionContextTokens: 65536` and `perRequestContextTokens: 32768`
- **THEN** startup fails and names the `decisionModels[0].limits` path

### Requirement: Decision model catalog entries name a supported account

Each `decisionModels[].provider` MUST name a `providers[].id`.
An unknown provider MUST fail startup naming its array-index `.provider` path.
The entry MUST resolve a decision wire (`system-one` or
`openrouter-decisions`) and a nonblank account key;
unsupported routing MUST fail startup at the entry's `.wire` path.

#### Scenario: An unknown decision model provider fails startup

- **WHEN** a `decisionModels` entry names a `provider` that `providers[]` does not define
- **THEN** startup fails and names `decisionModels[0].provider` for the first entry

#### Scenario: A decision model without a default or override fails startup

- **WHEN** a decision entry names an `openai-completions` provider and declares no wire
- **THEN** startup fails and names `decisionModels[0].wire` for the first entry
- **AND** no decision client is built

### Requirement: Decision model catalog entries carry a provider model id

Each `decisionModels[].providerModelId` MUST be a nonblank string, sent
verbatim as the wire `model`. A blank `providerModelId` MUST fail startup and
name the array-index path, such as `decisionModels[0].providerModelId`. An
entry that sets `model` MUST fail startup.

#### Scenario: A catalog entry carries a model id

- **WHEN** a `decisionModels` entry sets `providerModelId` to `jev-1.13`
- **THEN** startup succeeds and the provider receives that model id on every call
- **AND** the entry has no field for a price

#### Scenario: A blank decision model name fails startup

- **WHEN** a `decisionModels` entry has a `providerModelId` that is blank or resolves to blank
- **THEN** startup fails and names `decisionModels[0].providerModelId` for the first entry

#### Scenario: The former field name fails startup

- **WHEN** a `decisionModels` entry sets `model` instead of `providerModelId`
- **THEN** startup fails and names the first entry of `decisionModels`

### Requirement: Decision model catalog fields accept interpolation

`id`, `provider`, and `providerModelId` MUST accept `{env:…}` and `{path:…}`
interpolation. A field that resolves blank MUST fail startup and name its
array-index path. Diagnostics MUST NOT print interpolated catalog values.

#### Scenario: An interpolated provider id resolves at startup

- **WHEN** a `decisionModels` entry sets `provider` to `{env:DECISION_PROVIDER}` and the variable holds a System One provider id
- **THEN** startup succeeds and the entry binds to that provider

#### Scenario: An empty interpolation fails startup

- **WHEN** a `decisionModels` entry sets `providerModelId` to `{env:DECISION_MODEL:-}` and the variable is unset
- **THEN** startup fails and names `decisionModels[0].providerModelId` for the first entry
