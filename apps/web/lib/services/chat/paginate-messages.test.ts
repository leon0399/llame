import { describe, expect, it, vi } from "vitest";

import {
  CHAT_HISTORY_MAX_PAGES,
  CHAT_HISTORY_PAGE_SIZE,
  paginateAllMessages,
} from "./paginate-messages";
import type { ChatMessageResponse } from "./history";

// A message with just the fields the paginator reads (seq); id encodes order.
const m = (seq: number): ChatMessageResponse =>
  ({ id: `m${seq}`, seq }) as never;

// A page of `n` messages ending at seq `endSeq` (ascending, oldest-first).
const page = (endSeq: number, n: number) =>
  Array.from({ length: n }, (_, i) => m(endSeq - n + 1 + i));

describe("paginateAllMessages", () => {
  it("a single short page → one fetch, all rows", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ messages: page(3, 3) });
    const all = await paginateAllMessages(fetchPage);
    expect(all.map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(undefined);
  });

  it("full page then short page → merged oldest→newest, cursor = oldest seq", async () => {
    // Newest page first: seqs 101..200 (PAGE_SIZE), then older 1..50.
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ messages: page(200, CHAT_HISTORY_PAGE_SIZE) })
      .mockResolvedValueOnce({ messages: page(50, 50) });
    const all = await paginateAllMessages(fetchPage);
    expect(all[0].seq).toBe(1); // oldest first
    expect(all[all.length - 1].seq).toBe(200); // newest last
    expect(all).toHaveLength(CHAT_HISTORY_PAGE_SIZE + 50);
    // second call fetched strictly older than the oldest of page 1 (seq 101).
    expect(fetchPage).toHaveBeenNthCalledWith(2, 101);
  });

  it("empty first page → []", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ messages: [] });
    expect(await paginateAllMessages(fetchPage)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("full page then empty → stops (exact multiple of page size)", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ messages: page(100, CHAT_HISTORY_PAGE_SIZE) })
      .mockResolvedValueOnce({ messages: [] });
    const all = await paginateAllMessages(fetchPage);
    expect(all).toHaveLength(CHAT_HISTORY_PAGE_SIZE);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("caps at CHAT_HISTORY_MAX_PAGES for a very long chat (safety valve)", async () => {
    // Full pages with a strictly-decreasing cursor → advances forever; the cap
    // is what stops it (loads the latest MAX_PAGES*PAGE_SIZE turns).
    let endSeq = 100_000;
    const fetchPage = vi.fn().mockImplementation(() => {
      const p = page(endSeq, CHAT_HISTORY_PAGE_SIZE);
      endSeq -= CHAT_HISTORY_PAGE_SIZE;
      return Promise.resolve({ messages: p });
    });
    const all = await paginateAllMessages(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(CHAT_HISTORY_MAX_PAGES);
    expect(all).toHaveLength(CHAT_HISTORY_MAX_PAGES * CHAT_HISTORY_PAGE_SIZE);
  });

  it("breaks if the cursor does not advance (server ignores beforeSeq) WITHOUT duplicating the page", async () => {
    // Always returns the same full page → would loop forever without the guard,
    // and — the guard runs before merging — must not double-count that page either.
    const fetchPage = vi
      .fn()
      .mockResolvedValue({ messages: page(200, CHAT_HISTORY_PAGE_SIZE) });
    const all = await paginateAllMessages(fetchPage);
    // First page accepted and merged; second call returns the SAME cursor
    // (101, not < 101) → rejected before merging, so only the first page's
    // messages are kept, not two copies of the same 100 rows.
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(all).toHaveLength(CHAT_HISTORY_PAGE_SIZE);
    expect(all.map((x) => x.seq)).toEqual(
      page(200, CHAT_HISTORY_PAGE_SIZE).map((x) => x.seq),
    );
  });
});
