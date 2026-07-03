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
 */
export function enrichAvailableModels(
  available: AvailableModel[],
): ChatModel[] {
  return available.map((model) => {
    const enrichment = findCatalogModel(model.id);
    return {
      ...(enrichment ?? {}),
      id: model.id,
      name: enrichment?.name ?? model.label,
    };
  });
}
