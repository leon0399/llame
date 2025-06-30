import { ChatGroupPeriod, useGroupedChats } from "@/lib/services/chat/queries";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton } from "@workspace/ui/components/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu";
import { CheckIcon, GlobeIcon, LockIcon, MoreHorizontalIcon, PenLineIcon, ShareIcon, TrashIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@workspace/ui/lib/utils";

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
}: {
  chat: { id: string; title: string; }
  isActive?: boolean;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild className="group/button" isActive={isActive}>
        <Link href={`/chat/${chat.id}`}>
          <span>{chat.title}</span>
        </Link>
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

        <DropdownMenuContent side="bottom" align="end">
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
  const {
    data: groupedChats,
    isLoading,
    hasData,
  } = useGroupedChats();

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
      {Object.entries(groupedChats || {}).map(([period, chats]) => (
        <SidebarGroup key={period}>
          <ChatGroupHeader className="sticky top-0 z-10 bg-sidebar">
            { /** @ts-ignore */}
            {chatGroupTitles[period]}
          </ChatGroupHeader>
          <SidebarGroupContent>
            <SidebarMenu>
              {chats.map((chat) => (
                <ChatItem key={chat.id} chat={chat} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
      ))}
    </>
  );
}