## 1. Config schema and boot normalization

- [x] 1.1 Widen `llame.config.schema.json` `modelReasoning.effortLevels.items` to `string | { value, label }` (object requires both nonblank strings; drop array `uniqueItems`) and verify invalid fixtures fail AJV as expected in loader tests
- [x] 1.2 Update `RawModelEntry` / catalog types so resolved `effortLevels` is `{ value: string; label?: string }[]` and verify `pnpm --filter api typecheck` passes for touched files
- [x] 1.3 Implement `resolveModelReasoning` normalization + uniqueness/blank/`defaultEffort`-against-`value` checks; verify new and updated cases in `config-loader.test.ts` (mixed array, object missing label, duplicate values, default by value, bare-string omit `label`)

## 2. Public catalog and request validation

- [x] 2.1 Publish normalized `{ value, label? }[]` from `toAvailableModelResponse` / `ModelReasoningResponse`; regenerate `openapi.json` via `pnpm --filter api build` and commit the diff
- [x] 2.2 Update effort membership checks (`ModelsService` and any `.includes` on levels) to compare against `.value`; verify unit tests still cover valid effort, unknown effort, and that a label string is rejected as `effort`
- [x] 2.3 Regenerate Orval bindings in `apps/web` and verify `ModelReasoningResponse.effortLevels` is the object array type

## 3. Example config and docs

- [x] 3.1 Update `llame.config.json.example` (and live example entries if desired) to demonstrate mixed bare strings + labeled objects; verify boot still loads the example shape
- [x] 3.2 Update the reasoning-effort paragraph in `apps/api/AGENTS.md` for the labeled item shape; verify `pnpm lint:markdown` on touched docs
- [x] 3.3 Add CHANGELOG entry (and drop from ROADMAP if listed); verify conventional wording matches other catalog wire breaks

## 4. Web UI (not in specs — product behavior)

- [x] 4.1 Add a small `effortDisplayLabel(levels, value) => label ?? value` helper (or inline equivalent) and verify it returns label when present and value otherwise
- [x] 4.2 Update `EffortSelector`: selection/send stay on `value`; trigger shows `label ?? value`; drop `font-mono` when a label is shown, keep `font-mono` for value-only; update stories and verify Storybook play/tests for labeled vs unlabeled
- [x] 4.3 Update `MessageUsage` badge text and hover-card "at effort" row to resolve label from `models` by `modelId` + persisted effort value, fallback to raw token; keep monospace in both places; verify stories/tests cover labeled, unlabeled, and unknown-value fallback

## 5. Verification

- [x] 5.1 Run `pnpm --filter api test` (unit incl. config-loader + models) and confirm green
- [x] 5.2 Run `pnpm --filter web typecheck` and effort-selector / message-usage story tests; confirm green
