import { getChatMessages } from "../../api/generated/chats/chats";
import type { GetChatMessagesParams } from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import {
  normalizeChatMessagesResponse,
  type ChatMessageResponse,
} from "./history";
import {
  CHAT_HISTORY_PAGE_SIZE,
  paginateAllMessages,
} from "./paginate-messages";
import { chatToMarkdown, slugifyTitle } from "./chat-markdown";
import { fetchModels } from "../models/queries";

/** Fetch a chat's FULL message history (owner-scoped), paginating the cursor. */
function fetchAllMessages(chatId: string): Promise<Array<ChatMessageResponse>> {
  return paginateAllMessages((beforeSeq) => {
    const params: GetChatMessagesParams = { limit: CHAT_HISTORY_PAGE_SIZE };
    if (beforeSeq !== undefined) {
      params.beforeSeq = beforeSeq;
    }
    return getChatMessages(
      encodeURIComponent(chatId),
      params,
      undefined,
      createAuthenticatedBrowserFetch(globalThis.fetch),
    ).then(normalizeChatMessagesResponse);
  });
}

/** Trigger a browser download of a text file (SSR-guarded, object-URL revoked). */
function downloadTextFile(filename: string, content: string): void {
  if (globalThis.window === undefined) return;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
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
  const [messages, modelsResponse] = await Promise.all([
    fetchAllMessages(chatId),
    fetchModels().catch(() => undefined),
  ]);
  const markdown = chatToMarkdown(title, messages, modelsResponse?.models);
  downloadTextFile(`${slugifyTitle(title)}.md`, markdown);
}
