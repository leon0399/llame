import { resolveEndRelativeSelector, type PendingSelector } from "./path";

/** The request fields a listing places against its own entry count. */
export type SliceOptions = {
  offset?: number;
  limit?: number;
  /** Members the requested level's entry count still has to place. */
  pending?: PendingSelector;
};

/** A flat slice already placed against the requested level's entry count. */
export type FlatSlice<Entry> = {
  offset: number;
  end: number;
  selected: Array<Entry>;
};

/**
 * The flat slice the selector asks for, with `N-` and `-K` resolved against
 * that count — the one count a listing holds. A member past the last entry
 * slices nothing, which is the empty page a listing past its end already
 * returns.
 */
export function requestedSlice<Entry>(
  targetPath: string,
  entries: Array<Entry>,
  options: SliceOptions,
): FlatSlice<Entry> {
  const count = entries.length;
  const { offset, limit } = resolveEndRelativeSelector(
    {
      path: targetPath,
      raw: false,
      offset: options.offset ?? 0,
      limit: options.limit ?? count,
      pending: options.pending,
    },
    count,
  );
  const end = Math.min(offset + (limit ?? count), count);
  return { offset, end, selected: entries.slice(offset, end) };
}
