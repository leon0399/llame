"use client";

import { PlusIcon } from "lucide-react";

import {
  ProjectSearchItems,
  SearchList,
  SearchListAction,
} from "@/components/search-list";

/**
 * Choosing a project, wherever a chat is filed: "No project" first, the
 * owner's projects with the current one checked, and "New project" last.
 * The same list in the chat menu's "Add to project" and the composer's
 * project picker. The caller closes its popup in `onSelect` and
 * `onNewProject`.
 */
export function ProjectSelect({
  projects,
  selectedId,
  onSelect,
  onNewProject,
}: {
  projects: ReadonlyArray<{ id: string; name: string }>;
  selectedId: string | null;
  onSelect: (projectId: string | null) => void;
  /** Opens the caller's new-project dialog; absent, the entry is shown
   *  disabled. */
  onNewProject?: () => void;
}) {
  return (
    <SearchList
      placeholder="Search projects…"
      first={
        <SearchListAction
          position="first"
          label="No project"
          checked={selectedId === null}
          onSelect={() => onSelect(null)}
        />
      }
      last={
        <SearchListAction
          position="last"
          label="New project"
          icon={<PlusIcon />}
          disabled={onNewProject === undefined}
          onSelect={() => onNewProject?.()}
        />
      }
    >
      <ProjectSearchItems
        projects={projects}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </SearchList>
  );
}
