## Why

The provider connection and the entire model catalog are still hardcoded: `apps/api/src/models/model-catalog.ts` is a frozen `provider: 'openai'` list, and provider credentials/base URL are read ad hoc from `ConfigService` env (`OPENAI_API_KEY`, `OPENAI_BASE_URL`). #166 established operator config-as-code (`llame.config.json`) but explicitly deferred `providers[]`/`models[]` to this follow-up. Until they move into the config file, an operator cannot add a model, point at a second OpenAI-compatible endpoint (a local Ollama alongside hosted OpenAI), or run a keyless local provider — the three things a self-hosted BYOK instance most needs to do without a code change.

## What Changes

- **`providers[]` in `llame.config.json`** — duplicable provider entries `{ id, type, key, baseUrl }`. `type` is `"openai"` only in this slice (covers native OpenAI + OpenAI-compatible Ollama + any compatible endpoint); `key`/`baseUrl` use the existing `{env:}`/`{path:}` interpolation. `OPENAI_API_KEY`/`OPENAI_BASE_URL` stop being read directly and become interpolation inputs referenced from a provider entry.
- **`models[]` in `llame.config.json`** — the model catalog as config entries `{ id, provider→providers[].id, providerModelId, contextWindowTokens, pricingUsdPer1M, compactionThresholdTokens?, …display fields }`, **superseding** the hardcoded `model-catalog.ts`. **BREAKING (operator-facing, pre-release):** an instance with no `models[]` configured has no executable models; the shipped `.example` reproduces today's catalog so `cp` preserves current behavior.
- **Type-dispatched client factory** — `ModelsService` resolves a model → its provider → a client selected by provider `type`. A single `openai` case today; any other `type` is a loud boot error. The seam is built so the Anthropic adapter (a **split-out follow-up**) is a localized addition, not a rework.
- **Keyless providers** — a provider whose `key` resolves empty (`"{env:OLLAMA_API_KEY:-}"`) runs without credentials; the OpenAI client passes a placeholder `apiKey` so `@ai-sdk/provider-utils` `loadApiKey` no longer throws `LoadAPIKeyError`. **Subsumes #162.**
- **Per-model compaction threshold** — an optional `models[].compactionThresholdTokens` replaces the instance env knobs. Threshold resolution becomes: per-model override → else `contextWindowTokens × ratio`. The `COMPACTION_TOKEN_THRESHOLD` and `MODEL_CONTEXT_WINDOW_TOKENS` env reads in `compaction.service.ts` are **deleted**. User-per-model and per-send tiers are **out of scope** (they arrive with #168's tenant-settings redesign).
- **Boot-time reference integrity** — `models[].provider` must reference a defined `providers[].id`, and `defaults.modelId`/`titleGenerationModelId` must reference a defined model, or boot fails (config-as-code = deploy-time correctness). Default-model validity moves from a request-time `503` to boot.
- **Type erosion** — the compile-time `ActiveSystemModelId` literal union becomes `string`; model-id validity is enforced by ajv + catalog lookup (the tradeoff #166 already accepted). The `/api/v1/models` public response contract (#161) is unchanged.

## Capabilities

### New Capabilities

<!-- None. This change improves two existing capabilities. -->

### Modified Capabilities

- `instance-config`: adds the `providers[]` and `models[]` config surface (schema shape, array-of-objects loader resolution with per-element interpolation, secret discipline over array elements, cross-reference integrity); removes the first-slice statements that "provider settings stay env vars" and reserved the `models` key for later; keeps the "no instance-level compaction knob" invariant but relocates the threshold to a per-model field.
- `available-models`: the executable catalog is sourced from `models[]` instead of the hardcoded list; provider execution resolves model→provider→client by provider `type`; keyless providers execute; the default-model configuration error moves to boot; compaction threshold is per-model; the `OPENAI_*`/`DEFAULT_MODEL_ID`/`OPENAI_MODEL` env scenarios are restated in terms of config entries.

## Impact

- **Config/schema**: `apps/api/src/instance-config/llame-config.ts` (new `providers`/`models` types), `llame.config.schema.json` (new namespaces + provider/model `$defs`), `config-loader.ts` (new array-of-objects resolvers reusing `interpolateString`), `llame.config.json.example`.
- **Models domain**: `model-catalog.ts` (hardcoded array removed; types kept), `models.service.ts` (`createClient(modelId)`/`resolveProviderCredential(providerId)`, catalog now from `InstanceConfigService`), `openai-model-client.ts` (keyless placeholder apiKey), a new `model-client-factory` (`.type` dispatch).
- **Execution callers**: `runs/runs-worker.service.ts:162`, `titles/title.service.ts:73`, and the `runs/worker-harness.ts` + `models/fake-model-client.ts` test fakes move to the type-agnostic API.
- **Compaction**: `compaction/compaction.service.ts` (both env reads deleted; per-model threshold), `compaction/compaction.ts` (`resolveCompactionThreshold` input shape).
- **Dependencies**: none added in this slice (`@ai-sdk/anthropic` lands with the follow-up).
- **Eval suite**: its cheap-compaction override migrates from `COMPACTION_TOKEN_THRESHOLD` to a low `compactionThresholdTokens` on a model entry in its config fixture.
- **Docs**: SPEC config section, `apps/api/AGENTS.md`, `.env.example`, README quickstart; `CHANGELOG.md`.
- **Refs**: requires #166 (merged, PR #165); refs #37 (BYOK track — the `resolveModelCredential(userId)` seam is preserved unused), #162 (keyless — subsumed), #168 (tenant settings — owns the dropped compaction tiers). Anthropic adapter filed as an immediate follow-up.
