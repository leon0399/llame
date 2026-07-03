import type { ChatModel } from "@/lib/ai/models";

/**
 * The ALTERNATIVE models to offer on "regenerate with a different model" — every
 * available model except the one currently selected (that one is the plain
 * regenerate button's default). Order preserved; empty when there's one model or
 * none (→ the caret dropdown isn't rendered). Pure, so it's unit-tested.
 */
export function regenerateModelOptions(
  models: ChatModel[],
  currentId: string,
): ChatModel[] {
  return models.filter((model) => model.id !== currentId);
}
