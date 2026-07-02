import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";

/**
 * BYOK provider accounts (#18). The api owns the credential vault; web never
 * sees a secret — the API key is write-only on create and absent from every
 * response (mirrors the api's egress allowlist).
 */
export type ProviderType =
  | "openai_compatible"
  | "openrouter"
  | "anthropic"
  | "google_gemini"
  | "aws_bedrock"
  | "ollama"
  | "custom_http";

export type ProviderAccount = {
  id: string;
  providerType: ProviderType;
  displayName: string;
  authMode: string;
  baseUrl: string | null;
  defaultModel: string | null;
  enabled: boolean;
  createdAt: string;
};

export type CreateProviderAccountInput = {
  providerType: ProviderType;
  displayName: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
};

export const providerQueryKeys = {
  all: ["provider-accounts"] as const,
  lists: () => [...providerQueryKeys.all, "list"] as const,
};

export async function fetchProviderAccounts(): Promise<ProviderAccount[]> {
  return api
    .get(buildApiUrl("/api/v1/provider-accounts"))
    .json<ProviderAccount[]>();
}

export async function createProviderAccount(
  input: CreateProviderAccountInput,
): Promise<ProviderAccount> {
  return api
    .post(buildApiUrl("/api/v1/provider-accounts"), { json: input })
    .json<ProviderAccount>();
}

export async function deleteProviderAccount(id: string): Promise<void> {
  await api.delete(buildApiUrl(`/api/v1/provider-accounts/${id}`));
}

export const useProviderAccountsQuery = () =>
  useQuery({
    queryKey: providerQueryKeys.lists(),
    queryFn: fetchProviderAccounts,
  });

export const useCreateProviderAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProviderAccount,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: providerQueryKeys.lists(),
      });
    },
  });
};

export const useDeleteProviderAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProviderAccount,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: providerQueryKeys.lists(),
      });
    },
  });
};
