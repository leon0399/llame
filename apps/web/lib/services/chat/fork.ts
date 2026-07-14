import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import { toast } from "@workspace/ui/components/sonner";
import { chatQueryKeys, type ChatResponse } from "./queries";

/**
 * Fork a chat up to `fromMessageId` into a new chat (POST the forks
 * sub-collection). Omit `fromMessageId` to fork the WHOLE conversation
 * (clone) — the sidebar's "Fork" menu item, as opposed to the per-message
 * "fork from here" action.
 */
export function forkChat(
  chatId: string,
  fromMessageId?: string,
): Promise<ChatResponse> {
  return api
    .post(buildApiUrl(`/api/v1/chats/${chatId}/forks`), {
      // JSON.stringify drops an undefined property, so an omitted
      // fromMessageId reaches the API as an absent field, not `null`.
      json: { fromMessageId },
    })
    .json<ChatResponse>();
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
