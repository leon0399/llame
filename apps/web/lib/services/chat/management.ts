import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import { chatQueryKeys } from "./queries";

export type ChatVisibility = "private" | "public";

export async function setChatVisibility(
  id: string,
  visibility: ChatVisibility,
): Promise<void> {
  await api.patch(buildApiUrl(`/api/v1/chats/${id}`), { json: { visibility } });
}

export function useSetChatVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      visibility,
    }: {
      id: string;
      visibility: ChatVisibility;
    }) => setChatVisibility(id, visibility),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() }),
  });
}
