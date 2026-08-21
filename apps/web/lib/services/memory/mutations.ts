import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateMemory as updateMemoryEndpoint } from "../../api/generated/memory/memory";
import type {
  MemoryResponse,
  UpdateMemoryDto,
} from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import { memoryQueryKeys } from "./queries";

export const memoryMutationKeys = {
  all: ["memory", "mutations"] as const,
  update: () => [...memoryMutationKeys.all, "update"] as const,
};

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

export async function updateMemory(
  input: UpdateMemoryDto,
): Promise<MemoryResponse> {
  return updateMemoryEndpoint(input, undefined, authenticatedFetch());
}

/**
 * The next value is fully client-computable, so the switch may update
 * optimistically. Preserve the documented mutation discipline: cancel →
 * snapshot → patch → rollback on error → always invalidate on settle.
 */
export function useUpdateMemoryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: memoryMutationKeys.update(),
    // Only memory controls share this lane. A shared personalization scope
    // would serialize unrelated settings; no scope would race rapid clicks.
    scope: { id: "memory" },
    mutationFn: updateMemory,
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: memoryQueryKeys.mine() });
      const previous = queryClient.getQueryData<MemoryResponse>(
        memoryQueryKeys.mine(),
      );
      if (previous) {
        queryClient.setQueryData<MemoryResponse>(memoryQueryKeys.mine(), {
          ...previous,
          ...input,
        });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(memoryQueryKeys.mine(), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: memoryQueryKeys.mine() });
    },
  });
}
