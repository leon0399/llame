import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HTTPError } from "ky";

import { api, buildApiUrl } from "../../api/client";
import { toast } from "@workspace/ui/components/sonner";
import { pinQueryKeys } from "../pins/queries";
import { chatQueryKeys } from "./queries";

/**
 * Chat management — rename and hard-delete via the owner-scoped
 * PATCH/DELETE /chats/:id resource endpoints. The delete cascades the chat's
 * messages/runs. Mutations invalidate the chat list on success; a failure
 * (network / validation) surfaces a toast rather than failing silently.
 *
 * Pinning is NOT here — it moved to the unified /api/v1/pins resource
 * (lib/services/pins/mutations.ts, rework-item-pinning). Rename/delete still
 * invalidate the pins list (design D5a): a pinned chat's title changing, or
 * the chat vanishing, must be reflected the next time the rail/list reads
 * GET /pins — the pins cache holds its own denormalized copy of the title.
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: pinQueryKeys.list() });
    },
    onError: () => toast.error("Couldn't rename the chat."),
  });
}

export async function setChatArchive(
  id: string,
  archived: boolean,
): Promise<void> {
  await api.patch(buildApiUrl(`/api/v1/chats/${id}`), { json: { archived } });
}

export function useSetChatArchive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      setChatArchive(id, archived),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: pinQueryKeys.list() });
    },
    onError: (_err, { archived }) =>
      toast.error(
        archived
          ? "Couldn't archive the chat."
          : "Couldn't unarchive the chat.",
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: pinQueryKeys.list() });
    },
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
