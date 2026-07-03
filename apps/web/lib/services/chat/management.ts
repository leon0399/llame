import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HTTPError } from "ky";

import { api, buildApiUrl } from "../../api/client";
import { chatQueryKeys } from "./queries";

/**
 * Chat management — rename (PATCH) and hard-delete (DELETE). Both are
 * owner-scoped server-side (RLS + ownerUserId); the delete cascades the chat's
 * messages/runs/todos. Mutations invalidate the chat list on success.
 */
export async function renameChat(id: string, title: string): Promise<void> {
  await api.patch(buildApiUrl(`/api/v1/chats/${id}`), { json: { title } });
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

export function useRenameChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      renameChat(id, title),
    // lists() is a prefix of infinite() (the grouped list), so this
    // invalidates the sidebar history too.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() }),
  });
}

export function useDeleteChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteChat(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() }),
  });
}
