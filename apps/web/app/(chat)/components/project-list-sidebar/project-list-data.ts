"use client";

import { useMemo } from "react";

import { selectPinnedProjectMap, usePins } from "@/lib/services/pins/queries";
import { filterProjectsByName } from "@/lib/services/project/filter";
import {
  type ProjectListFilters,
  useProjectsQuery,
} from "@/lib/services/project/queries";
import type { ProjectResponse } from "@/lib/services/project/types";

import { archivedFilter, type ListShow } from "../chat-list-view";

/** The view's list, as on the chats rail: Active and All sit below a Pinned
 *  section, so they exclude pins; Archived has no Pinned section and lists
 *  archived pins too. */
function projectListFilters(show: ListShow): ProjectListFilters {
  if (show === "archived") return { archived: "only" };
  return { pinned: "exclude", archived: archivedFilter(show) };
}

/**
 * The open project is always listed, whatever the view — the chats rail's
 * rule: archiving it from its page, or opening an archived one by link,
 * never makes its row vanish. It slots into `updatedAt` order and leaves on
 * navigation.
 */
function withOpenProject(
  projects: Array<ProjectResponse>,
  open: ProjectResponse | undefined,
  shownElsewhere: ReadonlyArray<ProjectResponse>,
): Array<ProjectResponse> {
  if (!open) return projects;
  const listed = (project: ProjectResponse) => project.id === open.id;
  if (projects.some(listed) || shownElsewhere.some(listed)) return projects;
  return [...projects, open].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** The open project's full card, from the archive-inclusive list the
 *  project page itself reads; only fetched on a project's page. */
function useOpenProject(openProjectId: string | undefined) {
  const { data } = useProjectsQuery(
    { archived: "with" },
    openProjectId !== undefined,
  );
  return data?.find((project) => project.id === openProjectId);
}

/** The projects rail's sections for a view, narrowed by the name filter. */
export function useProjectListData(
  show: ListShow,
  filter: string,
  openProjectId: string | undefined,
) {
  const { data: pinnedData, isLoading: pinnedLoading } = useProjectsQuery({
    pinned: "only",
    archived: "with",
  });
  const { data: listData, isLoading: listLoading } = useProjectsQuery(
    projectListFilters(show),
  );
  const open = useOpenProject(openProjectId);
  const { data: pins } = usePins();

  return useMemo(() => {
    const pinned = show === "archived" ? [] : (pinnedData ?? []);
    const listed = withOpenProject(listData ?? [], open, pinned);
    return {
      pinnedProjects: filterProjectsByName(pinned, filter),
      listedProjects: filterProjectsByName(listed, filter),
      pinnedIds: selectPinnedProjectMap(pins),
      hasData: pinned.length > 0 || listed.length > 0,
      // Pinned gates the first paint; a view switch reloads only the list.
      isLoading: pinnedLoading,
      listLoading,
    };
  }, [
    show,
    pinnedData,
    listData,
    open,
    pins,
    filter,
    pinnedLoading,
    listLoading,
  ]);
}
