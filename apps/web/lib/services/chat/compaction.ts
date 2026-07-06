/**
 * Pure client-side boundary math over the chat's latest compaction (#57).
 *
 * The compaction itself is no longer fetched separately here — it arrives
 * EMBEDDED in `GET :id/messages` (#136: folded from a standalone
 * `GET :id/compaction` call, which was a second, independently-failing fetch
 * with no way for the UI to tell "no compaction" apart from "the fetch
 * errored"). `useChatMessagesQuery` (queries.ts) now returns both
 * `{ messages, compaction }` from one request; `compactionBoundaryIndex`
 * below is the only thing this module still needs to provide.
 */

/**
 * Index in `messages` where the compacted span ENDS — i.e. where the marker
 * renders (BEFORE that index; `=== messages.length` renders AFTER the last).
 * The boundary is the first message past `uptoSeq` (`metadata.seq > uptoSeq`, or
 * a live/seq-less message, which is always newest).
 *
 * Sentinel `-1` = no marker, and ONLY for "no compaction" or "no messages".
 * When a compaction exists but EVERY loaded message is within the summarized
 * span (all `seq <= uptoSeq` — the most-invisible case the feature exists to
 * surface), the boundary is AFTER them (`messages.length`), so the marker still
 * shows. Index `0` → the whole loaded window is post-boundary → marker at the
 * top ("earlier messages summarized" above, older ones not yet loaded).
 *
 * Computed over the CURRENTLY-LOADED window (today the full history — no
 * client-side pagination yet).
 */
export function compactionBoundaryIndex(
  messages: ReadonlyArray<{ metadata?: { seq?: number } }>,
  uptoSeq: number | null | undefined,
): number {
  if (uptoSeq === null || uptoSeq === undefined || messages.length === 0) {
    return -1;
  }
  const idx = messages.findIndex((m) => {
    const seq = m.metadata?.seq;
    return seq === undefined || seq > uptoSeq;
  });
  return idx === -1 ? messages.length : idx;
}
