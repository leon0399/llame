import { useQuery } from "@tanstack/react-query";

import { listProjects as listProjectsEndpoint } from "../../api/generated/projects/projects";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";

// Serializable-array key factory (TkDodo's "Effective React Query Keys"),
// same convention as chatQueryKeys / orgUnitsQueryKeys.
//
// `pinned`/`archived` filters are folded into the key so two views (Pinned
// section + All projects) cache independently, while lists()-prefix
// invalidation still catches both (create, rename, archive, delete, pin).
export type ProjectListFilters = {
  pinned?: "only" | "exclude";
  archived?: "only" | "with";
};

export const projectQueryKeys = {
  all: ["projects"] as const,
  lists: () => [...projectQueryKeys.all, "list"] as const,
  filtered: (filters?: ProjectListFilters) =>
    filters && (filters.pinned !== undefined || filters.archived !== undefined)
      ? ([...projectQueryKeys.lists(), filters] as const)
      : projectQueryKeys.lists(),
};

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

export const fetchProjects = (filters?: ProjectListFilters) => {
  return listProjectsEndpoint(filters, undefined, authenticatedFetch());
};

export function useProjectsQuery(filters?: ProjectListFilters) {
  return useQuery({
    queryKey: projectQueryKeys.filtered(filters),
    queryFn: () => fetchProjects(filters),
  });
}

/** @deprecated Use useProjectsQuery with explicit filters instead. */
export function useProjects() {
  return useProjectsQuery();
}
