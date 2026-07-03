import { api } from "../../api/client";
import {
  buildChatMessagesHistoryUrl,
  type ChatMessageResponse,
  type ChatMessagesResponse,
} from "./history";
import { chatToMarkdown, slugifyTitle } from "./chat-markdown";

// The history endpoint DEFAULTS to the latest 100 messages (and caps at 200), so
// a single no-limit fetch would silently truncate a long chat's export. Page
// through with the `beforeSeq` cursor to get the WHOLE conversation. 100 is
// always <= the api's max limit, so it never trips the `@Max` validator.
const PAGE_SIZE = 100;

/** Fetch a chat's FULL message history, oldest-first, paginating the cursor. */
async function fetchAllMessages(
  chatId: string,
): Promise<ChatMessageResponse[]> {
  const all: ChatMessageResponse[] = [];
  let beforeSeq: number | undefined;

  for (;;) {
    const url = buildChatMessagesHistoryUrl(chatId, {
      limit: PAGE_SIZE,
      ...(beforeSeq !== undefined ? { beforeSeq } : {}),
    });
    const { messages } = await api.get(url).json<ChatMessagesResponse>();
    if (messages.length === 0) break;
    // Each page is oldest-first; older pages are fetched later, so prepend.
    all.unshift(...messages);
    if (messages.length < PAGE_SIZE) break; // reached the start of the chat
    beforeSeq = messages[0].seq; // oldest seq seen so far
  }

  return all;
}

/** Trigger a browser download of a text file (SSR-guarded, object-URL revoked). */
function downloadTextFile(filename: string, content: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Fetch a chat's FULL history (owner-scoped, paginated), render it as Markdown,
 * and download the file. Per-chat, client-side — "own your data".
 */
export async function exportChatAsMarkdown(
  chatId: string,
  title: string,
): Promise<void> {
  const messages = await fetchAllMessages(chatId);
  const markdown = chatToMarkdown(title, messages);
  downloadTextFile(`${slugifyTitle(title)}.md`, markdown);
}
