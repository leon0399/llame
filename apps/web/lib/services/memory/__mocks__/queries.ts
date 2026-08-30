import { fn } from "storybook/test";

import type { MemoryResponse } from "../../../api/generated/models";

/**
 * Re-declared rather than re-exported from `../queries`, and it has to stay
 * that way. `sb.mock` redirects that specifier to THIS module, so
 * `export { memoryQueryKeys } from "../queries"` resolves back to itself and
 * breaks the Storybook preview. `models/__mocks__/queries.ts` carries the same
 * duplication for the same reason — it is not an oversight to clean up.
 */
export const memoryQueryKeys = {
  all: ["memory"] as const,
  mine: () => [...memoryQueryKeys.all, "me"] as const,
};

export const fetchMemory = fn().mockName("fetchMemory");

export const refetchMemory = fn().mockName("refetchMemory");

export const useMemoryQuery = fn(
  () =>
    ({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: refetchMemory,
    }) satisfies {
      data: MemoryResponse | undefined;
      isPending: boolean;
      isError: boolean;
      refetch: typeof refetchMemory;
    },
).mockName("useMemoryQuery");
