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
  SidebarMenuAction,
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

import { SearchFilterInput } from "@/components/search-filter-input";
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

// One project row, mirroring ChatItem's shape: icon + name, a live pin
// toggle (design D2/D5a — the unified /api/v1/pins resource, pins is the
// sole source of pin state), and a "…" menu with Rename / Archive / Delete.
function ProjectItem({
  project,
  isActive,
  isPinned,
}: {
  project: ProjectResponse;
  isActive: boolean;
  /** From the caller's `usePins()` — this project carries no pin field of its own. */
  isPinned: boolean;
}) {
  const isArchived = project.archivedAt !== null;
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const pinMutation = usePinItem();
  const unpinMutation = useUnpinItem();
  const archiveMutation = useSetProjectArchive();

  const togglePin = () =>
    isPinned
      ? unpinMutation.mutate({ itemType: "project", itemId: project.id })
      : pinMutation.mutate({
          itemType: "project",
          itemId: project.id,
          card: { id: project.id, name: project.name, archivedAt: project.archivedAt },
        });

  return (
    <SidebarMenuItem>
      {/* Widen the primitive's single-action pr-8 to fit the two row controls
          — same treatment as ChatItem. */}
      <SidebarMenuButton
        className="group-has-data-[sidebar=menu-action]/menu-item:pr-12"
        isActive={isActive}
        asChild
      >
        <Link href={`/projects/${project.id}`}>
          <FolderIcon className="text-muted-foreground" />
          <span className="truncate">{project.name}</span>
          {isArchived && (
            <span className="text-xs text-muted-foreground shrink-0">
              Archived
            </span>
          )}
        </Link>
      </SidebarMenuButton>

      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuAction
            showOnHover={!isPinned}
            className="right-7"
            onClick={togglePin}
          >
            {isPinned ? <PinOffIcon /> : <PinIcon />}
            <span className="sr-only">{isPinned ? "Unpin" : "Pin"}</span>
          </SidebarMenuAction>
        </TooltipTrigger>
        <TooltipContent>{isPinned ? "Unpin" : "Pin"}</TooltipContent>
      </Tooltip>

      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            showOnHover={!isActive}
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <MoreHorizontalIcon />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        {/* Grouped by action semantics with dividers, mirroring ChatItem's
            row menu: pin toggle → rename → lifecycle (archive, then delete). */}
        <DropdownMenuContent side="bottom" align="start">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={togglePin}>
              {isPinned ? <PinOffIcon /> : <PinIcon />}
              <span>{isPinned ? "Unpin" : "Pin"}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => setTimeout(() => setRenameOpen(true), 0)}
            >
              <PenLineIcon />
              <span>Rename</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() =>
                archiveMutation.mutate({
                  id: project.id,
                  archived: project.archivedAt === null ? true : false,
                })
              }
            >
              <ArchiveIcon />
              <span>
                {project.archivedAt === null ? "Archive" : "Unarchive"}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setTimeout(() => setDeleteOpen(true), 0)}
            >
              <TrashIcon />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameProjectDialog
        project={project}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteProjectDialog
        project={project}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </SidebarMenuItem>
  );
}

// Secondary (nested) sidebar listing projects — the /projects counterpart of
// ChatListSidebar, same shell and desktop-only rule.
//
// Two server-driven categories (mirroring ChatList's architecture):
//   1. Pinned section — ?pinned=only&archived=with (includes archived pinned)
//   2. All section    — ?pinned=exclude (archived excluded by default)
// This retires bug #204 by construction: Pinned is a discrete rendered
// section above All, never interleaved.
export function ProjectListSidebar() {
  const { isMobile } = useSidebar();
  const pathname = usePathname();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { data: pinnedData, isLoading: pinnedLoading } = useProjectsQuery({
    pinned: "only",
    archived: "with",
  });
  const { data: unpinnedData, isLoading: listLoading } = useProjectsQuery({
    pinned: "exclude",
  });

  // Only alongside the /projects routes; ChatListSidebar owns the rest.
  if (isMobile || !pathname.startsWith("/projects")) {
    return null;
  }

  const pinnedProjects = filterProjectsByName(pinnedData ?? [], filter);
  const allUnpinnedProjects = unpinnedData ?? [];
  const filteredUnpinned = filterProjectsByName(allUnpinnedProjects, filter);
  const hasData =
    (pinnedData?.length ?? 0) > 0 || (unpinnedData?.length ?? 0) > 0;
  const isLoading = pinnedLoading || listLoading;

  return (
    <Sidebar
      collapsible="none"
      className="hidden w-64 shrink-0 border-r bg-background md:flex"
    >
      <div className={cn(topBarClasses, "gap-2 pr-1.5 pl-3")}>
        <span className="flex-1 text-sm font-semibold">Projects</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setNewProjectOpen(true)}
            >
              <FolderPlusIcon />
              <span className="sr-only">New project</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            New project
          </TooltipContent>
        </Tooltip>
      </div>

      <SearchFilterInput
        value={filter}
        onChange={setFilter}
        placeholder="Search projects…"
        className="border-b px-3 py-2"
      />

      <SidebarContent>
        {isLoading && !hasData ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarRowSkeletons />
            </SidebarGroupContent>
          </SidebarGroup>
        ) : !hasData ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <div className="px-2 text-muted-foreground w-full flex flex-row justify-center items-center text-sm gap-2">
                No projects yet — create one to group your chats.
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : pinnedProjects.length === 0 && filteredUnpinned.length === 0 ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <div className="px-2 text-muted-foreground w-full flex flex-row justify-center items-center text-sm gap-2">
                No projects found
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            {pinnedProjects.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel>Pinned</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {pinnedProjects.map((project) => (
                      <ProjectItem
                        key={project.id}
                        project={project}
                        isActive={pathname === `/projects/${project.id}`}
                        isPinned
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
            {filteredUnpinned.length > 0 && (
              <SidebarGroup>
                {pinnedProjects.length > 0 && (
                  <SidebarGroupLabel>All projects</SidebarGroupLabel>
                )}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {filteredUnpinned.map((project) => (
                      <ProjectItem
                        key={project.id}
                        project={project}
                        isActive={pathname === `/projects/${project.id}`}
                        isPinned={false}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </>
        )}
      </SidebarContent>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />
    </Sidebar>
  );
}
