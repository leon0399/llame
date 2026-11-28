"use client";

import { useState } from "react";

import { useProjectsQuery } from "@/lib/services/project/queries";
import type { ProjectResponse } from "@/lib/services/project/types";

/** The project a composer files its chat into, and the ways to change it. */
export type ComposerProject = {
  /** The owner's projects the row under the input offers. */
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
