"use client";

import * as React from "react";

import {
  type ChatListFilters,
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
  SidebarMenu,
} from "@workspace/ui/components/sidebar";
import { usePathname } from "next/navigation";

import {
  archivedFilter,
  type ChatListShow,
  ChatListShowChip,
  useChatListShow,
} from "../chat-list-view";
import { ChatTimeGroups } from "../chat-time-groups";
import { SidebarRowSkeletons } from "../sidebar-row-skeletons";
import { ChatItem } from "./chat-item";
import { CreateProjectForChatDialog } from "./project-dialogs";

/** The view's list: Active and All sit below a Pinned section, so they
 *  exclude pins; Archived has no Pinned section and lists archived pins too. */
function listFilters(show: ChatListShow): ChatListFilters {
  if (show === "archived") return { archived: "only" };
  return { pinned: "exclude", archived: archivedFilter(show) };
}

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

  const { data: pinnedData, isLoading: pinnedLoading } = useChatsQuery({
    pinned: "only",
    archived: "with",
  });
  const { data, isLoading: chatsLoading } = useChatsQuery(listFilters(show));
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
    isLoading: chatsLoading || pinnedLoading,
  };
}

function PinnedChatsSection({
  chats,
  routeChatId,
  projects,
  onNewProject,
}: {
  chats: ReturnType<typeof useChatListData>["pinnedChats"];
  routeChatId: string | undefined;
  projects: ReturnType<typeof useChatListData>["allProjects"];
  onNewProject: (chatId: string) => void;
}) {
  if (chats.length === 0) return null;

  return (
    <SidebarGroup>
      {/* The sticky backdrop lives on a plain wrapper: the label owns its own
          appearance, and the opaque fill that hides rows scrolling under it
          is a container concern. `bg-sidebar` matches the rail in both places
          this list renders (mobile sheet and desktop panel). */}
      <div className="sticky top-0 z-10 bg-sidebar">
        <SidebarGroupLabel>Pinned</SidebarGroupLabel>
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          {chats.map((chat) => (
            <ChatItem
              key={chat.id}
              chat={chat}
              isActive={chat.id === routeChatId}
              projects={projects}
              onNewProject={
                onNewProject ? () => onNewProject(chat.id) : undefined
              }
              isPinned={true}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
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

const EMPTY_TEXT = new Map<ChatListShow, string>([
  ["active", "Your conversations will appear here once you start chatting!"],
  ["archived", "No archived chats."],
  ["all", "Your conversations will appear here once you start chatting!"],
]);

function ChatListEmptyState({ show }: { show: ChatListShow }) {
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
  if (list.allChats.length === 0 && list.pinnedChats.length === 0)
    return <ChatListEmptyState show={list.show} />;

  return (
    <>
      <PinnedChatsSection
        chats={list.pinnedChats}
        routeChatId={list.routeChatId}
        projects={list.allProjects}
        onNewProject={setNewProjectChatId}
      />
      <ChatTimeGroups
        chats={list.allChats}
        selectedChatId={list.routeChatId}
        projects={list.allProjects}
        onRequestNewProject={setNewProjectChatId}
        pinnedAtByChatId={list.pinnedAtByChatId}
        // Rail and sheet both render on the sidebar surface.
        surfaceClassName="bg-sidebar"
      />
      <CreateProjectForChatDialog
        chatId={newProjectChatId}
        onClose={() => setNewProjectChatId(null)}
      />
    </>
  );
}

// Chat list splits into two server-driven categories (design D4/D5):
//   1. Pinned section — ?pinned=only&archived=with (includes archived pinned)
//   2. The view's list — Active, Archived, or All (see listFilters)
// This retires bug #204 by construction: Pinned is a discrete rendered
// section above the time-grouped list, never interleaved.
export function ChatList() {
  const view = useChatListShow();
  return (
    <>
      <ChatListShowChip {...view} />
      <ChatListBody />
    </>
  );
}
