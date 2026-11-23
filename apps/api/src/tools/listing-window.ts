import {
  applySelectorSuffix,
  boundFlatResult,
  directoryResult,
  MAX_RESULT_CODE_UNITS,
  NativeFileError,
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

/** The single-range forms a listing accepts, shared so each reader names them
 *  the same way. */
export const LISTING_RANGE_FORMS =
  'a single :L5-10, :L5+10, :L5-, or :-L5 range';

/** The sentence every listing refusal adds: a bare number reads as a line. */
export const BARE_NUMBER_NOTE = 'A bare number also reads as a line.';

/** Why a listing refused its selector, for the caller's own wording. */
export type ListingRefusal =
  /** The applier's own text for a selector it judged itself. */
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'outline' }
  | { readonly kind: 'range' };

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
  } catch (error) {
    if (!(error instanceof NativeFileError)) throw error;

    return { refusal: { kind: 'invalid', message: error.message } };
  }

  if (target.outline) return { refusal: { kind: 'outline' } };

  if (
    target.raw ||
    target.ranges !== undefined ||
    target.pending?.includes(',') === true
  ) {
    return { refusal: { kind: 'range' } };
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
