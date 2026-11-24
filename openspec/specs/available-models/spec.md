# available-models

## Purpose

Authenticated, executable model availability: `GET /api/v1/models` is the source of models and model roles a caller can actually run, chat sends name an optional `selector` (a model id or a `@role`) validated before persistence, the resolved model id is persisted on the run and used for execution, compaction, and usage telemetry, and title generation resolves its own configured selector. The catalog is config-sourced (`llame.config.jsonc`'s `providers[]`/`models[]`/`modelRoles`, providers-and-models-as-code); future org/group/user sources and BYOK extend the same flat response shape without changing route semantics.

## Requirements

### Requirement: Authenticated executable models endpoint

The system MUST expose `GET /api/v1/models` as the authenticated API for the executable models of
the caller. A successful response MUST contain a non-empty flat `models` array, the `roles` that
`model-roles` defines, and a non-null `defaultSelector`. `defaultSelector` MUST name a returned model
or a returned role.

Model-domain errors MUST use the standard error body `{ statusCode, error, message, code }`.

#### Scenario: Authenticated caller reads available models

- **WHEN** an authenticated caller requests `GET /api/v1/models` and the model config is valid
- **THEN** the API returns 200 with `models.length > 0` and a `defaultSelector` that names a returned model or role
- **AND** the response does not show the title-generation config

#### Scenario: Unauthenticated caller is denied

- **WHEN** a caller without a valid session requests `GET /api/v1/models`
- **THEN** the API returns 401 and returns no model data

#### Scenario: Missing provider credential does not disable configured models

- **WHEN** a configured provider has no credential, because it is keyless or its key is unset
- **THEN** `GET /api/v1/models` can still return the models of that provider
- **AND** the API does not probe whether the provider requires credentials

#### Scenario: Default model validity is enforced at boot, not per request

- **WHEN** the endpoint serves requests
- **THEN** `defaultSelector` always names a returned model or role
- **AND** a `defaults.selector` that names no `models[]` entry and no role fails startup, so the instance never serves with an invalid default

#### Scenario: Unset default model is a request-time configuration error

- **WHEN** `defaults.selector` is absent or `null`
- **THEN** `GET /api/v1/models` returns 503 with `statusCode = 503`, `error = "Service Unavailable"`, and `code = "model_configuration_invalid"`
- **AND** this case is different from a dangling reference, which fails startup

### Requirement: Available model entries use opaque ids and rich display metadata

Each available model entry SHALL include an opaque API `id`, a `source` enum value, and best-effort rich display metadata. Clients SHALL treat `id` as opaque and SHALL NOT parse provider routing semantics from it. The API response SHALL NOT expose provider execution ids unless a future requirement needs them.

Internal system model catalog entries SHALL explicitly configure the provider execution id used by the adapter. The implementation SHALL NOT derive a provider execution id by parsing, splitting, or stripping the llame model `id`.

Per model entry, `id`, `source`, `contextWindowTokens`, and `input` SHALL be required. `contextWindowTokens` is execution-critical — it sizes the context-compaction trigger — and SHALL therefore be part of the model contract at every layer (internal catalog, API response, and future org/group/user sources), not optional display metadata. `input` SHALL be `["text"]` when a model's configuration omits it, and SHALL NOT be omitted or returned as `null`. All other metadata SHALL remain optional and SHALL NOT affect model executability; missing optional metadata, including `name`, SHALL NOT make model configuration invalid. Unknown optional metadata SHALL be omitted from JSON rather than returned as `null`; `null` is reserved for fields with explicit domain-level null semantics.

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

The executable model set MUST be the `models[]` catalog of the operator config file, not a compiled
catalog. `defaults.selector` MUST name one `models[].id` or one role, and startup MUST validate it.
The credential and the base URL of a model MUST come from its `providers[]` entry. The system MUST NOT
read `OPENAI_MODEL`, `OPENAI_BASE_URL`, or `OPENAI_API_KEY` as bare variables. A `providers[]` entry
can use them as `{env:…}` inputs.

#### Scenario: Catalog is config-sourced

- **WHEN** the instance resolves the executable models
- **THEN** it uses the `models[]` entries of the config file
- **AND** it does not use a compiled catalog

#### Scenario: Shipped example reproduces the current catalog

- **WHEN** an operator copies the committed `llame.config.jsonc.example` with no change
- **THEN** the executable catalog holds the earlier compiled system models (`system:openai:gpt-5.5`, `system:openai:gpt-5.4`, `system:openai:gpt-5.4-mini`, `system:openai:gpt-5.4-nano`, `system:openai:gpt-4o`, `system:openai:gpt-4o-mini`) on a default OpenAI provider

#### Scenario: Base URL is not probed

- **WHEN** a provider sets `baseUrl`
- **THEN** the models endpoint does not probe the provider before it returns the configured models

#### Scenario: Provider credential validity is not prevalidated

- **WHEN** a provider `key` is set, empty, or invalid
- **THEN** model availability and send validation do not check whether the provider accepts it
- **AND** an authentication or reachability failure shows at provider request time

#### Scenario: Provider credential failure is not payment required

- **WHEN** a provider request fails because a credential is missing or invalid, or because the provider is unreachable
- **THEN** the system does not return `402 Payment Required`
- **AND** the failure is a failure of the Run, with the class of `provider-failures`

#### Scenario: A model absent from the catalog is not executable

- **WHEN** a model id is not in the configured `models[]`
- **THEN** `GET /api/v1/models` does not return it, and a chat `selector` with that id gets `model_not_available`

#### Scenario: Legacy OpenAI model env is ignored

- **WHEN** `OPENAI_MODEL` is set
- **THEN** it has no effect on the returned models, the default selector, or the Run execution
- **AND** it does not make the model config invalid

### Requirement: Provider execution resolves through the configured provider

Model execution SHALL resolve a run's model to its catalog entry, that entry's `provider` to the matching `providers[]` entry, and a model client selected by the provider's `type`. The implementation SHALL dispatch on `type` — each executable type maps to exactly one client; `provider-api-selection` specifies the wire for every wire-named type, and `subscription-access-openai-codex` specifies it for `openai-codex`, whose transport and endpoint are fixed by construction — and SHALL treat any unrecognized resolved `type` as an internal error, not a silent fallback. Provider credentials SHALL come from the resolved provider entry for every executable type, not from a fixed environment variable. The request endpoint SHALL come from that entry only for the types whose endpoint is operator-declared: `openai-completions` uses its required `baseUrl`, `openai-responses` uses its optional `baseUrl` and otherwise the OpenAI default, `anthropic-messages` uses its optional `baseUrl` and otherwise the Anthropic default, and `openai-codex` rejects `baseUrl` entirely and executes against the fixed Codex endpoint `subscription-access-openai-codex` specifies. A keyless provider (empty resolved `key`) SHALL execute against its configured endpoint without raising a missing-credential error at client construction.

#### Scenario: Model routes to its provider's client

- **WHEN** a worker executes a run whose stored model id resolves to a catalog entry with `provider: "p"` and `providers[].id "p"` has an executable `type`
- **THEN** it builds the client for that `type` using provider `p`'s `key`/`baseUrl`
- **AND** it does not read `OPENAI_API_KEY` or `OPENAI_BASE_URL` as bare environment variables

#### Scenario: Keyless provider executes

- **WHEN** a run's model resolves to a keyless provider (empty `key`, e.g. a local Ollama declared `openai-completions`)
- **THEN** the model client is constructed without raising `LoadAPIKeyError`
- **AND** provider auth/reachability failures still surface at provider request time, not at construction

#### Scenario: Two providers of the same type route independently

- **WHEN** two models name two distinct providers of the same executable `type`
- **THEN** each executes against its own provider's `key`/`baseUrl`

### Requirement: Per-model compaction threshold

A model catalog entry MAY declare an optional `compactionThresholdTokens`. The compaction trigger threshold for a run SHALL resolve to that per-model value when present, otherwise to `Math.floor(contextWindowTokens × COMPACTION_WINDOW_RATIO)`. The threshold SHALL be compared against the measured context size inside the Run, before that Run's first model request. No instance-level compaction threshold or context-window override SHALL be read; the removed `COMPACTION_TOKEN_THRESHOLD` and `MODEL_CONTEXT_WINDOW_TOKENS` environment variables SHALL have no effect. Per-user and per-send threshold tiers are out of scope for this capability.

#### Scenario: Per-model override drives the trigger

- **WHEN** a run's model declares `compactionThresholdTokens`
- **THEN** compaction triggers against that value
- **AND** the model's `contextWindowTokens × ratio` is not used

#### Scenario: Falls back to the window-derived threshold

- **WHEN** a run's model does not declare `compactionThresholdTokens`
- **THEN** compaction triggers against `Math.floor(contextWindowTokens × COMPACTION_WINDOW_RATIO)`

#### Scenario: Instance compaction env vars are inert

- **WHEN** `COMPACTION_TOKEN_THRESHOLD` or `MODEL_CONTEXT_WINDOW_TOKENS` is set in the environment
- **THEN** it does not affect any run's compaction threshold

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

### Requirement: Model use for compaction and title generation is explicit

One compaction MUST use exactly one of two models. When the prepared request does not fit the window
of the Run model, the summary MUST use the model of the previous completed Run. When it fits and
reaches the threshold, the summary MUST use the model of the current segment. Title generation MUST
resolve `defaults.titleGenerationSelector`, as `model-failover` defines for a role. The system MUST
NOT add a model registry only for titles.

#### Scenario: Compaction uses triggering run model

- **WHEN** the Run's own threshold triggers a compaction before its first model request
- **THEN** the summary request uses the model of the current segment of that Run

#### Scenario: A window-triggered compaction uses the previous completed run's model

- **WHEN** a compaction precedes the first model request of a Run because the prepared request does not fit the model window
- **THEN** the summary request uses the model of the previous completed Run
- **AND** it sends no model id of the Run that prepared the request

#### Scenario: Title generation uses separate configured model

- **WHEN** title generation runs after a completed turn
- **THEN** it resolves its model from `defaults.titleGenerationSelector`
- **AND** it uses the credentials and the transport of that model's provider
- **AND** it does not use `defaults.selector`
- **AND** it persists no title model id, usage, cost, or telemetry
- **AND** `GET /api/v1/models` does not show the title selector

#### Scenario: Title model configuration failure does not break chat

- **WHEN** `defaults.titleGenerationSelector` is absent
- **THEN** `GET /api/v1/models`, chat sends, and Runs can still succeed with a valid chat config
- **AND** title generation leaves the Chat untitled and logs a server error
- **AND** title generation does not use `defaults.selector`

### Requirement: Assistant usage includes llame model id

Assistant message and compaction usage telemetry SHALL include the opaque llame `modelId` that produced the model output. New assistant message and compaction usage telemetry SHALL use `modelId` instead of the legacy `model` field and SHALL NOT write the legacy `provider` field. Existing computed usage fields, including generated-time `costUsd`, SHALL remain persisted and SHALL NOT be recomputed from future model metadata changes.

#### Scenario: Assistant usage records model id

- **WHEN** an assistant message is persisted after model execution
- **THEN** its usage telemetry includes the selected opaque `modelId`
- **AND** it does not write the legacy `model` field
- **AND** it does not write the legacy `provider` field

#### Scenario: Compaction usage records model id

- **WHEN** compaction usage telemetry is persisted after a compaction model call
- **THEN** its usage telemetry includes the opaque `modelId` of the model that ran that compaction: the triggering run's selected `modelId` on a threshold trigger, or the previous completed run's `modelId` on a window trigger
- **AND** it does not write the legacy `model` field
- **AND** it does not write the legacy `provider` field

#### Scenario: Past cost remains persisted

- **WHEN** model metadata or pricing configuration later changes
- **THEN** previously persisted `costUsd` values on message usage remain unchanged

### Requirement: Existing message ids conflict

In the current product, a chat send MUST use a user message id only once in a Chat. A chat send
with a message id that exists MUST get a conflict, also when its content or its model id matches
an earlier request. This rule does not apply to a follow-up request from `turn-actions`, because
that request names a user message that exists.

#### Scenario: Duplicate message id is rejected

- **WHEN** a caller posts a chat message whose id already exists in that Chat
- **THEN** the API returns 409 and creates no new Run

#### Scenario: A follow-up request names a message that exists

- **WHEN** the owner sends a follow-up request for the latest user message of a Chat
- **THEN** the message id does not cause a conflict
- **AND** the `turn-actions` rules decide the answer

### Requirement: Web sends only with valid selected model

The web app MUST fetch `/api/v1/models` and MUST show the stored selection of the Chat, or
`defaultSelector` for a Chat with no selection. A send MUST name `selector` only after the owner picks
in the picker, or for the first send of a new Chat. The composer input can stay usable while models
load or fail. The send action MUST stay disabled until a valid selection exists.

#### Scenario: Web initializes selected model

- **WHEN** the web app loads the models for a new Chat
- **THEN** the picker shows `defaultSelector`

#### Scenario: Web sends selected model id

- **WHEN** the owner picks `@coding` in the picker and sends a message
- **THEN** the request body holds `selector: "@coding"`
- **AND** a later send with no new pick holds no `selector`

#### Scenario: Web displays usage model id

- **WHEN** the web app shows or exports the usage of a reply
- **THEN** it reads `usage.modelId`
- **AND** it does not need a legacy `usage.model` or `usage.provider` field

#### Scenario: Send disabled while models are unavailable

- **WHEN** the models load, fail to load, or no valid selection exists
- **THEN** the chat input stays usable, and the send action is disabled

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

A chat send MUST accept an optional top-level `effort`. A present `effort` MUST be a nonblank string.
The API MUST validate it against the `value`s of `reasoning.effortLevels` of the resolved model of
`model-roles`, before it creates a message or a Run. The API MUST NOT accept a published `label` as
`effort`.

The API MUST match `effort` byte for byte. It MUST NOT apply its own vocabulary, pattern, or case
rule. It MUST NOT case-fold, trim, or change the value before the match. It MUST reject only a blank
value.

The selector MUST be validated before the effort. A blank or unavailable selector MUST get its own
failure, and the API MUST NOT evaluate `effort`.

An omitted `effort` MUST resolve as `model-roles` defines. For a model with no reasoning, an omitted
`effort` MUST resolve to no effort.

An effort that the resolved model does not declare MUST get 422 with `code = "effort_not_available"`.
Any `effort` for a model with no reasoning MUST get the same answer. The API then MUST create no
message and no Run.

#### Scenario: Send with a valid effort

- **WHEN** a caller sends a message with a valid `selector` and an `effort` that equals a declared level of the resolved model
- **THEN** the API creates the user message and the Run at that effort

#### Scenario: Label is rejected as effort

- **WHEN** a caller sends an `effort` that equals a published `label` and no declared `value`
- **THEN** the API returns 422 with `code = "effort_not_available"`
- **AND** it creates no message and no Run

#### Scenario: Omitted effort resolves the model default

- **WHEN** a caller sends with the exact selector of a model that declares reasoning, and with no `effort`
- **THEN** the Run uses that model's `defaultEffort`

#### Scenario: Omitted effort on a non-reasoning model

- **WHEN** a caller sends with the selector of a model that declares no reasoning, and with no `effort`
- **THEN** the API creates the message and the Run with no effort
- **AND** it does not reject the request

#### Scenario: Effort not declared by the selected model

- **WHEN** a caller sends an `effort` that the resolved model does not declare
- **THEN** the API returns 422 with `statusCode = 422`, `error = "Unprocessable Entity"`, and `code = "effort_not_available"`
- **AND** it creates no message and no Run

#### Scenario: Effort supplied for a non-reasoning model

- **WHEN** a caller sends any `effort` for a resolved model that declares no reasoning
- **THEN** the API returns 422 with `code = "effort_not_available"`
- **AND** it creates no message and no Run

#### Scenario: Malformed effort

- **WHEN** a caller sends a blank or non-string `effort`
- **THEN** the API returns 400 and creates no message and no Run

#### Scenario: Casing is significant

- **WHEN** a caller sends an `effort` that differs from a declared value only in letter case
- **THEN** the API returns 422 with `code = "effort_not_available"`
- **AND** it does not case-fold the value

#### Scenario: Effort is validated against the request's own model

- **WHEN** a caller sends an `effort` that another catalog model declares and the resolved model does not
- **THEN** the API returns 422 with `code = "effort_not_available"`

#### Scenario: Unavailable model is reported before effort is considered

- **WHEN** a caller sends an unavailable `selector` and an `effort` that no model declares
- **THEN** the API returns 422 with `code = "model_not_available"`
- **AND** it does not report an effort failure

#### Scenario: Missing model id short-circuits effort validation

- **WHEN** a caller sends an `effort` with a blank `selector`
- **THEN** the API returns 400 for the selector
- **AND** it does not evaluate the effort

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

### Requirement: Compaction inherits effort from the Run whose prefix it reuses

Compaction SHALL send the effort of the Run whose prompt prefix it reuses,
because a compaction request deliberately reproduces that Run's system prompt
and message prefix in order to reach the provider's prompt cache while it is
still warm. Sending a different effort would invalidate the cache the request
shape exists to exploit.

A compaction that runs before a Run's first model request is a continuation of
that Run's request rather than work after a completed turn, and its effort
source is selected once. A window trigger, where the prepared request does not
fit the Run model's window, SHALL send the previous completed Run's effort — the
Run whose model and system-prompt receipt the summary request reuses — and
SHALL NOT send the effort submitted with the incoming turn, which was validated
against a different model's declared levels and is not part of the reused
prefix. That window trigger SHALL apply whether or not the measured context size
also reaches the threshold. Only when the request fits the Run model's window
and the measured context size reaches the threshold SHALL the threshold trigger
send the resolved effort of the attempt it precedes. There SHALL be no separate
transition mode with a different effort source.

The inherited effort SHALL be sent as persisted, without re-validation against
current configuration, on the same receipt grounds as run execution.

Title generation SHALL send no effort. It executes on a separately configured
model with its own system prompt, shares no prefix with any Run, and the Run's
level may not exist in that model's vocabulary at all.

#### Scenario: Compaction inherits the triggering run's effort

- **WHEN** a run at some resolved effort is preceded by a compaction its own
  threshold triggered
- **THEN** the compaction model call sends that same effort

#### Scenario: Compaction of a run without effort sends none

- **WHEN** a run that resolved no effort is preceded by a compaction its own
  threshold triggered
- **THEN** the compaction model call sends no reasoning-effort parameter

#### Scenario: A window trigger uses the previous completed Run's effort

- **WHEN** a model switch requires compaction because the prepared request does
  not fit the selected model's window
- **THEN** the compaction model call sends the previous completed Run's
  persisted effort, the Run whose model and system-prompt receipt the request
  reuses
- **AND** it does not send the effort submitted with the incoming turn

#### Scenario: Inherited effort is not re-validated

- **WHEN** compaction inherits an effort that is no longer among its model's
  declared levels
- **THEN** it sends the value unchanged rather than dropping it or substituting
  a current default

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

### Requirement: Available model entries publish their input modalities

An entry's `input` SHALL name the input modalities the model accepts, drawn only from `text`,
`image`, and `pdf`. It SHALL be the model's resolved configured declaration in its declared order,
and it SHALL NOT be inferred from the model `id`, name, provider, or provider execution id.

#### Scenario: Declared image input is published

- **WHEN** a model entry configures `input: ["text", "image"]` and an authenticated caller requests
  `GET /api/v1/models`
- **THEN** that model's entry includes `input` equal to `["text", "image"]`

#### Scenario: Declared PDF input is published

- **WHEN** a model entry configures `input: ["text", "image", "pdf"]` and an authenticated caller
  requests `GET /api/v1/models`
- **THEN** that model's entry includes `input` equal to `["text", "image", "pdf"]`

#### Scenario: Undeclared input is published as text only

- **WHEN** a model entry omits `input` and an authenticated caller requests `GET /api/v1/models`
- **THEN** that model's entry includes `input` equal to `["text"]`
- **AND** the field is neither omitted nor `null`

#### Scenario: Every returned entry carries input

- **WHEN** `GET /api/v1/models` returns several models, some declaring `input` and some not
- **THEN** every returned entry includes a non-empty `input` array containing `text`

### Requirement: A compaction Run uses the model of its own Run

A compaction Run MUST send its summary request with the model id and the effort stored on that Run.
The absorbed rows can be too large for the window of that model. Then the Run MUST use the window
variant of automatic compaction, with its source Run. Without a source Run, the Run MUST fail.

#### Scenario: Compact with the composer model

- **WHEN** the owner sends `/compact` with model `B` and effort `low` to an idle Chat, and the last turn Run used model `A`
- **THEN** the summary request uses model `B` with effort `low`

#### Scenario: A history that does not fit the composer model

- **WHEN** the owner sends `/compact` with a model whose window cannot hold the absorbed rows
- **THEN** the summary request uses the model, the receipt, and the effort of the window variant source Run

#### Scenario: No source Run for a history that does not fit

- **WHEN** the absorbed rows do not fit the window of the Run model, and no earlier Run completed a reply
- **THEN** the compaction Run fails, and the Chat has no new checkpoint

### Requirement: A step-boundary compaction uses the model of the live Run

A step-boundary compaction MUST use the model id and the effort of the turn Run that it compacts.
The model and effort of a `/compact` item MUST NOT change them. A step-boundary compaction MUST NOT
use the window variant.

#### Scenario: A compact steer with another model

- **WHEN** a turn Run on model `A` is live, and the owner sends `/compact` as a steer with model `B`
- **THEN** the summary request uses model `A`
