"use client";

import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Button } from "@workspace/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
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
  FolderIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  PenLineIcon,
  PinIcon,
  TrashIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SearchFilterInput } from "@/components/search-filter-input";
import { filterProjectsByName } from "@/lib/services/project/filter";
import { useProjects } from "@/lib/services/project/queries";
import type { ProjectResponse } from "@/lib/services/project/types";
import { SidebarRowSkeletons } from "../sidebar-row-skeletons";
import { topBarClasses } from "../top-bar";
import {
  DeleteProjectDialog,
  NewProjectDialog,
  RenameProjectDialog,
} from "../chat-list-sidebar/project-dialogs";

// One project row, mirroring ChatItem's shape: icon + name, a pin action
// (disabled placeholder — pinning isn't implemented yet; never hidden, never
// a dead click), and a "…" menu with Rename / Delete.
function ProjectItem({
  project,
  isActive,
}: {
  project: ProjectResponse;
  isActive: boolean;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
        </Link>
      </SidebarMenuButton>

      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuAction
            showOnHover
            aria-disabled="true"
            tabIndex={-1}
            // Disabled placeholder until pinning ships: keep pointer events
            // for the tooltip, drop the interactive fills (same idiom as the
            // nav's coming-soon items).
            className="right-7 pointer-events-auto! cursor-default opacity-50 hover:bg-transparent!"
          >
            <PinIcon />
            <span className="sr-only">Pin — coming soon</span>
          </SidebarMenuAction>
        </TooltipTrigger>
        <TooltipContent>Pin — coming soon</TooltipContent>
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
        <DropdownMenuContent side="bottom" align="start">
          <DropdownMenuItem
            // Deferred open, same reasoning as the chat row menu's Rename.
            onSelect={() => setTimeout(() => setRenameOpen(true), 0)}
          >
            <PenLineIcon />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setTimeout(() => setDeleteOpen(true), 0)}
          >
            <TrashIcon />
            <span>Delete</span>
          </DropdownMenuItem>
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
export function ProjectListSidebar() {
  const { isMobile } = useSidebar();
  const pathname = usePathname();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { data: projects, isLoading } = useProjects();

  // Only alongside the /projects routes; ChatListSidebar owns the rest.
  if (isMobile || !pathname.startsWith("/projects")) {
    return null;
  }

  const allProjects = projects ?? [];
  const filteredProjects = filterProjectsByName(allProjects, filter);

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
        <SidebarGroup>
          <SidebarGroupContent>
            {isLoading ? (
              <SidebarRowSkeletons />
            ) : allProjects.length === 0 ? (
              <div className="px-2 text-muted-foreground w-full flex flex-row justify-center items-center text-sm gap-2">
                No projects yet — create one to group your chats.
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="px-2 text-muted-foreground w-full flex flex-row justify-center items-center text-sm gap-2">
                No projects found
              </div>
            ) : (
              <SidebarMenu>
                {filteredProjects.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    isActive={pathname === `/projects/${project.id}`}
                  />
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />
    </Sidebar>
  );
}
