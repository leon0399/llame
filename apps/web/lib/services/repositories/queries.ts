import { useQuery } from "@tanstack/react-query";

import type { RepositoryResponse } from "../../api/generated/models";
import { listRepositories } from "../../api/generated/repositories/repositories";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

export type { RepositoryResponse };

// Serializable-array key factory: generic resource → the caller's resource.
export const repositoryQueryKeys = {
  all: ["repositories"] as const,
  list: () => [...repositoryQueryKeys.all, "list"] as const,
};

/**
 * The owner's repository catalog. A project links from this catalog, which
 * `POST /api/v1/checkouts` fills when it adopts a clone it has not seen.
 */
export async function fetchRepositories(): Promise<Array<RepositoryResponse>> {
  return listRepositories(
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
}

export function useRepositoriesQuery(enabled = true) {
  return useQuery({
    queryKey: repositoryQueryKeys.list(),
    queryFn: fetchRepositories,
    enabled,
  });
}
