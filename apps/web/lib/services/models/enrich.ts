import { findCatalogModel, type ChatModel } from "../../ai/models";

/** The api's available-model shape (#76). */
export type AvailableModel = {
  id: string;
  label: string;
  providerType: string;
  source: "byok" | "instance";
  providerAccountId: string | null;
};

/**
 * Merge the live availability set with static-catalog display metadata (name,
 * description, price, context window, icon). Enrichment matches a live BARE id
 * against the catalog's prefixed OR bare key (`findCatalogModel`) — the previous
 * exact-id lookup missed EVERY live model, since live ids are bare and the
 * catalog is prefixed. An unknown/custom id keeps just its id + label. Pure.
 *
 * CAVEAT (accepted): the match is by model IDENTITY, not provider — llame has no
 * `openai` provider type (real OpenAI and OpenAI-compatible proxies like Groq/
 * vLLM/LiteLLM both use `openai_compatible`, and `defaultModel` is free text). So
 * a bare `gpt-4o` served by a NON-canonical endpoint gets the catalog's canonical
 * metadata — the merged `price`/`contextWindow`/links are a REFERENCE for that
 * model, NOT a guarantee for the specific endpoint. This is a UX/trust display
 * concern only (verified: `price` never feeds a cost calc — the server prices
 * turns independently). Provider-gating was rejected because `openai_compatible`
 * can't distinguish real OpenAI from a proxy.
 */
export function enrichAvailableModels(
  available: AvailableModel[],
): ChatModel[] {
  return available.map((model) => {
    const enrichment = findCatalogModel(model.id);
    return {
      ...enrichment,
      id: model.id,
      name: enrichment?.name ?? model.label,
    };
  });
}
