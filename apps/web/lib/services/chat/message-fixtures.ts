import type { ChatMessageResponse } from "./history";

/**
 * Test-support factory for the raw api-shaped chat message row (the
 * `GET /chats/:id/messages` wire shape). Owns the 9-field boilerplate so
 * suites state only what they assert on. Not imported by production code.
 */
export function rawChatMessage(
  overrides: Partial<ChatMessageResponse> &
    Pick<ChatMessageResponse, "id" | "seq">,
): ChatMessageResponse {
  return {
    chatId: "chat-1",
    role: "assistant",
    senderUserId: null,
    parts: [],
    attachments: [],
    usage: null,
    inReplyTo: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
