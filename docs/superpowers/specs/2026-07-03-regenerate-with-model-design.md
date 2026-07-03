# Regenerate with a different model

## Objective

llame's reason to exist is bring-your-own multi-provider — a user wires up
OpenAI, Anthropic, a local Ollama, etc. — yet nothing in the chat UI actually
LETS you use more than one model on a turn: the composer picks one "current"
model and every send/regenerate uses it. Add the smallest thing that unlocks the
differentiator: on the per-message regenerate action, let the user re-run that
turn through ANY of their available models in one click ("didn't like GPT-4o's
answer — try it with Claude / o3 / my local model"). The backend already accepts
a per-turn `model` on regenerate (`POST /chats/:id/runs` `model?`, validated
against the availability set #76), so this is CLIENT-ONLY.

## Design

- Keep the existing regenerate icon-button as the 1-click "regenerate with the
  CURRENT model" fast path — unchanged (`regenerate({ messageId, body: { model:
  modelToSend } })`). No regression for the common case or single-provider users.
- When `availableModels.length > 1`, render an adjacent small caret
  (`ChevronDown`) `DropdownMenu` next to it: a label "Regenerate with a different
  model" + one item per ALTERNATIVE model (every available model except the
  current `selectedModel`). Picking model `X` → `regenerate({ messageId, body:
  { model: X } })`. This is a ONE-OFF regen with `X`; it does NOT change the
  session's `selectedModel` (the composer's selector owns that).
- Options come from `useModelsQuery()` — the SAME availability set the send guard
  (`modelToSend`) uses — so a picked model can never be rejected (422).
- `currentId` for the filter is `selectedModel` (raw). When `selectedModel` IS in
  the availability set, it's excluded (the plain button's default). When it's
  stale/not-in-set, the plain button falls back to the server-resolved default
  (which the client can't name), so the menu lists ALL available models — the
  resolved default may appear as an item; harmless, since every item is a valid
  explicit choice, not a 422.
- Only shown while the message's regenerate is allowed (`status === "ready" ||
  "error"`), same condition as the existing button.

## Testability

- Pure `regenerateModelOptions(models, currentId)` (unit-tested): the alternative
  models to offer — every model whose `id !== currentId`, order preserved. Empty
  IFF every model present equals `currentId` (so: none; or only the current
  model). A lone model whose id differs from `currentId` (stale selection) is
  kept. The caret dropdown renders iff this is non-empty. Item labels use the
  existing `model.name ?? model.id` fallback.
- The dropdown is a thin declarative surface over that list + the existing
  `regenerate` (tsc/build coverage), consistent with the other menus.

## Non-goals (named)

- Side-by-side comparison (showing two models' answers at once). This REPLACES
  the assistant reply, exactly like the existing regenerate (which hard-deletes
  the old reply and generates a new one) — just with a chosen model. A
  comparison view is a separate, larger feature.
- Persisting/labelling which model produced a given assistant message beyond the
  existing per-turn usage telemetry. Changing the session default model from this
  menu. A per-model picker on the FIRST send (the composer's model selector
  already owns initial model choice).

## Revision history

- **v2 (2026-07-03):** Round-1 review. The primary reviewer confirmed all six
  load-bearing checks against source — critically that `body.model` on regenerate
  flows through `regenerateLastTurn` → `resolveForModel` (the same path as send),
  so it genuinely takes effect (not a no-op), and that `resolveForModel` throws a
  422 server-side for an unauthorized model (defense-in-depth). Fixes: specified
  `currentId = selectedModel` and its stale-selection behavior (P1); tightened the
  empty-set contract (P2) + added a test for a lone differing model; noted the
  `name ?? id` label fallback.
- **v1 (2026-07-03):** Initial.
