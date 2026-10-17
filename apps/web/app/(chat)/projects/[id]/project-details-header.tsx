"use client";

import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { MoreVerticalIcon, PinIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { IconButtonTooltip } from "@/components/icon-button-tooltip";
import { ArchivedBadge } from "@/components/archived-badge";
import type { ProjectResponse } from "@/lib/services/project/types";

import {
  ProjectDialogs,
  ProjectMenuItems,
  useProjectDialogs,
  useProjectItemPin,
} from "../../components/project-list-sidebar/project-actions";

/** The pin toggle beside the title: a filled pin while the project is
 *  pinned, an outline one while it is not. */
function ProjectPinToggle({
  isPinned,
  onToggle,
}: {
  isPinned: boolean;
  onToggle: () => void;
}) {
  const label = isPinned ? "Unpin" : "Pin";
  return (
    <IconButtonTooltip label={label} onClick={onToggle} aria-pressed={isPinned}>
      <PinIcon className={cn(isPinned && "fill-current")} />
    </IconButtonTooltip>
  );
}

/** The project's name, archive state and description. */
function ProjectDetailsTitle({ project }: { project: ProjectResponse }) {
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight break-words">
          {project.name}
        </h1>
        {project.archivedAt !== null && <ArchivedBadge />}
      </div>
      {project.description && (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {project.description}
        </p>
      )}
    </div>
  );
}

/**
 * The project page's own header, inside the page content: the project's name
 * and description, with its pin toggle and the same "…" menu its list row
 * carries. Deleting the project from here leaves for the projects list. A
 * plain block rather than a `<header>`: the shell's top bar is the page's one
 * banner landmark.
 */
export function ProjectDetailsHeader({
  project,
  isPinned,
}: {
  project: ProjectResponse;
  isPinned: boolean;
}) {
  const router = useRouter();
  const togglePin = useProjectItemPin(project, isPinned);
  const dialogs = useProjectDialogs();

  return (
    <div className="flex items-start gap-4">
      <ProjectDetailsTitle project={project} />
      <div className="flex shrink-0 items-center gap-1">
        <ProjectPinToggle isPinned={isPinned} onToggle={togglePin} />
        <DropdownMenu modal={true}>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
            <MoreVerticalIcon />
            <span className="sr-only">More</span>
          </DropdownMenuTrigger>
          <ProjectMenuItems
            project={project}
            isPinned={isPinned}
            onTogglePin={togglePin}
            onEdit={dialogs.openEdit}
            onDelete={dialogs.openDelete}
            align="end"
          />
        </DropdownMenu>
      </div>
      <ProjectDialogs
        project={project}
        dialogs={dialogs}
        onDeleted={() => router.push("/projects")}
      />
    </div>
  );
}
