"use client";

import * as React from "react";

import { useChatContext } from "@/contexts/chat-context";
import { useChatsQuery } from "@/lib/services/chat/queries";
import { selectPinnedChatMap, usePins } from "@/lib/services/pins/queries";
import { useProjects } from "@/lib/services/project/queries";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@workspace/ui/components/sidebar";
import { usePathname } from "next/navigation";

import { ChatTimeGroups } from "../chat-time-groups";
import { SidebarRowSkeletons } from "../sidebar-row-skeletons";
import { ChatItem } from "./chat-item";
import { CreateProjectForChatDialog } from "./project-dialogs";

// Chat list splits into two server-driven categories (design D4/D5):
//   1. Pinned section — ?pinned=only&archived=with (includes archived pinned)
//   2. All section    — ?pinned=exclude (archived excluded by default)
// This retires bug #204 by construction: Pinned is a discrete rendered
// section above the time-grouped All, never interleaved.
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

  const { data: pinnedData, isLoading: pinnedLoading } = useChatsQuery({
    pinned: "only",
    archived: "with",
  });
  const {
    data,
    isLoading: chatsLoading,
    hasData,
  } = useChatsQuery({
    pinned: "exclude",
  });
  const { data: projects } = useProjects();
  const { data: pins } = usePins();
  const pinnedChats = React.useMemo(
    () => pinnedData?.pages.flat() ?? [],
    [pinnedData],
  );
  const allChats = React.useMemo(() => data?.pages.flat() ?? [], [data]);
  const allProjects = React.useMemo(() => projects ?? [], [projects]);
  const pinnedAtByChatId = React.useMemo(
    () => selectPinnedChatMap(pins),
    [pins],
  );

  const [newProjectChatId, setNewProjectChatId] = React.useState<string | null>(
    null,
  );

  if (chatsLoading || pinnedLoading) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Today</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarRowSkeletons />
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (!hasData && pinnedChats.length === 0) {
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
      {pinnedChats.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="sticky top-0 z-10 bg-sidebar md:bg-background">
            Pinned
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {pinnedChats.map((chat) => (
                <ChatItem
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === selectedChatId}
                  onSelect={handleSelect}
                  projects={allProjects}
                  onNewProject={
                    setNewProjectChatId
                      ? () => setNewProjectChatId(chat.id)
                      : undefined
                  }
                  isPinned={true}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {hasData && (
        <ChatTimeGroups
          chats={allChats}
          selectedChatId={selectedChatId}
          onSelect={handleSelect}
          projects={allProjects}
          onRequestNewProject={setNewProjectChatId}
          pinnedAtByChatId={pinnedAtByChatId}
        />
      )}
      <CreateProjectForChatDialog
        chatId={newProjectChatId}
        onClose={() => setNewProjectChatId(null)}
      />
    </>
  );
}
