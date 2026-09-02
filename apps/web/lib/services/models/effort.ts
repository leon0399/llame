type EffortLevel = { value: string; label?: string };

/** Resolve an effort value to its operator label, else the raw value. */
export function effortDisplayLabel(
  levels: ReadonlyArray<EffortLevel> | undefined,
  value: string,
): string {
  return levels?.find((level) => level.value === value)?.label ?? value;
}
