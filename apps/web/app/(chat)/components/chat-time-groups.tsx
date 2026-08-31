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
  [ChatGroupPeriod.TODAY]: "Today",
  [ChatGroupPeriod.YESTERDAY]: "Yesterday",
  [ChatGroupPeriod.LAST_WEEK]: "Last 7 Days",
  [ChatGroupPeriod.LAST_MONTH]: "Last 30 Days",
  [ChatGroupPeriod.OLDER]: "Older",
};

/** Row-render props shared by every chat in every time-period group. */
type ChatRowProps = {
  selectedChatId?: string | null;
  /** For the rows' "Add to project" submenu. */
  projects: Array<ProjectResponse>;
  /**
   * A row's "New project" submenu action: the caller owns ONE shared
   * CreateProjectForChatDialog and files the requesting chat on create.
   */
  onRequestNewProject?: (chatId: string) => void;
  /**
   * Chat id -> pinnedAt, from the caller's `usePins()`
   * (`selectPinnedChatMap`). Pins is the sole source of pin state (design
   * D5) — this is what routes a chat into the Pinned group and marks its
   * row's pin toggle, not a field on the chat itself.
   */
  pinnedAtByChatId?: ReadonlyMap<string, string>;
};

/** One time-period section (e.g. "Today", "Last 7 Days") of the chat list. */
function ChatTimeGroup({
  period,
  chats,
  rowProps,
}: {
  period: ChatGroupPeriod;
  chats: Array<ChatResponse>;
  rowProps: ChatRowProps;
}) {
  return (
    <SidebarGroup>
      {/* Sticky scroll anchor. The surface differs per container: the
          mobile sheet paints bg-sidebar, the desktop panel bg-background
          — the md: split matches exactly where each one renders. */}
      <SidebarGroupLabel className="sticky top-0 z-10 bg-sidebar md:bg-background">
        {chatGroupTitles[period]}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {chats.map((chat) => (
            <ChatItem
              key={chat.id}
              chat={chat}
              isActive={chat.id === rowProps.selectedChatId}
              projects={rowProps.projects}
              onNewProject={
                rowProps.onRequestNewProject
                  ? () => rowProps.onRequestNewProject?.(chat.id)
                  : undefined
              }
              isPinned={rowProps.pinnedAtByChatId?.has(chat.id) ?? false}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * The pinned/time-period grouped chat list — ONE grouping behavior for every
 * surface that lists chats (the chats rail, the mobile sheet, the /projects
 * page's "Chats in this project"). Callers own data fetching and their
 * loading/empty states; this renders an already-loaded list.
 */
export function ChatTimeGroups({
  chats,
  selectedChatId,
  projects,
  onRequestNewProject,
  pinnedAtByChatId,
}: {
  chats: Array<ChatResponse>;
} & ChatRowProps) {
  const groupedChats = React.useMemo(
    () => groupChatsByTimePeriod(chats),
    [chats],
  );
  const rowProps: ChatRowProps = {
    selectedChatId,
    projects,
    onRequestNewProject,
    pinnedAtByChatId,
  };

  return (
    <>
      {Object.entries(groupedChats)
        .filter(([, groupChats]) => groupChats.length > 0)
        .map(([period, groupChats]) => (
          <ChatTimeGroup
            key={period}
            // SAFETY: `groupedChats` is built by `groupChatsByTimePeriod`,
            // which only ever populates `ChatGroupPeriod` enum keys —
            // `Object.entries` widens the key type to `string` regardless.
            period={period as ChatGroupPeriod}
            chats={groupChats}
            rowProps={rowProps}
          />
        ))}
    </>
  );
}
