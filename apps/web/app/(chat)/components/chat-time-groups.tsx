"use client";

import * as React from "react";

import {
  type ChatResponse,
  ChatGroupPeriod,
  groupChatsByTimePeriod,
} from "@/lib/services/chat/queries";
import type { ProjectResponse } from "@/lib/services/project/types";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@workspace/ui/components/sidebar";

import { ChatItem } from "./chat-list-sidebar/chat-item";

export const chatGroupTitles = {
  [ChatGroupPeriod.PINNED]: "Pinned",
  [ChatGroupPeriod.TODAY]: "Today",
  [ChatGroupPeriod.YESTERDAY]: "Yesterday",
  [ChatGroupPeriod.LAST_WEEK]: "Last 7 Days",
  [ChatGroupPeriod.LAST_MONTH]: "Last 30 Days",
  [ChatGroupPeriod.OLDER]: "Older",
};

/**
 * The pinned/time-period grouped chat list — ONE grouping behavior for every
 * surface that lists chats (the chats rail, the mobile sheet, the /projects
 * page's "Chats in this project"). Callers own data fetching and their
 * loading/empty states; this renders an already-loaded list.
 */
export function ChatTimeGroups({
  chats,
  selectedChatId,
  onSelect,
  projects,
  onRequestNewProject,
}: {
  chats: ChatResponse[];
  selectedChatId?: string | null;
  onSelect: (chatId: string) => void;
  /** For the rows' "Add to project" submenu. */
  projects: ProjectResponse[];
  /**
   * A row's "New project" submenu action: the caller owns ONE shared
   * CreateProjectForChatDialog and files the requesting chat on create.
   */
  onRequestNewProject?: (chatId: string) => void;
}) {
  const groupedChats = React.useMemo(
    () => groupChatsByTimePeriod(chats),
    [chats],
  );

  return (
    <>
      {Object.entries(groupedChats)
        .filter(([, groupChats]) => groupChats.length > 0)
        .map(([period, groupChats]) => (
          <SidebarGroup key={period}>
            {/* Sticky scroll anchor. The surface differs per container: the
                mobile sheet paints bg-sidebar, the desktop panel bg-background
                — the md: split matches exactly where each one renders. */}
            <SidebarGroupLabel className="sticky top-0 z-10 bg-sidebar md:bg-background">
              {chatGroupTitles[period as ChatGroupPeriod]}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {groupChats.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === selectedChatId}
                    onSelect={onSelect}
                    projects={projects}
                    onNewProject={
                      onRequestNewProject
                        ? () => onRequestNewProject(chat.id)
                        : undefined
                    }
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
    </>
  );
}
