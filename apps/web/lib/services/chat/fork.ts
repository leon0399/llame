import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import { chatQueryKeys, type ChatResponse } from "./queries";

/** Fork a chat up to `fromMessageId` into a new chat (POST the forks sub-collection). */
export function forkChat(
  chatId: string,
  fromMessageId: string,
): Promise<ChatResponse> {
  return api
    .post(buildApiUrl(`/api/v1/chats/${chatId}/forks`), {
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
      fromMessageId: string;
    }) => forkChat(chatId, fromMessageId),
    onSuccess: () => {
      // The new chat appears in the sidebar list.
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
    },
  });
}
