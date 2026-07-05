import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";

/**
 * Personal memories — durable facts the assistant remembers about the user.
 * `source='user'` memories (added here) are auto-injected into chats; `agent`
 * memories (saved by the assistant) are recall-only. The api owns storage; web
 * reads/writes through this narrow /me/memories surface.
 */
export const MEMORY_CONTENT_MAX = 2000;

export type MemorySource = "user" | "agent";

export type Memory = {
  id: string;
  content: string;
  source: MemorySource;
  createdAt: string;
};

export const memoriesQueryKeys = {
  all: ["me", "memories"] as const,
};

export async function fetchMemories(): Promise<Memory[]> {
  return api.get(buildApiUrl("/api/v1/me/memories")).json<Memory[]>();
}

export async function createMemory(content: string): Promise<Memory> {
  return api
    .post(buildApiUrl("/api/v1/me/memories"), { json: { content } })
    .json<Memory>();
}

export async function deleteMemory(id: string): Promise<void> {
  await api.delete(buildApiUrl(`/api/v1/me/memories/${id}`));
}

export const useMemoriesQuery = () =>
  useQuery({ queryKey: memoriesQueryKeys.all, queryFn: fetchMemories });

export const useCreateMemory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMemory,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: memoriesQueryKeys.all }),
  });
};

export const useDeleteMemory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMemory,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: memoriesQueryKeys.all }),
  });
};
