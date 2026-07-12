import { useQuery } from "@tanstack/react-query";

import { api, buildApiUrl } from "../../api/client";
import type { ProjectResponse } from "./types";

// Serializable-array key factory (TkDodo's "Effective React Query Keys"),
// same convention as chatQueryKeys / orgUnitsQueryKeys.
export const projectQueryKeys = {
  all: ["projects"] as const,
  lists: () => [...projectQueryKeys.all, "list"] as const,
};

export const fetchProjects = () =>
  api.get(buildApiUrl("/api/v1/projects")).json<ProjectResponse[]>();

/** The caller's projects, newest-created first (server order — projects-repository.ts). */
export function useProjects() {
  return useQuery({
    queryKey: projectQueryKeys.lists(),
    queryFn: fetchProjects,
  });
}
