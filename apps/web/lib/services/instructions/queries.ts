import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";

/**
 * Custom instructions — a user-scope config value the api merges into the chat
 * system prompt as a non-authoritative block. The api owns resolution; web only
 * reads/writes the raw text through this narrow endpoint.
 */
export const INSTRUCTIONS_MAX = 4000;

export type Instructions = { instructions: string };

export const instructionsQueryKeys = {
  all: ["me", "instructions"] as const,
};

export async function fetchInstructions(): Promise<Instructions> {
  return api.get(buildApiUrl("/api/v1/me/instructions")).json<Instructions>();
}

export async function updateInstructions(
  instructions: string,
): Promise<Instructions> {
  return api
    .put(buildApiUrl("/api/v1/me/instructions"), { json: { instructions } })
    .json<Instructions>();
}

export const useInstructionsQuery = () =>
  useQuery({
    queryKey: instructionsQueryKeys.all,
    queryFn: fetchInstructions,
  });

export const useUpdateInstructions = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateInstructions,
    onSuccess: (data) => {
      queryClient.setQueryData(instructionsQueryKeys.all, data);
    },
  });
};
