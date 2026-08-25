# available-models

## Purpose

Authenticated, executable model availability: `GET /api/v1/models` is the source of models a caller can actually run, chat sends carry an explicit opaque `modelId` validated before persistence, the selected model id is persisted on the run and used for execution, compaction, and usage telemetry, and title generation resolves its own configured model. The catalog is config-sourced (`llame.config.json`'s `providers[]`/`models[]`, providers-and-models-as-code); future org/group/user sources and BYOK extend the same flat response shape without changing route semantics.

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

### Requirement: Available model entries publish their reasoning effort contract

An available model entry SHALL include a `reasoning` object when, and only when, the operator declared one for that model. The object SHALL carry `effortLevels`, `defaultEffort`, and `cacheInvalidatedByEffortChange`. `effortLevels` SHALL be an array of objects `{ value: string, label?: string }` in the operator-authored order so a client can present them as an ordered scale without inferring one. A bare-string config entry SHALL publish as `{ value }` with no `label` field. A labeled config entry SHALL publish both `value` and `label` byte-identical to the configured strings.

A level's `value` SHALL be treated as an identifier. An optional `label` is operator-authored display metadata only. A consumer MAY render `label` when present, otherwise the `value` as a fallback, but SHALL NOT invent a label when none was published, SHALL NOT parse meaning, magnitude, or ordering out of either string's text, and SHALL NOT assume a `value` means the same thing on another model.

A model with no declared reasoning SHALL omit `reasoning` entirely rather than returning `null` or an empty object, consistent with unknown optional metadata being absent rather than fabricated.

The reasoning object SHALL NOT expose the provider execution id, the provider connection, host paths, or any other server-only configuration.

#### Scenario: Reasoning-capable model publishes its levels

- **WHEN** `GET /api/v1/models` returns a model whose operator configuration declares `reasoning`
- **THEN** its entry includes `reasoning` with `effortLevels`, `defaultEffort`, and `cacheInvalidatedByEffortChange`
- **AND** each `effortLevels` item is an object with a `value` string and an optional `label` string
- **AND** `effortLevels` preserves the operator-authored order

#### Scenario: Levels are published verbatim

- **WHEN** a declared level is returned
- **THEN** its `value` is byte-identical to the configured value
- **AND** it is not normalized, titlecased, or replaced with a llame-invented display label

#### Scenario: Operator labels are published when authored

- **WHEN** a config entry used `{ value, label }` for a level
- **THEN** the published item includes that `label` byte-identical to the configured string

#### Scenario: Unlabeled levels omit the label field

- **WHEN** a config entry used a bare string for a level
- **THEN** the published item is `{ value }` with no `label` field

#### Scenario: Non-reasoning model omits the object

- **WHEN** `GET /api/v1/models` returns a model whose operator configuration declares no `reasoning`
- **THEN** the entry omits `reasoning` rather than returning `null` or an empty object

#### Scenario: Reasoning object carries no server-only configuration

- **WHEN** a reasoning object is returned
- **THEN** it contains no provider execution id, provider connection detail, or host path

### Requirement: Chat sends accept an optional reasoning effort

Creating a chat message SHALL accept an optional top-level `effort`. When present it SHALL be a nonblank string and SHALL be validated, before any message or run is created, against the `value`s of `reasoning.effortLevels` of the model named by the same request's `modelId`. A published `label` SHALL NOT be accepted as `effort`.

`effort` SHALL be treated as opaque and matched byte-exactly against the selected model's declared values. The API SHALL NOT impose a vocabulary, character pattern, or casing rule of its own, and SHALL NOT case-fold, trim beyond blank rejection, or otherwise normalize the submitted value before matching.

Model validation SHALL precede effort validation. When the request's `modelId` is missing, malformed, or unavailable, the API SHALL return that failure and SHALL NOT evaluate `effort` at all, because a level's legality is defined only by a resolved model.

When `effort` is omitted, the API SHALL resolve the selected model's `defaultEffort`. When the selected model declares no reasoning, an omitted `effort` SHALL resolve to no effort and the request SHALL proceed.

An effort value that is not a declared `value` of the selected model, or any `effort` at all for a model that declares no reasoning, SHALL be rejected with 422 and `code = "effort_not_available"`, creating no message and no run.

#### Scenario: Send with a valid effort

- **WHEN** an authenticated caller posts a chat message with a valid `modelId` and an `effort` that equals one of that model's declared level values
- **THEN** the API creates the user message and run and enqueues execution at that effort

#### Scenario: Label is rejected as effort

- **WHEN** a caller posts a chat message with an `effort` equal to a published `label` but not equal to any declared `value`
- **THEN** the API returns 422 with `code = "effort_not_available"`
- **AND** it creates no message or run

#### Scenario: Omitted effort resolves the model default

- **WHEN** a caller posts a chat message naming a model that declares reasoning, without `effort`
- **THEN** the API resolves that model's `defaultEffort` for the run

#### Scenario: Omitted effort on a non-reasoning model

- **WHEN** a caller posts a chat message naming a model that declares no reasoning, without `effort`
- **THEN** the API creates the message and run with no effort
- **AND** the request is not rejected

#### Scenario: Effort not declared by the selected model

- **WHEN** a caller posts a chat message with an `effort` that is not one of the selected model's declared values
- **THEN** the API returns 422 with `statusCode = 422`, `error = "Unprocessable Entity"`, and `code = "effort_not_available"`
- **AND** it creates no message or run

#### Scenario: Effort supplied for a non-reasoning model

- **WHEN** a caller posts a chat message naming a model that declares no reasoning, with any `effort`
- **THEN** the API returns 422 with `code = "effort_not_available"`
- **AND** it creates no message or run

#### Scenario: Malformed effort

- **WHEN** a caller posts a chat message with a blank or non-string `effort`
- **THEN** the API returns 400 and creates no message or run

#### Scenario: Casing is significant

- **WHEN** a caller posts an `effort` that differs from a declared value only by letter case
- **THEN** the API returns 422 with `code = "effort_not_available"`
- **AND** the value is not case-folded to match

#### Scenario: Effort is validated against the request's own model

- **WHEN** a caller posts an `effort` that is a declared value of some other catalog model but not of the request's `modelId`
- **THEN** the API returns 422 with `code = "effort_not_available"`

#### Scenario: Unavailable model is reported before effort is considered

- **WHEN** a caller posts a chat message whose `modelId` is unavailable and whose `effort` is also not a value of any model
- **THEN** the API returns 422 with `code = "model_not_available"`
- **AND** it does not return or additionally report an effort failure

#### Scenario: Missing model id short-circuits effort validation

- **WHEN** a caller posts a chat message with an `effort` but no `modelId`
- **THEN** the API returns 400 for the missing model id
- **AND** it does not evaluate the submitted effort

### Requirement: Resolved reasoning effort is persisted and executed per run

A run SHALL persist the effort resolved at accept time, not a marker meaning "use the configured default". A later change to a model's `defaultEffort` or `effortLevels` SHALL NOT alter the effort of an already-created run.

The worker SHALL execute the run using the run's persisted effort and SHALL NOT re-resolve or re-validate it against current configuration at pickup. A run whose persisted effort is no longer a declared level of its model SHALL still send that value; a value the provider rejects SHALL fail the run at request time rather than being silently dropped or replaced. A run whose persisted effort is absent SHALL execute with no effort parameter, leaving the provider's own default in force.

A persisted effort SHALL be sent to the provider whenever it is present, including when its value denotes disabled reasoning. The system SHALL NOT treat any level as equivalent to omitting the parameter.

#### Scenario: Run stores the resolved effort

- **WHEN** a new run is created for a chat message
- **THEN** the run stores the effort resolved at accept time

#### Scenario: Configuration change does not rewrite history

- **WHEN** a model's `defaultEffort` changes after a run was created
- **THEN** that run's persisted effort is unchanged
- **AND** a queued run still executes at its persisted effort

#### Scenario: Worker executes the persisted effort

- **WHEN** a worker picks up a queued run whose persisted effort is present
- **THEN** it sends that effort to the provider
- **AND** it does not re-resolve the effort from current configuration

#### Scenario: A level withdrawn from configuration is still sent

- **WHEN** a worker picks up a run whose persisted effort is no longer among its model's declared levels
- **THEN** it sends the persisted value unchanged
- **AND** it does not drop the parameter or substitute the current default

#### Scenario: Run without an effort sends no parameter

- **WHEN** a worker picks up a run whose persisted effort is absent
- **THEN** it sends no reasoning-effort parameter and the provider default applies

#### Scenario: A disabling level is still sent

- **WHEN** a run's persisted effort denotes disabled reasoning
- **THEN** that value is sent to the provider
- **AND** it is not dropped as though no effort had been selected

### Requirement: Reasoning effort accompanies model identity everywhere it is recorded or returned

Reasoning effort SHALL be recorded and exposed wherever the executing opaque `modelId` is recorded or exposed, and SHALL be absent wherever `modelId` is absent. The two describe the same execution decision, so a surface carrying one without the other would let an owner read a cost, a latency, or a receipt without being able to attribute it.

This SHALL hold for the run resource, the run context receipt, assistant message usage telemetry, compaction usage telemetry, model-attribution run events, and the turn-telemetry log record. It SHALL NOT extend a surface that carries no `modelId`, including the active-runs list and the public shared-chat view.

Effort SHALL be represented under the field name `effort` at every one of these surfaces, and SHALL be absent rather than null when the run carried none.

A recorded effort is a receipt. Persisted effort values SHALL NOT be recomputed or backfilled when model configuration later changes, matching the existing rule for generated-time `costUsd`.

#### Scenario: Run resource exposes its effort

- **WHEN** a client reads a run
- **THEN** the response includes the run's persisted effort, or omits it when the run carried none

#### Scenario: Context receipt exposes the executing effort

- **WHEN** an owner reads a run's context receipt
- **THEN** the receipt includes the effort that run executed with, alongside its `modelId`
- **AND** the effort does not participate in the receipt's content or availability hashes

#### Scenario: Assistant usage records the effort

- **WHEN** an assistant message is persisted after model execution
- **THEN** its usage telemetry includes the run's effort alongside `modelId`
- **AND** the field is omitted when the run carried no effort

#### Scenario: Errored and aborted turns still record effort

- **WHEN** a turn ends in an error or is aborted
- **THEN** its persisted usage telemetry still records the effort it ran with

#### Scenario: Model-attribution run events carry the effort

- **WHEN** the run event describing the requested model inference is appended or replayed
- **THEN** its payload includes the run's effort alongside the opaque `modelId`

#### Scenario: Turn telemetry log records the effort

- **WHEN** a turn's telemetry log record is emitted
- **THEN** it includes the effort alongside `modelId`

#### Scenario: Surfaces without model identity gain no effort

- **WHEN** a response carries no `modelId`, such as the active-runs list or the public shared-chat message view
- **THEN** it carries no effort either

#### Scenario: Recorded effort is never recomputed

- **WHEN** a model's declared levels or default change after a turn was recorded
- **THEN** the previously persisted effort on that turn's usage, receipt, and events remains unchanged

### Requirement: Post-turn model work inherits effort only where its request is prefix-aligned

Compaction SHALL send the effort of the run whose prompt prefix it reuses, because a compaction request deliberately reproduces that run's system prompt and message prefix in order to reach the provider's prompt cache while it is still warm. Sending a different effort would invalidate the cache the request shape exists to exploit.

Full compaction after a completed turn SHALL use the triggering run's effort. Transition compaction SHALL use the **source** run's effort — the run whose model and system prompt the request reuses — and SHALL NOT use the effort submitted with the incoming turn, which was validated against a different model's declared levels and is not part of the reused prefix.

The inherited effort SHALL be sent as persisted, without re-validation against current configuration, on the same receipt grounds as run execution.

Title generation SHALL send no effort. It executes on a separately configured model with its own system prompt, shares no prefix with any run, and the run's level may not exist in that model's vocabulary at all.

#### Scenario: Compaction inherits the triggering run's effort

- **WHEN** a completed run at some effort triggers compaction
- **THEN** the compaction model call sends that same effort

#### Scenario: Compaction of a run without effort sends none

- **WHEN** a completed run that carried no effort triggers compaction
- **THEN** the compaction model call sends no reasoning-effort parameter

#### Scenario: Transition compaction uses the source run's effort

- **WHEN** a model switch triggers transition compaction over a source run's prefix
- **THEN** the compaction model call sends the source run's persisted effort
- **AND** it does not send the effort submitted with the incoming turn

#### Scenario: Inherited effort is not re-validated

- **WHEN** compaction inherits an effort that is no longer among its model's declared levels
- **THEN** it sends the value unchanged rather than dropping it or substituting a current default

#### Scenario: Compaction usage records its effort

- **WHEN** compaction usage telemetry is persisted after a compaction model call
- **THEN** it records the effort that call used, alongside `modelId`

#### Scenario: Title generation sends no effort

- **WHEN** title generation runs after a completed turn at any effort
- **THEN** the title model call sends no reasoning-effort parameter

### Requirement: An effort change is not a model-visible context event

A change in effort between turns SHALL NOT author a model-visible context item, and SHALL NOT be added as a cause of effective-context change. Effort changes what the model spends on the answer, not what it knows, so disclosing it would spend context on a fact the model cannot act on.

#### Scenario: Effort change authors no context item

- **WHEN** a turn's resolved effort differs from the previous run's effort and the model is unchanged
- **THEN** no context item is authored for that turn on account of the effort change

#### Scenario: Model change disclosure is unaffected

- **WHEN** a turn changes both the model and the effort
- **THEN** the model change is disclosed exactly as it is for an effort-unchanged model change
- **AND** the disclosure does not mention effort
