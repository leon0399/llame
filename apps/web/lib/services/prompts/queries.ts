import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";

/**
 * Saved prompts — the user's reusable `/<name>` templates. The api owns storage
 * (owner-scoped); web reads/writes through /me/prompts. The SHARED query key is
 * read by BOTH the settings manager and the composer autocomplete, so a settings
 * edit invalidates the composer's list (one source of truth, no per-keystroke
 * refetch).
 */
export const PROMPT_NAME_MAX = 64;
export const PROMPT_CONTENT_MAX = 8000;

export type Prompt = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export const promptsQueryKeys = {
  all: ["me", "prompts"] as const,
};

export async function fetchPrompts(): Promise<Prompt[]> {
  return api.get(buildApiUrl("/api/v1/me/prompts")).json<Prompt[]>();
}

export async function createPrompt(input: {
  name: string;
  content: string;
}): Promise<Prompt> {
  return api
    .post(buildApiUrl("/api/v1/me/prompts"), { json: input })
    .json<Prompt>();
}

export async function updatePrompt(
  id: string,
  patch: { name?: string; content?: string },
): Promise<Prompt> {
  return api
    .patch(buildApiUrl(`/api/v1/me/prompts/${id}`), { json: patch })
    .json<Prompt>();
}

export async function deletePrompt(id: string): Promise<void> {
  await api.delete(buildApiUrl(`/api/v1/me/prompts/${id}`));
}

export const usePromptsQuery = () =>
  useQuery({ queryKey: promptsQueryKeys.all, queryFn: fetchPrompts });

const useInvalidatePrompts = () => {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: promptsQueryKeys.all });
};

export const useCreatePrompt = () => {
  const invalidate = useInvalidatePrompts();
  return useMutation({ mutationFn: createPrompt, onSuccess: invalidate });
};

export const useUpdatePrompt = () => {
  const invalidate = useInvalidatePrompts();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { name?: string; content?: string };
    }) => updatePrompt(id, patch),
    onSuccess: invalidate,
  });
};

export const useDeletePrompt = () => {
  const invalidate = useInvalidatePrompts();
  return useMutation({ mutationFn: deletePrompt, onSuccess: invalidate });
};
