"use client";

import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Button } from "@workspace/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  ArchiveIcon,
  FolderIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  PenLineIcon,
  PinIcon,
  PinOffIcon,
  TrashIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ArchivedBadge } from "@/components/archived-badge";
import { PinButton } from "@/components/pin-button";
import { SearchFilterInput } from "@/components/search-filter-input";
import { HoverReveal, SidebarRowAction } from "@/components/hover-reveal";
import { SidebarRowTitle } from "@/components/sidebar-row-title";
import { usePinItem, useUnpinItem } from "@/lib/services/pins/mutations";
import { useSetProjectArchive } from "@/lib/services/project/mutations";
import { filterProjectsByName } from "@/lib/services/project/filter";
import { useProjectsQuery } from "@/lib/services/project/queries";
import type { ProjectResponse } from "@/lib/services/project/types";
import { SidebarRowSkeletons } from "../sidebar-row-skeletons";
import { topBarClasses } from "@/app/shell/top-bar";
import {
  DeleteProjectDialog,
  NewProjectDialog,
  RenameProjectDialog,
} from "../chat-list-sidebar/project-dialogs";

function useProjectItemPin(project: ProjectResponse, isPinned: boolean) {
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

type ProjectRowMenuItemsProps = {
  project: ProjectResponse;
  isPinned: boolean;
  onTogglePin: () => void;
  onRename: () => void;
  onDelete: () => void;
  onArchiveToggle: () => void;
};

// Grouped by action semantics with dividers, mirroring ChatItem's row menu:
// pin toggle → rename → lifecycle (archive, then delete).
function ProjectRowMenuItems({
  project,
  isPinned,
  onTogglePin,
  onRename,
  onDelete,
  onArchiveToggle,
}: ProjectRowMenuItemsProps) {
  return (
    <DropdownMenuContent side="bottom" align="start">
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={onTogglePin}>
          {isPinned ? <PinOffIcon /> : <PinIcon />}
          <span>{isPinned ? "Unpin" : "Pin"}</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={onRename}>
          <PenLineIcon />
          <span>Rename</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={onArchiveToggle}>
          <ArchiveIcon />
          <span>{project.archivedAt === null ? "Archive" : "Unarchive"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <TrashIcon />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}

function ProjectRowMenu({
  project,
  isActive,
  isPinned,
  onTogglePin,
  onRename,
  onDelete,
}: {
  project: ProjectResponse;
  isActive: boolean;
  isPinned: boolean;
  onTogglePin: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const archiveMutation = useSetProjectArchive();

  return (
    <DropdownMenu modal={true}>
      <HoverReveal atRest={isActive}>
        <DropdownMenuTrigger render={<SidebarRowAction />}>
          <MoreHorizontalIcon />
          <span className="sr-only">More</span>
        </DropdownMenuTrigger>
      </HoverReveal>
      <ProjectRowMenuItems
        project={project}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
        onRename={onRename}
        onDelete={onDelete}
        onArchiveToggle={() =>
          archiveMutation.mutate({
            id: project.id,
            archived: project.archivedAt === null,
          })
        }
      />
    </DropdownMenu>
  );
}

function ProjectRowLabel({
  project,
  isActive,
  isArchived,
}: {
  project: ProjectResponse;
  isActive: boolean;
  isArchived: boolean;
}) {
  return (
    <SidebarMenuButton
      className="min-w-0 flex-1 hover:bg-transparent focus-visible:ring-0 active:bg-transparent data-active:bg-transparent"
      isActive={isActive}
      render={<Link href={`/projects/${project.id}`} />}
    >
      {/* Archived rows read as de-emphasized (mock's `.sec-item[data-archived]`
          icon opacity + muted title). */}
      <FolderIcon
        className={cn("text-muted-foreground", isArchived && "opacity-50")}
      />
      {/* Wrapper so the row's `[&>span:last-child]:truncate` rule lands here
          and not on the name, which fades rather than ellipses. */}
      <span className="flex min-w-0 flex-1 items-center gap-[.35rem]">
        <SidebarRowTitle
          text={project.name}
          animateChanges
          className={cn(isArchived && "text-muted-foreground")}
        />
        {isArchived && <ArchivedBadge />}
      </span>
    </SidebarMenuButton>
  );
}

// One project row, mirroring ChatItem's shape: icon + name, a live pin
// toggle (design D2/D5a — the unified /api/v1/pins resource, pins is the
// sole source of pin state), and a "…" menu with Rename / Archive / Delete.
type ProjectItemProps = {
  project: ProjectResponse;
  isActive: boolean;
  /** From the caller's `usePins()` — this project carries no pin field of its own. */
  isPinned: boolean;
};

function useProjectItemDialogs() {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  return {
    renameOpen,
    deleteOpen,
    setRenameOpen,
    setDeleteOpen,
    openRename: () => setTimeout(() => setRenameOpen(true), 0),
    openDelete: () => setTimeout(() => setDeleteOpen(true), 0),
  };
}

const projectRowClassName = cn(
  "flex items-center rounded-md pr-1 hover:bg-sidebar-accent has-[a:focus-visible]:inset-ring-2 has-[a:focus-visible]:inset-ring-sidebar-ring",
);

export function ProjectItem({ project, isActive, isPinned }: ProjectItemProps) {
  const isArchived = project.archivedAt !== null;
  const togglePin = useProjectItemPin(project, isPinned);
  const dialogs = useProjectItemDialogs();

  return (
    // In-flow actions and a row-level fill, exactly as ChatItem — see
    // HoverReveal for why the row reserves nothing while they are hidden.
    <SidebarMenuItem
      className={cn(projectRowClassName, isActive && "bg-sidebar-accent")}
    >
      <ProjectRowLabel
        project={project}
        isActive={isActive}
        isArchived={isArchived}
      />
      <PinButton isPinned={isPinned} togglePin={togglePin} />
      <ProjectRowMenu
        project={project}
        isActive={isActive}
        isPinned={isPinned}
        onTogglePin={togglePin}
        onRename={dialogs.openRename}
        onDelete={dialogs.openDelete}
      />
      <RenameProjectDialog
        project={project}
        open={dialogs.renameOpen}
        onOpenChange={dialogs.setRenameOpen}
      />
      <DeleteProjectDialog
        project={project}
        open={dialogs.deleteOpen}
        onOpenChange={dialogs.setDeleteOpen}
      />
    </SidebarMenuItem>
  );
}

// Two server-driven categories (mirroring ChatList's architecture):
//   1. Pinned section — ?pinned=only&archived=with (includes archived pinned)
//   2. All section    — ?pinned=exclude (archived excluded by default)
// This retires bug #204 by construction: Pinned is a discrete rendered
// section above All, never interleaved.
function useProjectListSidebarData(filter: string) {
  const { data: pinnedData, isLoading: pinnedLoading } = useProjectsQuery({
    pinned: "only",
    archived: "with",
  });
  const { data: unpinnedData, isLoading: listLoading } = useProjectsQuery({
    pinned: "exclude",
  });

  const pinnedProjects = filterProjectsByName(pinnedData ?? [], filter);
  const filteredUnpinned = filterProjectsByName(unpinnedData ?? [], filter);
  const hasData =
    (pinnedData?.length ?? 0) > 0 || (unpinnedData?.length ?? 0) > 0;

  return {
    pinnedProjects,
    filteredUnpinned,
    hasData,
    isLoading: pinnedLoading || listLoading,
  };
}

function ProjectListSidebarHeader({
  onNewProject,
}: {
  onNewProject: () => void;
}) {
  return (
    <div className={cn(topBarClasses, "gap-2 pr-1.5 pl-3")}>
      <span className="flex-1 text-sm font-semibold">Projects</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={onNewProject}
            />
          }
        >
          <FolderPlusIcon />
          <span className="sr-only">New project</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          New project
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function EmptyProjectsMessage({ text }: { text: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <div className="px-2 text-muted-foreground w-full flex flex-row justify-center items-center text-sm gap-2">
          {text}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function ProjectGroup({
  label,
  projects,
  pathname,
  isPinned,
}: {
  label: string | null;
  projects: Array<ProjectResponse>;
  pathname: string;
  isPinned: boolean;
}) {
  if (projects.length === 0) return null;
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {projects.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              isActive={pathname === `/projects/${project.id}`}
              isPinned={isPinned}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

type ProjectListSidebarContentProps = {
  isLoading: boolean;
  hasData: boolean;
  pinnedProjects: Array<ProjectResponse>;
  filteredUnpinned: Array<ProjectResponse>;
  pathname: string;
};

function projectListIsEmpty({
  isLoading,
  hasData,
  pinnedProjects,
  filteredUnpinned,
}: ProjectListSidebarContentProps): boolean {
  return (
    (isLoading && !hasData) ||
    !hasData ||
    (pinnedProjects.length === 0 && filteredUnpinned.length === 0)
  );
}

function ProjectListSidebarLoadingOrEmptyState({
  isLoading,
  hasData,
  pinnedProjects,
  filteredUnpinned,
}: ProjectListSidebarContentProps) {
  if (isLoading && !hasData) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarRowSkeletons />
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }
  if (!hasData) {
    return (
      <EmptyProjectsMessage text="No projects yet — create one to group your chats." />
    );
  }
  if (pinnedProjects.length === 0 && filteredUnpinned.length === 0) {
    return <EmptyProjectsMessage text="No projects found" />;
  }
  return null;
}

function ProjectListSidebarContent(props: ProjectListSidebarContentProps) {
  if (projectListIsEmpty(props)) {
    return <ProjectListSidebarLoadingOrEmptyState {...props} />;
  }
  const { pinnedProjects, filteredUnpinned, pathname } = props;
  return (
    <>
      <ProjectGroup
        label="Pinned"
        projects={pinnedProjects}
        pathname={pathname}
        isPinned
      />
      <ProjectGroup
        label={pinnedProjects.length > 0 ? "All projects" : null}
        projects={filteredUnpinned}
        pathname={pathname}
        isPinned={false}
      />
    </>
  );
}

// Secondary (nested) sidebar listing projects — the /projects counterpart of
// ChatListSidebar, same shell and desktop-only rule.
export function ProjectListSidebar() {
  const { isMobile } = useSidebar();
  const pathname = usePathname();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { pinnedProjects, filteredUnpinned, hasData, isLoading } =
    useProjectListSidebarData(filter);

  // Only alongside the /projects routes; ChatListSidebar owns the rest.
  if (isMobile || !pathname.startsWith("/projects")) {
    return null;
  }

  return (
    <Sidebar
      collapsible="none"
      className="hidden w-64 shrink-0 border-r bg-background md:flex"
    >
      <ProjectListSidebarHeader onNewProject={() => setNewProjectOpen(true)} />

      <SearchFilterInput
        value={filter}
        onChange={setFilter}
        placeholder="Search projects…"
        className="border-b px-3 py-2"
      />

      <SidebarContent>
        <ProjectListSidebarContent
          isLoading={isLoading}
          hasData={hasData}
          pinnedProjects={pinnedProjects}
          filteredUnpinned={filteredUnpinned}
          pathname={pathname}
        />
      </SidebarContent>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />
    </Sidebar>
  );
}
