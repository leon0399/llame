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
  isn't in the catalog → still shows id + label, correctly).
- **Provider-scoped matching (accepted-tradeoff risk, review P1).** The match is
  by model IDENTITY, not provider — and llame's DOMINANT topology makes this
  imperfect: there is no `openai` provider type; real OpenAI and OpenAI-compatible
  proxies (Groq/vLLM/LiteLLM/Together) BOTH use `openai_compatible`, and
  `defaultModel` is free text. So a bare `gpt-4o` served by a NON-canonical
  endpoint gets the catalog's OpenAI-canonical price/context/description. Unlike
  the safe unknown-id case (shows id+label), this can DISPLAY canonical metadata
  for a possibly-different endpoint. Accepted because: (a) `openai_compatible`
  can't be gated to distinguish real OpenAI from a proxy, so provider-scoping is
  infeasible; (b) an id-named `gpt-4o` usually IS gpt-4o (proxied), so the
  model-property fields are typically accurate; (c) the blast radius is UX/trust
  only — the enriched `price` NEVER feeds a cost calc (the server prices turns
  independently); (d) the preview card now frames pricing/specs as a "catalog
  reference — your endpoint's actual rate may differ," so it reads as a reference,
  not a per-endpoint guarantee.

## Revision history

- **v2 (2026-07-03):** Round-1 review. Verifier converged (the critical
  live-id-wins spread verified against all 3 consumers; `price` doesn't feed
  cost). Adversarial P1: the cross-provider bare-id match is llame's DOMINANT
  topology (no `openai` provider type; proxies share `openai_compatible`), so a
  proxied `gpt-4o` shows OpenAI-canonical metadata — a UX/trust risk the v1
  non-goal undersold. Addressed: the non-goal now states it plainly with the
  accepted-tradeoff rationale, the preview card frames pricing/specs as a
  "catalog reference," `enrich.ts` carries the caveat, and a P2 test guards
  bare-tail uniqueness across the catalog.
- **v1 (2026-07-03):** Initial.
