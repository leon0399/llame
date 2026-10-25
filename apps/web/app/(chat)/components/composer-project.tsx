"use client";

import { useState } from "react";
import { FolderIcon, FolderPlusIcon, XIcon } from "lucide-react";

import { ButtonGroup } from "@workspace/ui/components/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";

import { filterProjectsByName } from "@/lib/services/project/filter";
import { useProjectsQuery } from "@/lib/services/project/queries";
import type { ProjectResponse } from "@/lib/services/project/types";

import {
  ProjectRadioList,
  ProjectSearchFilter,
} from "./chat-list-sidebar/chat-item-menu";
import { ComposerTooltip } from "./composer-tooltip";
import { PromptInputButton } from "./prompt-input";

/** The project a composer files its chat into, and the ways to change it. */
export type ComposerProject = {
  /** The owner's projects the `+` menu offers. */
  projects: Array<ProjectResponse>;
  /** The chosen project, or null for an unfiled chat. */
  selected: Pick<ProjectResponse, "id" | "name"> | null;
  /** A project id files the chat there; null leaves it unfiled. */
  onSelect: (projectId: string | null) => void;
  /** The page fixes the project (the project page): shown, not changeable. */
  locked?: boolean;
};

export type ChatPageProject = {
  /** The draft's project chip, or undefined for a chat that already exists:
   *  the sidebar's "Move to project" files an existing chat. */
  project: ComposerProject | undefined;
  /** The project a not-yet-created chat will be filed into, or null. */
  draftProjectId: string | null;
};

/**
 * The chat page's project. A chat with no message yet does not exist to file,
 * so the choice is held here and the first send creates the chat in that
 * project. A chat that exists reads nothing and offers no chip.
 */
export function useChatPageProject(exists: boolean): ChatPageProject {
  const projects = useProjectsQuery(undefined, !exists).data ?? [];
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  if (exists) return { project: undefined, draftProjectId: null };
  return {
    project: {
      projects,
      selected: projects.find((row) => row.id === draftProjectId) ?? null,
      onSelect: setDraftProjectId,
    },
    draftProjectId,
  };
}

/** The owner's projects as one filtered radio list. Re-picking the chosen
 *  project removes it, as the sidebar's "Move to project" does. */
function ProjectPickerItems({ project }: { project: ComposerProject }) {
  const [filter, setFilter] = useState("");
  return (
    <>
      {project.projects.length > 0 && (
        <ProjectSearchFilter value={filter} onChange={setFilter} />
      )}
      <ProjectRadioList
        chat={{ projectId: project.selected?.id ?? null }}
        allProjects={project.projects}
        filteredProjects={filterProjectsByName(project.projects, filter)}
        onFile={project.onSelect}
      />
    </>
  );
}

/** The `+` menu's "Add to project" submenu. */
export function ComposerProjectSubmenu({
  project,
}: {
  project: ComposerProject;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={project.locked}>
        <FolderPlusIcon />
        <span>
          {project.selected === null ? "Add to project" : "Change project"}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="w-56">
          <ProjectPickerItems project={project} />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

/** The chip where the page fixes the project: present, but not a control. */
function LockedProjectChip({ name }: { name: string }) {
  return (
    <PromptInputButton
      variant="secondary"
      size="default"
      disabled
      aria-label={`Project ${name}`}
    >
      <FolderIcon aria-hidden className="size-4" />
      <span className="max-w-32 truncate font-normal">{name}</span>
    </PromptInputButton>
  );
}

/** The chip's remove cell: only this control leaves the chat unfiled. */
export function ChipRemoveButton({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <ComposerTooltip
      label={label}
      render={
        <PromptInputButton
          variant="secondary"
          size="icon"
          aria-label={label}
          onClick={onRemove}
        />
      }
    >
      <XIcon aria-hidden className="size-4" />
    </ComposerTooltip>
  );
}

/**
 * The filled chip beside `+` while the chat is filed: the project's name opens
 * the project list to change it, and the joined × removes it. Where the page
 * fixes the project, the chip is disabled.
 */
export function ComposerProjectChip({ project }: { project: ComposerProject }) {
  const selected = project.selected;
  if (selected === null) return null;
  if (project.locked === true)
    return <LockedProjectChip name={selected.name} />;
  return (
    <ButtonGroup>
      <DropdownMenu>
        <ComposerTooltip
          label="Project"
          render={
            <DropdownMenuTrigger
              render={
                <PromptInputButton
                  variant="secondary"
                  size="default"
                  aria-label={`Project ${selected.name}`}
                />
              }
            />
          }
        >
          <FolderIcon aria-hidden className="size-4" />
          <span className="max-w-32 truncate font-normal">{selected.name}</span>
        </ComposerTooltip>
        <DropdownMenuContent align="start" className="w-56">
          <ProjectPickerItems project={project} />
        </DropdownMenuContent>
      </DropdownMenu>
      <ChipRemoveButton
        label={`Remove from project ${selected.name}`}
        onRemove={() => project.onSelect(null)}
      />
    </ButtonGroup>
  );
}
