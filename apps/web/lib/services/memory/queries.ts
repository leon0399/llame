import { useQuery } from "@tanstack/react-query";

import { getMemory } from "../../api/generated/memory/memory";
import type { MemoryResponse } from "../../api/generated/models";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

// Serializable-array key factory: generic resource → the caller's resource.
export const memoryQueryKeys = {
  all: ["memory"] as const,
  mine: () => [...memoryQueryKeys.all, "me"] as const,
};

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

export async function fetchMemory(): Promise<MemoryResponse> {
  return getMemory(undefined, authenticatedFetch());
}

/**
 * The caller's own memory settings. The API returns defaults for an owner with
 * no stored row, so the UI has no first-use branch.
 */
export function useMemoryQuery() {
  return useQuery({
    queryKey: memoryQueryKeys.mine(),
    queryFn: fetchMemory,
  });
}
