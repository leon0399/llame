import type { UIMessage } from "ai";
import { buildApiUrl } from "../../api/client";

export type ChatMessageResponse = {
  id: string;
  chatId: string;
  seq: number;
  role: UIMessage["role"] | "tool";
  senderUserId: string | null;
  parts: UIMessage["parts"];
  attachments: unknown[];
  usage: Record<string, unknown> | null;
  inReplyTo: string | null;
  createdAt: string;
};

export type ChatMessagesResponse = {
  messages: ChatMessageResponse[];
};

export type ChatMessagesHistoryOptions = {
  limit?: number;
  beforeSeq?: number;
};

export function buildChatMessagesHistoryUrl(
  chatId: string,
  options: ChatMessagesHistoryOptions = {},
): string {
  const url = new URL(
    buildApiUrl(`/api/v1/chats/${encodeURIComponent(chatId)}/messages`),
  );

  if (options.limit !== undefined) {
    url.searchParams.set("limit", String(options.limit));
  }

  if (options.beforeSeq !== undefined) {
    url.searchParams.set("beforeSeq", String(options.beforeSeq));
  }

  return url.toString();
}

type ChatUiMessageResponse = ChatMessageResponse & {
  role: Extract<UIMessage["role"], "user" | "assistant">;
};

function isChatUiMessageResponse(
  message: ChatMessageResponse,
): message is ChatUiMessageResponse {
  return message.role === "user" || message.role === "assistant";
}

export function toChatUiMessages(response: ChatMessagesResponse): UIMessage[] {
  return response.messages.filter(isChatUiMessageResponse).map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts,
    // Carry `seq` into message metadata so the compaction boundary can locate
    // where the summarized span ends (AI SDK UIMessage has no seq of its own).
    // Unconditional: a conditional spread would drop it on turns with nothing
    // else to carry and mis-place the boundary.
    metadata: { seq: message.seq },
  }));
}
