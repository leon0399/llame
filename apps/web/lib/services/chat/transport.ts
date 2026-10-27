import type { ChatRequestOptions, UIMessage } from "ai";
import type { PermissionModeResponseValue } from "../../api/generated/models";
import { buildApiUrl } from "../../api/fetch";

/**
 * The follow-up request body the api accepts (`POST
 * /chats/:chatId/messages/:userMessageId/runs`), one variant per action
 * (turn-actions D3/D13). Each variant names exactly the fields its action
 * takes: `continue` resumes the Run's own model and effort, so it carries
 * neither.
 */
export type FollowUpRunRequest =
  | { action: "continue"; permissionMode?: PermissionModeResponseValue }
  | {
      action: "regenerate";
      modelId: string;
      effort?: string;
      permissionMode?: PermissionModeResponseValue;
    };

/** Everything one request needs: the log, the Chat, and the selections the
 *  composer holds when it is prepared. */
export type ChatTransportRequestOptions = {
  messages: Array<Pick<UIMessage, "id" | "parts">>;
  /** The Chat the messages belong to — the SDK's own `id`. */
  chatId: string;
  /** `regenerate-message` is a follow-up Run; anything else is a chat send. */
  trigger?: "submit-message" | "regenerate-message";
  /**
   * The `body` a `regenerate()` call carried. A follow-up request names its
   * action here; a chat send carries none.
   */
  followUp?: ChatRequestOptions["body"];
  modelId: string | undefined;
  /**
   * Reasoning effort for this turn. Absent means "use the model's own
   * default" — the api resolves it, so the client never has to guess a level
   * for a model whose vocabulary it has not loaded.
   */
  effort?: string | undefined;
  permissionMode?: PermissionModeResponseValue;
};

export const NO_MODEL_SELECTED_ERROR =
  "Cannot send a chat request without a selected model";

export const NO_FOLLOW_UP_ACTION_ERROR =
  "Cannot send a follow-up request without an action";

export function buildChatMessagesUrl(chatId: string): string {
  return buildApiUrl(`/api/v1/chats/${chatId}/messages`);
}

export function buildChatStreamUrl(chatId: string): string {
  return buildApiUrl(`/api/v1/chats/${chatId}/stream`);
}

/** The follow-up Run route: keyed on the turn's user message, not the reply. */
export function buildFollowUpRunUrl(
  chatId: string,
  userMessageId: string,
): string {
  return buildApiUrl(`/api/v1/chats/${chatId}/messages/${userMessageId}/runs`);
}

/**
 * Resume-on-refresh (#49): points the transport's reconnectToStream at the
 * api's stream-resume endpoint, which replays the chat's active run as a
 * UI-message stream (or 204 → the SDK resolves null and the chat stays idle).
 */
export function prepareReconnectToStreamRequest({ id }: { id: string }) {
  return { api: buildChatStreamUrl(id) };
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The follow-up request a `regenerate()` body names, or null when the body is
 * not one this build sends. `continue` carries only a permission mode;
 * `regenerate` always names a model, because the Run it replaces may have used
 * another.
 */
export function followUpRunRequest(
  value: ChatRequestOptions["body"],
): FollowUpRunRequest | null {
  if (value === undefined) return null;
  const permissionMode =
    "permissionMode" in value && value.permissionMode === "bypass"
      ? "bypass"
      : undefined;
  if ("action" in value && value.action === "continue") {
    return {
      action: "continue",
      ...(permissionMode !== undefined && { permissionMode }),
    };
  }
  if (!("action" in value) || value.action !== "regenerate") return null;
  if (!("modelId" in value) || !isNonBlankString(value.modelId)) return null;
  const effort = "effort" in value ? value.effort : undefined;
  return {
    action: "regenerate",
    modelId: value.modelId,
    // Omitted, never sent as null or "": the api rejects a blank effort.
    ...(isNonBlankString(effort) && { effort }),
    ...(permissionMode !== undefined && { permissionMode }),
  };
}

/** The chat-send body: the last message plus the composer's selections. */
export type ChatSendBody = {
  modelId: string;
  effort?: string;
  permissionMode?: PermissionModeResponseValue;
  message: { id: string; parts: UIMessage["parts"] };
};

/** One prepared request: the endpoint to call and the body to send. The body
 *  is a chat send or a follow-up, which the api tells apart by `action`. */
export type PreparedChatRequest = {
  api: string;
  body: ChatSendBody | FollowUpRunRequest;
};

/** The follow-up request: the same UI-message stream a chat send answers, keyed
 *  on the turn's LAST user message rather than the reply, because the SDK
 *  slices the log to that message whether or not a reply exists (D13). */
function prepareFollowUpRun(
  options: Pick<ChatTransportRequestOptions, "chatId" | "followUp">,
  userMessageId: string,
): PreparedChatRequest {
  const request = followUpRunRequest(options.followUp);
  if (request === null) throw new Error(NO_FOLLOW_UP_ACTION_ERROR);
  return {
    api: buildFollowUpRunUrl(options.chatId, userMessageId),
    body: request,
  };
}

/** A chat send: only the last message travels — the server owns history. */
function prepareChatSend(
  options: Pick<
    ChatTransportRequestOptions,
    "modelId" | "effort" | "permissionMode"
  >,
  message: Pick<UIMessage, "id" | "parts">,
  api: string,
): PreparedChatRequest {
  const { modelId, effort, permissionMode } = options;
  if (modelId === undefined || modelId.trim().length === 0) {
    throw new Error(NO_MODEL_SELECTED_ERROR);
  }
  return {
    api,
    body: {
      modelId,
      // Omitted, never sent as null or "": the api rejects a blank effort with
      // 400 and treats absence as "resolve this model's defaultEffort".
      ...(effort !== undefined && effort.length > 0 && { effort }),
      ...(permissionMode === "bypass" && { permissionMode }),
      message: { id: message.id, parts: message.parts },
    },
  };
}

export function prepareSendMessagesRequest(
  options: ChatTransportRequestOptions,
): PreparedChatRequest {
  const lastMessage = options.messages.at(-1);
  if (!lastMessage) {
    throw new Error("Cannot send an empty chat request");
  }
  return options.trigger === "regenerate-message"
    ? prepareFollowUpRun(options, lastMessage.id)
    : prepareChatSend(
        options,
        lastMessage,
        buildChatMessagesUrl(options.chatId),
      );
}
