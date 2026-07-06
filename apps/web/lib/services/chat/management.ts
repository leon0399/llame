import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HTTPError } from "ky";

import { api, buildApiUrl } from "../../api/client";
import { toast } from "@workspace/ui/components/sonner";
import { chatQueryKeys } from "./queries";

/**
 * Chat management — rename, pin, and hard-delete via the owner-scoped
 * PATCH/DELETE /chats/:id resource endpoints. The delete cascades the chat's
 * messages/runs. Mutations invalidate the chat list on success; a failure
 * (network / validation) surfaces a toast rather than failing silently.
 */
export async function renameChat(id: string, title: string): Promise<void> {
  await api.patch(buildApiUrl(`/api/v1/chats/${id}`), { json: { title } });
}

export function useRenameChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      renameChat(id, title),
    // lists() is a prefix of infinite() (the grouped list), so this
    // invalidates the sidebar history too.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() }),
    onError: () => toast.error("Couldn't rename the chat."),
  });
}

export async function setChatPinned(
  id: string,
  pinned: boolean,
): Promise<void> {
  await api.patch(buildApiUrl(`/api/v1/chats/${id}`), { json: { pinned } });
}

export function useSetChatPinned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      setChatPinned(id, pinned),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() }),
    onError: (_error, { pinned }) =>
      toast.error(
        pinned ? "Couldn't pin the chat." : "Couldn't unpin the chat.",
      ),
  });
}

export async function deleteChat(id: string): Promise<void> {
  try {
    await api.delete(buildApiUrl(`/api/v1/chats/${id}`));
  } catch (error) {
    // 404 = already gone (e.g. a double-click's second request). That IS the
    // desired end state, so treat delete as idempotent rather than erroring.
    if (error instanceof HTTPError && error.response.status === 404) return;
    throw error;
  }
}

export function useDeleteChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteChat(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() }),
    onError: () => toast.error("Couldn't delete the chat."),
  });
}

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
    onError: () => toast.error("Couldn't update sharing for this chat."),
  });
}
