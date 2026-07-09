## Context

Current `master` has a rich model list in `apps/web/lib/ai/models.ts`, but the chat transport never sends a selected model. The API executes the backend-configured model through `ModelsService.createOpenAIClient`, using `OPENAI_MODEL` as a provider model string and `OPENAI_API_KEY`/`OPENAI_BASE_URL` as OpenAI-compatible transport config.

That is not a real model-selection contract. The next step should be explicit executable availability:

- `/api/v1/models` returns models the authenticated user can actually use.
- the client sends one of those ids as top-level `modelId` on every chat send.
- the API validates and persists that selected id before enqueueing a run.

PR #137/#147 prove a broader path with BYOK provider accounts, remembered selection, OpenRouter, and allowlists. This change deliberately does less. The v1 model set is the hardcoded system catalog moved from web to API. Future JSON config and org/group/user sources can extend the same flat response shape.

## Goals / Non-Goals

**Goals:**

- Make `GET /api/v1/models` the authenticated availability API for executable models available to the caller.
- Preserve the current rich selector metadata from `apps/web/lib/ai/models.ts`, but make API field names explicit about units.
- Make chat sends explicit by requiring top-level `modelId`.
- Persist selected model ids on runs and assistant usage telemetry.
- Fail visibly for missing/invalid model configuration instead of guessing.
- Keep the first implementation system-only and hardcoded.

**Non-Goals:**

- Remembered selected-model preference/localStorage.
- BYOK provider accounts, native OpenRouter adapter, provider settings UI, or credential vault changes.
- Org/group/user model sources, JSON-backed model config, model allowlists, or config resolver integration.
- Provider live probing or reachability checks.
- Historical execution/pricing snapshot ledger beyond storing `modelId` and existing computed `costUsd`.
- Persisting or metering title-generation model usage; title generation remains existing best-effort metadata except for choosing its model from config.
- Backward compatibility or JSON backfill for proof-of-concept model-selection payloads, frontend static model helpers, legacy usage fields, or legacy run-event model payloads.
- Exact final composer error copy/layout; frontend requirements stay functional because the UI is subject to redesign.

## Decisions

### `/api/v1/models` Means Executable Availability

`GET /api/v1/models` returns a flat list of executable choices for the authenticated caller:

```ts
type ModelsResponse = {
  defaultModelId: string;
  models: AvailableModelResponse[];
};
```

For this slice every entry has `source: "system"`, and all authenticated users receive the same list if system model configuration is valid. The contract is still availability, not passive catalog metadata; future org/group/user sources can add entries without changing route semantics.

Alternative rejected: keep a separate system catalog endpoint. Leo wants `/api/v1/models` to be the API of models available to the user.

### Flat Entries With Opaque Model Ids

Model entries are flat, not grouped:

```ts
type AvailableModelResponse = {
  id: string;
  source: "system";
  name?: string;
  description?: string;
  tags?: string[];
  icon?: string;
  providerLabel?: string;
  contextWindowTokens?: number;
  pricingUsdPer1M?: {
    input?: number;
    cachedInput?: number;
    output?: number;
  };
  knowledgeCutoff?: string;
  reasoning?: boolean;
  website?: string;
  apiDocs?: string;
  modelPage?: string;
  releasedAt?: string;
};
```

`id` is an opaque, stable API id. Clients send it back and may compare it for equality; they must not parse provider routing from it. Internal catalog entries must carry explicit provider execution ids and adapter details; those stay server-only for now. Implementation must not derive `providerModelId` by parsing, splitting, or stripping the llame `id`, even when the current active ids look like `system:openai:<slug>`.

Display metadata remains optional, matching the current frontend model shape. Externally required model-entry fields are only `id` and `source`; even `name` is optional. Missing metadata such as `name`, `description`, `tags`, `contextWindowTokens`, pricing, dates, or links must not make an otherwise executable model unavailable. Unknown optional metadata is omitted from JSON rather than emitted as `null`, matching this repo's convention for optional fields; `null` is reserved for fields that are always present and have a domain-level null state. Configuration validation is for execution-critical fields: llame `id`, `source`, server-only provider execution id, adapter/routing information, and default id membership.

Alternatives rejected:

- grouped response by source/provider: grouping is presentation and would create churn with every future source type.
- exposing `providerModelId`: not needed by the current UI and invites clients to depend on provider internals.
- copying web's `price.input`/`contextWindow` field names directly: units are ambiguous for an API contract.
- deriving provider execution ids from llame ids: this makes the opaque-id rule performative and breaks as soon as aliases, proxies, or copied providers appear.

### System Configuration Is Explicit And Complete

The v1 system catalog is hardcoded in API code and is the complete configured system model set. `OPENAI_API_KEY` and `OPENAI_BASE_URL` are transport configuration for the OpenAI-compatible client, not availability gates. `OPENAI_API_KEY` may be absent for local OpenAI-compatible servers such as Ollama, and neither key presence nor key validity is probed by `/api/v1/models`.

Only models executable by the current backend belong in the active catalog. Current unsupported frontend entries, such as Anthropic or xAI models, can be copied over as commented future entries shaped like real model entries, but they must remain commented and must not be exported or returned by `/api/v1/models` until the matching adapter/configuration exists.

Initial active system ids:

- `system:openai:gpt-5.5`
- `system:openai:gpt-5.4`
- `system:openai:gpt-5.4-mini`
- `system:openai:gpt-5.4-nano`
- `system:openai:gpt-4o`
- `system:openai:gpt-4o-mini`

`OPENAI_MODEL` is replaced by `DEFAULT_MODEL_ID`, which names an opaque API model id from the hardcoded catalog. If `OPENAI_MODEL` is still present in the environment, it is ignored for model selection and does not make configuration invalid.

Rules:

- model-domain errors use the repo's standard `{ statusCode, error, message, code }` response body shape
- missing/blank `DEFAULT_MODEL_ID` -> `503` with code `model_configuration_invalid`
- `DEFAULT_MODEL_ID` not found in the catalog -> `503` with code `model_configuration_invalid`
- successful `200` always has `models.length > 0` and `defaultModelId` matching one entry
- `.env.example` sets `DEFAULT_MODEL_ID=system:openai:gpt-5.4-mini`
- `.env.example` sets `TITLE_GENERATION_MODEL_ID=system:openai:gpt-5.4-nano`

Alternative rejected: synthesize a minimal unknown default entry. That guesses incomplete configuration and contradicts the requirement to fail transparently.

### API Owns Ordering, Default Is A Field

The API returns models in stable order and the web selector preserves that order. `defaultModelId` is the only default signal. The default entry is not required to be first; future UI can add a default badge without changing API semantics.

### Chat Send Requires Top-Level `modelId`

`POST /api/v1/chats/:id/messages` takes:

```ts
{
  "message": { "id": "...", "parts": [...] },
  "modelId": "system:openai:gpt-5.4-mini"
}
```

Validation:

- missing/non-string/blank `modelId` -> `400`
- any other string that is not available to the caller -> `422` with code `model_not_available`
- no valid model configuration -> `503` with `model_configuration_invalid`
- existing message id -> `409`
- valid new message and valid model id -> persist message + run and enqueue

The selected model id is execution configuration, not message content, so it is top-level rather than nested inside `message`. The API must not validate model ids with a public syntax regex beyond requiring a non-empty string; ids are opaque and availability is determined by exact lookup.

### Persist Selected Model Id On Runs

Add required `runs.model_id` and backfill existing dev rows once to the literal canonical default `system:openai:gpt-5.4-mini`. The migration must not leave a database-level default on `runs.model_id`; new rows must provide `modelId` explicitly through application code. This repo has no real production usage for the current branch, so the migration can prefer a clean non-null invariant over nullable historical accommodation.

Do not migrate JSON payloads in `messages.usage`, `compactions.usage`, or `run_events.payload` from legacy `model`/`provider` to `modelId`. Existing proof-of-concept JSON data can remain stale or be reset out of band; only the structural `runs.model_id` column needs a migration backfill because new execution depends on it.

At enqueue time the API validates the selected id and stores it on the run. The worker uses the stored run model id to resolve the model for execution. It must not silently substitute a new default. If the stored model becomes unavailable before pickup, the run fails transparently rather than rerouting.

Provider credential and reachability failures happen at provider request time. Missing or invalid `OPENAI_API_KEY` must not make `/api/v1/models` fail and must not be rejected before run persistence; a provider that needs authentication will fail the model request transparently, while a local OpenAI-compatible provider that does not require a key can still work. Do not return `402 Payment Required` for missing system credentials. For this slice, provider authentication/reachability failure is a generic execution failure: if it surfaces through an HTTP request before streaming/queue handoff, `500` is enough; otherwise the run fails through the normal run failure path.

Run events that identify model execution, including `model.requested` and `model.completed`, use `modelId` and stop exposing legacy `model`/`provider` attribution. This applies to live SSE and event replay/resume.

`messages.usage` should include the opaque `modelId` for assistant messages. New assistant usage telemetry replaces the legacy `model` field with `modelId` and stops writing the legacy `provider` field. Compaction usage telemetry follows the same model-attribution shape: `modelId`, not `model` or `provider`. The frontend should migrate to `usage.modelId` and does not need a legacy `usage.model` or `usage.provider` fallback for proof-of-concept data. Existing `costUsd` remains the generated-time computed cost; this change does not add a full pricing/execution snapshot.

### Post-Turn Model Use

The assistant response and compaction use the selected model id stored on the run. Compaction is caused by a completed message/run, so it must use the model selected for that triggering message rather than a separate compaction default.

Title generation uses a separate server-side `TITLE_GENERATION_MODEL_ID` setting. It must name a valid active system catalog id and resolves through the same explicit server-only provider execution ids as chat models. It uses the same system provider credentials and transport configuration (`OPENAI_API_KEY` and optional `OPENAI_BASE_URL`) as chat execution; only the model id differs. This change does not introduce a separate title-only model registry or title-specific provider credentials. The title model setting is fully internal and is not returned by `GET /api/v1/models`.

Missing or invalid `TITLE_GENERATION_MODEL_ID` must not fail `GET /api/v1/models`, chat send, or run execution. Title generation remains best-effort metadata: if title model configuration cannot be resolved, the chat stays untitled and the server logs a clear error. It must not silently fall back to `DEFAULT_MODEL_ID`.

This change does not persist title-generation `modelId`, title usage, title cost, or title telemetry. The only title-generation behavior change is model resolution from explicit configuration.

### Idempotency Is Strict For Now

The current product does not expose retries/regeneration. If a user message id already exists in the chat, the API returns `409` regardless of matching content or model id. Future retry/regenerate work can reintroduce explicit retry semantics with a separate contract.

### Frontend Sends Only After Model Selection Is Valid

The web app fetches `/api/v1/models`, initializes selected model from `defaultModelId`, and sends top-level `modelId` with every chat request. The composer input can remain usable while models load or fail, but the send button is disabled until a valid selected model id exists. Model display falls back deterministically to `name ?? id`. Errors/loading state must be surfaced functionally near the selector/composer; exact copy/layout is out of scope.

No remembered selected-model persistence is added in this change.

## Risks / Trade-offs

- Hardcoded system catalog will need replacement -> Accept for this slice; JSON-backed config is a future change.
- Required `modelId` breaks older clients -> Accept because this is pre-v1 and makes behavior explicit.
- Backfilling existing runs to default is historically imprecise -> Accept for current dev data; avoids nullable API/model invariants.
- No remembered selection means default changes can still affect reload behavior -> Accept for now; the selected model is visible and sent explicitly, and remembered selection is tracked separately.
- Provider/proxy internals can still drift behind the same model id -> Out of scope; this change snapshots only llame's selected opaque id and computed cost, not an audit ledger of upstream routing.
