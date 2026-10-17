"use client";

import * as React from "react";

import {
  type ChatResponse,
  useChatsQuery,
  useOpenChat,
} from "@/lib/services/chat/queries";
import { selectPinnedChatMap, usePins } from "@/lib/services/pins/queries";
import { useProjects } from "@/lib/services/project/queries";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@workspace/ui/components/sidebar";
import { usePathname } from "next/navigation";

import {
  chatListFilters,
  type ListShow,
  ListViewChip,
  pinnedChatsFilters,
  useChatListShow,
} from "../chat-list-view";
import { ChatTimeGroups, PinnedChatGroup } from "../chat-time-groups";
import { SidebarRowSkeletons } from "../sidebar-row-skeletons";
import { CreateProjectForChatDialog } from "./project-dialogs";

/**
 * The open chat is always listed, whatever the view: archiving it, or opening
 * an archived chat from search or a link, never makes the row vanish or the
 * view switch. It slots into `updatedAt` order and leaves on navigation.
 */
function withOpenChat(
  chats: Array<ChatResponse>,
  openChat: ChatResponse | undefined,
  shownElsewhere: ReadonlyArray<ChatResponse>,
): Array<ChatResponse> {
  if (!openChat) return chats;
  const listed = (chat: ChatResponse) => chat.id === openChat.id;
  if (chats.some(listed) || shownElsewhere.some(listed)) return chats;
  return [...chats, openChat].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

function useChatListData() {
  const pathname = usePathname();
  const routeChatId = pathname.startsWith("/chat/")
    ? pathname.split("/")[2]
    : undefined;
  const { show } = useChatListShow();

  const { data: pinnedData, isLoading: pinnedLoading } =
    useChatsQuery(pinnedChatsFilters());
  const { data, isLoading: chatsLoading } = useChatsQuery(
    chatListFilters(show),
  );
  const openChat = useOpenChat(routeChatId);
  const { data: projects } = useProjects();
  const { data: pins } = usePins();
  const pinnedChats = React.useMemo(
    () => (show === "archived" ? [] : (pinnedData?.pages.flat() ?? [])),
    [pinnedData, show],
  );
  const allChats = React.useMemo(
    () => withOpenChat(data?.pages.flat() ?? [], openChat, pinnedChats),
    [data, openChat, pinnedChats],
  );
  const allProjects = React.useMemo(() => projects ?? [], [projects]);
  const pinnedAtByChatId = React.useMemo(
    () => selectPinnedChatMap(pins),
    [pins],
  );

  return {
    show,
    routeChatId,
    pinnedChats,
    allChats,
    allProjects,
    pinnedAtByChatId,
    // Pinned gates the first paint; a view switch reloads only the list.
    isLoading: pinnedLoading,
    listLoading: chatsLoading,
  };
}

function ChatListLoadingState() {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Today</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarRowSkeletons />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const EMPTY_TEXT = new Map<ListShow, string>([
  ["active", "Your conversations will appear here once you start chatting!"],
  ["archived", "No archived chats."],
  ["all", "Your conversations will appear here once you start chatting!"],
]);

function ChatListEmptyState({ show }: { show: ListShow }) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <div className="px-2 text-muted-foreground w-full flex flex-row justify-center items-center text-sm gap-2">
          {EMPTY_TEXT.get(show)}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function ChatListBody() {
  const list = useChatListData();
  const [newProjectChatId, setNewProjectChatId] = React.useState<string | null>(
    null,
  );

  if (list.isLoading) return <ChatListLoadingState />;
  if (
    !list.listLoading &&
    list.allChats.length === 0 &&
    list.pinnedChats.length === 0
  )
    return <ChatListEmptyState show={list.show} />;

  const rowProps = {
    selectedChatId: list.routeChatId,
    projects: list.allProjects,
    onRequestNewProject: setNewProjectChatId,
    pinnedAtByChatId: list.pinnedAtByChatId,
    // Rail and sheet both render on the sidebar surface.
    surfaceClassName: "bg-sidebar",
  };
  return (
    <>
      <PinnedChatGroup chats={list.pinnedChats} {...rowProps} />
      {list.listLoading ? (
        <ChatListLoadingState />
      ) : (
        <ChatTimeGroups chats={list.allChats} {...rowProps} />
      )}
      <CreateProjectForChatDialog
        chatId={newProjectChatId}
        onClose={() => setNewProjectChatId(null)}
      />
    </>
  );
}

// Chat list splits into two server-driven categories (design D4/D5):
//   1. Pinned section — ?pinned=only&archived=with (includes archived pinned)
//   2. The view's list — Active, Archived, or All (see chatListFilters)
// This retires bug #204 by construction: Pinned is a discrete rendered
// section above the time-grouped list, never interleaved.
export function ChatList() {
  const view = useChatListShow();
  return (
    <>
      <ListViewChip {...view} />
      <ChatListBody />
    </>
  );
}
