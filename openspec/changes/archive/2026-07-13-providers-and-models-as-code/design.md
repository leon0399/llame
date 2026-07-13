## Context

#166 (PR #165) shipped operator config-as-code: a strict, closed JSONC `llame.config.json`, validated by its own published JSON Schema (the schema **is** the ajv boot validator), with `{env:}`/`{path:}` interpolation resolved once at boot and file→built-in-default precedence. It deliberately deferred the two largest operator surfaces — the provider list and the model catalog — to this follow-up, and left the loader as a **per-leaf scalar** resolver (`readLeaf` + `resolve{NullableString,Numeric,ToolAllowlist,WorkerProfiles}` in `config-loader.ts`).

Today those two surfaces are hardcoded:

- `apps/api/src/models/model-catalog.ts` is a frozen `readonly SystemModelCatalogEntry[]` with `provider: 'openai'` literals and an `ActiveSystemModelId` TS union derived from it.
- `models.service.ts` reads `OPENAI_API_KEY`/`OPENAI_BASE_URL` from `ConfigService` and only ever builds one client type (`createOpenAIModelClient`).
- `compaction.service.ts` still reads `COMPACTION_TOKEN_THRESHOLD` / `MODEL_CONTEXT_WINDOW_TOKENS` env vars (kept alive by #166 as _readers_, not file settings, pending this change).

The `ModelClient` interface (`model-client.ts`) is already provider-agnostic (`streamText`/`generateObject`/`contextWindowTokens`), so the hard part of this change is the config **loader shape** and **resolution wiring**, not the client contract.

Two hard scope boundaries, settled in the 2026-07-13 design session:

- **Anthropic is split out.** `type: openai` already covers native OpenAI + OpenAI-compatible Ollama + any compatible endpoint — the bulk of the value. The Anthropic adapter carries all the novel risk (new dependency, a new client implementation, unverified seam-mapping) and would block the whole config migration on it working. This change builds the `.type`-dispatch seam; a follow-up adds `type: anthropic`.
- **Compaction gets one tier, not three.** The issue body's `model → user → per-send` was aspirational; the tiers do not exist today. The user-per-model tier requires tenant DB storage under RLS, which is #168's territory. This change delivers only the model-default tier (a config field) and deletes the instance env knobs; the multi-tier resolver arrives with #168's redesign.

## Goals / Non-Goals

**Goals:**

- Move `providers[]` and `models[]` into `llame.config.json` as strictly-validated, interpolation-aware config, superseding `model-catalog.ts`.
- Make provider execution `type`-dispatched (model → provider → client-by-type), with a seam that makes adding a provider type a localized change.
- Support keyless OpenAI-compatible providers (local Ollama) without a `LoadAPIKeyError` — subsuming #162.
- Move per-model compaction threshold onto the model entry and delete the instance-level compaction env reads.
- Enforce provider/model reference integrity and default-model validity at boot (deploy-time correctness).
- Keep `/api/v1/models` (#161) byte-identical and the per-user BYOK credential seam (#37) intact.

**Non-Goals:**

- **The Anthropic adapter** (`@ai-sdk/anthropic`, `createAnthropicModelClient`, `type: anthropic` in the enum) — an immediate isolated follow-up. This change ships `type: openai` only.
- **User-per-model and per-send compaction tiers** — owned by #168 (tenant settings + per-run snapshot).
- **Per-user BYOK provider credentials** (#37/v0.4) — the `resolveModelCredential(userId)` seam is preserved but unused; provider `key` in config is the operator-level credential.
- **Model visibility/allowlist per scope** (#85), **OpenRouter catalog sync** (#84) — separate changes that consume this catalog shape.
- Hot-reload of the catalog — restart-to-apply, same as #166.

## Decisions

### D1. `providers[]` and `models[]` as top-level config arrays; `type` enum is `["openai"]` only

`providers` is an array of `{ id, type, key?, baseUrl? }`; `models` is an array of `{ id, provider, providerModelId, contextWindowTokens, pricingUsdPer1M?, compactionThresholdTokens?, …display fields }`. Providers are **duplicable** — `type` selects the client implementation, so two `type: openai` entries (hosted OpenAI + a local Ollama on a different `baseUrl`) coexist by distinct `id`. The schema's `type` enum lists **only `"openai"`**: a strict-closed schema must not advertise a type it cannot execute, so `type: anthropic` fails schema validation at boot until the follow-up adds both the enum value and the client. The follow-up's diff is then exactly: enum `+= "anthropic"`, factory `+= case`, new `createAnthropicModelClient`, `+@ai-sdk/anthropic`.

_Alternative — forward-declare `anthropic` in the enum now:_ rejected. It would let an operator write `type: anthropic` and get a runtime "unsupported type" boot error instead of a schema error at the exact offending path — worse diagnostics, and it violates the #166 principle that the published schema describes what the instance can actually do.

### D2. Array-of-objects loader resolution: reuse `interpolateString`, add an array resolver, carry the scalar loader's secret discipline

`providers[].key`/`baseUrl` are the first **interpolated string fields inside array elements**; every scalar resolver in `config-loader.ts` is single-leaf. Rather than force the per-leaf helpers to handle arrays, add a dedicated `resolveProviders(raw)` / `resolveModels(raw)` that iterates schema-validated elements and calls the existing `interpolateString` per field, with error context `providers[<id>].key` (never the array index alone, never the value). The JSON Schema owns element **shape** (required keys, `type` enum, `contextWindowTokens` integer ≥ 1); the resolver owns **interpolation, cross-references, and coercion** — the same validate-shape-then-resolve split the scalar path uses. `key` resolved values inherit the **no-log/no-error-leak** requirement (#166's "Resolved secret values are never exposed") verbatim, now proven by a negative test over an array element whose `key` resolves to a credential.

### D3. Type-dispatched client factory as the execution seam

Introduce a factory that maps a resolved `providers[].type` to a `ModelClient` constructor: `openai` → `createOpenAIModelClient` (with the provider's `key`/`baseUrl`). Any other value is an internal error, not reachable from config while the schema enum gates `type` (defense-in-depth for the follow-up window). `ModelsService.createClient(modelId)` becomes: look up model → look up its `provider` entry → resolve credential → dispatch on `type`. This replaces `createOpenAIClient`/`getOpenAIProviderCredential`. `client.provider` becomes the provider `type` (dynamic) — safe, because nothing branches on the `'openai'` literal behaviorally; run identity is carried by `client.model` (the opaque llame id), and run events already forbid a `provider` field (available-models spec: "do not expose legacy `model` or `provider` fields").

### D4. Keyless providers via placeholder `apiKey` (subsumes #162)

A provider `key` of `"{env:OLLAMA_API_KEY:-}"` resolving empty means **keyless** (same empty-resolution-means-unset semantics as #166's nullable scalars). The OpenAI client today omits `apiKey` entirely when absent, which makes `@ai-sdk/provider-utils` `loadApiKey` throw `LoadAPIKeyError` at request time when `OPENAI_API_KEY` is also unset (the exact #162 bug). Fix: when the resolved credential is empty, pass a **non-empty placeholder** `apiKey` to `createOpenAI`; an OpenAI-compatible endpoint that ignores auth (local Ollama) never inspects it, and a real OpenAI endpoint would already have failed for a genuinely missing key. The keyless path becomes a first-class, tested execution path (today's unit test mocks `createOpenAI` and never exercises `loadApiKey` — a false green called out in #162).

### D5. Per-model compaction threshold is the single tier; instance env knobs deleted

Add optional `models[].compactionThresholdTokens`. Threshold resolution collapses to: `model.compactionThresholdTokens` (explicit per-model override) **else** `model.contextWindowTokens × COMPACTION_WINDOW_RATIO` (0.8). The two `ConfigService` reads in `compaction.service.ts:53-63` (`COMPACTION_TOKEN_THRESHOLD`, `MODEL_CONTEXT_WINDOW_TOKENS`) are **removed**; `resolveCompactionThreshold`'s input shape narrows to `{ explicitThresholdTokens?, contextWindowTokens }` fed from the catalog entry, not env. No user-per-model or per-send tier (#168). The **eval suite** loses its `COMPACTION_TOKEN_THRESHOLD` cheap-compaction override; its replacement is a model entry in the eval config fixture carrying a low `compactionThresholdTokens` — an explicit task so it is not silently dropped.

_Alternative — keep the resolver 3-tier with `userPerModel=null` for now:_ rejected by Leo. #168 is a genuine technical redesign of tenant settings; pre-building the tier signature is speculative shape that #168 would rework anyway. One tier now, redesigned when the tiers actually exist.

### D6. Boot-time reference integrity + default-model validation

`models[].provider` MUST reference a defined `providers[].id`, or boot fails naming the model id and the dangling provider ref — the same fail-closed pattern as `tools.allowed` validating against the tool registry. Additionally, `defaults.modelId` and `defaults.titleGenerationModelId` (when set) MUST reference a defined model, or boot fails. This **moves** default-model invalidity from a request-time `503 model_configuration_invalid` (today's `ModelsService.resolveDefaultModelConfig`) to boot: the catalog is now config too, so a config-as-code instance should fail its deploy on a dangling default rather than serve `/api/v1/models` and 503 on the first send. The runtime `model_not_available` (422) for a _caller-supplied_ unknown `modelId` is unchanged — that is request data, not config.

### D7. Type erosion: `ActiveSystemModelId` union → `string`

A config-sourced catalog cannot produce a compile-time literal union. `ActiveSystemModelId` becomes `string`; `SYSTEM_MODEL_BY_ID` becomes a `Map<string, …>` built at boot from the resolved config; `requireAvailableModel`'s `as ActiveSystemModelId` casts disappear. Validity is enforced by ajv (shape) + catalog `Map` lookup (existence) — exactly the compile-time-to-runtime tradeoff #166 accepted when it moved `defaults.modelId` off a typed constant. No runtime-narrowing gymnastics.

### D8. Provider credential source: config `key`, with the BYOK seam preserved

The provider `key` (interpolated, possibly `{path:}`-mounted) is the operator-level credential resolved at boot and carried to the client. `ModelsService.resolveProviderCredential(providerId)` returns it. The per-user `resolveModelCredential(userId)` seam stays in the code, unused, so #37 (v0.4 BYOK) later layers user creds _over_ the provider key without reworking the call sites.

## Risks / Trade-offs

- **[A resolved `key` leaks into logs/errors]** → The array resolver carries #166's secret discipline verbatim: errors name `providers[<id>].<field>` and never the value; a negative test asserts a credential-valued `key` appears in no log/error. Same requirement, new (array) code path.
- **[Anthropic seam parity is unverified]** → Out of scope here; the follow-up owns it. `@ai-sdk/anthropic@3.x` is the `ai` v6-paired line, but whether it exposes reasoning-delta chunks (`onReasoningDelta`) and tool-calling for `generateObject` the way the OpenAI client maps them is **verify-at-implementation**, not assumed — recorded as an Open Question for the follow-up, not this change.
- **[No `models[]` = no executable models (breaking)]** → Pre-release, no external deploys. The shipped `llame.config.json.example` reproduces today's six-model catalog + a default OpenAI provider, so `cp` preserves current behavior; quickstart/e2e fixtures provision it.
- **[Eval suite silently loses its compaction override]** → Explicit migration task (D5): the fixture gains a low-`compactionThresholdTokens` model; a test asserts the fixture still forces compaction.
- **[Type erosion removes compile-time model-id safety]** → Accepted (D7); ajv + `Map` lookup replace it, same as #166.
- **[Boot now fails on a dangling default that used to 503 at request time]** → Intended (D6): a config-as-code instance should fail its deploy, not boot into a broken model surface. Documented; the example ships a valid default.
- **[Placeholder apiKey masks a genuinely-misconfigured hosted provider]** → A hosted OpenAI provider with an empty key was already broken; the placeholder changes the failure from boot-omission to a provider-side 401 at request time, which is the correct layer (credential validity is not prevalidated — existing available-models requirement).

## Migration Plan

1. Extend `llame-config.ts` types + `llame.config.schema.json` with `providers[]`/`models[]` (`$defs` for the provider entry, model entry, and a shared `type` enum); add `resolveProviders`/`resolveModels` to `config-loader.ts` with reference-integrity + secret-safe errors; add default-model boot validation.
2. Rework the models domain: delete the hardcoded array from `model-catalog.ts` (keep the types + `toPublicModel`), source the catalog from `InstanceConfigService`, add the `.type`-dispatch factory, `createClient`/`resolveProviderCredential`, keyless placeholder apiKey.
3. Move execution callers (`runs-worker.service.ts`, `title.service.ts`, `worker-harness.ts`, `fake-model-client.ts`) to the type-agnostic API.
4. Delete the compaction env reads; wire the per-model threshold; migrate the eval fixture.
5. Ship `llame.config.json.example` reproducing the current catalog + provider; update `.env.example`, README quickstart, `apps/api/AGENTS.md`, SPEC config section; `CHANGELOG.md`.
6. File the Anthropic-adapter follow-up (issue + change stub) referencing the `.type` seam and the seam-parity open question.
7. Rollback: the change is pre-release; reverting restores the hardcoded catalog. No data migration (catalog is config, not DB).

## Open Questions

- **Model `source` field** — the catalog entry still carries `source: 'system'` (the only value). Config-sourced models are all "system" for now; whether `source` should reflect provider origin (`org`/`user`) is deferred to #85/#37, not decided here. Keep `source: 'system'` as a constant this slice.
- **(Follow-up, not this change) `@ai-sdk/anthropic` seam parity** — pin the exact version whose peer range includes `ai@6.0.x` and confirm reasoning-delta + `generateObject` tool-calling behavior against its types before wiring the Anthropic client.
