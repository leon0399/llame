import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import { toast } from "@workspace/ui/components/sonner";
import { chatQueryKeys } from "../chat/queries";
import { projectQueryKeys } from "./queries";
import type { ProjectResponse } from "./types";

/**
 * Project management — owner-scoped CRUD via POST/PATCH/DELETE
 * /api/v1/projects(/:id), mirroring ../chat/management.ts's shape (folders-only,
 * no membership/sharing here — SPEC's projects-foundation slice). Mutations
 * invalidate the project list on success; a failure surfaces a toast rather
 * than failing silently.
 */
export async function createProject(name: string): Promise<ProjectResponse> {
  return api
    .post(buildApiUrl("/api/v1/projects"), { json: { name } })
    .json<ProjectResponse>();
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: projectQueryKeys.lists() }),
    onError: () => toast.error("Couldn't create the project."),
  });
}

export async function updateProject(
  id: string,
  name: string,
): Promise<ProjectResponse> {
  return api
    .patch(buildApiUrl(`/api/v1/projects/${id}`), { json: { name } })
    .json<ProjectResponse>();
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updateProject(id, name),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: projectQueryKeys.lists() }),
    onError: () => toast.error("Couldn't rename the project."),
  });
}

export async function deleteProject(id: string): Promise<void> {
  await api.delete(buildApiUrl(`/api/v1/projects/${id}`));
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectQueryKeys.lists() });
      // Deleting a project unfiles its chats server-side (ON DELETE SET
      // NULL — projects-repository.ts) rather than deleting them — refresh
      // the chat list too, so they reappear under the unfiled/time-grouped
      // sidebar list instead of looking like they vanished.
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
    },
    onError: () => toast.error("Couldn't delete the project."),
  });
}

/**
 * File/unfile a chat via the chats resource (PATCH /api/v1/chats/:id
 * { projectId }) — a uuid files the chat into that project, null unfiles it.
 */
export async function fileChat(
  chatId: string,
  projectId: string | null,
): Promise<void> {
  await api.patch(buildApiUrl(`/api/v1/chats/${chatId}`), {
    json: { projectId },
  });
}

export function useFileChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      chatId,
      projectId,
    }: {
      chatId: string;
      projectId: string | null;
    }) => fileChat(chatId, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectQueryKeys.lists() });
    },
    onError: (_error, { projectId }) =>
      toast.error(
        projectId
          ? "Couldn't move the chat."
          : "Couldn't remove the chat from its project.",
      ),
  });
}
