## 1. API Model Availability

- [x] 1.1 Move the rich model metadata for currently executable models from `apps/web/lib/ai/models.ts` into an API-owned hardcoded catalog with active ids `system:openai:gpt-5.5`, `system:openai:gpt-5.4`, `system:openai:gpt-5.4-mini`, `system:openai:gpt-5.4-nano`, `system:openai:gpt-4o`, and `system:openai:gpt-4o-mini`, server-only provider execution ids, `source: "system"`, and explicit fields like `contextWindowTokens` and `pricingUsdPer1M`.
- [x] 1.1a Configure provider execution ids explicitly on each server-side catalog entry; do not derive them by parsing llame model ids.
- [x] 1.1b Treat rich display metadata as optional; validate execution-critical catalog fields only.
- [x] 1.2 Preserve unsupported Anthropic/xAI-style frontend catalog entries only as commented future-reference entries shaped like real entries, never exported or returned by `/api/v1/models`.
- [x] 1.3 Replace `OPENAI_MODEL` usage with `DEFAULT_MODEL_ID` for llame model selection; update `.env.example` with `DEFAULT_MODEL_ID=system:openai:gpt-5.4-mini` and `TITLE_GENERATION_MODEL_ID=system:openai:gpt-5.4-nano`; ignore any leftover `OPENAI_MODEL`.
- [x] 1.4 Add model availability helpers in `ModelsService` that validate `DEFAULT_MODEL_ID`, resolve `TITLE_GENERATION_MODEL_ID` as a valid active system catalog id for title generation, return a stable ordered flat list, and throw typed configuration errors for missing/invalid chat model config only; do not require or probe `OPENAI_API_KEY`.
- [x] 1.5 Add explicit Swagger DTOs for `ModelsResponse`, `AvailableModelResponse`, pricing metadata, and model-domain error responses using `{ statusCode, error, message, code }`.
- [x] 1.6 Add `ModelsController` at `GET /api/v1/models` and register it without exposing provider execution ids.

## 2. API Selection And Persistence

- [x] 2.1 Add a required top-level `modelId` field to `CreateMessageDto` with class-validator/OpenAPI coverage for non-empty string only; do not add a model-id syntax regex.
- [x] 2.2 Validate `modelId` by exact lookup against the effective available-model set before creating a user message or run; map missing/non-string/blank input to 400, unavailable string ids to 422, and model config errors to 503.
- [x] 2.3 Tighten message idempotency so an existing message id returns 409 regardless of matching content.
- [x] 2.4 Add a Drizzle-generated migration for required `runs.model_id`, backfilled once to literal `system:openai:gpt-5.4-mini` for existing rows, with no persistent database default.
- [x] 2.5 Update `RunsRepository.create` and related tests/call sites to require and persist `modelId`.
- [x] 2.6 Update run dispatch/worker execution so the worker resolves the stored run model id, run events use `modelId` without legacy `model`/`provider`, and the worker never silently substitutes the current default.
- [x] 2.7 Persist the opaque `modelId` in assistant message usage telemetry while preserving generated-time `costUsd`; stop writing legacy `model` and `provider` fields for new assistant usage.
- [x] 2.8 Update compaction to use the selected model id from the run/message that triggered compaction and persist compaction usage with `modelId`, not legacy `model`/`provider`.
- [x] 2.9 Update title generation to resolve a separate title model from `TITLE_GENERATION_MODEL_ID` while reusing the same system provider credentials/base URL as chat execution; missing/invalid title model config leaves the chat untitled, logs an error, does not fall back to `DEFAULT_MODEL_ID`, and does not persist title model usage/cost/telemetry.

## 3. API Tests

- [x] 3.1 Add models service/controller tests for valid availability including missing `OPENAI_API_KEY`, missing/blank/unknown `DEFAULT_MODEL_ID`, non-empty model list, default id membership, and response ordering preservation.
- [x] 3.2 Add chat send tests for required `modelId`, unavailable `modelId` -> 422, model config failure -> 503, no message/run writes on validation failure, and no `402 Payment Required` for missing system provider credentials.
- [x] 3.3 Add run persistence/worker/event tests proving selected model id is stored, used by the worker, emitted in run events without legacy `model`/`provider`, and not replaced by a changed default.
- [x] 3.4 Add duplicate message id coverage proving 409 on id alone.
- [x] 3.5 Add telemetry tests proving assistant usage includes `modelId`, omits legacy `model`/`provider`, and keeps `costUsd` persisted.
- [x] 3.6 Add post-turn tests proving compaction uses the triggering run's selected model, compaction usage uses `modelId` without legacy `model`/`provider`, and title generation uses `TITLE_GENERATION_MODEL_ID` without persisting title model usage/cost/telemetry.

## 4. Web Model Client And Composer

- [ ] 4.1 Replace the fake model query with an API-backed `GET /api/v1/models` query through the shared `api`/`buildApiUrl` client.
- [ ] 4.2 Remove `apps/web/lib/ai/models.ts` as a frontend-owned static catalog; no proof-of-concept compatibility re-export is required.
- [ ] 4.3 Update the model selector to render API model entries in API order and initialize selected model from `defaultModelId`.
- [ ] 4.4 Update chat transport request preparation to require and send top-level `modelId`.
- [ ] 4.5 Disable the send action while models are loading, failed, or no valid selected model exists, while leaving the composer input usable.
- [ ] 4.6 Update usage/Markdown display helpers to use `usage.modelId` and resolve names from loaded `/models` data where available, with deterministic fallback to the id; no legacy `usage.model`/`usage.provider` fallback is required.

## 5. Web Tests

- [ ] 5.1 Add model query tests proving the web fetch uses `GET /api/v1/models` and handles the envelope shape.
- [ ] 5.2 Add selector/composer coverage proving default initialization, API-order rendering, and disabled send until a valid model is selected.
- [ ] 5.3 Update transport tests to prove `modelId` is included and missing selection is rejected client-side.
- [ ] 5.4 Update usage/export tests for `usage.modelId` display/name resolution and id fallback behavior.

## 6. Documentation And Generated Artifacts

- [x] 6.1 Regenerate API migrations from the Drizzle schema change and do not hand-write migration SQL unless Drizzle cannot express a required step; do not add JSON backfills for legacy usage or run-event payloads.
- [ ] 6.2 Regenerate `apps/api/openapi.json` through the API build path after DTO/controller changes.
- [ ] 6.3 Update `CHANGELOG.md` with the dated model availability/model selection change.
- [ ] 6.4 Update docs/env references from `OPENAI_MODEL` to `DEFAULT_MODEL_ID` and `TITLE_GENERATION_MODEL_ID`.
- [ ] 6.5 Do not remove BYOK/model-governance roadmap items unless this implementation actually completes them.

## 7. Verification

- [x] 7.1 Run focused API Jest coverage for models, chats, runs, and telemetry.
- [ ] 7.2 Run focused web Vitest coverage for model query, selector/composer, transport, usage, and export.
- [ ] 7.3 Run `pnpm --filter api typecheck` and `pnpm --filter web typecheck`.
- [ ] 7.4 Run `pnpm --filter api lint` and `pnpm --filter web lint`.
- [ ] 7.5 Run `pnpm --filter api build` to validate OpenAPI generation.
- [ ] 7.6 Run `openspec validate add-available-models --strict`.
