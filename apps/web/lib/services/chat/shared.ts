import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@workspace/ui/components/sonner";

import {
  forkSharedChat as forkSharedChatEndpoint,
  getSharedChat as getSharedChatEndpoint,
} from "../../api/generated/chats/chats";
import type {
  SharedChatMessageResponsePartsItem,
  SharedChatResponse,
} from "../../api/generated/models";
import {
  createAuthenticatedBrowserFetch,
  createOptionalAuthFetch,
} from "../../api/fetch";
import { chatQueryKeys, type ChatResponse } from "./queries";

/**
 * Public read-only shared chat (api `@Public` `/shared/chats/:id`). The api
 * strips reasoning + identity — the client just renders text turns. `seq` is
 * an opaque ordering integer (not identity), included so the page can page
 * through a long conversation with the same `beforeSeq` cursor idiom as the
 * owner chat history (see `paginateAllMessages` / `paginate-messages.ts`).
 */
export type SharedChatMessage = {
  id: string;
  seq: number;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
  createdAt: string;
};

export type SharedChat = {
  id: string;
  // null = untitled (server-side generation pending, #78); render a localized
  // placeholder client-side — same convention as the authenticated chat list.
  title: string | null;
  messages: Array<SharedChatMessage>;
};

export async function fetchSharedChat(
  id: string,
  options?: { limit?: number; beforeSeq?: number },
): Promise<SharedChat> {
  const response = await getSharedChatEndpoint(
    id,
    options,
    undefined,
    createOptionalAuthFetch(globalThis.fetch),
  );
  return normalizeSharedChat(response);
}

/**
 * Fork a public chat into a new chat the CALLER owns (POST the shared
 * chat's `forks` sub-collection) — continues a shared conversation in the
 * visitor's own account. Auth-required at the api; a 401 here means the
 * visitor isn't signed in (the page gates the button on `useMeOptional`
 * before this is ever called).
 */
export async function forkSharedChat(id: string): Promise<ChatResponse> {
  const response = await forkSharedChatEndpoint(
    id,
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
  return response;
}

function normalizeSharedChat(response: SharedChatResponse): SharedChat {
  return {
    id: response.id,
    title: response.title,
    messages: response.messages.map((message) => ({
      id: message.id,
      seq: message.seq,
      role: message.role,
      parts: message.parts.filter(isTextPart),
      createdAt: message.createdAt,
    })),
  };
}

function isTextPart(
  part: SharedChatMessageResponsePartsItem,
): part is { type: "text"; text: string } {
  return part.type === "text" && typeof part.text === "string";
}

export function useForkSharedChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => forkSharedChat(id),
    // The new chat appears in the caller's OWN sidebar list — same
    // invalidation useForkChat does for the owner-scoped fork.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() }),
    onError: () => toast.error("Couldn't fork this chat. Nothing was created."),
  });
}
