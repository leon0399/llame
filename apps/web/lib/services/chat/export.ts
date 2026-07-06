import { api } from "../../api/client";
import {
  buildChatMessagesHistoryUrl,
  type ChatMessageResponse,
  type ChatMessagesResponse,
} from "./history";
import {
  CHAT_HISTORY_PAGE_SIZE,
  paginateAllMessages,
} from "./paginate-messages";
import { chatToMarkdown, slugifyTitle } from "./chat-markdown";

/** Fetch a chat's FULL message history (owner-scoped), paginating the cursor. */
function fetchAllMessages(chatId: string): Promise<ChatMessageResponse[]> {
  return paginateAllMessages((beforeSeq) =>
    api
      .get(
        buildChatMessagesHistoryUrl(chatId, {
          limit: CHAT_HISTORY_PAGE_SIZE,
          ...(beforeSeq !== undefined ? { beforeSeq } : {}),
        }),
      )
      .json<ChatMessagesResponse>(),
  );
}

/** Trigger a browser download of a text file (SSR-guarded, object-URL revoked). */
function downloadTextFile(filename: string, content: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously right after click() can race the browser's
  // (async) download handoff and cancel/interrupt the save in some browsers
  // (notably Firefox) — defer it a tick so the download has already started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
