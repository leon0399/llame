## ADDED Requirements

### Requirement: Provider execution resolves through the configured provider

Model execution SHALL resolve a run's model to its catalog entry, that entry's `provider` to the matching `providers[]` entry, and a model client selected by the provider's `type`. The implementation SHALL dispatch on `type` (this slice: `openai` → the OpenAI/OpenAI-compatible client) and SHALL treat any unrecognized resolved `type` as an internal error, not a silent fallback. Provider credentials and base URL SHALL come from the resolved provider entry, not from a fixed environment variable. A keyless provider (empty resolved `key`) SHALL execute against an OpenAI-compatible endpoint without raising a missing-credential error at client construction.

#### Scenario: Model routes to its provider's client

- **WHEN** a worker executes a run whose stored model id resolves to a catalog entry with `provider: "p"` and `providers[].id "p"` has `type: "openai"`
- **THEN** it builds the OpenAI-compatible client using provider `p`'s `key`/`baseUrl`
- **AND** it does not read `OPENAI_API_KEY` or `OPENAI_BASE_URL` as bare environment variables

#### Scenario: Keyless provider executes

- **WHEN** a run's model resolves to a keyless provider (empty `key`, e.g. a local Ollama)
- **THEN** the model client is constructed without raising `LoadAPIKeyError`
- **AND** provider auth/reachability failures still surface at provider request time, not at construction

#### Scenario: Two providers of the same type route independently

- **WHEN** two models name two distinct `type: "openai"` providers
- **THEN** each executes against its own provider's `key`/`baseUrl`

### Requirement: Per-model compaction threshold

A model catalog entry MAY declare an optional `compactionThresholdTokens`. The compaction trigger threshold for a run SHALL resolve to that per-model value when present, otherwise to `contextWindowTokens × COMPACTION_WINDOW_RATIO`. No instance-level compaction threshold or context-window override SHALL be read; the removed `COMPACTION_TOKEN_THRESHOLD` and `MODEL_CONTEXT_WINDOW_TOKENS` environment variables SHALL have no effect. Per-user and per-send threshold tiers are out of scope for this capability.

#### Scenario: Per-model override drives the trigger

- **WHEN** a run's model declares `compactionThresholdTokens`
- **THEN** compaction triggers against that value
- **AND** the model's `contextWindowTokens × ratio` is not used

#### Scenario: Falls back to the window-derived threshold

- **WHEN** a run's model does not declare `compactionThresholdTokens`
- **THEN** compaction triggers against `contextWindowTokens × COMPACTION_WINDOW_RATIO`

#### Scenario: Instance compaction env vars are inert

- **WHEN** `COMPACTION_TOKEN_THRESHOLD` or `MODEL_CONTEXT_WINDOW_TOKENS` is set in the environment
- **THEN** it does not affect any run's compaction threshold

## MODIFIED Requirements

### Requirement: Authenticated executable models endpoint

The system SHALL expose `GET /api/v1/models` as the authenticated API for executable models available to the caller. A successful response SHALL contain a non-empty flat `models` array and a non-null `defaultModelId` that references one returned model.

Model-domain errors SHALL use the application-standard error body shape `{ statusCode, error, message, code }`.

#### Scenario: Authenticated caller reads available models

- **WHEN** an authenticated caller requests `GET /api/v1/models` and model configuration is valid
- **THEN** the API returns 200 with `models.length > 0` and `defaultModelId` matching one returned model id
- **AND** the response does not expose title-generation model configuration

#### Scenario: Unauthenticated caller is denied

- **WHEN** a caller without a valid session requests `GET /api/v1/models`
- **THEN** the API returns 401 and does not return model availability data

#### Scenario: Missing provider credential does not disable configured models

- **WHEN** a configured provider has no credential (keyless or an unset key)
- **THEN** `GET /api/v1/models` can still return the models routed to that provider
- **AND** the API does not probe whether the provider will require credentials

#### Scenario: Default model validity is enforced at boot, not per request

- **WHEN** the endpoint is serving requests
- **THEN** `defaultModelId` always references a returned model, because a `defaults.modelId` that does not reference a defined `models[]` entry fails startup (the instance never begins serving on an invalid default)

#### Scenario: Unset default model is a request-time configuration error

- **WHEN** `defaults.modelId` is unset (absent or explicit `null`)
- **THEN** `GET /api/v1/models` returns 503 with body containing `statusCode = 503`, `error = "Service Unavailable"`, and `code = "model_configuration_invalid"`
- **AND** this case is distinct from a dangling reference, which fails startup instead (previous scenario)

### Requirement: System model configuration is explicit

The executable model set SHALL be the `models[]` catalog configured in `llame.config.json`, not a hardcoded catalog. `defaults.modelId` SHALL name one configured `models[].id` and is validated at startup. Provider execution configuration (credential, base URL) SHALL come from the `providers[]` entry a model references, not from `OPENAI_MODEL`, `OPENAI_BASE_URL`, or `OPENAI_API_KEY` read as bare environment variables (those names may still be referenced as `{env:…}` interpolation inputs inside `providers[]`).

#### Scenario: Catalog is config-sourced

- **WHEN** the instance resolves executable models
- **THEN** it uses the `models[]` entries from the config file
- **AND** it does not use a compiled-in hardcoded catalog

#### Scenario: Shipped example reproduces the current catalog

- **WHEN** an operator copies the committed `llame.config.json.example` unchanged
- **THEN** the executable catalog matches the previously hardcoded active system models (`system:openai:gpt-5.5`, `system:openai:gpt-5.4`, `system:openai:gpt-5.4-mini`, `system:openai:gpt-5.4-nano`, `system:openai:gpt-4o`, `system:openai:gpt-4o-mini`) routed to a default OpenAI provider

#### Scenario: Base URL is not probed

- **WHEN** a provider sets `baseUrl`
- **THEN** the models endpoint does not probe provider reachability before returning configured models

#### Scenario: Provider credential validity is not prevalidated

- **WHEN** a provider `key` is set, empty, or invalid
- **THEN** model availability and chat enqueue validation do not verify whether the provider will accept it
- **AND** provider authentication or reachability failures surface at provider request time

#### Scenario: Provider credential failure is not payment required

- **WHEN** a provider request fails because credentials are missing, invalid, or the provider is unreachable
- **THEN** the system does not return `402 Payment Required`
- **AND** the failure is represented as a generic execution failure for this slice

#### Scenario: A model absent from the catalog is not executable

- **WHEN** a model id is not present in the configured `models[]`
- **THEN** it is not returned by `GET /api/v1/models` and is not accepted as a chat `modelId`

#### Scenario: Legacy OpenAI model env is ignored

- **WHEN** `OPENAI_MODEL` is set
- **THEN** it does not affect returned model availability, default-model selection, or chat execution
- **AND** it does not make model configuration invalid
