"use client";

import { Button } from "@workspace/ui/components/button";
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
import { useStartNewChat } from "@/contexts/chat-context";
import { topBarClasses } from "../top-bar";
import { ChatList } from "./chat-list";

// Secondary (nested) sidebar listing chats. Desktop-only: on mobile the chat
// list renders inside the main sidebar's sheet instead (see AppSidebar).
export function ChatListSidebar() {
  const { isMobile } = useSidebar();
  const pathname = usePathname();
  const startNewChat = useStartNewChat();

  // Unmount on mobile — the sheet owns the chat list there; keeping this
  // subtree mounted would double the list render and query subscriptions.
  // The `hidden md:flex` classes below cover the SSR paint, where isMobile
  // is not yet known. The /projects section swaps in its own rail
  // (ProjectListSidebar) instead of this one.
  if (isMobile || pathname.startsWith("/projects")) {
    return null;
  }

  return (
    <Sidebar
      collapsible="none"
      className="hidden w-64 shrink-0 border-r bg-background md:flex"
    >
      <div className={cn(topBarClasses, "gap-2 pr-1.5 pl-3")}>
        <span className="flex-1 text-sm font-semibold">Chats</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon" className="size-8">
              <Link href="/" onClick={startNewChat}>
                <SquarePenIcon />
                <span className="sr-only">New chat</span>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            New chat
          </TooltipContent>
        </Tooltip>
      </div>

      <SidebarContent>
        <ChatList />
      </SidebarContent>
    </Sidebar>
  );
}
