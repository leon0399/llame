import type { UIMessage } from "ai";
import { buildApiUrl } from "../../api/client";

type PrepareSendMessagesOptions = {
  messages: Array<Pick<UIMessage, "id" | "parts">>;
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
  body,
}: PrepareSendMessagesOptions & {
  body?: { model?: unknown };
}): {
  body: {
    message: {
      id: string;
      parts: UIMessage["parts"];
      model?: string;
    };
  };
} {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    throw new Error("Cannot send an empty chat request");
  }

  // Selected model (#76): forwarded only when a non-empty string is supplied
  // by the caller (sendMessage's body). The api validates it against the
  // caller's available set and 422s an unknown id — so the caller must not
  // pass an id that isn't in the live model list.
  const model =
    typeof body?.model === "string" && body.model.length > 0
      ? body.model
      : undefined;

  return {
    body: {
      message: {
        id: lastMessage.id,
        parts: lastMessage.parts,
        ...(model !== undefined ? { model } : {}),
      },
    },
  };
}
