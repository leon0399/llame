"use client";

import { buttonVariants } from "@workspace/ui/components/button";
import { Kbd } from "@workspace/ui/components/kbd";
import { usePrimaryModifierKey } from "@workspace/ui/hooks/use-modifier-key";
import {
  Sidebar,
  SidebarContent,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { SquarePenIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { topBarClasses } from "@/app/shell/top-bar";
import { SHORTCUT_KEY_NEW_CHAT } from "@/lib/command-palette";
import { ListViewMenu, useChatListShow } from "../chat-list-view";
import { ChatList } from "./chat-list";

/** The rail's new-chat button. Its tooltip names the same Ctrl/⌘+Shift+O
 *  chord as the main rail's New Chat, which the main rail binds. */
function NewChatButton() {
  const modifierKey = usePrimaryModifierKey();
  const key = SHORTCUT_KEY_NEW_CHAT.toUpperCase();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href="/"
            prefetch={false}
            aria-keyshortcuts={`${modifierKey === "⌘" ? "Meta" : "Control"}+Shift+${key}`}
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "size-8",
            )}
          />
        }
      >
        <SquarePenIcon />
        <span className="sr-only">New chat</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <span className="flex items-center gap-1.5">
          New chat
          <Kbd>{`${modifierKey}+Shift+${key}`}</Kbd>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

// Secondary (nested) sidebar listing chats. Desktop-only: on mobile the chat
// list renders inside the main sidebar's sheet instead (see AppSidebar).
export function ChatListSidebar() {
  const { isMobile } = useSidebar();
  const pathname = usePathname();
  const view = useChatListShow();

  // Unmount on mobile — the sheet owns the chat list there; keeping this
  // subtree mounted would double the list render and query subscriptions.
  // The `hidden md:flex` classes below cover the SSR paint, where isMobile
  // is not yet known. The /projects section swaps in its own rail
  // (ProjectListSidebar) instead of this one; /gallery and /settings have none.
  if (isMobile || /^\/(projects|gallery|settings)(\/|$)/.test(pathname)) {
    return null;
  }

  return (
    <Sidebar collapsible="none" className="hidden w-64 shrink-0 md:flex">
      <div className={cn(topBarClasses, "gap-2 pr-1.5 pl-3")}>
        <span className="flex-1 text-sm font-semibold">Chats</span>
        <ListViewMenu {...view} />
        <NewChatButton />
      </div>

      <SidebarContent>
        <ChatList />
      </SidebarContent>
    </Sidebar>
  );
}
