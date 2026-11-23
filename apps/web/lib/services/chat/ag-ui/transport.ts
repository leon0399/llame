import { authAwareFetch } from "../../../api/fetch";
import { buildChatStreamUrl, type PreparedChatRequest } from "../transport";
import {
  ChatRequestRejectedError,
  type ChatRequest,
  type ChatTransport,
} from "./chat";
import { readAgUiEvents } from "./event-stream";

/** The events of an accepted stream response, or the api's refusal thrown as
 *  an error whose message is the response body (its error envelope). */
async function streamEvents(response: Response) {
  if (!response.ok) {
    throw new ChatRequestRejectedError(
      (await response.text()) || "Failed to fetch the chat response.",
    );
  }

  if (response.body === null) {
    throw new Error("The chat response has no body.");
  }

  return readAgUiEvents(response.body);
}

/**
 * The Chat's AG-UI transport: a send or a follow-up POSTs the request
 * `prepare` builds and reads the Run's events from the response; a reconnect
 * GETs the stream of the Chat's executing Run (resume-on-refresh, #49), which
 * the api answers with 204 when the Chat has none.
 *
 * `onAccepted` runs once the api accepted a request (before its events are
 * read), so the caller can retire the state that request carried.
 */
export function createChatTransport<TAccepted>(
  prepare: (
    request: ChatRequest,
  ) => PreparedChatRequest & { accepted: TAccepted },
  onAccepted: (request: ChatRequest, accepted: TAccepted) => void,
): ChatTransport {
  return {
    async sendMessages(request, signal) {
      const prepared = prepare(request);
      const { api, body } = prepared;

      const response = await authAwareFetch(api, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        credentials: "include",
        signal,
      });

      if (response.ok) onAccepted(request, prepared.accepted);

      return streamEvents(response);
    },
    async reconnectToStream(chatId, signal) {
      const response = await authAwareFetch(buildChatStreamUrl(chatId), {
        headers: { accept: "text/event-stream" },
        credentials: "include",
        signal,
      });

      return response.status === 204 ? null : streamEvents(response);
    },
  };
}
