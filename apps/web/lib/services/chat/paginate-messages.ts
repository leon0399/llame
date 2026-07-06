import type { ChatMessageResponse, ChatMessagesResponse } from "./history";

// The history endpoint defaults to the latest 100 messages and caps at 200. Page
// at 100 (always <= the api max, so it never trips `@Max`). `beforeSeq` is
// EXCLUSIVE server-side (maxSeq = beforeSeq - 1), so passing the oldest seq we've
// seen fetches strictly-older rows — no duplicate, no skip at the page boundary.
export const CHAT_HISTORY_PAGE_SIZE = 100;

// Safety valve: cap the walk at the most recent N pages so a pathological chat
// (llame's durable runs can accrue very long histories with large tool-call
// traces) can't blow up SSR latency or the serialized payload. A chat past this
// shows the latest MAX_PAGES*PAGE_SIZE turns — still far better than the old
// 100-message cap; the true tail is a follow-up ("load older" / virtualization).
export const CHAT_HISTORY_MAX_PAGES = 20;

/**
 * Load a chat's history (up to `CHAT_HISTORY_MAX_PAGES` pages, newest-first walk)
 * by following the `beforeSeq` cursor. `fetchPage` is injected (ky client, SSR
 * raw-fetch, or a test fake), so this loop is pure. Each page is oldest-first;
 * older pages are prepended, yielding a globally oldest→newest array.
 */
export async function paginateAllMessages(
  fetchPage: (beforeSeq: number | undefined) => Promise<ChatMessagesResponse>,
): Promise<ChatMessageResponse[]> {
  const all: ChatMessageResponse[] = [];
  let beforeSeq: number | undefined;

  for (let page = 0; page < CHAT_HISTORY_MAX_PAGES; page++) {
    const { messages } = await fetchPage(beforeSeq);
    if (messages.length === 0) break;

    const nextCursor = messages[0].seq; // oldest seq of this page
    // Guard against a non-advancing cursor (a server that ignored beforeSeq)
    // BEFORE merging the page: checking only after `all.unshift(...)` still
    // stops the infinite loop, but by then the duplicate page is already
    // counted into the result once more — this must reject the page outright.
    if (beforeSeq !== undefined && nextCursor >= beforeSeq) break;

    all.unshift(...messages);
    if (messages.length < CHAT_HISTORY_PAGE_SIZE) break; // reached the chat start
    beforeSeq = nextCursor;
  }

  return all;
}
