import { codePointSafeCutIndex } from '@workspace/runtime-safety';

/**
 * Corpus-agnostic chunking toolkit (search/core). Groups an ordered list of
 * atomic items (for chat search: whole messages; for knowledge/RAG later:
 * document blocks) into character-budgeted, boundary-respecting chunks with
 * trailing overlap. Deterministic and pure — the same input always yields the
 * same grouping, which is what makes the content-hash no-op-upsert path work.
 *
 * Rules:
 * - Items are never split (message/block boundaries are respected). A single item
 *   larger than `maxChars` becomes its own oversized chunk (passthrough) — lexical
 *   indexes have no input cap, so splitting it buys nothing here.
 * - A chunk accumulates whole items until adding the next would exceed `maxChars`
 *   (but always contains at least one NEW item, so progress is guaranteed).
 * - Each chunk after the first re-includes the previous chunk's last `overlapItems`
 *   items, so a Q/A pair split across a boundary is still matchable from either side —
 *   except an item that alone fills the budget (`>= maxChars`), which is already a
 *   complete chunk and would only bloat the next one, so it is not carried forward.
 */
export interface ChunkByBudgetOptions {
  maxChars: number;
  overlapItems: number;
}

export function chunkByCharBudget<T>(
  items: ReadonlyArray<T>,
  sizeOf: (item: T) => number,
  { maxChars, overlapItems }: ChunkByBudgetOptions,
): Array<Array<T>> {
  const groups: Array<Array<T>> = [];
  let cursor = 0;
  let prevTail: Array<T> = [];

  while (cursor < items.length) {
    const group = [...prevTail];
    let size = group.reduce((acc, item) => acc + sizeOf(item), 0);

    // Always take at least one new item; then keep taking while under budget.
    while (cursor < items.length) {
      const next = items[cursor];
      const nextSize = sizeOf(next);
      const hasNewItem = group.length > prevTail.length;
      if (hasNewItem && size + nextSize > maxChars) break;
      group.push(next);
      size += nextSize;
      cursor += 1;
    }

    groups.push(group);
    // Carry the last `overlapItems` items into the next chunk for context
    // continuity — but never a truly oversized item (one that alone meets/exceeds
    // the budget): it is already fully covered by its own chunk, and dragging it
    // forward would bloat every following chunk.
    prevTail =
      overlapItems > 0 && cursor < items.length
        ? group.slice(-overlapItems).filter((item) => sizeOf(item) < maxChars)
        : [];
  }

  return groups;
}

/**
 * Cut `text` at an index in `[from, from + maxLen]`, preferring (in order) a
 * blank line, a newline or sentence end, then plain whitespace — never
 * mid-word unless no boundary exists at all within the budget. Returns
 * `text.length` unchanged when the tail from `from` already fits.
 *
 * Corpus-agnostic: chat search's oversized-message splitting is the first
 * consumer (`search/chat/conversation-chunker.ts`, #517); knowledge/RAG and
 * curated memory reuse this kernel rather than reimplementing boundary and
 * surrogate-safety logic per corpus.
 *
 * Takes a cursor offset instead of a fresh substring so a caller advancing
 * through a large string never re-copies the tail on every iteration — the
 * window inspected here is always bounded by `maxLen`, which is what keeps
 * repeated calls linear in the length of `text` rather than quadratic.
 */
export function cutTextAtBoundary(
  text: string,
  from: number,
  maxLen: number,
): number {
  if (text.length - from <= maxLen) return text.length;
  const window = text.slice(from, from + maxLen);

  const blankLine = window.lastIndexOf('\n\n');
  if (blankLine > 0) return from + blankLine + 2;

  let sentenceEnd = -1;
  for (const token of ['\n', '. ', '! ', '? ']) {
    const idx = window.lastIndexOf(token);
    if (idx > 0) sentenceEnd = Math.max(sentenceEnd, idx + token.length);
  }
  if (sentenceEnd > 0) return from + sentenceEnd;

  for (let i = window.length - 1; i > 0; i -= 1) {
    if (/\s/.test(window.charAt(i))) return from + i + 1;
  }

  // No boundary at all within the budget: hard-cut at maxLen — code-point-safe
  // via the shared primitive so this never splits a surrogate pair (e.g. an
  // emoji) into two unpaired halves.
  return codePointSafeCutIndex(text, from + maxLen);
}
