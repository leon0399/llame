## 1. Schema + config types

- [x] 1.1 Extend `llame.config.schema.json` with a `providers` array: items `{ id (non-empty string), type (enum: exactly `["openai"]`), key? (string), baseUrl? (string) }`, `additionalProperties: false`; add a shared provider-`type` `$def`. Descriptions double as hover docs.
- [x] 1.2 Extend the schema with a `models` array: items `{ id, provider, providerModelId, contextWindowTokens (integer ≥ 1), pricingUsdPer1M?, compactionThresholdTokens? (integer ≥ 1), + optional display fields mirroring the public model contract }`, `additionalProperties: false`. Use the numeric-or-token `$defs` where interpolation must stay editor-valid.
- [x] 1.3 Add `providers` / `models` to the `LlameConfig` type in `llame-config.ts` (new `ProviderConfig` / `ModelConfig` types) and to `BUILT_IN_DEFAULTS` (empty arrays). Keep the type and schema co-edited (they must not drift).
- [x] 1.4 Update the schema's top-level `description` and the `defaults`/`First-slice` prose to reflect that `models` now holds the catalog and provider connections live in `providers[]` (no longer "reserved"/"env-only").

## 2. Loader resolution + reference integrity

- [x] 2.1 Add `resolveProviders(raw, env)` to `config-loader.ts`: iterate schema-validated entries, `interpolateString` each `key`/`baseUrl`, empty `key` → keyless. Error context names `providers[<id>].<field>`, never index-only, never the value. Reject duplicate ids.
- [x] 2.2 Add `resolveModels(raw, env, providerIds)`: build the entries; a `provider` not in `providerIds` fails boot naming the model id + dangling ref.
- [x] 2.3 Add default-model boot validation: `defaults.modelId` and `defaults.titleGenerationModelId` (when set) must reference a resolved model id, else `InstanceConfigError` naming the dangling default.
- [x] 2.4 Confirm secret discipline holds for arrays: no resolved `key` reaches any thrown message or log (extend the redaction path/tests if the array errors introduce a new sink).

## 3. Models domain rework

- [x] 3.1 In `model-catalog.ts`: delete the hardcoded `SYSTEM_MODEL_CATALOG` array and the `ActiveSystemModelId` literal union; keep `PublicModelCatalogEntry`, `SystemModelCatalogEntry` (widen `id: string`, `provider: string`), pricing/`toPublicModel` helpers, and `DEFAULT_SYSTEM_MODEL_ID` only if still referenced.
- [x] 3.2 Source the catalog in `ModelsService` from `InstanceConfigService.config.models` (build the `id → entry` `Map` at boot); `requireAvailableModel`/`resolveDefaultModelConfig`/`getAvailableModels` read the config catalog; drop the `as ActiveSystemModelId` casts.
- [x] 3.3 Add a `.type`-dispatch client factory (`model-client-factory.ts`): `openai` → `createOpenAIModelClient`; any other resolved `type` throws an internal error. `client.provider` = the provider `type`.
- [x] 3.4 Replace `createOpenAIClient`/`getOpenAIProviderCredential` with `createClient(modelId)` (model → provider → factory) and `resolveProviderCredential(providerId)` (reads the provider's resolved `key`). Keep the unused `resolveModelCredential(userId)` BYOK seam.
- [x] 3.5 In `openai-model-client.ts`: when the resolved credential is empty, pass a non-empty placeholder `apiKey` to `createOpenAI` so `loadApiKey` never throws for a keyless endpoint (fixes #162).

## 4. Execution callers

- [x] 4.1 Move `runs-worker.service.ts` (`~:162`) from `createOpenAIClient({credential: getOpenAIProviderCredential(), modelId})` to `createClient(modelId)`.
- [x] 4.2 Move `titles/title.service.ts` (`~:73`) to `createClient(modelId)`.
- [x] 4.3 Update the `runs/worker-harness.ts` and `models/fake-model-client.ts` fakes to the type-agnostic surface (`createClient`, dynamic `provider`), removing the `provider: 'openai'` literals and `getOpenAIProviderCredential` fake.

## 5. Compaction: per-model threshold, delete instance env

- [x] 5.1 Delete the `COMPACTION_TOKEN_THRESHOLD` / `MODEL_CONTEXT_WINDOW_TOKENS` reads in `compaction.service.ts` (`~:53-63`); narrow `resolveCompactionThreshold` input to `{ explicitThresholdTokens?, contextWindowTokens }`.
- [x] 5.2 Feed `explicitThresholdTokens` from the run model's `compactionThresholdTokens` (via the catalog / client), falling back to `contextWindowTokens × COMPACTION_WINDOW_RATIO`.
- [x] 5.3 Migrate the eval suite's cheap-compaction override: replace the `COMPACTION_TOKEN_THRESHOLD` env trick with a model entry carrying a low `compactionThresholdTokens` in the eval config fixture; keep/adjust the assertion that compaction still fires.

## 6. Example, config, docs

- [x] 6.1 Rewrite `apps/api/llame.config.json.example`: a default `type: openai` provider (`key: "{env:OPENAI_API_KEY:-}"`, `baseUrl: "{env:OPENAI_BASE_URL:-}"`), an optional keyless Ollama provider (commented), and the six current models under `models[]` reproducing today's catalog; `defaults.modelId` set.
- [x] 6.2 Update `.env.example` (OPENAI\_\* now interpolation inputs), README quickstart, `apps/api/AGENTS.md` (catalog/provider config, keyless, per-model compaction, removed compaction env vars), and the SPEC config section.
- [x] 6.3 Add the `CHANGELOG.md` entry (same PR).

## 7. Tests

- [x] 7.1 Loader: valid providers/models; duplicate provider id fails; `models[].provider` dangling ref fails; unsupported `type` fails schema; `contextWindowTokens` missing/non-positive fails; dangling `defaults.modelId` fails boot.
- [x] 7.2 Interpolation over arrays: `key`/`baseUrl` `{env:}`/`{path:}` resolve; keyless (`{env:X:-}` empty); **no-secret-in-logs negative test over an array element `key`** (errors name `providers[<id>].<field>`, not the value).
- [x] 7.3 Execution: `createClient(modelId)` routes to the model's provider; keyless client constructs without `LoadAPIKeyError` (real `createOpenAI`, not mocked — closes the #162 false-green); two same-type providers route independently.
- [x] 7.4 Compaction: per-model `compactionThresholdTokens` drives the trigger; falls back to window×ratio; env vars inert.
- [x] 7.5 `/api/v1/models` response is byte-identical to the pre-change contract for the example catalog (#161).

## 8. Follow-up + verification

- [x] 8.1 File the Anthropic-adapter follow-up (issue + change stub): `@ai-sdk/anthropic@3.x`, `createAnthropicModelClient`, `type` enum `+= "anthropic"`, factory `+= case`; carry the seam-parity open question (reasoning-delta + `generateObject` tool-calling verify-at-implementation). Filed as [#208](https://github.com/leon0399/llame/issues/208).
- [x] 8.2 `pnpm --filter api build` / `typecheck` / `lint` clean; `pnpm --filter api test` green.
- [x] 8.3 `openspec validate providers-and-models-as-code` clean; every spec scenario maps to at least one executed test.
