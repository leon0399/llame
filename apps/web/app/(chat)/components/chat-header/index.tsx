"use client";

import { useEffect, useMemo } from "react";

import { SidebarTrigger } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import { usePathname } from "next/navigation";

import { topBarClasses } from "@/app/shell/top-bar";
import { useTypewriter } from "@/components/use-typewriter";
import { useChatsQuery } from "@/lib/services/chat/queries";

export interface ChatHeaderProps {
  className?: string;
}

// Same placeholder the chat-list / pins rows use for title === null (#78).
const UNTITLED_CHAT_LABEL = "New chat";

/** Tab title when no chat is open — root layout has no metadata title. */
const DEFAULT_DOCUMENT_TITLE = "llame";

export function PureChatHeader({ className }: ChatHeaderProps) {
  const pathname = usePathname();
  const chatId = pathname.startsWith("/chat/")
    ? pathname.split("/")[2]
    : undefined;

  // Same two list caches the sidebar owns — title changes (generation, rename)
  // invalidate lists(), so the header stays in lockstep with the rails.
  const { data: pinnedData } = useChatsQuery({
    pinned: "only",
    archived: "with",
  });
  const { data: allData } = useChatsQuery({ pinned: "exclude" });

  const settledTitle = useMemo(() => {
    if (!chatId) return null;
    const chats = [
      ...(pinnedData?.pages.flat() ?? []),
      ...(allData?.pages.flat() ?? []),
    ];
    const chat = chats.find((candidate) => candidate.id === chatId);
    // Missing from loaded pages (deep link to an unloaded older chat) reads
    // the same as untitled until the list entry appears — no extra getChat.
    return chat?.title ?? UNTITLED_CHAT_LABEL;
  }, [allData, chatId, pinnedData]);

  const target = settledTitle ?? "";
  const display = useTypewriter(target, { enabled: settledTitle !== null });

  useEffect(() => {
    document.title =
      settledTitle === null ? DEFAULT_DOCUMENT_TITLE : settledTitle;
  }, [settledTitle]);

  // The /projects pages render their own header (project title + trigger);
  // stacking this bar above it would double the chrome.
  if (pathname.startsWith("/projects")) {
    return null;
  }

  return (
    <header
      className={cn(topBarClasses, "bg-background gap-2 px-2", className)}
    >
      {/* Mobile-only: opens the sidebar sheet; the desktop rail has its own toggle. */}
      <SidebarTrigger className="md:hidden" />

      {settledTitle !== null ? (
        <span className="max-w-[60ch] truncate pl-1 text-sm font-semibold">
          {display}
        </span>
      ) : null}
    </header>
  );
}

export const ChatHeader = PureChatHeader;
