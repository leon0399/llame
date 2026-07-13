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
  items: readonly T[],
  sizeOf: (item: T) => number,
  { maxChars, overlapItems }: ChunkByBudgetOptions,
): T[][] {
  const groups: T[][] = [];
  let cursor = 0;
  let prevTail: T[] = [];

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
