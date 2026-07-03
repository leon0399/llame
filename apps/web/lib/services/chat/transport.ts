import type { UIMessage } from 'ai';
import { buildApiUrl } from '../../api/client';

type PrepareSendMessagesOptions = {
  messages: Array<Pick<UIMessage, 'id' | 'parts'>>;
};

export function buildChatMessagesUrl(chatId: string): string {
  return buildApiUrl(`/api/v1/chats/${chatId}/messages`);
}

export function buildChatStreamUrl(chatId: string): string {
  return buildApiUrl(`/api/v1/chats/${chatId}/stream`);
}

export function buildChatRunsUrl(chatId: string): string {
  return buildApiUrl(`/api/v1/chats/${chatId}/runs`);
}

/**
 * Resume-on-refresh (#49): points the transport's reconnectToStream at the
 * api's stream-resume endpoint, which replays the chat's active run as a
 * UI-message stream (or 204 → the SDK resolves null and the chat stays idle).
 */
export function prepareReconnectToStreamRequest({
  id,
}: {
  id: string;
}): { api: string } {
  return { api: buildChatStreamUrl(id) };
}

export function prepareSendMessagesRequest({
  id,
  messages,
  body,
  trigger,
}: PrepareSendMessagesOptions & {
  id: string;
  body?: {
    model?: unknown;
    editUserMessage?: unknown;
    editMessageId?: unknown;
  };
  trigger?: 'submit-message' | 'regenerate-message';
}): { api?: string; body: Record<string, unknown> } {
  // Selected model (#76): forwarded only when a non-empty string is supplied
  // by the caller (sendMessage's body). The api validates it against the
  // caller's available set and 422s an unknown id — so the caller must not
  // pass an id that isn't in the live model list.
  const model =
    typeof body?.model === 'string' && body.model.length > 0
      ? body.model
      : undefined;
  // Edit & resubmit: the new text for the last user message + the id it was
  // rendered on (the server pins the edit to it — 409 if it's no longer last,
  // so a two-tab race can't rewrite a different message). Both forwarded ONLY on
  // regenerate; the transport reconstructs the runs body from scratch, so
  // anything not explicitly forwarded here is dropped.
  const editUserMessage =
    typeof body?.editUserMessage === 'string' && body.editUserMessage.length > 0
      ? body.editUserMessage
      : undefined;
  const editMessageId =
    typeof body?.editMessageId === 'string' && body.editMessageId.length > 0
      ? body.editMessageId
      : undefined;

  // Regenerate: re-run the last completed turn via a DISTINCT endpoint
  // (POST /chats/:id/runs), never /messages. Route by the SDK `trigger` — by
  // now the SDK has already stripped the assistant message from client state,
  // so `messages.at(-1)` is the user turn and looks identical to a fresh send.
  if (trigger === 'regenerate-message') {
    return {
      api: buildChatRunsUrl(id),
      body: {
        ...(model !== undefined ? { model } : {}),
        // editMessageId only rides WITH an edit — it pins that edit's target and
        // is meaningless on its own.
        ...(editUserMessage !== undefined
          ? {
              editUserMessage,
              ...(editMessageId !== undefined ? { editMessageId } : {}),
            }
          : {}),
      },
    };
  }

  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    throw new Error('Cannot send an empty chat request');
  }
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
