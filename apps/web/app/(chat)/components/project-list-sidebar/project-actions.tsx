"use client";

import { useState } from "react";

import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@workspace/ui/components/dropdown-menu";
import {
  ArchiveIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  TrashIcon,
} from "lucide-react";

import { usePinItem, useUnpinItem } from "@/lib/services/pins/mutations";
import { useSetProjectArchive } from "@/lib/services/project/mutations";
import type { ProjectResponse } from "@/lib/services/project/types";
import {
  DeleteProjectDialog,
  EditProjectDialog,
} from "../chat-list-sidebar/project-dialogs";

/** The project's pin toggle through the unified pins resource (design
 *  D2/D5a); pinning synthesizes the rail's card from the project at hand. */
export function useProjectItemPin(project: ProjectResponse, isPinned: boolean) {
  const pinMutation = usePinItem();
  const unpinMutation = useUnpinItem();
  return () =>
    isPinned
      ? unpinMutation.mutate({ itemType: "project", itemId: project.id })
      : pinMutation.mutate({
          itemType: "project",
          itemId: project.id,
          card: {
            id: project.id,
            name: project.name,
            archivedAt: project.archivedAt,
          },
        });
}

/** The menu's own "danger zone" (archive toggle, then delete). It owns the
 *  archive mutation because both the label and the payload are read from the
 *  project's archive state. */
function ProjectLifecycleItems({
  project,
  onDelete,
}: {
  project: ProjectResponse;
  onDelete: () => void;
}) {
  const archiveMutation = useSetProjectArchive();
  const isArchived = project.archivedAt !== null;

  return (
    <DropdownMenuGroup>
      <DropdownMenuItem
        onSelect={() =>
          archiveMutation.mutate({ id: project.id, archived: !isArchived })
        }
      >
        <ArchiveIcon />
        <span>{isArchived ? "Unarchive" : "Archive"}</span>
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onSelect={onDelete}>
        <TrashIcon />
        <span>Delete</span>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

/** A project's "…" menu, the same wherever the project is shown (its list
 *  row, its page header). Grouped by action semantics with dividers,
 *  mirroring ChatItem's row menu: pin toggle → edit details → lifecycle
 *  (archive, then delete). */
export function ProjectMenuItems({
  project,
  isPinned,
  onTogglePin,
  onEdit,
  onDelete,
  align = "start",
}: {
  project: ProjectResponse;
  isPinned: boolean;
  onTogglePin: () => void;
  onEdit: () => void;
  onDelete: () => void;
  align?: "start" | "end";
}) {
  return (
    <DropdownMenuContent side="bottom" align={align}>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={onTogglePin}>
          {isPinned ? <PinOffIcon /> : <PinIcon />}
          <span>{isPinned ? "Unpin" : "Pin"}</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={onEdit}>
          <PencilIcon />
          <span>Edit details</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <ProjectLifecycleItems project={project} onDelete={onDelete} />
    </DropdownMenuContent>
  );
}

/** Open state for the menu's two dialogs. Opening defers a tick so the menu
 *  has closed and returned focus before the dialog takes it. */
export function useProjectDialogs() {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  return {
    editOpen,
    deleteOpen,
    setEditOpen,
    setDeleteOpen,
    openEdit: () => setTimeout(() => setEditOpen(true), 0),
    openDelete: () => setTimeout(() => setDeleteOpen(true), 0),
  };
}

/** The menu's two dialogs, mounted with their owner so each one's field
 *  state re-seeds from the project on open (see project-dialogs.tsx). A lean
 *  card (no `description`, as the rail's pinned rows hold) can still be
 *  deleted; Edit details waits for the full project. */
export function ProjectDialogs({
  project,
  dialogs,
  onDeleted,
}: {
  project: { id: string; name: string; description?: string | null };
  dialogs: ReturnType<typeof useProjectDialogs>;
  /** Follow-up once the project is gone (e.g. leave its page). */
  onDeleted?: () => void;
}) {
  const { description } = project;
  return (
    <>
      {description !== undefined && (
        <EditProjectDialog
          project={{ ...project, description }}
          open={dialogs.editOpen}
          onOpenChange={dialogs.setEditOpen}
        />
      )}
      <DeleteProjectDialog
        project={project}
        open={dialogs.deleteOpen}
        onOpenChange={dialogs.setDeleteOpen}
        onDeleted={onDeleted}
      />
    </>
  );
}
