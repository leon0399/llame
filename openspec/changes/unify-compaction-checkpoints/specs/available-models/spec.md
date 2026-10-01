# Spec Delta

## MODIFIED Requirements

### Requirement: Per-model compaction threshold

A model catalog entry MAY declare an optional `compactionThresholdTokens`. The compaction trigger threshold for a run SHALL resolve to that per-model value when present, otherwise to `contextWindowTokens × COMPACTION_WINDOW_RATIO`. The threshold SHALL be compared against the measured context size inside the Run, before that Run's first model request. No instance-level compaction threshold or context-window override SHALL be read; the removed `COMPACTION_TOKEN_THRESHOLD` and `MODEL_CONTEXT_WINDOW_TOKENS` environment variables SHALL have no effect. Per-user and per-send threshold tiers are out of scope for this capability.

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

### Requirement: Model use for compaction and title generation is explicit

Compaction and title-generation work SHALL use explicit model selection. A
compaction whose trigger is the prepared request reaching the Run model's
threshold SHALL use the model id stored on that Run. A compaction whose trigger
is that prepared request not fitting the Run model's window SHALL use the
previous completed Run's model id, because the model the attempt precedes
cannot summarize a prefix it does not fit. Title generation SHALL use a separate
server-side `TITLE_GENERATION_MODEL_ID` that names a valid active system catalog
id. The implementation SHALL NOT introduce a separate title-only model registry
for this change.

#### Scenario: Compaction uses triggering run model

- **WHEN** a run's first model request is preceded by a compaction the Run's own
  threshold triggered
- **THEN** the compaction model call uses the selected model id stored on that run

#### Scenario: A window-triggered compaction uses the previous completed run's model

- **WHEN** a run's first model request is preceded by a compaction because the
  prepared request does not fit that run's model window
- **THEN** the compaction model call uses the previous completed run's model id
- **AND** it sends no model id from the run that prepared the request

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

### Requirement: Compaction inherits effort from the Run whose prefix it reuses

Compaction SHALL send the effort of the Run whose prompt prefix it reuses,
because a compaction request deliberately reproduces that Run's system prompt
and message prefix in order to reach the provider's prompt cache while it is
still warm. Sending a different effort would invalidate the cache the request
shape exists to exploit.

A compaction that runs before a Run's first model request is a continuation of
that Run's request rather than work after a completed turn. A threshold trigger
SHALL send the resolved effort of the attempt it precedes. A window trigger,
where the prepared request does not fit the Run model's window, SHALL send the
previous completed Run's effort — the Run whose model and system-prompt receipt
the summary request reuses — and SHALL NOT send the effort submitted with the
incoming turn, which was validated against a different model's declared levels
and is not part of the reused prefix. There SHALL be no separate transition
mode with a different effort source.

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

#### Scenario: Transition compaction uses the source run's effort

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

## RENAMED Requirements

- FROM: `### Requirement: Post-turn model use is explicit`
- TO: `### Requirement: Model use for compaction and title generation is explicit`
- FROM: `### Requirement: Post-turn model work inherits effort only where its request is prefix-aligned`
- TO: `### Requirement: Compaction inherits effort from the Run whose prefix it reuses`
