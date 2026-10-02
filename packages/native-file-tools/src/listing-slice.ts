import {
  invalidSelectorMessage,
  NativeFileError,
  resolvePendingSelector,
} from "./path";

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
 * The window the selector asks for: one run of the requested level's entries,
 * running to `count` when the request names no end. A request whose members
 * are still to place contributes its own window, and the offset and limit
 * beside it are placeholders.
 */
export function sliceWindow(options: SliceOptions, count: number): SliceWindow {
  if (options.pending !== undefined)
    return pendingSliceWindow(options.pending, count);
  const offset = options.offset ?? 0;
  return { offset, end: Math.min(offset + (options.limit ?? count), count) };
}

/**
 * The window a member list still to place asks for, with `N-` and `-K`
 * resolved against that count -- the one count a listing holds. A member past
 * the last entry selects nothing, which is the empty page a listing past its
 * end already returns.
 *
 * A comma request is refused. Its placed form is a set of intervals whose
 * `limit` is only the first of them, so the window below would answer with a
 * page the request never named.
 */
function pendingSliceWindow(pending: string, count: number): SliceWindow {
  const placed = resolvePendingSelector(pending, count);
  if (placed.ranges !== undefined)
    throw new NativeFileError("invalid_selector", invalidSelectorMessage());
  return {
    offset: placed.offset,
    end: Math.min(placed.offset + (placed.limit ?? count), count),
  };
}
