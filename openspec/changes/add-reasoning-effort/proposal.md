# Add per-request reasoning effort

## Why

Every modern reasoning model exposes an effort dial — OpenAI's
`reasoning_effort` spans `none` through `max`, Anthropic's `effort` spans `low`
through `max` — and it is the single largest lever a chat owner has over answer
quality, latency, and spend on one turn. llame sends no generation parameter of
any kind today: `ModelStreamInput` carries messages, tools, and callbacks, and
even `runs.maxOutputTokens` is only a context-fit reservation that never reaches
the provider. Owners are locked to whatever each model does by default, and an
operator who wants a cheap fast model and a deep expensive one must publish two
catalog entries for the same underlying model.

## What Changes

- **BREAKING** — `models[].reasoning` changes from a display boolean to an
  object declaring the model's effort vocabulary. An entry still using the
  boolean fails boot naming the offending model. `GET /api/v1/models` returns
  the object in its place, so generated clients must regenerate.
- Operators declare each model's effort levels as **opaque provider-native
  tokens** — no llame enumeration and no character pattern, since either is a
  llame-owned vocabulary that a provider release would invalidate. Adding a
  level a provider ships later is a configuration edit, never a release.
- Chat sends accept an optional per-request `effort`, matched byte-exactly
  against the selected model's declared levels. Omitting it resolves the model's
  `defaultEffort`. Model validation runs first: an unavailable `modelId` is
  reported without evaluating effort at all.
- The resolved effort is persisted on the run and is what the worker executes,
  so a later configuration edit cannot retroactively change a queued or
  historical run — and is never re-validated against current configuration.
- Effort accompanies `modelId` at every surface that records or returns it: the
  run resource, the run context receipt, assistant message usage, compaction
  usage, the model-attribution run event, and the turn-telemetry log. Surfaces
  that carry no `modelId` gain nothing.
- Compaction inherits the effort of the run whose prompt prefix it reuses,
  because its request shape exists to hit the provider's prompt cache and a
  differing effort would invalidate it. Transition compaction uses the **source**
  run's effort. Title generation, which shares no prefix and runs on a different
  model, sends none.
- Operators may declare that changing effort invalidates the provider's prompt
  cache for a model, so a later UI change can warn before an owner pays for a
  full prefix re-read.

Not in this change: any UI, `temperature` / `topP` / `topK` / other sampling
parameters, per-user effort preferences, per-chat effort memory, and per-level
display metadata.

## Capabilities

### New Capabilities

None. Effort is a property of the existing model-selection and run-execution
surfaces rather than a new capability.

### Modified Capabilities

- `instance-config`: the model catalog entry gains a `reasoning` object
  (`effortLevels`, `defaultEffort`, `cacheInvalidatedByEffortChange`) with boot
  validation, replacing the `reasoning` boolean.
- `available-models`: `GET /api/v1/models` publishes the reasoning object; chat
  send accepts and validates an optional `effort` after model validation; the
  resolved effort is persisted per run, executed by the worker, and recorded
  everywhere `modelId` is; post-turn model work inherits it only where its
  request is prefix-aligned.
- `reasoning-output`: the catalog's reasoning marker is now the object's
  presence rather than a boolean, without changing how reasoning output itself
  is collected or persisted.

## Impact

**Configuration.** `llame.config.json` `models[]` entries, the published
`llame.config.schema.json`, and `RawModelEntry` / `SystemModelCatalogEntry` /
`PublicModelCatalogEntry`. Existing configuration files that set
`reasoning: true` must be edited before the instance will boot.

**API.** `POST /api/v1/chats/:id/messages` gains an optional `effort` and a new
422 `effort_not_available`. `AvailableModelResponse.reasoning` changes shape.
`RunResponse`, `ContextReceiptResponse`, and `CompactionStatsResponse` gain
`effort`. `apps/api/openapi.json` and the committed Orval bindings in
`apps/web/lib/api/generated` regenerate; no `apps/web` component reads the
changed field today, so no web behavior changes.

**Database.** One additive migration adding a nullable `runs.effort`.

**Execution.** `ModelStreamInput` gains its first generation parameter;
`openai-model-client.ts` maps it onto `providerOptions.openai.reasoningEffort`
for both the Responses and Chat Completions paths; `CompactionService` threads
the inherited effort through both its full and transition paths;
`TurnTelemetry` gains an optional `effort` written by both the assistant-turn
and compaction writers.

**Dependencies.** Requires `@ai-sdk/openai@3.0.97` or newer, landed separately:
earlier versions reject `max` in `parseProviderOptions` before the request
leaves the process.
