# Model visibility allowlist (#85)

## Objective

Today every user sees + can use ALL their models (BYOK provider models + the
instance model). A self-hosted admin has no way to CURATE that — restrict to
approved/cost-controlled models, hide experimental ones. #85: a config-driven
model ALLOWLIST. When set, `listAvailableModels` returns only allowlisted ids;
because `resolveForModel` validates a selected id against that same set before any
provider call, the send path FAILS CLOSED too (a disallowed id →
`ModelNotAvailableError`, never silently used). Governance-aligned (a config
CONSUMER — exactly what ROADMAP says follows the resolver), reference-supported
(Open WebUI has model allowlists). Opt-in: unset/empty = no restriction (must not
hide everyone's models).

## Design

- **config-resolver** (`config-resolver.service.ts`):
  - `instanceLayer()`: parse `MODELS_ALLOWLIST` (comma-separated ids) → `config.models
= { allowlist: string[] }` — an instance admin sets it via env (parallel to
    `RUN_MAX_*`); also settable per-user via the config table.
  - `resolveForUser(userId): RunConfigSnapshot` → `resolveLayers([instanceLayer(),
userLayer])` — instance + user (NO chat layer), for user-level surfaces like the
    model list. (A trivial variant of `resolveForChatWithin`, which is
    instance→user→chat today.)
- **effective-config**: `snapshotModelAllowlist(snapshot): string[] | undefined` —
  `section(snapshot,'models')?.allowlist` accepted only as a NON-EMPTY array of
  non-empty strings; anything else → `undefined` (= no restriction, fail-open on a
  malformed/absent config so the default experience never breaks).
- **models.service**: inject `ConfigResolverService`; a pure
  `applyModelAllowlist(models, allowlist)` (undefined → unchanged; else keep only
  ids in the allowlist set). `listAvailableModels` resolves the user's config and
  applies it to the FULL merged set (BYOK + the instance model, filtered AFTER the
  instance push) — so the list AND (via `resolveForModel → listAvailableModels`)
  the explicit-id send path enforce the SAME set.
- **The default (no-model-id) path** must ALSO enforce the allowlist — `model` is
  optional in the send DTO and the worker passes it through, so an omitted id
  would otherwise bypass the whole control. `resolveForModel(userId, null)`: with
  NO allowlist, keep the existing default; WITH an allowlist, resolve the FIRST
  allowlisted-available model (fall-through — better UX than rejecting a
  now-disallowed default), or `ModelNotAvailableError` if the allowlisted set is
  empty. `resolveForUser` wraps its OWN `runAs(userId)` (else the user-scope config
  read is RLS-denied → fail-open).

## Testability

- `applyModelAllowlist` (unit): undefined allowlist → all models; a set allowlist →
  only matching ids; an allowlisted id the user doesn't have → simply absent (no
  phantom entry); order preserved.
- `snapshotModelAllowlist` (unit): a valid non-empty string array → itself; absent
  / non-array / empty / non-string members → undefined.
- integration (RLS harness): a user with a `{models:{allowlist:[…]}}` config row →
  `listAvailableModels` filtered to the allowlist; `resolveForModel` for a
  disallowed id → `ModelNotAvailableError` (fail-closed); a DIFFERENT user with no
  allowlist row is unaffected (the config row is tenant-scoped — the allowlist
  can't leak across users).

## Non-goals (named)

- An admin UI to set the allowlist — config/env-driven; the admin surface is a
  ROADMAP follow-up and #85 is its consumer. Per-ORG allowlist — the org layer
  isn't in the resolve chain yet (instance + user today; it slots in later). A
  denylist — allowlist (explicit permit) is the safer default. Wildcards/patterns
  — exact id match for the MVP. NOTE (forward-risk): when a model CATALOG with
  prefixed ids lands (same #85 lineage), the allowlist must keep matching the LIVE
  ids `listAvailableModels` emits, not catalog ids.

## Revision history

- **v3 (2026-07-05, PR carve-out review):** Split into its own PR
  (`stack/split-model-catalog`) on top of `stack/split-byok-models`. Review
  caught a second P0 the original design didn't cover: `resolveLayers` merges
  arrays WHOLE (later scope replaces, never intersects), so a user-scope config
  row that ALSO sets `models.allowlist` would silently REPLACE — not narrow —
  the operator's instance-layer list, letting a lower scope WIDEN visibility
  past what `MODELS_ALLOWLIST` permits. Fixed with
  `clampModelAllowlistToInstanceCeiling` in `resolveForUser`: the instance
  layer's own allowlist is now an explicit ceiling — a lower scope may narrow
  it further but can never exceed it, and a fully-disjoint lower-scope list
  falls back to the ceiling (never to an empty array, which
  `snapshotModelAllowlist` would otherwise read back as "no restriction").
  Covered by a new RLS integration case (operator allowlist + a widening
  user-scope config → still clamped) and unit cases in
  `model-allowlist.spec.ts`.
- **v2 (2026-07-03):** Round-1 review found a **P0** the design missed — the
  default (no-`modelId`) resolution path (`resolveForModel → resolveModelCredential`)
  never touched `listAvailableModels`, so omitting `model` (DTO-optional; the
  worker's production path) bypassed the allowlist entirely. Fixed: the default
  path now enforces the allowlist (fall-through to the first allowlisted-available
  model; error if none). Verified against the reviewer's P1s: the filter applies to
  the FULL merged set incl. the instance model (filtered after the push), and
  `resolveForUser` self-wraps `runAs(userId)` (else RLS-denies → fail-open). Tenant
  isolation of the allowlist config confirmed sound by the reviewer's direct RLS-
  predicate read. Added the catalog/live-id forward-note.
- **v1 (2026-07-03):** Initial.
