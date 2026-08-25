## MODIFIED Requirements

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
