import type { UIMessage } from "ai";
import { buildApiUrl } from "../../api/fetch";

type PrepareSendMessagesOptions = {
  messages: Array<Pick<UIMessage, "id" | "parts">>;
  modelId: string;
  /**
   * Reasoning effort for this turn. Absent means "use the model's own
   * default" — the api resolves it, so the client never has to guess a level
   * for a model whose vocabulary it has not loaded.
   */
  effort?: string | undefined;
};

export const NO_MODEL_SELECTED_ERROR =
  "Cannot send a chat request without a selected model";

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
export function prepareReconnectToStreamRequest({ id }: { id: string }) {
  return { api: buildChatStreamUrl(id) };
}

export function prepareSendMessagesRequest({
  messages,
  modelId,
  effort,
}: PrepareSendMessagesOptions) {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    throw new Error("Cannot send an empty chat request");
  }
  if (modelId.trim().length === 0) {
    throw new Error(NO_MODEL_SELECTED_ERROR);
  }

  return {
    body: {
      modelId,
      // Omitted, never sent as null or "": the api rejects a blank effort with
      // 400 and treats absence as "resolve this model's defaultEffort".
      ...(effort !== undefined && effort.length > 0 && { effort }),
      message: {
        id: lastMessage.id,
        parts: lastMessage.parts,
      },
    },
  };
}
