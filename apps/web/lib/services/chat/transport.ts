import type { UIMessage } from "ai";
import { buildApiUrl } from "../../api/client";

type PrepareSendMessagesOptions = {
  messages: Array<Pick<UIMessage, "id" | "parts">>;
  modelId: string;
};

export function buildChatMessagesUrl(chatId: string): string {
  return buildApiUrl(`/api/v1/chats/${chatId}/messages`);
}

export function buildChatStreamUrl(chatId: string): string {
  return buildApiUrl(`/api/v1/chats/${chatId}/stream`);
}

/**
 * Resume-on-refresh (#49): points the transport's reconnectToStream at the
 * api's stream-resume endpoint, which replays the chat's active run as a
 * UI-message stream (or 204 → the SDK resolves null and the chat stays idle).
 */
export function prepareReconnectToStreamRequest({ id }: { id: string }): {
  api: string;
} {
  return { api: buildChatStreamUrl(id) };
}

export function prepareSendMessagesRequest({
  messages,
  modelId,
}: PrepareSendMessagesOptions): {
  body: { modelId: string; message: { id: string; parts: UIMessage["parts"] } };
} {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    throw new Error("Cannot send an empty chat request");
  }
  if (modelId.trim().length === 0) {
    throw new Error("Cannot send a chat request without a selected model");
  }

  return {
    body: {
      modelId,
      message: {
        id: lastMessage.id,
        parts: lastMessage.parts,
      },
    },
  };
}
