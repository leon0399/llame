# Fix dead model-catalog enrichment for live (bare) model ids

## Objective

The model selector renders `model.description`, and `model-preview-card` renders
`model.price` + `contextWindow` — but for LIVE models these are ALWAYS blank.
`fetchModels` enriched the availability set with static-catalog metadata via
`staticById.get(model.id)`, an EXACT-id lookup. Live/persisted ids are BARE
(`gpt-4o`) while the catalog is PREFIXED (`openai:gpt-4o`), so the lookup misses
EVERY live model — the same id-shape split a prior review flagged for
`modelDisplayName` (fixed there via dual-keying) and named as pre-existing debt
in `fetchModels`. Fix it: enrich by matching a bare live id against the catalog's
prefixed OR bare key, so descriptions, pricing, and context windows finally show.

## Design

- `lib/ai/models.ts`: generalize the existing dual-keyed name map to a
  `MODEL_BY_ID` map of the FULL `ChatModel` (keyed on both the prefixed id and
  its bare tail; full id always set, bare tail first-catalog-wins). Export
  `findCatalogModel(id): ChatModel | undefined`. Refactor `modelDisplayName` to
  use it (behavior unchanged — its tests still pass).
- `lib/services/models/enrich.ts` (NEW, pure, relative imports only so vitest can
  load it without the `@/` alias): move `AvailableModel` + a pure
  `enrichAvailableModels(available)` here, using `findCatalogModel`. `queries.ts`
  imports + re-exports them; `fetchModels` calls `enrichAvailableModels`.

## Testability

- `findCatalogModel` (unit): a prefixed id → full entry; the BARE form → same
  entry (the fix); an unknown id → undefined.
- `enrichAvailableModels` (unit): a bare live id gains the catalog name +
  description + price; an unknown/custom id keeps id + label only (no
  description). `modelDisplayName` tests unchanged.

## Non-goals (named)

- Reconciling the catalog/live id-shape split at the SOURCE (prefixing live ids,
  or the api emitting catalog ids) — this fixes the consumer-side lookup only.
- Adding NEW catalog entries (e.g. the instance default `gpt-5.4-mini` still
  isn't in the catalog → still shows id + label, correctly). Enriching by
  provider (a live `gpt-4o` from any provider maps to the catalog `gpt-4o`).

## Revision history

- **v1 (2026-07-03):** Initial.
