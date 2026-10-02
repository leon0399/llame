import { resolvePendingSelector } from "./path";

/** The request fields a listing places against its own entry count. */
export type SliceOptions = {
  offset?: number;
  limit?: number;
  /** Members the requested level's entry count still has to place. */
  pending?: string;
};

/** The run of the requested level a listing's selector names. */
export type SliceWindow = {
  offset: number;
  end: number;
};

/**
 * The window the selector asks for, with `N-` and `-K` resolved against that
 * count — the one count a listing holds. A member past the last entry selects
 * nothing, which is the empty page a listing past its end already returns.
 */
export function sliceWindow(options: SliceOptions, count: number): SliceWindow {
  // A listing places only absolute members, so a pending request contributes
  // its own window: the offset and limit beside it are placeholders.
  const placed =
    options.pending === undefined
      ? options
      : resolvePendingSelector(options.pending, count);
  const offset = placed.offset ?? 0;
  return { offset, end: Math.min(offset + (placed.limit ?? count), count) };
}
