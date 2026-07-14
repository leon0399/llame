import { useQuery } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import type { ProjectResponse } from "./types";

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

export const fetchProjects = (filters?: ProjectListFilters) => {
  const searchParams: Record<string, string> = {};
  if (filters?.pinned !== undefined) searchParams.pinned = filters.pinned;
  if (filters?.archived !== undefined) searchParams.archived = filters.archived;
  const sp =
    Object.keys(searchParams).length > 0 ? { searchParams } : undefined;
  return api.get(buildApiUrl("/api/v1/projects"), sp).json<ProjectResponse[]>();
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
