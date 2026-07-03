# Remember the selected model across sessions

## Objective

`ChatProvider`'s `selectedModel` is `useState(DEFAULT_MODEL_ID)` — it RESETS to the
default on every session/reload. A user who picks Claude / o3 / their local model
must re-pick it every single time. Persist the last-selected model (localStorage)
so the choice sticks, matching ChatGPT/Claude.ai. Completes the model-selection
UX thread (enrichment, per-message model, regenerate-with-model).

## Design

- Pure `lib/services/models/selected-model-storage.ts` (SSR-safe, no imports so
  vitest loads it), keyed PER USER (`llame:selected-model:${userId}`):
  - `readSelectedModel(userId): string | null` — `getItem` guarded by `typeof
    window` + `userId` + try/catch (private-mode throws on ACCESS, not just
    write), returns null on any failure/absence.
  - `writeSelectedModel(userId, id): void` — `setItem`, same guards, swallows a
    throwing `setItem`, and no-ops on an empty `id` (the selector's deselect
    toggle) so a real choice isn't overwritten by "".
- `ChatProvider`: keep `useState(DEFAULT_MODEL_ID)` (so SSR and the FIRST client
  render match — no hydration mismatch). `userId = useMe().data?.id`. A
  `useEffect([userId])` restores the stored model once `userId` resolves;
  `setSelectedModel` wraps the state setter + `writeSelectedModel(userId, id)`
  (persists only when `userId` is known). userId is async — the same
  async-identity pattern the send-guard already uses for `availableModels`.
- `model-selector` trigger label falls back to `modelDisplayName(value)` when the
  selected id isn't in the loaded list (a stale restored id, or mid-load) — so it
  shows the model name, not a blank control.
- Graceful staleness: a persisted model no longer in the caller's availability
  set (provider removed) is handled by the EXISTING `modelToSend` guard
  (`availableModels.some(id === selectedModel)` → omit → server default). No extra
  validation needed.

## Testability

- `readSelectedModel` / `writeSelectedModel` (unit, `vi.stubGlobal`): write→read
  round-trips; read returns null when absent; a throwing `setItem` is swallowed
  (no crash); with no `window`/`localStorage`, read → null and write is a no-op
  (SSR safety).

## Non-goals (named)

- Per-CHAT model memory — this is the GLOBAL last-picked preference (the model
  selector is a global control, like ChatGPT). Per-chat is a follow-up.
- Server-side / cross-device sync (a DB user-preference) — localStorage is
  client-only + per-browser; cross-DEVICE sync is a larger, later change. (Cross-
  USER isolation on ONE browser IS handled, via per-user keying.)
- Validating/repairing a stale persisted id — the send guard degrades it to the
  server default and the selector label shows its name; no reconcile against
  `availableModels` needed (that list isn't known at ChatProvider mount anyway).

## Revision history

- **v2 (2026-07-03):** Round-1 review — both converged, no P0/P1. On the
  shared-browser question BOTH reviewers recommended documenting a per-browser
  limitation rather than per-user keying (arguing `userId` is async at mount).
  I OVERRODE that: llame explicitly serves "a family from the same core," and
  per-browser keying means each member's model choice clobbers the others on a
  shared machine — a real UX regression. Per-user keying (`userId = useMe()`) is
  the correct design, and its async-`userId` handling is the SAME pattern the
  send-guard already uses for `availableModels` (consistent, not a new problem
  class); the restore lands ~one useMe-fetch after mount, well before any user
  send (no auto-submit path). Also folded in the reviewers' P2s: the
  `getItem`-throw test, the empty-write guard, and the model-selector blank-label
  fallback.
- **v1 (2026-07-03):** Initial.
