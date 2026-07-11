import type { ProjectResponse } from "./types";

/**
 * Case-insensitive project-name filter — the ONE filter semantics shared by
 * the chat menu's project submenu and the projects rail (so a future change,
 * e.g. accent-insensitive compare, lands in both at once).
 */
export function filterProjectsByName(
  projects: ProjectResponse[],
  query: string,
): ProjectResponse[] {
  const filterQuery = query.trim().toLowerCase();
  if (filterQuery === "") return projects;
  return projects.filter((project) =>
    project.name.toLowerCase().includes(filterQuery),
  );
}
