import type { AvailableModel } from "./queries";

type EffortLevel = { value: string; label?: string };

/** Resolve an effort value to its operator label, else the raw value. */
export function effortDisplayLabel(
  levels: readonly EffortLevel[] | undefined,
  value: string,
): string {
  return levels?.find((level) => level.value === value)?.label ?? value;
}

/** Look up a persisted effort token against the live catalog for a model. */
export function effortDisplayLabelForModel(
  models: readonly AvailableModel[] | undefined,
  modelId: string | undefined,
  effort: string,
): string {
  const levels = models?.find((model) => model.id === modelId)?.reasoning
    ?.effortLevels;
  return effortDisplayLabel(levels, effort);
}
