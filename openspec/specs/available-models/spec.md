# available-models

## Purpose

Authenticated, executable model availability: `GET /api/v1/models` is the source of models a caller can actually run, chat sends carry an explicit opaque `modelId` validated before persistence, the selected model id is persisted on the run and used for execution, compaction, and usage telemetry, and title generation resolves its own configured model. The first implementation is the hardcoded system catalog; future org/group/user sources and BYOK extend the same flat response shape without changing route semantics.

## Requirements

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

#### Scenario: Missing API key does not disable configured models

- **WHEN** `OPENAI_API_KEY` is missing
- **THEN** `GET /api/v1/models` can still return configured system models
- **AND** the API does not probe whether the provider will require credentials

#### Scenario: Invalid default model configuration

- **WHEN** `DEFAULT_MODEL_ID` is missing, blank, or does not match a hardcoded model id
- **THEN** the API returns 503 with body containing `statusCode = 503`, `error = "Service Unavailable"`, and `code = "model_configuration_invalid"`

### Requirement: Available model entries use opaque ids and rich display metadata

Each available model entry SHALL include an opaque API `id`, a `source` enum value, and best-effort rich display metadata. Clients SHALL treat `id` as opaque and SHALL NOT parse provider routing semantics from it. The API response SHALL NOT expose provider execution ids unless a future requirement needs them.

Internal system model catalog entries SHALL explicitly configure the provider execution id used by the adapter. The implementation SHALL NOT derive a provider execution id by parsing, splitting, or stripping the llame model `id`.

Per model entry, `id`, `source`, and `contextWindowTokens` SHALL be required. `contextWindowTokens` is execution-critical — it sizes the context-compaction trigger — and SHALL therefore be part of the model contract at every layer (internal catalog, API response, and future org/group/user sources), not optional display metadata. All other metadata SHALL remain optional and SHALL NOT affect model executability; missing optional metadata, including `name`, SHALL NOT make model configuration invalid. Unknown optional metadata SHALL be omitted from JSON rather than returned as `null`; `null` is reserved for fields with explicit domain-level null semantics.

#### Scenario: System model entry

- **WHEN** a system model is returned
- **THEN** its entry includes `source = "system"`, an opaque `id`, and the known display metadata for that model

#### Scenario: Provider execution id is explicit server-side config

- **WHEN** the API resolves a system model for execution
- **THEN** it uses the catalog entry's explicit server-only provider execution id
- **AND** it does not derive that provider execution id from the llame model `id`

#### Scenario: Context window is required

- **WHEN** any executable model is returned by `GET /api/v1/models`
- **THEN** its entry includes a positive `contextWindowTokens`
- **AND** the same value sizes the context-compaction trigger for runs on that model
- **AND** a model with no configured context window is a configuration error, not an executable entry with omitted metadata

#### Scenario: Optional metadata is absent rather than fabricated

- **WHEN** a display field such as description, pricing, dates, or links is unknown
- **THEN** the field is omitted rather than guessed or returned as `null`

#### Scenario: Name is optional

- **WHEN** a returned model does not include `name`
- **THEN** clients use the opaque `id` as the deterministic display fallback

#### Scenario: Missing display metadata does not disable execution

- **WHEN** a hardcoded model has valid execution configuration but omits optional display metadata
- **THEN** the model can still be returned by `GET /api/v1/models` and accepted as chat `modelId`
- **AND** model configuration is not invalidated by the missing display metadata

#### Scenario: Pricing units are explicit

- **WHEN** pricing metadata is returned
- **THEN** it is represented with explicit units under `pricingUsdPer1M`, not ambiguous per-token field names

### Requirement: Available models are flat and API ordered

The available models response SHALL return a flat `models` array. The API SHALL own the returned order, and clients SHALL preserve that order unless applying user-driven filtering/search.

#### Scenario: Flat model list

- **WHEN** models from one or more sources are available
- **THEN** they are returned in one flat `models` array with source/provenance fields, not grouped by source or provider

#### Scenario: Default is identified by field

- **WHEN** a client needs the default model
- **THEN** it uses `defaultModelId`, not array position

### Requirement: System model configuration is explicit

The first implementation SHALL treat the hardcoded API model catalog as the complete system-configured model set. `DEFAULT_MODEL_ID` SHALL name one hardcoded model id, and `OPENAI_MODEL` SHALL NOT be the model-selection configuration variable for this feature.

#### Scenario: Initial active system ids

- **WHEN** the hardcoded catalog is implemented for this change
- **THEN** the active returned system model ids are `system:openai:gpt-5.5`, `system:openai:gpt-5.4`, `system:openai:gpt-5.4-mini`, `system:openai:gpt-5.4-nano`, `system:openai:gpt-4o`, and `system:openai:gpt-4o-mini`

#### Scenario: Valid system configuration

- **WHEN** `DEFAULT_MODEL_ID` names a hardcoded model id
- **THEN** the system models are considered executable for this implementation

#### Scenario: Base URL is not probed

- **WHEN** `OPENAI_BASE_URL` is set
- **THEN** the models endpoint does not probe provider reachability before returning configured models

#### Scenario: Provider credential validity is not prevalidated

- **WHEN** `OPENAI_API_KEY` is set, missing, or invalid
- **THEN** model availability and chat enqueue validation do not verify whether the provider will accept it
- **AND** provider authentication or reachability failures surface at provider request time

#### Scenario: Provider credential failure is not payment required

- **WHEN** a provider request fails because credentials are missing, invalid, or the configured provider is unreachable
- **THEN** the system does not return `402 Payment Required`
- **AND** the failure is represented as a generic execution failure for this slice

#### Scenario: Unsupported future models are not active availability

- **WHEN** the codebase preserves unsupported model metadata as commented future reference entries
- **THEN** those commented entries are not exported, not returned by `GET /api/v1/models`, and not accepted as chat `modelId` values

#### Scenario: OpenAI model env is not used as the default model id

- **WHEN** the system resolves the default model for availability or chat execution
- **THEN** it reads `DEFAULT_MODEL_ID`, not `OPENAI_MODEL`

#### Scenario: Legacy OpenAI model env is ignored

- **WHEN** `OPENAI_MODEL` is set
- **THEN** it does not affect returned model availability, default-model selection, or chat execution
- **AND** it does not make model configuration invalid

### Requirement: Chat sends require explicit model id

Creating a chat message SHALL require a top-level `modelId` naming one model from the caller's effective `GET /api/v1/models` response. The API SHALL validate `modelId` before creating the user message or run.

`modelId` SHALL be treated as opaque. The API SHALL NOT impose a public syntax grammar beyond requiring a non-empty string; availability SHALL be checked by exact id lookup.

#### Scenario: Send with valid model id

- **WHEN** an authenticated caller posts a new chat message with a valid top-level `modelId`
- **THEN** the API creates the user message and run, stores the selected model id on the run, and enqueues execution for that model

#### Scenario: Missing model id

- **WHEN** a caller posts a chat message without `modelId`
- **THEN** the API returns 400 and creates no message or run

#### Scenario: Malformed model id

- **WHEN** a caller posts a chat message with a blank or non-string `modelId`
- **THEN** the API returns 400 and creates no message or run

#### Scenario: Unavailable model id

- **WHEN** a caller posts a chat message with a nonblank string `modelId` that is not available to that caller
- **THEN** the API returns 422 with body containing `statusCode = 422`, `error = "Unprocessable Entity"`, and `code = "model_not_available"`
- **AND** it creates no message or run

#### Scenario: Model configuration unavailable during send

- **WHEN** the system cannot resolve executable model configuration during chat send
- **THEN** the API returns 503 with the application-standard model configuration error body using code `model_configuration_invalid`
- **AND** it creates no message or run

### Requirement: Selected model id is persisted for execution

Runs SHALL persist the selected opaque model id as a required field. The worker SHALL execute the run using the run's stored model id and SHALL NOT silently fall back to a different default.

#### Scenario: Run stores selected model id

- **WHEN** a new run is created for a chat message
- **THEN** the run row stores the selected model id

#### Scenario: Worker executes stored model id

- **WHEN** a worker picks up a queued run
- **THEN** it resolves and executes the model from the run's stored model id

#### Scenario: Run events identify model id

- **WHEN** model execution run events are appended or replayed
- **THEN** model-attribution payloads use the stored opaque `modelId`
- **AND** they do not expose legacy `model` or `provider` fields

#### Scenario: Stored model becomes unavailable

- **WHEN** a worker cannot resolve the run's stored model id at pickup time
- **THEN** the run fails transparently and does not execute a different model

#### Scenario: Existing run rows are backfilled

- **WHEN** the migration adding the required run model id is applied to existing rows
- **THEN** existing rows are backfilled once with the literal id `system:openai:gpt-5.4-mini`
- **AND** `runs.model_id` has no persistent database default after the migration

#### Scenario: Legacy JSON payloads are not backfilled

- **WHEN** the migration for this change is applied
- **THEN** it does not rewrite legacy JSON model attribution in `messages.usage`, `compactions.usage`, or `run_events.payload`
- **AND** proof-of-concept JSON payloads can remain stale or be reset out of band

### Requirement: Post-turn model use is explicit

Post-turn work SHALL use explicit model selection. Compaction SHALL use the model id selected for the triggering message/run. Title generation SHALL use a separate server-side `TITLE_GENERATION_MODEL_ID` that names a valid active system catalog id. The implementation SHALL NOT introduce a separate title-only model registry for this change.

#### Scenario: Compaction uses triggering run model

- **WHEN** a completed run triggers compaction
- **THEN** the compaction model call uses the selected model id stored on that triggering run

#### Scenario: Title generation uses separate configured model

- **WHEN** title generation runs after a completed turn
- **THEN** it resolves its model from `TITLE_GENERATION_MODEL_ID`
- **AND** `TITLE_GENERATION_MODEL_ID` names a valid active system catalog id
- **AND** it uses the same system provider credentials and transport config as chat execution
- **AND** it does not silently use the chat selector's `defaultModelId`
- **AND** it does not persist title-generation model id, usage, cost, or telemetry
- **AND** it remains internal and is not exposed in `GET /api/v1/models`

#### Scenario: Title model configuration failure does not break chat

- **WHEN** `TITLE_GENERATION_MODEL_ID` is missing, blank, or unknown
- **THEN** `GET /api/v1/models`, chat send, and run execution can still succeed if chat model configuration is valid
- **AND** title generation leaves the chat untitled and logs a server error
- **AND** title generation does not fall back to `DEFAULT_MODEL_ID`

### Requirement: Assistant usage includes llame model id

Assistant message and compaction usage telemetry SHALL include the opaque llame `modelId` that produced the model output. New assistant message and compaction usage telemetry SHALL use `modelId` instead of the legacy `model` field and SHALL NOT write the legacy `provider` field. Existing computed usage fields, including generated-time `costUsd`, SHALL remain persisted and SHALL NOT be recomputed from future model metadata changes.

#### Scenario: Assistant usage records model id

- **WHEN** an assistant message is persisted after model execution
- **THEN** its usage telemetry includes the selected opaque `modelId`
- **AND** it does not write the legacy `model` field
- **AND** it does not write the legacy `provider` field

#### Scenario: Compaction usage records model id

- **WHEN** compaction usage telemetry is persisted after a compaction model call
- **THEN** its usage telemetry includes the triggering run's selected opaque `modelId`
- **AND** it does not write the legacy `model` field
- **AND** it does not write the legacy `provider` field

#### Scenario: Past cost remains persisted

- **WHEN** model metadata or pricing configuration later changes
- **THEN** previously persisted `costUsd` values on message usage remain unchanged

### Requirement: Existing message ids conflict

For the current product, a user message id SHALL be single-use within a chat. A request using an existing message id SHALL conflict regardless of whether the message content or model id matches a prior request.

#### Scenario: Duplicate message id is rejected

- **WHEN** a caller posts a chat message whose id already exists in that chat
- **THEN** the API returns 409 and creates no new run

### Requirement: Web sends only with valid selected model

The web app SHALL fetch `/api/v1/models`, initialize the selected model from `defaultModelId`, and include top-level `modelId` in every chat send. The composer input MAY remain usable while models load or fail, but the send action SHALL be disabled until a valid model selection exists.

#### Scenario: Web initializes selected model

- **WHEN** the web app successfully loads available models
- **THEN** it selects `defaultModelId` unless a future preference feature provides another valid selection

#### Scenario: Web sends selected model id

- **WHEN** the user sends a chat message after models have loaded
- **THEN** the request body includes top-level `modelId` equal to the visibly selected model id

#### Scenario: Web displays usage model id

- **WHEN** the web app displays or exports assistant usage metadata
- **THEN** it reads `usage.modelId`
- **AND** it does not need to support legacy `usage.model` or `usage.provider` fallback

#### Scenario: Send disabled while models are unavailable

- **WHEN** models are loading, failed, or no valid selected model exists
- **THEN** the chat input remains usable but the send action is disabled
