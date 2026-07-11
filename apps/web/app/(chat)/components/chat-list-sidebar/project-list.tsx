"use client";

import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
  FolderIcon,
  MoreHorizontalIcon,
  PenLineIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";

import type { ChatResponse } from "@/lib/services/chat/queries";
import type { ProjectResponse } from "@/lib/services/project/types";

import { ChatItem } from "./chat-item";
import {
  DeleteProjectDialog,
  NewProjectDialog,
  RenameProjectDialog,
} from "./project-dialogs";

// One sidebar section per project: name + a "…" menu (rename/delete) in the
// group header, then that project's chats — same SidebarMenuButton/ChatItem
// rows as the time-period groups below it. A project with no chats yet still
// renders its header (so it stays visible/manageable), with a quiet
// placeholder line instead of a chat list.
function ProjectGroup({
  project,
  chats,
  projects,
  selectedChatId,
  onSelect,
}: {
  project: ProjectResponse;
  chats: ChatResponse[];
  projects: ProjectResponse[];
  selectedChatId: string | null | undefined;
  onSelect: (chatId: string) => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="gap-1.5 pr-8">
        <FolderIcon />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
      </SidebarGroupLabel>

      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <SidebarGroupAction>
            <MoreHorizontalIcon />
            <span className="sr-only">Project actions</span>
          </SidebarGroupAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start">
          <DropdownMenuItem
            // Deferred open, same reasoning as the chat row menu's Rename:
            // let the dropdown close normally before the dialog mounts.
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

      <SidebarGroupContent>
        {chats.length > 0 ? (
          <SidebarMenu>
            {chats.map((chat) => (
              <ChatItem
                key={chat.id}
                chat={chat}
                isActive={chat.id === selectedChatId}
                onSelect={onSelect}
                projects={projects}
              />
            ))}
          </SidebarMenu>
        ) : (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            No chats yet
          </div>
        )}
      </SidebarGroupContent>

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
    </SidebarGroup>
  );
}

/**
 * "Projects" section of the chat sidebar: an umbrella header (with the "new
 * project" affordance) followed by one group per project. Always rendered
 * (even with zero projects) so the create affordance stays discoverable —
 * same principle as the top bar's always-visible "New chat" button.
 */
export function ProjectsSection({
  projects,
  chatsByProject,
  selectedChatId,
  onSelect,
}: {
  projects: ProjectResponse[];
  chatsByProject: Map<string, ChatResponse[]>;
  selectedChatId: string | null | undefined;
  onSelect: (chatId: string) => void;
}) {
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarGroupAction onClick={() => setNewProjectOpen(true)}>
              <PlusIcon />
              <span className="sr-only">New project</span>
            </SidebarGroupAction>
          </TooltipTrigger>
          <TooltipContent side="right">New project</TooltipContent>
        </Tooltip>
      </SidebarGroup>

      {projects.map((project) => (
        <ProjectGroup
          key={project.id}
          project={project}
          chats={chatsByProject.get(project.id) ?? []}
          projects={projects}
          selectedChatId={selectedChatId}
          onSelect={onSelect}
        />
      ))}

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />
    </>
  );
}
