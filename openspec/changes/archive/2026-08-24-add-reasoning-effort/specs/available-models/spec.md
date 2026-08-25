## ADDED Requirements

### Requirement: Available model entries publish their reasoning effort contract

An available model entry SHALL include a `reasoning` object when, and only when, the operator declared one for that model. The object SHALL carry `effortLevels`, `defaultEffort`, and `cacheInvalidatedByEffortChange`. `effortLevels` SHALL be returned in the operator-authored order so a client can present them as an ordered scale without inferring one.

A level SHALL be published verbatim and treated as an identifier. A client MAY render the token itself as a display fallback but SHALL NOT parse meaning, magnitude, or ordering out of its text, and SHALL NOT assume a token means the same thing on another model.

A model with no declared reasoning SHALL omit `reasoning` entirely rather than returning `null` or an empty object, consistent with unknown optional metadata being absent rather than fabricated.

The reasoning object SHALL NOT expose the provider execution id, the provider connection, host paths, or any other server-only configuration.

#### Scenario: Reasoning-capable model publishes its levels

- **WHEN** `GET /api/v1/models` returns a model whose operator configuration declares `reasoning`
- **THEN** its entry includes `reasoning` with `effortLevels`, `defaultEffort`, and `cacheInvalidatedByEffortChange`
- **AND** `effortLevels` preserves the operator-authored order

#### Scenario: Levels are published verbatim

- **WHEN** a declared level is returned
- **THEN** the token is byte-identical to the configured value
- **AND** it is not normalized, titlecased, or replaced with a llame display label

#### Scenario: Non-reasoning model omits the object

- **WHEN** `GET /api/v1/models` returns a model whose operator configuration declares no `reasoning`
- **THEN** the entry omits `reasoning` rather than returning `null` or an empty object

#### Scenario: Reasoning object carries no server-only configuration

- **WHEN** a reasoning object is returned
- **THEN** it contains no provider execution id, provider connection detail, or host path

### Requirement: Chat sends accept an optional reasoning effort

Creating a chat message SHALL accept an optional top-level `effort`. When present it SHALL be a nonblank string and SHALL be validated, before any message or run is created, against the `reasoning.effortLevels` of the model named by the same request's `modelId`.

`effort` SHALL be treated as opaque and matched byte-exactly against the selected model's declared levels. The API SHALL NOT impose a vocabulary, character pattern, or casing rule of its own, and SHALL NOT case-fold, trim beyond blank rejection, or otherwise normalize the submitted value before matching.

Model validation SHALL precede effort validation. When the request's `modelId` is missing, malformed, or unavailable, the API SHALL return that failure and SHALL NOT evaluate `effort` at all, because a level's legality is defined only by a resolved model.

When `effort` is omitted, the API SHALL resolve the selected model's `defaultEffort`. When the selected model declares no reasoning, an omitted `effort` SHALL resolve to no effort and the request SHALL proceed.

An effort value that is not a declared level of the selected model, or any `effort` at all for a model that declares no reasoning, SHALL be rejected with 422 and `code = "effort_not_available"`, creating no message and no run.

#### Scenario: Send with a valid effort

- **WHEN** an authenticated caller posts a chat message with a valid `modelId` and an `effort` that is one of that model's declared levels
- **THEN** the API creates the user message and run and enqueues execution at that effort

#### Scenario: Omitted effort resolves the model default

- **WHEN** a caller posts a chat message naming a model that declares reasoning, without `effort`
- **THEN** the API resolves that model's `defaultEffort` for the run

#### Scenario: Omitted effort on a non-reasoning model

- **WHEN** a caller posts a chat message naming a model that declares no reasoning, without `effort`
- **THEN** the API creates the message and run with no effort
- **AND** the request is not rejected

#### Scenario: Effort not declared by the selected model

- **WHEN** a caller posts a chat message with an `effort` that is not one of the selected model's declared levels
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

- **WHEN** a caller posts an `effort` that differs from a declared level only by letter case
- **THEN** the API returns 422 with `code = "effort_not_available"`
- **AND** the value is not case-folded to match

#### Scenario: Effort is validated against the request's own model

- **WHEN** a caller posts an `effort` that is a declared level of some other catalog model but not of the request's `modelId`
- **THEN** the API returns 422 with `code = "effort_not_available"`

#### Scenario: Unavailable model is reported before effort is considered

- **WHEN** a caller posts a chat message whose `modelId` is unavailable and whose `effort` is also not a level of any model
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
