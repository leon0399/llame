## Why

Effort levels are opaque provider tokens (`xhigh`, `none`). The UI renders them
verbatim in monospace, which is correct for identifiers and hostile as the only
composer label. Operators already author the vocabulary; they should also be
able to attach a human label without inventing a llame-owned enum. The prior
`add-reasoning-effort` design deferred exactly this widening
(`string | { value, label }`) until a UI consumer needed it — that consumer is
here.

## What Changes

- Config `models[].reasoning.effortLevels` accepts a mixed array of bare
  strings and `{ value, label }` objects. Bare string remains unlabeled; object
  form requires a nonblank `value` and nonblank `label`. Uniqueness and
  `defaultEffort` membership are on `value` only.
- Boot normalizes every entry to `{ value, label? }` and publishes that shape
  on `GET /api/v1/models` (OpenAPI + Orval bindings regenerate).
- Chat send / run accept still take the raw `effort` **value** string only.
  Labels never enter request validation, persistence, or provider calls.
- First-party web UI (tasks only — not spec requirements): effort selector
  and message telemetry show `label ?? value` with the typography rules in
  design.md / tasks.md.
- Example config and docs updated to show the mixed form.
- **BREAKING** (catalog wire shape only): `reasoning.effortLevels` stops being
  `string[]` and becomes `{ value: string; label?: string }[]`. Existing
  configs that use bare strings keep working. Any client that assumed
  `effortLevels: string[]` must update. Request `effort` is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `instance-config`: widen `effortLevels` item shape; uniqueness / default
  membership / blank rules apply to `value`; label integrity rules.
- `available-models`: publish labeled levels; keep request `effort` as value
  only; clarify display fallback vs inventing meaning from the token.

## Impact

- `apps/api`: JSON Schema, `resolveModelReasoning`, catalog types, models DTO /
  OpenAPI, loader tests, AGENTS.md reasoning paragraph, example config.
- `apps/web`: Orval regen, `EffortSelector`, `MessageUsage` (badge + card),
  stories, any `effortLevels.includes` / index helpers.
- No DB / migration / worker revision: runs already persist the value token;
  labels are display metadata from the catalog, not receipts.
