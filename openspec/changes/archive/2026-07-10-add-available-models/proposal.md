## Why

The model selector is currently backed by a frontend-only static list (`apps/web/lib/ai/models.ts`), while the API alone knows what it can actually execute. That split creates a fake choice: the UI can display rich models, but chat sends cannot explicitly select one.

This change makes `/api/v1/models` the authenticated API for executable models available to the user. The first implementation is intentionally small: system-configured models only, hardcoded in the API for now, with org/group/user models and JSON-backed configuration left for later.

## What Changes

- Add `GET /api/v1/models` returning the flat list of executable models available to the authenticated user plus the effective `defaultModelId`.
- Move the rich static model metadata from `apps/web/lib/ai/models.ts` into the API-owned models feature, with less ambiguous API field names such as `contextWindowTokens` and `pricingUsdPer1M`.
- Start the active system catalog with ids `system:openai:gpt-5.5`, `system:openai:gpt-5.4`, `system:openai:gpt-5.4-mini`, `system:openai:gpt-5.4-nano`, `system:openai:gpt-4o`, and `system:openai:gpt-4o-mini`.
- Keep unsupported Anthropic/xAI-style entries from the current frontend catalog only as commented future reference entries, not active availability entries.
- Treat model ids as opaque, stable API ids. Clients compare and send them back; they do not parse routing semantics from them.
- Add required top-level `modelId` to `POST /api/v1/chats/:id/messages`; the web client always sends the visibly selected model id.
- Validate `modelId` against the same effective availability resolver used by `GET /api/v1/models`; unavailable ids fail before message/run persistence.
- Persist the selected model id on runs and include the opaque model id in assistant message usage telemetry.
- Replace `OPENAI_MODEL` with required `DEFAULT_MODEL_ID`; it must name one hardcoded API model id. Missing/invalid model configuration fails visibly.
- Add a separate server-side `TITLE_GENERATION_MODEL_ID` setting for title generation; compaction uses the model selected for the message/run that triggered compaction.
- Disable chat sending in the web UI until models are loaded and a valid model is selected, while leaving the composer input usable.
- Tighten message idempotency for the current product: an existing message id rejects, regardless of matching content.
- Do not add remembered selected-model persistence, BYOK provider accounts, OpenRouter adapter work, config resolver integration, model allowlists, admin UI, provider live probing, or JSON-backed model configuration in this change.

## Capabilities

### New Capabilities

- `available-models`: Authenticated executable model availability, model selection on chat sends, and persistence of selected model ids.

### Modified Capabilities

- None.

## Impact

- `apps/api/src/models`: API-owned model metadata, availability resolver, DTO/controller surface, model-id validation, default-model configuration handling, and tests.
- `apps/api/src/chats`: request DTO gains required `modelId`; controller/service validate it before persistence; existing message id behavior changes to unconditional conflict.
- `apps/api/src/runs`: run schema gains required selected model id with existing rows backfilled once to `system:openai:gpt-5.4-mini` and no persistent database default; worker resolves and executes the stored model id without silent fallback; run events identify model execution by `modelId`; compaction uses the triggering run's selected model and the same `modelId` telemetry shape as messages.
- `apps/api/src/titles`: title generation resolves its own configured model id from `TITLE_GENERATION_MODEL_ID`.
- `apps/api/src/chats/turn-telemetry.ts`: assistant message and compaction usage record the opaque `modelId` while preserving computed `costUsd` at generation time.
- `apps/web/lib/services/models` and selector/composer code: fetch availability from `/api/v1/models`, initialize selection from `defaultModelId`, send top-level `modelId`, and disable send until valid.
- `apps/web/lib/ai/models.ts`: removed as a frontend-owned static catalog; no compatibility shim is required for the proof-of-concept frontend model contract.
- `apps/api/.env.example`, docs/changelog, and generated OpenAPI output need updates for `DEFAULT_MODEL_ID` and `TITLE_GENERATION_MODEL_ID`.
- Adds a database migration; no new dependency.
