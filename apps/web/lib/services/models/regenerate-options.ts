import type { ChatModel } from "@/lib/ai/models";

/**
 * Distinct models by id (keep-first, order preserved). The availability set can
 * carry DUPLICATE ids — two BYOK provider accounts whose `defaultModel` is the
 * same id both surface that id — and offering the same model twice (or counting
 * it toward "you have multiple models") is meaningless.
 */
export function dedupeModelsById(models: ChatModel[]): ChatModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

/**
 * The ALTERNATIVE models to offer on "regenerate with a different model" — every
 * DISTINCT available model except the one currently selected (that one is the
 * plain regenerate button's default). Order preserved. The caret's visibility is
 * gated on `dedupeModelsById(models).length > 1` (≥2 distinct models), NOT on
 * this list's length — a single distinct model with a stale selection would
 * otherwise offer itself as a fake "alternative". Pure, so it's unit-tested.
 */
export function regenerateModelOptions(
  models: ChatModel[],
  currentId: string,
): ChatModel[] {
  return dedupeModelsById(models).filter((model) => model.id !== currentId);
}
