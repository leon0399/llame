import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import { memoryQueryKeys } from "./queries";
import type { MemorySettings, MemorySettingsUpdate } from "./types";

export const memoryMutationKeys = {
  all: ["memory", "mutations"] as const,
  update: () => [...memoryMutationKeys.all, "update"] as const,
};

export async function updateMemory(
  input: MemorySettingsUpdate,
): Promise<MemorySettings> {
  return api
    .patch(buildApiUrl("/api/v1/me/memory"), { json: input })
    .json<MemorySettings>();
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
      const previous = queryClient.getQueryData<MemorySettings>(
        memoryQueryKeys.mine(),
      );
      if (previous) {
        queryClient.setQueryData<MemorySettings>(memoryQueryKeys.mine(), {
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
