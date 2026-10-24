import {
  useQuery,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import { z } from "zod";

import {
  getProject,
  listProjectRepositories,
  listProjects as listProjectsEndpoint,
} from "../../api/generated/projects/projects";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import type { ProjectRepositoryLink } from "./types";

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
  detail: (id: string) => [...projectQueryKeys.all, "detail", id] as const,
  // The link prefix is its own scope so a link write can refresh one project's
  // links without touching detail reads.
  repositoryLinks: () => [...projectQueryKeys.all, "link"] as const,
  links: (id: string) => [...projectQueryKeys.repositoryLinks(), id] as const,
};

const projectListFiltersSchema = z.object({
  pinned: z.enum(["only", "exclude"]).optional(),
  archived: z.enum(["only", "with"]).optional(),
});

/** The filters of a `projectQueryKeys.filtered` key; `undefined` for any other key. */
export function projectListFiltersFromKey(
  queryKey: QueryKey,
): ProjectListFilters | undefined {
  if (queryKey[0] !== "projects" || queryKey[1] !== "list") return undefined;
  return projectListFiltersSchema.safeParse(queryKey[2]).data ?? {};
}

function authenticatedFetch(): typeof fetch {
  return createAuthenticatedBrowserFetch(globalThis.fetch);
}

export const fetchProjects = (filters?: ProjectListFilters) => {
  return listProjectsEndpoint(filters, undefined, authenticatedFetch());
};

export function useProjectsQuery(filters?: ProjectListFilters, enabled = true) {
  return useQuery({
    queryKey: projectQueryKeys.filtered(filters),
    queryFn: () => fetchProjects(filters),
    enabled,
  });
}

/** One project from the archive-inclusive list (so archiving it keeps it
 *  found), plus the list itself for callers that offer the others. */
export function useProjectById(id: string | undefined, enabled = true) {
  const { data: projects, isLoading } = useProjectsQuery(
    { archived: "with" },
    enabled && id !== undefined,
  );
  return {
    projects,
    isLoading,
    project: projects?.find((candidate) => candidate.id === id),
  };
}

/** @deprecated Use useProjectsQuery with explicit filters instead. */
export function useProjects() {
  return useProjectsQuery();
}

/**
 * One project in full, for an edit surface that only holds a lean card (the
 * rail's pinned rows carry no description): read once each time it is
 * enabled (each time the dialog opens), even while an observer keeps the
 * last copy cached; `isFetching` tells the caller that copy may be stale.
 * Focus and reconnect do not refetch it, so an open form is never withdrawn.
 */
export function useProjectQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: projectQueryKeys.detail(id),
    queryFn: ({ signal }) => getProject(id, { signal }, authenticatedFetch()),
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * Every repository the project links, each with the alias, primary flag, and
 * isolation policy the project owns. The project page's Repositories section
 * is this read's only consumer.
 */
export async function fetchProjectRepositoryLinks(
  projectId: string,
): Promise<Array<ProjectRepositoryLink>> {
  return listProjectRepositories(projectId, undefined, authenticatedFetch());
}

/** The state a link-list reader holds: pending, failed, or one project's links. */
export type ProjectRepositoryLinksQuery = UseQueryResult<
  Array<ProjectRepositoryLink>
>;

export function useProjectRepositoryLinksQuery(
  projectId: string,
  enabled = true,
): ProjectRepositoryLinksQuery {
  return useQuery({
    queryKey: projectQueryKeys.links(projectId),
    queryFn: () => fetchProjectRepositoryLinks(projectId),
    enabled,
  });
}
