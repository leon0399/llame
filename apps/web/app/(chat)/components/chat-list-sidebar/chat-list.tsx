"use client";

import * as React from "react";

import { useChatContext } from "@/contexts/chat-context";
import { useChatsQuery } from "@/lib/services/chat/queries";
import { useProjects } from "@/lib/services/project/queries";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@workspace/ui/components/sidebar";
import { usePathname } from "next/navigation";

import { ChatTimeGroups } from "../chat-time-groups";
import { SidebarRowSkeletons } from "../sidebar-row-skeletons";
import { CreateProjectForChatDialog } from "./project-dialogs";

// Every chat — filed into a project or not — lives in the time-grouped list.
// Project grouping is the /projects section's job (ProjectListSidebar + the
// per-project page), not this rail's.
export function ChatList() {
  const pathname = usePathname();
  const { activeChatId, setActiveChatId } = useChatContext();
  const routeChatId = pathname.startsWith("/chat/")
    ? pathname.split("/")[2]
    : undefined;
  const selectedChatId = routeChatId ?? activeChatId;

  const handleSelect = (chatId: string) => {
    setActiveChatId(chatId);
  };

  const { data, isLoading: chatsLoading, hasData } = useChatsQuery();
  // Only for the rows' "Add to project" submenu — not for grouping.
  const { data: projects } = useProjects();
  const allChats = React.useMemo(() => data?.pages.flat() ?? [], [data]);
  const allProjects = React.useMemo(() => projects ?? [], [projects]);

  // The ONE shared "new project from a chat row" dialog for the whole list
  // (never one per row); non-null = the chat that will be filed on create.
  const [newProjectChatId, setNewProjectChatId] = React.useState<string | null>(
    null,
  );

  if (chatsLoading) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Today</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarRowSkeletons />
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (!hasData) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="px-2 text-muted-foreground w-full flex flex-row justify-center items-center text-sm gap-2">
            Your conversations will appear here once you start chatting!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
      <ChatTimeGroups
        chats={allChats}
        selectedChatId={selectedChatId}
        onSelect={handleSelect}
        projects={allProjects}
        onRequestNewProject={setNewProjectChatId}
      />
      <CreateProjectForChatDialog
        chatId={newProjectChatId}
        onClose={() => setNewProjectChatId(null)}
      />
    </>
  );
}
