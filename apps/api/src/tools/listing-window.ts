import {
  applySelectorSuffix,
  boundFlatResult,
  directoryResult,
  MAX_RESULT_CODE_UNITS,
  resolveEndRelativeSelector,
  type ReadTarget,
} from '@workspace/native-file-tools';

import { type ToolResult } from './types';

/** The run of a listing's requested level that its selector names. */
export type ListingWindow = {
  readonly offset: number;
  /** Absent means the run continues to the entry count. */
  readonly limit?: number;
};

/** Why a listing refused its selector, for the caller's own wording. */
export type ListingRefusal = 'invalid' | 'outline' | 'range';

/**
 * Place a listing selector against the requested level's entry count. A
 * listing is a flat slice, so it takes the single-member forms only; a comma
 * request is refused before it is placed, because its merged intervals would
 * otherwise answer with a window the request never named.
 */
export function placeListingSelector(
  locator: string,
  selector: string | undefined,
  count: number,
): { readonly window: ListingWindow } | { readonly refusal: ListingRefusal } {
  if (selector === undefined) return { window: { offset: 0 } };
  let target: ReadTarget;

  try {
    target = applySelectorSuffix(locator, selector);
  } catch {
    return { refusal: 'invalid' };
  }

  if (target.outline) return { refusal: 'outline' };

  if (
    target.raw ||
    target.ranges !== undefined ||
    target.pending?.includes(',') === true
  ) {
    return { refusal: 'range' };
  }

  return { window: resolveEndRelativeSelector(target, count) };
}

/** The caller's wording of a listing page: its empty text and its refusal. */
export type ListingRender = {
  readonly emptyContent: string;
  readonly refuse: (refusal: ListingRefusal) => ToolResult;
};

/**
 * A listing page in the directory-list shape: the locator, then one line per
 * entry, in the order the caller produced. The window is placed by
 * `placeListingSelector` and the page is cut to the read bound. `emptyContent` is
 * the whole text of an empty listing.
 */
export function renderListing(
  path: string,
  entries: ReadonlyArray<string>,
  selector: string | undefined,
  { emptyContent, refuse }: ListingRender,
): ToolResult {
  const placed = placeListingSelector(path, selector, entries.length);

  if ('refusal' in placed) return refuse(placed.refusal);
  const { offset, limit } = placed.window;
  const end = Math.min(offset + (limit ?? entries.length), entries.length);

  const result = directoryResult(path, entries.length, {
    content:
      entries.length === 0
        ? emptyContent
        : [path, ...entries.slice(offset, end)].join('\n') + '\n',
    truncated: end < entries.length,
    ...(end < entries.length && { nextOffset: end }),
  });

  return boundFlatResult(result, offset, MAX_RESULT_CODE_UNITS);
}
