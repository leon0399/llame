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
import { cn } from "@workspace/ui/lib/utils";

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

/** One titled section ("Pinned", "Today", "Last 7 Days", …) of the list.
 *  Its heading is a sticky scroll anchor that paints the surface it scrolls
 *  over: this list renders on the sidebar rail and sheet and on the project
 *  page, so the surface comes from the caller, and a wrapper paints it
 *  because the label primitive owns its own color. */
function ChatGroup({
  title,
  chats,
  rowProps,
  surfaceClassName,
  pinned = false,
}: {
  title: string;
  chats: Array<ChatResponse>;
  rowProps: ChatRowProps;
  surfaceClassName: string;
  /** Every row is pinned, whether or not the pins map has loaded yet. */
  pinned?: boolean;
}) {
  const { onRequestNewProject, pinnedAtByChatId } = rowProps;
  return (
    <SidebarGroup>
      <div className={cn("sticky top-0 z-10", surfaceClassName)}>
        <SidebarGroupLabel>{title}</SidebarGroupLabel>
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          {chats.map((chat) => (
            <ChatItem
              key={chat.id}
              chat={chat}
              isActive={chat.id === rowProps.selectedChatId}
              projects={rowProps.projects}
              onNewProject={
                onRequestNewProject && (() => onRequestNewProject(chat.id))
              }
              isPinned={pinned || (pinnedAtByChatId?.has(chat.id) ?? false)}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** The Pinned section every chat list shows above its time groups — a
 *  discrete server query, never interleaved with them (#204). Renders
 *  nothing without pinned chats. */
export function PinnedChatGroup({
  chats,
  surfaceClassName,
  ...rowProps
}: {
  chats: Array<ChatResponse>;
  surfaceClassName: string;
} & ChatRowProps) {
  if (chats.length === 0) return null;
  return (
    <ChatGroup
      title="Pinned"
      chats={chats}
      rowProps={rowProps}
      surfaceClassName={surfaceClassName}
      pinned
    />
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
  surfaceClassName,
}: {
  chats: Array<ChatResponse>;
  /**
   * The background the sticky group headings scroll over — `bg-sidebar` in
   * the rail and sheet, `bg-background` on the project page. Required, so a
   * new caller cannot inherit someone else's surface by accident.
   */
  surfaceClassName: string;
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
          <ChatGroup
            key={period}
            // SAFETY: `groupedChats` is built by `groupChatsByTimePeriod`,
            // which only ever populates `ChatGroupPeriod` enum keys —
            // `Object.entries` widens the key type to `string` regardless.
            title={chatGroupTitles[period as ChatGroupPeriod]}
            chats={groupChats}
            rowProps={rowProps}
            surfaceClassName={surfaceClassName}
          />
        ))}
    </>
  );
}
