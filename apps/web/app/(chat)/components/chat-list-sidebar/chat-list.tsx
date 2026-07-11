"use client";

import * as React from "react";

import { useChatContext } from "@/contexts/chat-context";
import {
  type ChatResponse,
  ChatGroupPeriod,
  groupChatsByTimePeriod,
  useChatsQuery,
} from "@/lib/services/chat/queries";
import { useProjects } from "@/lib/services/project/queries";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@workspace/ui/components/sidebar";
import { usePathname } from "next/navigation";

import { ChatItem } from "./chat-item";
import { ProjectsSection } from "./project-list";

export { ChatItem } from "./chat-item";

const chatGroupTitles = {
  [ChatGroupPeriod.PINNED]: "Pinned",
  [ChatGroupPeriod.TODAY]: "Today",
  [ChatGroupPeriod.YESTERDAY]: "Yesterday",
  [ChatGroupPeriod.LAST_WEEK]: "Last 7 Days",
  [ChatGroupPeriod.LAST_MONTH]: "Last 30 Days",
  [ChatGroupPeriod.OLDER]: "Older",
};

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
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const allChats = React.useMemo(() => data?.pages.flat() ?? [], [data]);
  const allProjects = React.useMemo(() => projects ?? [], [projects]);

  // The set of projects we actually have loaded. A chat's projectId only
  // counts as "filed" when it resolves against this set — if `useProjects`
  // errored (its `data` then stays undefined/stale) or a filed chat
  // references a project that's since been deleted (desync between the two
  // independent queries), the id won't be in here.
  const loadedProjectIds = React.useMemo(
    () => new Set(allProjects.map((project) => project.id)),
    [allProjects],
  );

  // Projects partition the list first: a chat filed into a LOADED project
  // only ever appears under that project's group, never also under the
  // time-period groups below. A chat whose projectId doesn't resolve against
  // loadedProjectIds (unfiled, or the error/desync case above) falls back to
  // the time-grouped list instead — so a project-list hiccup can't make a
  // filed chat render nowhere and look like data loss. Pinned stays a
  // cross-cutting concern WITHIN each of those two partitions (an unfiled
  // pinned chat still gets its own "Pinned" time-group, same as before this
  // feature; a filed pinned chat surfaces inside its project's group, still
  // showing its pin affordance on the row).
  const unfiledChats = React.useMemo(
    () =>
      allChats.filter(
        (chat) =>
          chat.projectId === null || !loadedProjectIds.has(chat.projectId),
      ),
    [allChats, loadedProjectIds],
  );
  const chatsByProject = React.useMemo(() => {
    const map = new Map<string, ChatResponse[]>();
    for (const chat of allChats) {
      if (chat.projectId === null || !loadedProjectIds.has(chat.projectId))
        continue;
      const list = map.get(chat.projectId);
      if (list) list.push(chat);
      else map.set(chat.projectId, [chat]);
    }
    return map;
  }, [allChats, loadedProjectIds]);
  const groupedChats = React.useMemo(
    () => groupChatsByTimePeriod(unfiledChats),
    [unfiledChats],
  );

  if (chatsLoading || projectsLoading) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Today</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {Array.from({ length: 5 }).map((_, index) => (
              <SidebarMenuItem key={index}>
                <SidebarMenuSkeleton className="*:bg-sidebar-accent-foreground/10" />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (!hasData && allProjects.length === 0) {
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
      <ProjectsSection
        projects={allProjects}
        chatsByProject={chatsByProject}
        selectedChatId={selectedChatId}
        onSelect={handleSelect}
      />

      {Object.entries(groupedChats || {})
        .filter(([, chats]) => chats.length > 0)
        .map(([period, chats]) => (
          <SidebarGroup key={period}>
            {/* Sticky scroll anchor. The surface differs per container: the
                mobile sheet paints bg-sidebar, the desktop panel bg-background
                — the md: split matches exactly where each one renders. */}
            <SidebarGroupLabel className="sticky top-0 z-10 bg-sidebar md:bg-background">
              {chatGroupTitles[period as ChatGroupPeriod]}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {chats.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === selectedChatId}
                    onSelect={handleSelect}
                    projects={allProjects}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
    </>
  );
}
