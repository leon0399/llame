"use client";

import { useState, type ReactNode } from "react";
import { MessagesSquareIcon } from "lucide-react";
import Link from "next/link";

import { useActiveRuns } from "@/contexts/active-runs-context";
import type { ChatResponse } from "@/lib/services/chat/queries";
import { usePinItem, useUnpinItem } from "@/lib/services/pins/mutations";
import type { ProjectResponse } from "@/lib/services/project/types";
import { ArchivedBadge } from "@/components/archived-badge";
import { PinButton } from "@/components/pin-button";
import { SidebarRowTitle } from "@/components/sidebar-row-title";
import { cn } from "@workspace/ui/lib/utils";
import {
  DeleteChatDialog,
  RenameChatDialog,
} from "../app-sidebar/chat-item-dialogs";
import {
  ChatActivityIndicator,
  resolveChatActivityStatus,
} from "./chat-activity-indicator";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";

import { ChatItemMenu } from "./chat-item-menu";
import { ShareChatDialog } from "./share-chat-dialog";

// Placeholder for untitled chats (title === null, generation pending). Client-owned
// so it can be localized without touching stored data.
const UNTITLED_CHAT_LABEL = "New chat";

function ChatItemIcon({
  isArchived,
  activityStatus,
}: {
  isArchived: boolean;
  activityStatus: ReturnType<typeof resolveChatActivityStatus>;
}) {
  return (
    <span
      // Archived rows read as de-emphasized (mock's
      // `.sec-item[data-archived] .sec-ico { opacity:.5 }`).
      className={cn(
        "relative flex shrink-0 items-center",
        isArchived && "opacity-50",
      )}
    >
      {/* SidebarMenuButton's own [&>svg]:size-4 rule only reaches a DIRECT
          child <svg> — nesting the icon inside this wrapper (for the badge's
          position:relative anchor) took it out from under that rule, so the
          size has to be explicit here now. */}
      <MessagesSquareIcon className="text-muted-foreground size-4" />
      <ChatActivityIndicator status={activityStatus} />
    </span>
  );
}

function ChatItemTitleBlock({
  chat,
  title,
  isArchived,
  activityStatus,
  excerpt,
}: {
  chat: ChatResponse;
  title: string;
  isArchived: boolean;
  activityStatus: ReturnType<typeof resolveChatActivityStatus>;
  excerpt: string | null | undefined;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-w-0 items-center gap-[.35rem]">
        {/* A title cut short fades and scrolls to its end on hover; the
            excerpt keeps an ellipsis — the rest of it belongs to the chat,
            not to this row (DESIGN.md §3, "Overflow"). */}
        <SidebarRowTitle
          text={title}
          animateChanges
          // The placeholder stands in for a name the run is still producing,
          // so it reads as in progress rather than as the chat's actual
          // title.
          shimmer={chat.title === null && activityStatus === "processing"}
          // Archived title de-emphasis (mock's `.sec-title` rule).
          className={cn(isArchived && "text-muted-foreground")}
        />
        {isArchived && <ArchivedBadge />}
      </span>
      {excerpt && (
        <span className="truncate text-xs text-muted-foreground">
          {excerpt}
        </span>
      )}
    </span>
  );
}

/** The row's clickable body: activity icon, title, and excerpt. Split out of
 * `ChatItem` since it's a distinct, self-contained visual region. */
function ChatItemLink({
  chat,
  title,
  isActive,
  isArchived,
  activityStatus,
  excerpt,
}: {
  chat: ChatResponse;
  title: string;
  isActive: boolean;
  isArchived: boolean;
  activityStatus: ReturnType<typeof resolveChatActivityStatus>;
  excerpt: string | null | undefined;
}) {
  return (
    <SidebarMenuButton
      className="h-auto min-w-0 flex-1 py-1.5 hover:bg-transparent focus-visible:ring-0 active:bg-transparent data-active:bg-transparent"
      isActive={isActive}
      render={<Link href={`/chat/${chat.id}`} />}
    >
      <ChatItemIcon isArchived={isArchived} activityStatus={activityStatus} />
      <ChatItemTitleBlock
        chat={chat}
        title={title}
        isArchived={isArchived}
        activityStatus={activityStatus}
        excerpt={excerpt}
      />
    </SidebarMenuButton>
  );
}

function ChatItemRow({
  isActive,
  children,
}: {
  isActive: boolean;
  children: ReactNode;
}) {
  return (
    // A flex line, not the primitive's overlay: the actions below are real
    // layout, so the text shrinks by exactly their width and the row reserves
    // nothing while they are hidden (see HoverReveal). The hover/active fill
    // moves with that — it belongs to the whole row, and the button no longer
    // spans it — so the row paints it and the button hands it back.
    <SidebarMenuItem
      className={cn(
        "flex items-center rounded-md pr-1 hover:bg-sidebar-accent has-[a:focus-visible]:inset-ring-2 has-[a:focus-visible]:inset-ring-sidebar-ring",
        isActive && "bg-sidebar-accent",
      )}
    >
      {children}
    </SidebarMenuItem>
  );
}

type DialogState = { open: boolean; onOpenChange: (open: boolean) => void };

/** The row's three action dialogs, plus the state driving them — bundled so
 * `ChatItem` hands out one object instead of six loose props. */
function useChatItemDialogs() {
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return {
    share: { open: shareOpen, onOpenChange: setShareOpen },
    rename: { open: renameOpen, onOpenChange: setRenameOpen },
    deleteDialog: { open: deleteOpen, onOpenChange: setDeleteOpen },
    openShare: () => setShareOpen(true),
    openRename: () => setRenameOpen(true),
    openDelete: () => setDeleteOpen(true),
  };
}

function ChatItemDialogs({
  chat,
  title,
  isActive,
  share,
  rename,
  deleteDialog,
}: {
  chat: ChatResponse;
  title: string;
  isActive: boolean;
  share: DialogState;
  rename: DialogState;
  deleteDialog: DialogState;
}) {
  return (
    <>
      <ShareChatDialog
        chat={{ id: chat.id, visibility: chat.visibility }}
        {...share}
      />
      <RenameChatDialog chat={{ id: chat.id, title }} {...rename} />
      <DeleteChatDialog
        chat={{ id: chat.id, title }}
        isActive={isActive}
        {...deleteDialog}
      />
    </>
  );
}

/** Everything `ChatItem` derives before it can render: activity status, the
 * three action dialogs, and the pin toggle. Split out so the component below
 * is composition only. */
function useChatItemRow(
  chat: ChatResponse,
  isPinned: boolean,
  isActive: boolean,
) {
  const { completedChats, activeChatIds } = useActiveRuns();
  const activityStatus = resolveChatActivityStatus({
    processing: activeChatIds.has(chat.id),
    unread: completedChats.has(chat.id),
  });
  const dialogs = useChatItemDialogs();
  const pinMutation = usePinItem();
  const unpinMutation = useUnpinItem();

  // Unified pin resource (design D2): PUT to pin, DELETE to unpin, keyed by
  // itemType+itemId. Pinning synthesizes a card from the chat already on
  // screen (design D5a) — the rail can render it before the server responds.
  const togglePin = () =>
    isPinned
      ? unpinMutation.mutate({ itemType: "chat", itemId: chat.id })
      : pinMutation.mutate({
          itemType: "chat",
          itemId: chat.id,
          card: { id: chat.id, title: chat.title, archivedAt: chat.archivedAt },
        });

  const title = chat.title ?? UNTITLED_CHAT_LABEL;

  // One flat context, spread into every child below instead of each
  // repeating the same props at its own call site.
  return {
    chat,
    title,
    isActive,
    isPinned,
    togglePin,
    isArchived: chat.archivedAt !== null,
    excerpt: chat.lastMessage,
    activityStatus,
    onRename: dialogs.openRename,
    onShare: dialogs.openShare,
    onDelete: dialogs.openDelete,
    share: dialogs.share,
    rename: dialogs.rename,
    deleteDialog: dialogs.deleteDialog,
  };
}

export function ChatItem({
  chat,
  isActive = false,
  projects = [],
  onNewProject,
  isPinned = false,
}: {
  chat: ChatResponse;
  isActive?: boolean;
  /** The caller's projects, for the row menu's "Move to project" submenu. */
  projects?: Array<ProjectResponse>;
  /**
   * Opens the caller-owned "new project" dialog (one shared instance, not one
   * per row); the caller files this chat into the created project. Absent →
   * the submenu item renders disabled (never a dead click).
   */
  onNewProject?: () => void;
  /**
   * From the caller's `usePins()` (pins is the sole source of pin state,
   * design D5) — this chat carries no pin field of its own.
   */
  isPinned?: boolean;
}) {
  const row = useChatItemRow(chat, isPinned, isActive);

  return (
    <ChatItemRow isActive={isActive}>
      <ChatItemLink {...row} />
      <PinButton {...row} />
      <ChatItemMenu {...row} projects={projects} onNewProject={onNewProject} />
      <ChatItemDialogs {...row} />
    </ChatItemRow>
  );
}
