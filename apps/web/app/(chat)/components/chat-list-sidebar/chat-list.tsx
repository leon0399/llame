"use client";

import {
  ChatGroupPeriod,
  useGroupedChatsQuery,
} from "@/lib/services/chat/queries";
import { useChatContext } from "@/contexts/chat-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@workspace/ui/components/sidebar";
import {
  ArchiveIcon,
  CopyIcon,
  FolderPlusIcon,
  MessagesSquareIcon,
  MoreHorizontalIcon,
  PenLineIcon,
  PinIcon,
  Share2Icon,
  TrashIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Placeholder for untitled chats (title === null, generation pending). Client-owned
// so it can be localized without touching stored data.
const UNTITLED_CHAT_LABEL = "New chat";

// Row menu, grouped by action semantics: quick pin toggle → chat metadata
// (name, project) → produce-something-new (share, duplicate) → lifecycle
// (reversible archive, then irreversible delete last). Everything is disabled
// until the corresponding feature ships — unimplemented actions stay visible
// but inert.
const CHAT_MENU_GROUPS: {
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
}[][] = [
  [{ label: "Pin", icon: PinIcon }],
  [
    { label: "Rename", icon: PenLineIcon },
    { label: "Add to project", icon: FolderPlusIcon },
  ],
  [
    { label: "Share", icon: Share2Icon },
    { label: "Duplicate", icon: CopyIcon },
  ],
  [
    { label: "Archive", icon: ArchiveIcon },
    { label: "Delete", icon: TrashIcon, destructive: true },
  ],
];

const chatGroupTitles = {
  [ChatGroupPeriod.TODAY]: "Today",
  [ChatGroupPeriod.YESTERDAY]: "Yesterday",
  [ChatGroupPeriod.LAST_WEEK]: "Last 7 Days",
  [ChatGroupPeriod.LAST_MONTH]: "Last 30 Days",
  [ChatGroupPeriod.OLDER]: "Older",
};

function ChatItem({
  chat,
  isActive = false,
  onSelect,
}: {
  chat: {
    id: string;
    title: string | null;
    lastMessage: { excerpt: string } | null;
  };
  isActive?: boolean;
  onSelect: (chatId: string) => void;
}) {
  const excerpt = chat.lastMessage?.excerpt;

  return (
    <SidebarMenuItem>
      {/* Widen the primitive's single-action pr-8 to fit the two row controls. */}
      <SidebarMenuButton
        className="h-auto py-1.5 group-has-data-[sidebar=menu-action]/menu-item:pr-12"
        isActive={isActive}
        asChild
      >
        <Link href={`/chat/${chat.id}`} onNavigate={() => onSelect(chat.id)}>
          <MessagesSquareIcon className="text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">
              {chat.title ?? UNTITLED_CHAT_LABEL}
            </span>
            {excerpt && (
              <span className="truncate text-xs text-muted-foreground">
                {excerpt}
              </span>
            )}
          </span>
        </Link>
      </SidebarMenuButton>

      {/* The rows are two lines tall; top-1/2! outweighs the primitive's
          per-size compound selectors (peer-data-[size=…]:top-*) to re-center. */}
      <SidebarMenuAction
        showOnHover
        disabled
        className="top-1/2! right-7 -translate-y-1/2 disabled:pointer-events-none disabled:opacity-50"
      >
        <PinIcon />
        <span className="sr-only">Pin</span>
      </SidebarMenuAction>

      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            // Always visible on the active row (as on the pre-redesign list),
            // hover-revealed elsewhere.
            showOnHover={!isActive}
            className="top-1/2! -translate-y-1/2 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <MoreHorizontalIcon />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="bottom" align="start">
          {CHAT_MENU_GROUPS.map((group, index) => (
            <DropdownMenuGroup key={index}>
              {index > 0 && <DropdownMenuSeparator />}
              {group.map((action) => (
                <DropdownMenuItem
                  key={action.label}
                  disabled
                  variant={action.destructive ? "destructive" : "default"}
                >
                  <action.icon />
                  <span>{action.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

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
  const { data: groupedChats, isLoading, hasData } = useGroupedChatsQuery();

  if (isLoading) {
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

  if (!hasData) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="px-2 text-zinc-500 w-full flex flex-row justify-center items-center text-sm gap-2">
            Your conversations will appear here once you start chatting!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
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
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
    </>
  );
}
