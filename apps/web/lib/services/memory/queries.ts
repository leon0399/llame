import { useQuery } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import type { MemorySettings } from "./types";

// Serializable-array key factory: generic resource → the caller's resource.
export const memoryQueryKeys = {
  all: ["memory"] as const,
  mine: () => [...memoryQueryKeys.all, "me"] as const,
};

export async function fetchMemory(): Promise<MemorySettings> {
  return api.get(buildApiUrl("/api/v1/me/memory")).json<MemorySettings>();
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
