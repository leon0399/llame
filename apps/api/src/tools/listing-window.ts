import {
  applySelectorSuffix,
  resolveEndRelativeSelector,
  type ReadTarget,
} from '@workspace/native-file-tools';

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
