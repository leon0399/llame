import { useMutation, useQueryClient } from "@tanstack/react-query";

import { forkChat as forkChatEndpoint } from "../../api/generated/chats/chats";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import { toast } from "@workspace/ui/components/sonner";
import { chatQueryKeys, type ChatResponse } from "./queries";

/**
 * Fork a chat up to `fromMessageId` into a new chat (POST the forks
 * sub-collection). Omit `fromMessageId` to fork the WHOLE conversation
 * (clone) — the sidebar's "Fork" menu item, as opposed to the per-message
 * "fork from here" action.
 */
export async function forkChat(
  chatId: string,
  fromMessageId?: string,
): Promise<ChatResponse> {
  const response = await forkChatEndpoint(
    chatId,
    { fromMessageId },
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
  return response;
}

export function useForkChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      chatId,
      fromMessageId,
    }: {
      chatId: string;
      fromMessageId?: string;
    }) => forkChat(chatId, fromMessageId),
    onSuccess: () => {
      // The new chat appears in the sidebar list.
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
    },
    onError: () => toast.error("Couldn't fork the chat. Nothing was created."),
  });
}
