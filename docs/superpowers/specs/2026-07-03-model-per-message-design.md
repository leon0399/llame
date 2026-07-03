# Multi-model UX: which model produced each reply (+ regenerate caret gate fix)

## Objective

Two tightly-coupled multi-model UX changes, completing last iteration's
"regenerate with a different model":

1. **Fix the regenerate caret render gate** (adversarial P1 on that feature): gate
   the caret on `availableModels.length > 1`, NOT on the options-list being
   non-empty. The old gate showed a caret for a SINGLE-model user whose
   `selectedModel` was a stale static default (options = `[theOnlyModel]`,
   non-empty) — offering their only model as a fake "alternative."
2. **Show WHICH model produced each assistant reply, visibly.** Now that a turn can
   be regenerated through different models, the reply should say which model it
   came from. The model id is ALREADY persisted per-turn (`messages.usage` →
   `TurnTelemetry.model`); `MessageUsage` surfaced it only in the hover `title`.
   Lead the visible usage line with the model's display name.

## Design

- `chat-page.tsx`: caret gate → `availableModels.length > 1` (one-line fix).
- `lib/ai/models.ts`: pure `modelDisplayName(id)` → the static-catalog `name`.
  IMPORTANT (primary-review P1): live/persisted model ids are BARE (`gpt-4o`,
  `gpt-5.4-mini` — from a BYOK account's `defaultModel` and the instance env
  model), while the static catalog is PREFIXED (`openai:gpt-4o`). So the catalog
  map is DUAL-KEYED (both `openai:gpt-4o` and the bare `gpt-4o` → `GPT-4o`), or
  the friendly-name branch would be dead for all real traffic. Fallback: the
  provider-stripped tail, then the raw id — so a model not in the catalog
  (`gpt-5.4-mini`, a custom id) shows as-is (still a readable model name, just
  unpolished). Reconciling the catalog/live id-shape split app-wide is
  pre-existing debt (same dead lookup in `fetchModels`), out of scope here.
- The render decision + line assembly is a pure `buildUsageLine(usage)` →
  `{ text, breakdown } | null` (unit-tested), with `MessageUsage` a thin wrapper.
  It leads `text` with `modelDisplayName(usage.model)` when present; drops `model`
  from the hover `breakdown` (now visible, no dup). Renders when `totalTokens > 0`
  OR a `model` is known; legacy status-only rows (no tokens, no model) → null.
  So a STOPPED turn (user-abort still emits `model.completed` telemetry live)
  shows its model immediately; a genuine provider ERROR emits only `run.failed`
  live (no telemetry chunk), so its model appears on the next load (the persisted
  `usage.model`) rather than instantly — degrades gracefully either way.

## Testability

- `modelDisplayName` (unit): prefixed catalog id → name; BARE catalog id → name
  (the dual-key path — the one that fires in production); unknown prefixed → tail;
  no-prefix unknown → raw id.
- `dedupeModelsById` / `regenerateModelOptions` (unit): dedupe keep-first;
  duplicate shared ids don't double-offer; excludes current.
- `buildUsageLine` (unit): model leads, then tokens; a token-less errored turn
  with a model still renders (`GPT-4o · error`); token-only when no model; null
  when neither; the model is NOT repeated in the breakdown.

## Non-goals (named)

- Persisting the model anywhere new (it already rides in `messages.usage`). A
  model icon/badge — the text name suffices. Showing a model on USER messages
  (only assistant turns have one). Changing token/cost/latency display. Back-
  filling the model onto historical turns whose telemetry predates `model` (they
  simply show no model — the render stays token-driven for those).

## Revision history

- **v2 (2026-07-03):** Round-1 review (both reviewers on the shipped code).
  Fixes: (a) primary P1 — `modelDisplayName`'s catalog lookup was dead because
  live ids are bare, not prefixed → dual-keyed the map (+ bare-id test); worked
  example corrected. (b) adversarial P1 — the regenerate caret gate broke under
  DUPLICATE model ids (empty menu); now gates on the DISTINCT count
  (`dedupeModelsById`). (c) both — the `MessageUsage` conditional was untested →
  extracted a pure `buildUsageLine` with direct tests. (d) error-vs-stopped live
  behavior stated precisely.
- **v1 (2026-07-03):** Initial.
