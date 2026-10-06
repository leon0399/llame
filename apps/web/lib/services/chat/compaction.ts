/**
 * Pure client-side boundary math over checkpoint rows in the owner history.
 *
 * The checkpoint row itself is not rendered as a message. Its
 * `absorbedThroughSeq` points at the last absorbed conversation row, so the
 * marker belongs immediately before the first UI message with a greater seq.
 *
 * Computed over the CURRENTLY-LOADED window (#187: the newest page plus any
 * older pages the reader has scrolled in — the boundary re-derives as the
 * window grows).
 */
export function compactionBoundaryIndex(
  messages: ReadonlyArray<{ metadata?: { seq?: number } }>,
  absorbedThroughSeq: number | null | undefined,
): number {
  if (
    absorbedThroughSeq === null ||
    absorbedThroughSeq === undefined ||
    messages.length === 0
  ) {
    return -1;
  }
  const idx = messages.findIndex((m) => {
    const seq = m.metadata?.seq;
    return seq === undefined || seq > absorbedThroughSeq;
  });
  return idx === -1 ? messages.length : idx;
}
