## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Chat sends require explicit model id

**Reason**: A send names a `selector`, which can be a role, and a send can omit it to use the Chat's
stored selection.

**Migration**: Use `model-roles` "A send names a selector or uses the stored selection". Clients send
`selector` in place of `modelId`.
