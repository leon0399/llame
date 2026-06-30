import { ChatGroupPeriod, useGroupedChatsQuery } from "@/lib/services/chat/queries";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton } from "@workspace/ui/components/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu";
import { MoreHorizontalIcon, PenLineIcon, TrashIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useChatContext } from "@/contexts/chat-context";

function ChatGroupHeader({ 
  children,
  className,
}: { 
  children: React.ReactNode
  className?: string;
}) {
  return (
    <SidebarGroupLabel className={className}>
      {children}
    </SidebarGroupLabel>
  );
}

function ChatItem({
  chat,
  isActive = false,
  onSelect,
}: {
  chat: { id: string; title: string; }
  isActive?: boolean;
  onSelect: (chatId: string) => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton className="group/button" isActive={isActive} onClick={() => onSelect(chat.id)}>
          <span>{chat.title}</span>
      </SidebarMenuButton>

      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            showOnHover={!isActive}
          >
            <MoreHorizontalIcon />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="bottom" align="start">
          <DropdownMenuItem
            className="cursor-pointer"
          >
            <PenLineIcon />
            <span>Rename</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="cursor-pointer text-destructive focus:bg-destructive/15 focus:text-destructive dark:text-red-500"
          >
            <TrashIcon />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

const chatGroupTitles = {
  [ChatGroupPeriod.TODAY]: "Today",
  [ChatGroupPeriod.YESTERDAY]: "Yesterday",
  [ChatGroupPeriod.LAST_WEEK]: "Last 7 Days",
  [ChatGroupPeriod.LAST_MONTH]: "Last 30 Days",
  [ChatGroupPeriod.OLDER]: "Older",
};

export function AppSidebarChatHistory() {
  const router = useRouter();
  const { activeChatId, setActiveChatId } = useChatContext();

  // Selecting a chat must also return to the chat page — `/settings` shares this
  // layout, so updating activeChatId alone would leave the user on settings.
  const handleSelect = (chatId: string) => {
    setActiveChatId(chatId);
    router.push("/");
  };
  const {
    data: groupedChats,
    isLoading,
    hasData,
  } = useGroupedChatsQuery();

  if (isLoading) {
    return (
      <SidebarGroup>
        <ChatGroupHeader>
          Today
        </ChatGroupHeader>
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
    )
  }

  return (
    <>
      {Object.entries(groupedChats || {}).map(([period, chats]) => {
        const chatGroupPeriod = period as ChatGroupPeriod;

        return (
        <SidebarGroup key={chatGroupPeriod}>
          <ChatGroupHeader className="sticky top-0 z-10 bg-sidebar">
            {chatGroupTitles[chatGroupPeriod]}
          </ChatGroupHeader>
          <SidebarGroupContent>
            <SidebarMenu>
              {chats.map((chat) => (
                <ChatItem
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === activeChatId}
                  onSelect={handleSelect}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        )
      })}
    </>
  );
}
