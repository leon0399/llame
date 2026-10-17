"use client";

import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import type { DragControls } from "framer-motion";
import {
  ArchiveIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PinOffIcon,
  TrashIcon,
} from "lucide-react";

import { HoverReveal, SidebarRowAction } from "@/components/hover-reveal";

/** One pinned row's painted line: the hover/active fill, the focus ring, and
 *  the `menu-item` scope its hover reveals and title fade key off. A plain
 *  div inside the `<li>`, so an expanded project's chat list sits below the
 *  line without sharing its hover. */
export function PinRowSurface({ children }: { children: ReactNode }) {
  return (
    <div
      data-sidebar="menu-item"
      className="group/menu-item relative flex items-center rounded-md pr-1 hover:bg-sidebar-accent has-data-active:bg-sidebar-accent has-[a:focus-visible]:inset-ring-2 has-[a:focus-visible]:inset-ring-sidebar-ring"
    >
      {children}
    </div>
  );
}

/** Trailing drag handle — same HoverReveal expand as other row actions. */
export function PinDragHandle({
  dragControls,
}: {
  dragControls: DragControls;
}) {
  return (
    <HoverReveal>
      <SidebarRowAction
        aria-label="Drag to reorder"
        className="cursor-grab active:cursor-grabbing"
        onPointerDown={(event) => {
          event.preventDefault();
          dragControls.start(event);
        }}
      >
        <GripVerticalIcon />
      </SidebarRowAction>
    </HoverReveal>
  );
}

// Every rail row here is, by construction, pinned (it only exists because
// it's in the pins list) — so the row's action controls are the drag handle
// and the "…" kebab (no separate hover pin/unpin button, unlike
// ChatItem/ProjectItem's list rows), and its toggle item is always "Unpin",
// never "Pin". The menu is grouped by action semantics exactly like its
// list-row counterpart: pin toggle → rename → lifecycle (archive, then
// delete). It's necessarily a SUBSET of the list row's menu — the rail holds
// only the lean RefCard (`{id,title|null}` / `{id,name}`), not the full
// chat/project, so data-heavy chat actions (Move to project, Share, Export,
// Fork) have no data to act on here and are deliberately omitted rather than
// faked.

/** The row's one edit action: Rename for a chat, Edit details for a
 *  project. */
type PinRowEditAction = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
};

type PinRowMenuProps = {
  isActive: boolean;
  onUnpin: () => void;
  edit: PinRowEditAction;
  isArchived: boolean;
  onToggleArchive: () => void;
  onDelete: () => void;
};

/** The lifecycle group (archive toggle, then delete) — the menu's own
 *  "danger zone", split out from the pin/rename actions above it. */
function PinRowLifecycleGroup({
  isArchived,
  onToggleArchive,
  onDelete,
}: {
  isArchived: boolean;
  onToggleArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem onSelect={onToggleArchive}>
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

/** The kebab menu shape both row types share (Unpin → edit → Archive/
 *  Delete) — split out so each row composes only its own label and dialogs. */
export function PinRowMenu({
  isActive,
  onUnpin,
  edit,
  isArchived,
  onToggleArchive,
  onDelete,
}: PinRowMenuProps) {
  return (
    <DropdownMenu modal={true}>
      <HoverReveal atRest={isActive}>
        <DropdownMenuTrigger render={<SidebarRowAction />}>
          <MoreHorizontalIcon />
          <span className="sr-only">More</span>
        </DropdownMenuTrigger>
      </HoverReveal>
      <DropdownMenuContent side="bottom" align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onUnpin}>
            <PinOffIcon />
            <span>Unpin</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={edit.onSelect}>
            {edit.icon}
            <span>{edit.label}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <PinRowLifecycleGroup
          isArchived={isArchived}
          onToggleArchive={onToggleArchive}
          onDelete={onDelete}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
