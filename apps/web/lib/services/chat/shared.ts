import { api, buildApiUrl } from "../../api/client";

/**
 * Public read-only shared chat (api `@Public` `/shared/chats/:id`). The api
 * strips reasoning + identity — the client just renders text turns.
 */
export type SharedChatMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
  createdAt: string;
};

export type SharedChat = {
  id: string;
  title: string;
  messages: SharedChatMessage[];
};

export async function fetchSharedChat(id: string): Promise<SharedChat> {
  return api
    .get(buildApiUrl(`/api/v1/shared/chats/${id}`))
    .json<SharedChat>();
}
