import { authAwareFetch } from "../../../api/fetch";
import { buildChatStreamUrl, type PreparedChatRequest } from "../transport";
import type { ChatRequest, ChatTransport } from "./chat";
import { readAgUiEvents } from "./event-stream";

/** The events of an accepted stream response, or the api's refusal thrown as
 *  an error whose message is the response body (its error envelope). */
async function streamEvents(response: Response) {
  if (!response.ok) {
    throw new Error(
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
 */
export function createChatTransport(
  prepare: (request: ChatRequest) => PreparedChatRequest,
): ChatTransport {
  return {
    async sendMessages(request, signal) {
      const { api, body } = prepare(request);

      return streamEvents(
        await authAwareFetch(api, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: JSON.stringify(body),
          credentials: "include",
          signal,
        }),
      );
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
