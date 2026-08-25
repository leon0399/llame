## Context

See proposal.md — Why. Today `effortLevels` is `string[]` end-to-end: config
schema, boot resolution, public catalog, and web consumers
(`EffortSelector`, `MessageUsage`). Selection state, chat-send `effort`, and
`runs.effort` are the raw provider token. The archived
`add-reasoning-effort` design explicitly deferred
`string | { id, label }` as an additive widen.

## Goals / Non-Goals

**Goals:**

- Operator-authored display labels without inventing a llame effort vocabulary.
- One normalized catalog shape for clients; mixed config shorthand only at
  authoring time.
- Request / persistence / provider path stay value-only.
- UI uses label when present, with the typography rules in the proposal.

**Non-Goals:**

- Cost hints, icons, or other per-level metadata (still deferred).
- Persisting labels on runs or rewriting historical telemetry.
- Translating / localizing labels (operator string is the display string).
- Changing slider semantics, default resolution, or cache-invalidation advisory.
- Auto-deriving labels from tokens (`xhigh` → "Extra High").

## Decisions

### D1 — Config item: `string | { value, label }`

Bare string remains the unlabeled shorthand. Object form requires both
`value` and `label`, each nonblank. `{ value: "x" }` without `label` is
rejected (equivalent to the bare string — don't keep two ways to say the
same thing).

_Alternatives considered:_ always-object config (forces churn for every
existing entry); `id` instead of `value` (mismatches the request field name
`effort` and the prior design's "identifier" language — `value` is clearer
beside `label`).

### D2 — Normalize at boot to `{ value, label? }[]`

`resolveModelReasoning` expands every item to that object. Internal catalog
and `GET /api/v1/models` never expose the mixed union. Clients always read
`level.value` / optional `level.label`.

_Alternatives considered:_ publish the mixed union (mirrors config, hurts
Orval/TS); always set `label` to `value` when absent (erases "operator
authored a label" and forces every UI to compare equality to decide
typography).

### D3 — Uniqueness and membership on `value` only

JSON Schema `uniqueItems` is unreliable for objects, so drop it on the array
and enforce uniqueness of `value` in `resolveModelReasoning` (same place as
blank checks and `defaultEffort` membership). `defaultEffort` remains a
string naming a `value`. Duplicate labels across different values are
allowed (operator footgun, not integrity).

### D4 — Telemetry label lookup is live catalog, not a receipt

`runs.effort` / message usage still store the value token. The badge and
hover card resolve `label` by finding that value under the run's `modelId`
in the current models list. If the model or value is gone, show the raw
token. Labels are presentation of current config, not historical truth —
same pattern as model display names.

_Alternatives considered:_ persist label beside effort (schema churn for
display metadata; stale labels when operators rename). Rejected.

### D5 — Typography split

| Surface                           | With label                            | Value-only fallback     |
| --------------------------------- | ------------------------------------- | ----------------------- |
| Effort selector trigger           | proportional (`font-normal`), no mono | `font-mono` (today)     |
| Telemetry badge + "at effort" row | `font-mono`, show label text          | `font-mono`, show value |

Selector is a primary composer control — labels read as UI chrome.
Telemetry stays monospace as a receipt strip even when the text is a
friendlier label.

### D6 — Selection state stays `string | undefined` (the value)

`selectedEffort`, send body, and slider indexing continue to use values.
Display is a pure projection: `levels.find(l => l.value === selected)?.label
?? selected`. No second piece of state.

## Risks / Trade-offs

- **[Risk] Catalog wire break for any client typed as `string[]`** → Mitigation:
  regenerate Orval in the same change; only first-party web consumes it
  today. Document in CHANGELOG as breaking for the models response only.
- **[Risk] Operator renames a label mid-conversation; badge text changes under
  old messages** → Accepted: same as renaming a model `name`. Value on the
  run is stable.
- **[Risk] Long labels overflow the compact selector button** → Mitigation:
  none in this change; operators own the string. Truncate later if a real
  config hits it.
- **[Trade-off] Dropping schema `uniqueItems`** → Custom boot check must
  stay tested; schema alone no longer catches duplicates.

## Migration Plan

1. Ship API that accepts both bare strings and labeled objects; publishes
   objects. Existing configs boot unchanged.
2. Regenerate OpenAPI + Orval; update web consumers in the same release so
   the catalog shape never lands without a matching client.
3. Optionally author labels in `llame.config.json` / example — not required
   for boot.
4. Rollback: revert the release; configs that added object entries fail the
   old schema until labels are stripped back to bare strings. No DB
   rollback.

## Open Questions

None that block implementation. Cost hints remain deferred per prior design.
