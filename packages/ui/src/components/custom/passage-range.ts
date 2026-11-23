/** A passage locator ends in its 1-based inclusive line range: the canonical
 *  `:L<start>-<end>`, or the bare `:<start>-<end>` a stored passage keeps. The
 *  path may itself contain `:`, so only the range is a suffix. */
export const PASSAGE_RANGE_SUFFIX = /:L?(\d+)-(\d+)$/u;
