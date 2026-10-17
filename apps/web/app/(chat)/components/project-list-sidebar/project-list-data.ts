"use client";

import { selectPinnedProjectMap, usePins } from "@/lib/services/pins/queries";
import { filterProjectsByName } from "@/lib/services/project/filter";
import {
  useProjectById,
  useProjectsQuery,
} from "@/lib/services/project/queries";

import {
  type ListShow,
  listViewFilters,
  PINNED_LIST_FILTERS,
  withOpenItem,
} from "../chat-list-view";

/** The projects rail's sections for a view, narrowed by the name filter. The
 *  open project's full card comes from the archive-inclusive list the project
 *  page itself reads, fetched only on a project's page. */
export function useProjectListData(
  show: ListShow,
  filter: string,
  openProjectId: string | undefined,
) {
  const { data: pinnedData, isLoading: pinnedLoading } =
    useProjectsQuery(PINNED_LIST_FILTERS);
  const { data: listData, isLoading: listLoading } = useProjectsQuery(
    listViewFilters(show),
  );
  const { project: open } = useProjectById(openProjectId);
  const { data: pins } = usePins();

  const pinned = show === "archived" ? [] : (pinnedData ?? []);
  const listed = withOpenItem(listData ?? [], open, pinned);
  return {
    pinnedProjects: filterProjectsByName(pinned, filter),
    listedProjects: filterProjectsByName(listed, filter),
    pinnedAtByProjectId: selectPinnedProjectMap(pins),
    hasData: pinned.length > 0 || listed.length > 0,
    // Pinned gates the first paint; a view switch reloads only the list.
    isLoading: pinnedLoading,
    listLoading,
  };
}
