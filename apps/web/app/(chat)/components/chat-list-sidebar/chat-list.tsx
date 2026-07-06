"use client";

import { useState } from "react";
import {
  ChatGroupPeriod,
  useGroupedChatsQuery,
} from "@/lib/services/chat/queries";
import { useChatContext } from "@/contexts/chat-context";
import { useActiveRuns } from "@/contexts/active-runs-context";
import { useSetChatPinned } from "@/lib/services/chat/management";
import { exportChatAsMarkdown } from "@/lib/services/chat/export";
import { useForkChat } from "@/lib/services/chat/fork";
import {
  DeleteChatDialog,
  RenameChatDialog,
} from "../app-sidebar/chat-item-dialogs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
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
import { toast } from "@workspace/ui/components/sonner";
import {
  ArchiveIcon,
  DownloadIcon,
  FolderPlusIcon,
  GitForkIcon,
  MessagesSquareIcon,
  MoreHorizontalIcon,
  PenLineIcon,
  PinIcon,
  PinOffIcon,
  Share2Icon,
  TrashIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { ShareChatDialog } from "./share-chat-dialog";

// Placeholder for untitled chats (title === null, generation pending). Client-owned
// so it can be localized without touching stored data.
const UNTITLED_CHAT_LABEL = "New chat";

// Row menu, grouped by action semantics: quick pin toggle → chat metadata
// (name, project) → produce-something-new (share, export, fork) → lifecycle
// (reversible archive, then irreversible delete last). Pin, Rename, Share,
// Export, Fork & Delete are wired; everything else stays a visible, disabled
// placeholder until its feature ships (never hidden, never a dead click).
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
    { label: "Export as Markdown", icon: DownloadIcon },
    // Clones the WHOLE chat into a new one the caller owns — reuses the
    // per-message "fork from here" machinery with no anchor message. Same
    // icon + vocabulary as MessageForkButton (the per-message action) —
    // same machinery, same affordance identity.
    { label: "Fork", icon: GitForkIcon },
  ],
  [
    { label: "Archive", icon: ArchiveIcon },
    { label: "Delete", icon: TrashIcon, destructive: true },
  ],
];

const chatGroupTitles = {
  [ChatGroupPeriod.PINNED]: "Pinned",
  [ChatGroupPeriod.TODAY]: "Today",
  [ChatGroupPeriod.YESTERDAY]: "Yesterday",
  [ChatGroupPeriod.LAST_WEEK]: "Last 7 Days",
  [ChatGroupPeriod.LAST_MONTH]: "Last 30 Days",
  [ChatGroupPeriod.OLDER]: "Older",
};

export function ChatItem({
  chat,
  isActive = false,
  onSelect,
}: {
  chat: {
    id: string;
    title: string | null;
    lastMessage: string | null;
    visibility: "private" | "public";
    pinnedAt: string | null;
  };
  isActive?: boolean;
  onSelect: (chatId: string) => void;
}) {
  const excerpt = chat.lastMessage;
  const { completedChats } = useActiveRuns();
  const hasUnseen = completedChats.has(chat.id);
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const title = chat.title ?? UNTITLED_CHAT_LABEL;
  const pinMutation = useSetChatPinned();
  const forkMutation = useForkChat();
  const router = useRouter();
  const isPinned = chat.pinnedAt !== null;

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
            <span className="flex items-center gap-1.5 truncate">
              {hasUnseen && (
                <span
                  aria-label="New reply"
                  className="bg-primary size-2 shrink-0 rounded-full"
                />
              )}
              <span className="truncate">{title}</span>
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
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarMenuAction
            showOnHover={!isPinned}
            className="top-1/2! right-7 -translate-y-1/2"
            onClick={() =>
              pinMutation.mutate({ id: chat.id, pinned: !isPinned })
            }
          >
            {isPinned ? <PinOffIcon /> : <PinIcon />}
            <span className="sr-only">{isPinned ? "Unpin" : "Pin"}</span>
          </SidebarMenuAction>
        </TooltipTrigger>
        <TooltipContent>{isPinned ? "Unpin" : "Pin"}</TooltipContent>
      </Tooltip>

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
              {group.map((action) => {
                const onSelect =
                  action.label === "Pin"
                    ? () =>
                        pinMutation.mutate({
                          id: chat.id,
                          pinned: !isPinned,
                        })
                    : action.label === "Rename"
                      ? () =>
                          // Let the dropdown close normally (no preventDefault
                          // — an always-open dropdown lingering behind the
                          // modal dialog needs a stray extra click to dismiss
                          // once the dialog closes) and defer the dialog open
                          // a tick, so its mount doesn't race the dropdown's
                          // own close/unmount and focus-return.
                          setTimeout(() => setRenameOpen(true), 0)
                      : action.label === "Share"
                        ? () => setTimeout(() => setShareOpen(true), 0)
                        : action.label === "Export as Markdown"
                          ? () => {
                              void exportChatAsMarkdown(chat.id, title).catch(
                                () => toast.error("Couldn't export the chat."),
                              );
                            }
                          : action.label === "Fork"
                            ? () =>
                                // No fromMessageId — clones the WHOLE chat,
                                // same mutation the per-message fork uses.
                                forkMutation.mutate(
                                  { chatId: chat.id },
                                  {
                                    onSuccess: (forked) =>
                                      router.push(`/chat/${forked.id}`),
                                  },
                                )
                            : action.label === "Delete"
                              ? () => setTimeout(() => setDeleteOpen(true), 0)
                              : undefined;

                const Icon =
                  action.label === "Pin" && isPinned ? PinOffIcon : action.icon;
                const label =
                  action.label === "Pin" && isPinned ? "Unpin" : action.label;

                return (
                  <DropdownMenuItem
                    key={action.label}
                    disabled={!onSelect}
                    onSelect={onSelect}
                    variant={action.destructive ? "destructive" : "default"}
                  >
                    <Icon />
                    <span>{label}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ShareChatDialog
        chat={{ id: chat.id, visibility: chat.visibility }}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
      <RenameChatDialog
        chat={{ id: chat.id, title }}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteChatDialog
        chat={{ id: chat.id, title }}
        isActive={isActive}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
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
          <div className="px-2 text-muted-foreground w-full flex flex-row justify-center items-center text-sm gap-2">
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
